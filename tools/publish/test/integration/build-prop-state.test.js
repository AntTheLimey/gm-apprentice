'use strict';
// A container's state file, built: on the player site the rows players see, on the GM site every row the GM site lists.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');
const { FILES, LIST, SETTINGS, SEALED_TITLE, SEALED_LINE, stateOf } = require('../helpers/prop-state-vault');

const rels = (site) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/'));

describe('a container state file, built', () => {
  const s = buildBoth({
    ...FILES(),
    // A container without a prop file: its made page, and its state file beside it.
    'Library/Chest.md': '---\ntype: prop\nprop_kind: container\nprop_state: chest.js\n---\nAn oak sea chest.\n',
    'Library/Compass.md': '---\ntype: prop\nprop_container: "[[Chest]]"\nprop_needle: points south\n---\nA brass compass.\n',
    ...LIST(['Library/Chest.md', 'Library/Compass.md']),
  }, SETTINGS);
  after(() => s.cleanup());

  it('a container with prop_file and prop_state ships its page, the made state file and the item pictures', () => {
    const files = rels(s.player);
    for (const f of ['props/bookcase.html', 'props/shelf.js', 'props/state.js', 'props/covers/atlas.png']) assert.ok(files.includes(f), `${f}: ${files.join(', ')}`);
    assert.match(s.player.read('props', 'bookcase.html'), /<script src="state\.js"><\/script>/);
    assert.deepEqual(Object.keys(stateOf(s.player.read('props', 'state.js')).LIBRARY), ['atlas-of-the-coast', 'the-sealed-volume-of-hours']);
    assert.equal(s.player.read('props', 'covers', 'atlas.png'), 'PNG-ATLAS');
    assert.ok(!files.some((f) => /sealed\.png|stamp\.png/.test(f)), files.join(', '));
    // The made container: its page and its state file, keyed by its item's note.
    assert.ok(files.includes('props/chest.html'));
    assert.deepEqual(stateOf(s.player.read('props', 'chest.js')).PROP_ITEMS, {
      compass: { title: 'Compass', line: null, href: '../library/compass.html', sealed: false, needle: 'points south' },
    });
  });

  it("the GM site's state lists unrevealed items", () => {
    const { LIBRARY } = stateOf(s.gm.read('props', 'state.js'));
    assert.deepEqual(Object.keys(LIBRARY).sort(), ['atlas-of-the-coast', 'ledger-of-debts', 'the-sealed-volume-of-hours']);
    assert.deepEqual(LIBRARY['the-sealed-volume-of-hours'], {
      title: SEALED_TITLE, line: SEALED_LINE, href: '../library/the-sealed-volume-of-hours.html', sealed: false, cover: 'covers/sealed.png',
    });
    assert.equal(LIBRARY['ledger-of-debts'].title, 'Ledger of Debts', 'a withheld name, without the GM site\'s marks');
    assert.ok(!Object.values(LIBRARY).some((v) => v.sealed), 'nothing is sealed from the GM');
    assert.equal(s.gm.read('props', 'covers', 'sealed.png'), 'PNG-SEALED');
  });
});
