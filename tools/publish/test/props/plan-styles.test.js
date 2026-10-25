const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planProps } = require('../../lib/props/plan');
const { takenAddresses } = require('../../lib/props/address');
const { styleLoader } = require('../../lib/props/styles');
const { propContainerOf, showSealedOf } = require('../../lib/props/note');

// A temp folder of real files; `files` maps rel -> text.
function tree(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

// A plugin styles folder with one style, "plain-test": the two files every style needs.
const pluginDir = (extra = {}) => tree('props-plugin-', {
  'plain-test/layout.html': '<div class="paper">{{{body}}}</div>',
  'plain-test/style.css': '.paper{color:#222}',
  ...extra,
});

const page = (root, rel, frontmatter) => ({ rel, sourcePath: path.join(root, rel), frontmatter });

function plan(root, pages, { ships = () => true, taken = takenAddresses(), plugin = pluginDir() } = {}) {
  return planProps({
    vaultPath: root, pages, relOf: (p) => p.rel, ships, taken, cutKeeper: true,
    styles: styleLoader({ vaultPath: root, pluginDir: plugin }),
  });
}

const outs = (p) => p.files.map((f) => f.out);
const styled = (extra = {}) => ({ type: 'prop', prop_style: 'plain-test', ...extra });

test('a styled prop is planned at props/<name>.html with no source', () => {
  const plugin = pluginDir();
  const root = tree('props-vault-', { 'Props/Letter.md': '' });
  const result = plan(root, [page(root, 'Props/Letter.md', styled())], { plugin });
  assert.deepStrictEqual(result.problems, []);
  const [p] = result.props;
  assert.strictEqual(p.made, 'style');
  assert.strictEqual(p.style.name, 'plain-test');
  assert.strictEqual(p.address, 'props/letter.html');
  assert.strictEqual(p.source, null);
  assert.strictEqual(p.hash, null);
  assert.deepStrictEqual(p.files, [{ source: null, out: 'props/letter.html', made: 'style' }]);
  assert.strictEqual(result.styles.length, 1);
  assert.deepStrictEqual(
    { name: result.styles[0].name, from: result.styles[0].from, replaces: result.styles[0].replaces },
    { name: 'plain-test', from: 'plugin', replaces: false },
  );
  assert.deepStrictEqual(result.styles[0].files.map((f) => f.out), ['props/styles/plain-test/style.css']);
  assert.strictEqual(result.styles[0].files[0].source, fs.realpathSync(path.join(plugin, 'plain-test/style.css')));
});

test('a style\'s script and assets are planned under its folder', () => {
  const plugin = pluginDir({ 'plain-test/script.js': 'void 0;', 'plain-test/assets/paper.png': 'PNG' });
  const root = tree('props-vault-', { 'Props/Letter.md': '' });
  const result = plan(root, [page(root, 'Props/Letter.md', styled())], { plugin });
  assert.deepStrictEqual(result.styles[0].files.map((f) => f.out), [
    'props/styles/plain-test/style.css', 'props/styles/plain-test/script.js', 'props/styles/plain-test/assets/paper.png',
  ]);
});

test('prop_address moves a styled page', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '' });
  const { props, problems } = plan(root, [page(root, 'Props/Letter.md', styled({ prop_address: 'gazetteer/papers/x.html' }))]);
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(props[0].address, 'gazetteer/papers/x.html');
  assert.deepStrictEqual(outs(props[0]), ['gazetteer/papers/x.html']);
});

test('a badly shaped prop_address on a styled prop falls back with 3a\'s row', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '' });
  const { props, problems } = plan(root, [page(root, 'Props/Letter.md', styled({ prop_address: 'papers/x.pdf' }))]);
  assert.strictEqual(props[0].address, 'props/letter.html');
  assert.deepStrictEqual(problems.map((p) => [p.detail, p.fix]), [[
    'prop_address "papers/x.pdf" must end in .html; it is published at props/letter.html',
    'write a path such as props/letter.html',
  ]]);
});

test('prop_file beats prop_style, with a row', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '', 'Props/inv.html': '<p>Dear sir</p>' });
  const { props, problems, styles } = plan(root, [page(root, 'Props/Letter.md', styled({ prop_file: 'inv.html' }))]);
  assert.strictEqual(props[0].made, null);
  assert.strictEqual(props[0].style, null);
  assert.strictEqual(props[0].source, fs.realpathSync(path.join(root, 'Props/inv.html')));
  assert.deepStrictEqual(outs(props[0]), ['props/letter.html']);
  assert.deepStrictEqual(styles, []);
  assert.deepStrictEqual(problems, [{
    rel: 'Props/Letter.md', code: 'PROP_NOT_COPIED', severity: 'warning',
    detail: 'prop_style "plain-test" is not used: the note names a prop_file, which is published as it is',
    fix: 'remove prop_style, or remove prop_file to use the style',
  }]);
  // A held prop raises nothing.
  assert.deepStrictEqual(plan(root, [page(root, 'Props/Letter.md', styled({ prop_file: 'inv.html' }))], { ships: () => false }).problems, []);
});

test('a container with neither file nor style is a made container page', () => {
  const root = tree('props-vault-', { 'Props/The Papers.md': '' });
  const { props, problems, styles } = plan(root, [page(root, 'Props/The Papers.md', { type: 'prop', prop_kind: 'container' })]);
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(props[0].kind, 'container');
  assert.strictEqual(props[0].made, 'container');
  assert.strictEqual(props[0].style, null);
  assert.deepStrictEqual(props[0].files, [{ source: null, out: 'props/the-papers.html', made: 'container' }]);
  assert.deepStrictEqual(styles, []);
});

test('a container with a style is a styled page of kind container', () => {
  const root = tree('props-vault-', { 'Props/Shelf.md': '' });
  const { props, styles } = plan(root, [page(root, 'Props/Shelf.md', { type: 'prop', prop_kind: 'container', prop_style: 'plain-test' })]);
  assert.strictEqual(props[0].kind, 'container');
  assert.strictEqual(props[0].made, 'style');
  assert.strictEqual(props[0].style.name, 'plain-test');
  assert.deepStrictEqual(outs(props[0]), ['props/shelf.html']);
  assert.deepStrictEqual(styles.map((s) => s.name), ['plain-test']);
});

test('an unknown style is a row and no page', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '' });
  const { props, problems, styles } = plan(root, [page(root, 'Props/Letter.md', styled({ prop_style: 'nosuch' }))]);
  assert.strictEqual(props[0].address, null);
  assert.deepStrictEqual(props[0].files, []);
  assert.strictEqual(props[0].made, null);
  assert.deepStrictEqual(styles, []);
  assert.deepStrictEqual(problems, [{
    rel: 'Props/Letter.md', code: 'PROP_NOT_COPIED', severity: 'warning',
    detail: 'the style "nosuch" is not one the plugin has or the vault adds in _meta/prop-styles/',
    fix: 'use one of: plain-test, or add the style',
  }]);
  assert.deepStrictEqual(plan(root, [page(root, 'Props/Letter.md', styled({ prop_style: 'nosuch' }))], { ships: () => false }).problems, []);
});

test('a held prop whose style does not load keeps its address for the gate', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '', 'Props/Shelf.md': '' });
  const { props, problems, styles } = plan(root, [
    page(root, 'Props/Letter.md', styled({ prop_style: 'nosuch', prop_address: 'papers/x.html' })),
    page(root, 'Props/Shelf.md', { type: 'prop', prop_kind: 'container', prop_style: 'nosuch', prop_address: '/abs.html' }),
  ], { ships: () => false });
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(styles, []);
  assert.deepStrictEqual(props.map((p) => [p.address, p.made, p.style, p.files]), [
    ['papers/x.html', null, null, []],
    ['props/shelf.html', null, null, []],
  ]);
});

test('a held styled prop raises nothing, claims nothing, keeps its address', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '', 'Props/Other.md': '' });
  const { props, problems, styles } = plan(root, [
    page(root, 'Props/Letter.md', styled({ prop_address: 'papers/x.html' })),
    page(root, 'Props/Other.md', styled({ prop_address: 'papers/x.html' })),
  ], { ships: (p) => p.rel === 'Props/Other.md' });
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(props[0].ships, false);
  assert.strictEqual(props[0].address, 'papers/x.html');
  assert.strictEqual(props[1].address, 'papers/x.html');
  assert.deepStrictEqual(outs(props[1]), ['papers/x.html']);
  assert.deepStrictEqual(styles.map((s) => s.name), ['plain-test']);
  // Held alone, its style ships nothing; a badly shaped address is not a row but still a default.
  const held = plan(root, [page(root, 'Props/Letter.md', styled({ prop_address: '/abs.html' }))], { ships: () => false });
  assert.deepStrictEqual(held.problems, []);
  assert.deepStrictEqual(held.styles, []);
  assert.strictEqual(held.props[0].address, 'props/letter.html');
});

test('two props share one style\'s files once', () => {
  const root = tree('props-vault-', { 'Props/A.md': '', 'Props/B.md': '' });
  const { props, styles } = plan(root, [page(root, 'Props/A.md', styled()), page(root, 'Props/B.md', styled())]);
  assert.deepStrictEqual(props.map((p) => p.address), ['props/a.html', 'props/b.html']);
  assert.strictEqual(styles.length, 1);
  assert.deepStrictEqual(styles[0].files.map((f) => f.out), ['props/styles/plain-test/style.css']);
});

test('made props claim addresses as 3a\'s do', () => {
  const root = tree('props-vault-', { 'A/Letter.md': '', 'B/Letter.md': '', 'C/Note.md': '', 'C/n.html': 'x' });
  const { props, problems } = plan(root, [
    page(root, 'A/Letter.md', styled()),
    page(root, 'B/Letter.md', { type: 'prop', prop_kind: 'container' }),
    page(root, 'C/Note.md', { type: 'prop', prop_file: 'n.html', prop_address: 'props/letter.html' }),
  ]);
  assert.deepStrictEqual(props.map((p) => p.address), [null, null, 'props/letter.html']);
  assert.deepStrictEqual(problems.map((p) => [p.rel, p.detail]), [
    ['A/Letter.md', 'its address props/letter.html is taken by C/Note.md'],
    ['B/Letter.md', 'its address props/letter.html is taken by C/Note.md'],
  ]);
});

test('a styled address on a page or tool folder is refused', () => {
  const root = tree('props-vault-', { 'Props/Letter.md': '', 'Props/Other.md': '' });
  const { props, problems, styles } = plan(root, [
    page(root, 'Props/Letter.md', styled({ prop_address: 'props/styles/x.html' })),
    page(root, 'Props/Other.md', styled({ prop_address: 'people/bob.html' })),
  ], { taken: takenAddresses({ pageOutputs: ['people/bob.html'] }) });
  assert.deepStrictEqual(props.map((p) => p.address), [null, null]);
  assert.deepStrictEqual(problems.map((p) => [p.detail, p.fix]), [
    ['its address props/styles/x.html is taken by the site\'s props/styles/ folder', 'give it another prop_address'],
    ['its address people/bob.html is taken by a page the site builds', 'give it another prop_address'],
  ]);
  assert.deepStrictEqual(styles, []);
});

test('propContainerOf reads the link target, NFC; showSealedOf is titles or none', () => {
  assert.strictEqual(propContainerOf({ prop_container: '[[The Bookshelf]]' }), 'The Bookshelf');
  assert.strictEqual(propContainerOf({ prop_container: '[[Props/The_Bookshelf|the shelf]]' }), 'Props/The_Bookshelf');
  assert.strictEqual(propContainerOf({ prop_container: ' The Bookshelf ' }), 'The Bookshelf');
  assert.strictEqual(propContainerOf({ prop_container: '[[Café]]' }), 'Café');
  assert.strictEqual(propContainerOf({ prop_container: [['The Bookshelf']] }), 'The Bookshelf');
  assert.strictEqual(propContainerOf({ prop_container: [['Props/Shelf|the shelf']] }), 'Props/Shelf');
  assert.strictEqual(propContainerOf({ prop_container: '' }), null);
  assert.strictEqual(propContainerOf({ prop_container: '[[]]' }), null);
  assert.strictEqual(propContainerOf({}), null);
  assert.strictEqual(showSealedOf({ show_sealed: 'titles' }), 'titles');
  assert.strictEqual(showSealedOf({ show_sealed: ' Titles ' }), 'titles');
  assert.strictEqual(showSealedOf({ show_sealed: 'all' }), 'none');
  assert.strictEqual(showSealedOf({}), 'none');
});
