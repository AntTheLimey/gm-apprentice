'use strict';
// A prop its container lists that has nothing of its own to show (an `object` in a container, no file, no style, no
// ties, no words): the container's listing and state file carry it, and the build writes no page of it, so no empty
// page turns up in search (#528: a clasped book on a shelf). Words in its body give it its page back. Text is original.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoth } = require('../helpers/gm-build');
const { FILES, LIST, SETTINGS, stateOf } = require('../helpers/prop-state-vault');
const { isListedOnly } = require('../../lib/props/note');
const { runLeakGate } = require('../../lib/leak-gate');

const CLASPED = (body = '') => `---\ntype: prop\nprop_kind: object\nprop_container: "[[Bookcase]]"\nprop_line: A slim volume that stays shut\nprop_status: clasped\nrelationships: []\n---\n${body}`;
const files = (body) => FILES({
  'Library/Clasped Volume.md': CLASPED(body),
  ...LIST(['Library/Clasped Volume.md']),
});

describe('isListedOnly', () => {
  const fm = { type: 'prop', prop_kind: 'object', prop_container: '[[Bookcase]]', relationships: [] };
  it('an empty object in a container is listed only', () => assert.equal(isListedOnly(fm, '\n  \n'), true));
  for (const [name, over, body] of [
    ['words in its body', {}, 'A slim volume.\n'],
    ['a tie', { relationships: [{ target: '[[Atlas of the Coast]]', type: 'beside' }] }, ''],
    ['no container', { prop_container: '' }, ''],
    ['a file of its own', { prop_file: 'volume.html' }, ''],
    ['a style', { prop_style: 'letter' }, ''],
    ['another kind', { prop_kind: 'document' }, ''],
  ]) {
    it(`not with ${name}`, () => assert.equal(isListedOnly({ ...fm, ...over }, body), false));
  }
});

describe('a prop its container lists with nothing of its own to show', () => {
  const s = buildBoth(files(''), { ...SETTINGS });
  after(() => s.cleanup());

  it('is in the state file with its fields and no link', () => {
    const { LIBRARY } = stateOf(s.player.read('props', 'state.js'));
    assert.deepEqual(LIBRARY['clasped-volume'], {
      title: 'Clasped Volume', line: 'A slim volume that stays shut', href: null, sealed: false, status: 'clasped',
    });
  });

  it('gets no page on either site and no search entry', () => {
    for (const site of [s.player, s.gm]) {
      assert.ok(!site.files().some((f) => /clasped-volume/i.test(f)), site.files().join(', '));
      assert.doesNotMatch(site.read('search-index.json'), /Clasped Volume/);
    }
  });

  it('is listed on the props page by title, unlinked', () => {
    const page = s.player.read('props', 'index.html');
    assert.match(page, /<span class="prop-title">Clasped Volume<\/span>/);
    assert.doesNotMatch(page, /<a [^>]*>Clasped Volume</);
  });

  it('explain says its container lists it with no page, not that it publishes at an address', () => {
    const { spawnSync } = require('node:child_process');
    const path = require('node:path');
    const bin = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
    const done = spawnSync(process.execPath, [bin, 'explain', 'Library/Clasped Volume.md', '--config', s.configPath], { encoding: 'utf8' });
    assert.match(done.stdout, /VERDICT: listed by its container, with no page of its own \(LISTED_ONLY\)/, done.stdout + done.stderr);
    assert.doesNotMatch(done.stdout, /VERDICT: publishes at/);
    const all = spawnSync(process.execPath, [bin, 'explain', '--all', '--json', '--config', s.configPath], { encoding: 'utf8' });
    const row = JSON.parse(all.stdout).pages.find((p) => p.path === 'Library/Clasped Volume.md');
    assert.equal(row.noPage, true);
    assert.equal(row.publishes, true);
  });

  it('the leak check finds nothing', () => {
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });
});

describe('the same prop with words in its body', () => {
  const s = buildBoth(files('The clasp is shaped like a hand.\n'), { ...SETTINGS, sites: ['player'] });
  after(() => s.cleanup());

  it('has its page, and its state entry links it', () => {
    assert.ok(s.player.files().some((f) => /clasped-volume\.html$/.test(f)), s.player.files().join(', '));
    assert.match(stateOf(s.player.read('props', 'state.js')).LIBRARY['clasped-volume'].href, /clasped-volume\.html$/);
  });
});

// Wave 1: the player view decides, per site.
describe('a listed-only prop whose body holds only GM Notes', () => {
  const GM = '<!-- gm-only -->\n\n## GM Notes\n\nThe clasp hides a key.\n\n<!-- /gm-only -->\n';
  const s = buildBoth(files(GM), { ...SETTINGS });
  after(() => s.cleanup());

  it('has no page and no search entry on the player site', () => {
    assert.ok(!s.player.files().some((f) => /clasped-volume/i.test(f)), s.player.files().join(', '));
    assert.doesNotMatch(s.player.read('search-index.json'), /Clasped Volume/);
    assert.equal(stateOf(s.player.read('props', 'state.js')).LIBRARY['clasped-volume'].href, null);
  });

  it('has its page on the GM site, where its GM Notes show', () => {
    assert.ok(s.gm.files().some((f) => /clasped-volume\.html$/.test(f)), s.gm.files().join(', '));
  });

  it('its GM Notes are hidden text to the leak check', () => {
    const { leakInto } = require('../helpers/leak-site');
    leakInto(s.player.dir, 'props/index.html', 'The clasp hides a key.');
    const found = runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings.map((f) => f.text);
    assert.ok(found.includes('the clasp hides a key'), found.join(' | '));
  });
});

describe('a listed-only prop with a hidden field', () => {
  const HIDDEN = 'Pawned twice by the harbour clerk';
  const s = buildBoth(FILES({
    'Library/Clasped Volume.md': CLASPED().replace('prop_status: clasped\n', `prop_status: clasped\nprop_secret: ${HIDDEN}\n`),
    ...LIST(['Library/Clasped Volume.md']),
  }), { ...SETTINGS, sites: ['player'] });
  after(() => s.cleanup());

  it('the field is not in the state file, and found where a page shows it', () => {
    assert.ok(!s.player.read('props', 'state.js').includes(HIDDEN));
    const { leakInto } = require('../helpers/leak-site');
    leakInto(s.player.dir, 'props/index.html', HIDDEN);
    const found = runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings.map((f) => f.text);
    assert.ok(found.includes('pawned twice by the harbour clerk'), found.join(' | '));
  });
});

describe('a listed-only prop whose GM Notes the GM site does not show', () => {
  const GM = '## GM Notes\n\nThe clasp hides a key.\n';
  const s = buildBoth(files(GM), { ...SETTINGS, gm: { show: { sections: false } } });
  after(() => s.cleanup());

  it('has no page on the GM site either', () => {
    assert.ok(!s.gm.files().some((f) => /clasped-volume/i.test(f)), s.gm.files().join(', '));
    assert.ok(!s.player.files().some((f) => /clasped-volume/i.test(f)));
  });
});

describe('a listed-only prop whose GM Notes the GM site shows (the default)', () => {
  const s = buildBoth(files('## GM Notes\n\nThe clasp hides a key.\n'), { ...SETTINGS });
  after(() => s.cleanup());

  it('has its page on the GM site', () => {
    assert.ok(s.gm.files().some((f) => /clasped-volume\.html$/.test(f)), s.gm.files().join(', '));
  });
});
