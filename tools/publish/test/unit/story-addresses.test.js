'use strict';
// Sessions that move chapter keep their old Story address (chapter pages, Task 8): the record of the Story addresses
// each session has had, kept beside the site, and the moves it gives.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readStoryAddresses, writeStoryAddresses, movedSessions, storyAddressesPath } = require('../../lib/story-addresses');

const session = (rel, outputPath) => ({ kind: 'session', outputPath, sourcePage: { rel } });
const chapter = (outputPath) => ({ kind: 'chapter', outputPath, sourcePage: { rel: 'Chapters/C.md' } });
const relOf = (page) => page.rel;

describe('story addresses', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'story-addr-'));

  it('no record reads as none; an unreadable one too', () => {
    const dir = tmp();
    try {
      assert.equal(readStoryAddresses(dir).size, 0);
      fs.mkdirSync(path.dirname(storyAddressesPath(dir)), { recursive: true });
      fs.writeFileSync(storyAddressesPath(dir), '{not json');
      assert.equal(readStoryAddresses(dir).size, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps every address a session has had, sessions only, beside the site (never in it)', () => {
    const dir = tmp();
    try {
      writeStoryAddresses(dir, [chapter('story/c.html'), session('Sessions/S 1.md', 'story/c-s1.html')], relOf, new Map());
      assert.ok(storyAddressesPath(dir).startsWith(path.join(dir, '.gm-apprentice') + path.sep));
      const first = readStoryAddresses(dir);
      assert.deepEqual([...first], [['Sessions/S 1.md', ['story/c-s1.html']]]);
      writeStoryAddresses(dir, [session('Sessions/S 1.md', 'story/d-s1.html')], relOf, first);
      assert.deepEqual([...readStoryAddresses(dir)], [['Sessions/S 1.md', ['story/c-s1.html', 'story/d-s1.html']]]);
      // A session the Story no longer shows keeps its addresses, for when it shows again.
      writeStoryAddresses(dir, [], relOf, readStoryAddresses(dir));
      assert.deepEqual([...readStoryAddresses(dir)], [['Sessions/S 1.md', ['story/c-s1.html', 'story/d-s1.html']]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a session key is read in NFC however its accents were typed', () => {
    const dir = tmp();
    try {
      const nfd = 'Sessions/Sesión 1.md'.normalize('NFD');
      writeStoryAddresses(dir, [session(nfd, 'story/c-s1.html')], relOf, new Map());
      assert.deepEqual([...readStoryAddresses(dir).keys()], ['Sessions/Sesión 1.md'.normalize('NFC')]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('movedSessions: each earlier address of a shown session that is no page of this build leads to its address now', () => {
    const previous = new Map([['Sessions/S 1.md', ['story/a-s1.html', 'story/b-s1.html']], ['Sessions/S 2.md', ['story/a-s2.html']], ['Sessions/Gone.md', ['story/a-gone.html']]]);
    const spine = [session('Sessions/S 1.md', 'story/c-s1.html'), session('Sessions/S 2.md', 'story/a-s2.html'), chapter('story/a.html')];
    const taken = new Set(['story/b-s1.html']);
    assert.deepEqual(movedSessions(previous, spine, relOf, taken), [{ from: 'story/a-s1.html', to: 'story/c-s1.html' }]);
  });
});
