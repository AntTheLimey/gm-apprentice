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
