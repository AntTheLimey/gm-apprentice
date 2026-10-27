'use strict';
// A container's state file (prop_state): a script beside its page setting one global to what the container lists, so a
// hand-made page can show it. Only what the listing shows reaches it: a shown item's row and published prop_* fields, a
// sealed item's title, no withheld item. And `props read-state`, which reads a hand-made one for the move.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildBoth } = require('../helpers/gm-build');
const { FILES, BOOKCASE, SETTINGS, SEALED_TITLE, SEALED_LINE, HIDDEN_FIELD, ODD, stateOf } = require('../helpers/prop-state-vault');
const { stateItems, stateScript } = require('../../lib/props/collection');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const rels = (site) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/'));

describe('a container state file', () => {
  const s = buildBoth(FILES(), { ...SETTINGS, sites: ['player'] });
  after(() => s.cleanup());
  const text = () => s.player.read('props', 'state.js');

  it("the state is the listing's rows", () => {
    const { LIBRARY } = stateOf(text());
    assert.deepEqual(Object.keys(LIBRARY), ['atlas-of-the-coast', 'the-sealed-volume-of-hours']);
    assert.deepEqual(LIBRARY['atlas-of-the-coast'], {
      title: 'Atlas of the Coast', line: 'Charts of every cove and inlet', href: '../library/atlas-of-the-coast.html', sealed: false,
      cover: 'covers/atlas.png', spine: 'Blue cloth', pages: 212, back: '../outside.png', odd: ODD,
    });
    // The props page lists the same rows, in the same order.
    const listing = s.player.read('props', 'index.html');
    assert.ok(listing.indexOf('Atlas of the Coast') < listing.indexOf(SEALED_TITLE), 'listing order');
  });

  it('a sealed item is its title only', () => {
    assert.deepEqual(stateOf(text()).LIBRARY['the-sealed-volume-of-hours'], { title: SEALED_TITLE, sealed: true });
    assert.ok(!text().includes(SEALED_LINE));
    assert.doesNotMatch(text(), /sealed\.png|book of hours/);
  });

  it('a withheld item is absent', () => {
    assert.doesNotMatch(text(), /Ledger|ledger|harbourmaster/);
  });

  it('a hidden prop field is absent', () => {
    assert.doesNotMatch(text(), /secret|stamp|Corwin/);
    assert.ok(!text().includes(HIDDEN_FIELD));
  });

  it('a field with </script> cannot end the script', () => {
    assert.ok(!text().includes('</script>'), text());
    assert.ok(!text().includes('<'), 'every < is escaped');
    assert.equal(stateOf(text()).LIBRARY['atlas-of-the-coast'].odd, ODD);
  });

  it('item pictures are copied, ../ ones are not', () => {
    assert.equal(s.player.read('props', 'covers', 'atlas.png'), 'PNG-ATLAS');
    const files = rels(s.player);
    assert.ok(!files.some((f) => /sealed\.png|stamp\.png|outside\.png/.test(f)), files.join(', '));
    assert.ok(s.logs.some((l) => /Atlas of the Coast\.md: prop_back "\.\.\/outside\.png" climbs out/.test(l)), s.logs.join('\n'));
  });

  it("the vault's own state.js is not copied", () => {
    assert.match(text(), /^window\.LIBRARY = \{/);
    assert.doesNotMatch(text(), /vault copy/);
    // The page and its other script ship as they are.
    assert.ok(s.player.exists('props', 'bookcase.html'));
    assert.ok(s.player.exists('props', 'shelf.js'));
  });
});

describe('a state file that cannot be made', () => {
  for (const [name, fm, said] of [
    ['a bad prop_state name is a row and no file', 'prop_state: State.JS\n', /prop_state "State\.JS" is not a file name/],
    ['a prop_state with a folder is a row and no file', 'prop_state: data/state.js\n', /prop_state "data\/state\.js" is not a file name/],
    ['a bad prop_state_global is a row and no file', 'prop_state: state.js\nprop_state_global: library\n', /prop_state_global "library" is not a name/],
  ]) {
    it(name, () => {
      const files = FILES({ 'Library/Bookcase.md': BOOKCASE().replace('prop_state: state.js\nprop_state_global: LIBRARY\n', fm) });
      const s = buildBoth(files, { ...SETTINGS, sites: ['player'] });
      try {
        assert.ok(s.logs.some((l) => /Library\/Bookcase\.md:/.test(l) && said.test(l)), s.logs.join('\n'));
        // No made file; the vault's own state.js is not linked from the page under another name, so nothing is at state.js
        // but what the page itself links (the vault's copy, when its name is not the bad one).
        // By name, as listed (a Mac's folders do not tell State.JS from state.js).
        const built = rels(s.player);
        assert.ok(!built.includes('props/State.JS') && !built.includes('props/data/state.js'), built.join(', '));
        if (s.player.exists('props', 'state.js')) assert.match(s.player.read('props', 'state.js'), /vault copy/);
      } finally { s.cleanup(); }
    });
  }

  it('a prop_state on a note that is not a container is ignored', () => {
    const files = FILES({ 'Library/Card.md': '---\ntype: prop\nprop_file: card.html\nprop_state: items.js\n---\nA card.\n', 'Library/card.html': '<p>A card.</p>' });
    const s = buildBoth(files, { ...SETTINGS, sites: ['player'] });
    try {
      assert.ok(!s.player.exists('props', 'items.js'));
      assert.ok(!s.logs.some((l) => /Card\.md/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
});

describe('stateItems and stateScript', () => {
  const page = (rel, out, fm = {}) => ({ outputPath: out, frontmatter: fm, sourceFrontmatter: fm });
  const props = [
    { rel: 'A/One.md', page: page('A/One.md', 'a/one.html', { prop_seal: 'red wax' }) },
    { rel: 'A/Two.md', page: page('A/Two.md', 'a/two.html') },
    { rel: 'A/Hidden Name.md', page: page('A/Hidden Name.md', 'a/hidden-name.html') },
  ];
  it("a key comes from the item's prop page, else its note; a sealed one from its title; a repeat gets -2", () => {
    const rows = [
      { rel: 'A/One.md', title: 'One', href: 'props/first.html', line: null, sealed: false },
      { rel: 'A/Two.md', title: 'Two', href: 'a/two.html', line: 'L', sealed: false },
      { rel: 'A/Hidden Name.md', title: 'First', sealed: true },
    ];
    const items = stateItems(rows, { props, from: 'props/state.js' });
    assert.deepEqual(items, {
      first: { title: 'One', line: null, href: 'first.html', sealed: false, seal: 'red wax' },
      two: { title: 'Two', line: 'L', href: '../a/two.html', sealed: false },
      'first-2': { title: 'First', sealed: true },
    });
    assert.equal(stateScript('X', { a: { t: '<!-- </script>' } }), 'window.X = {\n  "a": {\n    "t": "\\u003c!-- \\u003c/script>"\n  }\n};\n');
  });

  it('a field that is not text, a number, true or false (or lists and maps of them) is left out', () => {
    const fm = { prop_when: new Date(0), prop_none: null, prop_list: ['a', 1, true], prop_map: { k: 'v' }, prop_bad: ['a', null], prop_title: 'x', prop_href: 'y' };
    const items = stateItems([{ rel: 'A/One.md', title: 'One', href: 'a/one.html', line: null, sealed: false }],
      { props: [{ rel: 'A/One.md', page: page('A/One.md', 'a/one.html', fm) }], from: 'props/state.js' });
    assert.deepEqual(items.one, { title: 'One', line: null, href: '../a/one.html', sealed: false, list: ['a', 1, true], map: { k: 'v' } });
  });
});

describe('props read-state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-state-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (name, text, ...flags) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return spawnSync(process.execPath, [BIN, 'props', 'read-state', file, ...flags], { encoding: 'utf8' });
  };

  it('read-state reads window.LIBRARY', () => {
    const r = run('state.js', 'var shelf = { atlas: { title: "Atlas", pages: 212 } };\nshelf.map = { title: "Map" };\nwindow.LIBRARY = shelf;\n', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { global: 'LIBRARY', items: { atlas: { title: 'Atlas', pages: 212 }, map: { title: 'Map' } } });
    const plain = run('state.js', 'window.LIBRARY = { atlas: {}, map: {} };\n');
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout, 'window.LIBRARY: 2 items\n  atlas\n  map\n');
  });

  it('read-state refuses a file that calls require', () => {
    const r = run('bad.js', 'const fs = require("fs");\nwindow.LIBRARY = { files: fs.readdirSync("/") };\n', '--json');
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^Error: .*bad\.js could not be run: require is not defined/);
  });

  it('read-state refuses process, timers, no global, two globals and a loop that never ends', () => {
    for (const [text, said] of [
      ['window.X = { env: process.env };', /process is not defined/],
      ['setTimeout(() => {}, 1); window.X = {};', /setTimeout is not defined/],
      ['var X = {};', /sets nothing on window/],
      ['window.A = {}; window.B = {};', /sets 2 names on window \(A, B\)/],
      ['window.X = 3;', /not a list or map/],
      ['while (true) {}', /could not be run: Script execution timed out/],
    ]) {
      const r = run('x.js', text);
      assert.equal(r.status, 1, text);
      assert.match(r.stderr, said, text);
    }
  });
});
