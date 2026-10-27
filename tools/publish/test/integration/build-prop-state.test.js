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

describe("an item's own page that loads its container's state file", () => {
  // The atlas has a page of its own in a folder under the shelf's, loading the shelf's state as ../state.js (as a
  // hand-made library's book pages do); a second book's page sits beside the shelf and loads state.js.
  const ATLAS = FILES()['Library/Atlas of the Coast.md'].replace('prop_container:', 'prop_file: books/atlas.html\nprop_address: props/books/atlas.html\nprop_container:');
  const PAGE = (src) => `<!doctype html><html><head><title>Book</title></head><body><p>A book.</p><script src="${src}"></script></body></html>`;
  const s = buildBoth({
    ...FILES({ 'Library/Atlas of the Coast.md': ATLAS }),
    'Library/books/atlas.html': PAGE('../state.js'),
    'Library/Tide Book.md': '---\ntype: prop\nprop_container: "[[Bookcase]]"\nprop_file: tide.html\nprop_address: props/tide.html\nprop_cover: covers/stamp.png\n---\nA tide book.\n',
    'Library/tide.html': PAGE('state.js'),
    ...LIST(['Library/Tide Book.md']),
  }, { ...SETTINGS, sites: ['player'] });
  after(() => s.cleanup());

  it('the container still makes its state file, and its pictures ship', () => {
    const files = rels(s.player);
    for (const f of ['props/books/atlas.html', 'props/tide.html', 'props/state.js', 'props/covers/atlas.png']) assert.ok(files.includes(f), `${f}: ${files.join(', ')}`);
    const { LIBRARY } = stateOf(s.player.read('props', 'state.js'));
    assert.ok(!('old' in LIBRARY), 'the vault copy of state.js is not what ships');
    assert.deepEqual(Object.keys(LIBRARY).sort(), ['atlas', 'the-sealed-volume-of-hours', 'tide']);
    assert.equal(LIBRARY.atlas.href, 'books/atlas.html');
    assert.equal(s.player.read('props', 'covers', 'atlas.png'), 'PNG-ATLAS');
    // The links read as the made file: no row says the state file is taken, outside its folder or missing.
    assert.ok(!s.logs.some((l) => /links "(\.\.\/)?state\.js"|prop_state/.test(l)), s.logs.join('\n'));
    assert.match(s.player.read('props', 'books', 'atlas.html'), /<script src="\.\.\/state\.js"><\/script>/);
  });
});

describe('a state file refused because another container already makes it', () => {
  // The only way the build refuses a state file: a second container whose state lands on the same address (a site
  // file, a tool folder, a kept folder or a page could only hold that address if the container's own address were
  // refused first, see task 15's report). The first container's file is made, so the second's items link a real file.
  const s = buildBoth({
    ...FILES(),
    'Library/Chest.md': '---\ntype: prop\nprop_kind: container\nprop_address: props/chest.html\nprop_state: state.js\nprop_state_global: CHEST\n---\nA sea chest.\n',
    'Library/Tide Book.md': '---\ntype: prop\nprop_container: "[[Bookcase]]"\nprop_file: tide.html\nprop_address: props/tide.html\n---\nA tide book.\n',
    'Library/tide.html': '<!doctype html><html><head><title>Book</title></head><body><p>A book.</p><script src="state.js"></script></body></html>',
    ...LIST(['Library/Chest.md', 'Library/Tide Book.md']),
  }, { ...SETTINGS, sites: ['player'] });
  after(() => s.cleanup());

  it('names the refusal, ships the one made file, and the items link it', () => {
    assert.ok(s.logs.some((l) => /Bookcase\.md: prop_state "state\.js" would land on props\/state\.js, taken by Library\/Chest\.md/.test(l)), s.logs.join('\n'));
    assert.ok('CHEST' in stateOf(s.player.read('props', 'state.js')), 'the made file is the chest\'s');
    assert.ok(!s.logs.some((l) => /tide\.html links "state\.js"/.test(l)), s.logs.join('\n'));
    assert.ok(s.player.exists('props', 'tide.html'));
  });
});
