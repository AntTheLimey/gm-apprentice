'use strict';
// Sessions that move chapter keep their old Story address (chapter pages, Task 8): the record of the Story addresses
// each session has had, kept beside the site, and the moves it gives.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readStoryAddresses, writeStoryAddresses, movedSessions, storyAddressesPath, sharedSessionNames } = require('../../lib/story-addresses');

const session = (rel, outputPath) => ({ kind: 'session', outputPath, sourcePage: { rel } });
const chapter = (outputPath) => ({ kind: 'chapter', outputPath, sourcePage: { rel: 'Chapters/C.md' } });
const relOf = (page) => page.rel;

describe('story addresses', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'story-addr-'));

  it('no record reads as none, silently', () => {
    const dir = tmp();
    try {
      const said = [];
      assert.equal(readStoryAddresses(dir, { warn: (m) => said.push(m), today: '2026-11-04' }).size, 0);
      assert.deepEqual(said, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // A record that cannot be read is never overwritten: it is moved aside to a dated .bak, the build says so, and a new
  // record starts (PR C review S1).
  for (const [what, text] of [['corrupt', '{"version":1,"sessions":{'], ['of another version', '{"version":9,"sessions":{}}'], ['not a record', '[1,2]']]) {
    it(`a ${what} record is moved aside, said, and read as none`, () => {
      const dir = tmp();
      try {
        fs.mkdirSync(path.dirname(storyAddressesPath(dir)), { recursive: true });
        fs.writeFileSync(storyAddressesPath(dir), text);
        const said = [];
        assert.equal(readStoryAddresses(dir, { warn: (m) => said.push(m), today: '2026-11-04' }).size, 0);
        assert.equal(said.length, 1, said.join('\n'));
        assert.match(said[0], /story-addresses\.json/);
        assert.match(said[0], /story-addresses\.json\.2026-11-04\.bak/);
        assert.equal(fs.readFileSync(`${storyAddressesPath(dir)}.2026-11-04.bak`, 'utf8'), text);
        assert.equal(fs.existsSync(storyAddressesPath(dir)), false);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }

  it('a second .bak the same day does not overwrite the first', () => {
    const dir = tmp();
    try {
      fs.mkdirSync(path.dirname(storyAddressesPath(dir)), { recursive: true });
      fs.writeFileSync(`${storyAddressesPath(dir)}.2026-11-04.bak`, 'FIRST');
      fs.writeFileSync(storyAddressesPath(dir), 'SECOND{');
      readStoryAddresses(dir, { warn: () => {}, today: '2026-11-04' });
      assert.equal(fs.readFileSync(`${storyAddressesPath(dir)}.2026-11-04.bak`, 'utf8'), 'FIRST');
      assert.equal(fs.readFileSync(`${storyAddressesPath(dir)}.2026-11-04-2.bak`, 'utf8'), 'SECOND{');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // A session is known by its note's file name, which a move to another chapter's folder keeps.
  it('keeps every address a session has had, sessions only, beside the site (never in it)', () => {
    const dir = tmp();
    try {
      writeStoryAddresses(dir, [chapter('story/c.html'), session('Sessions/S 1.md', 'story/c-s1.html')], relOf, new Map());
      assert.ok(storyAddressesPath(dir).startsWith(path.join(dir, '.gm-apprentice') + path.sep));
      const first = readStoryAddresses(dir);
      assert.deepEqual([...first], [['S 1.md', ['story/c-s1.html']]]);
      writeStoryAddresses(dir, [session('Sessions/S 1.md', 'story/d-s1.html')], relOf, first);
      assert.deepEqual([...readStoryAddresses(dir)], [['S 1.md', ['story/c-s1.html', 'story/d-s1.html']]]);
      // A session the Story no longer shows keeps its addresses, for when it shows again.
      writeStoryAddresses(dir, [], relOf, readStoryAddresses(dir));
      assert.deepEqual([...readStoryAddresses(dir)], [['S 1.md', ['story/c-s1.html', 'story/d-s1.html']]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a session key is read in NFC however its accents were typed', () => {
    const dir = tmp();
    try {
      const nfd = 'Sessions/Sesión 1.md'.normalize('NFD');
      writeStoryAddresses(dir, [session(nfd, 'story/c-s1.html')], relOf, new Map());
      assert.deepEqual([...readStoryAddresses(dir).keys()], ['Sesión 1.md'.normalize('NFC')]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('movedSessions: each earlier address of a shown session that is no page of this build leads to its address now', () => {
    const previous = new Map([['S 1.md', ['story/a-s1.html', 'story/b-s1.html']], ['S 2.md', ['story/a-s2.html']], ['Gone.md', ['story/a-gone.html']]]);
    const spine = [session('Sessions/S 1.md', 'story/c-s1.html'), session('Sessions/S 2.md', 'story/a-s2.html'), chapter('story/a.html')];
    const taken = new Set(['story/b-s1.html']);
    assert.deepEqual(movedSessions(previous, spine, relOf, taken), [{ from: 'story/a-s1.html', to: 'story/c-s1.html' }]);
  });

  it('a session moved to another folder is the same session; two sessions with one file name are neither', () => {
    const previous = new Map([['S 1.md', ['story/a-s1.html']], ['Dup.md', ['story/a-dup.html']]]);
    const spine = [session('Chapters/B/S 1.md', 'story/b-s1.html'), session('Chapters/A/Dup.md', 'story/a2-dup.html'), session('Chapters/B/Dup.md', 'story/b-dup.html')];
    assert.deepEqual(movedSessions(previous, spine, relOf, new Set()), [{ from: 'story/a-s1.html', to: 'story/b-s1.html' }]);
    const dir = tmp();
    try {
      writeStoryAddresses(dir, spine, relOf, previous);
      // A recorded name that now has a twin is dropped: its old address can no longer say which session it was.
      assert.equal(readStoryAddresses(dir).has('Dup.md'), false);
      assert.deepEqual(sharedSessionNames(spine, relOf), ['Dup.md']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
