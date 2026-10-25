const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listStyles, loadStyle, styleLoader, PLUGIN_STYLES_DIR, VAULT_STYLES_DIR } = require('../../lib/props/styles');
const { propStyleOf, PROP_STYLE_RE } = require('../../lib/props/note');

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

const LAYOUT = '<div class="paper">{{{body}}}</div>';
const SHEET = '<article class="leaf">{{{text}}}</article>';
const CSS = '.paper{color:#222}';

// A plugin styles folder with one style, "terminal", that has every optional file.
function plugin(extra = {}) {
  return tree('props-plugin-', {
    'terminal/layout.html': LAYOUT,
    'terminal/sheet.html': SHEET,
    'terminal/style.css': CSS,
    'terminal/style.json': JSON.stringify({ title: 'Terminal', about: 'Green on black', fonts: ['VT323'], fields: { prop_screen: 'green' } }),
    'terminal/script.js': 'void 0;',
    ...extra,
  });
}

const vault = (files = {}) => tree('props-vault-', files);
const vs = (rel) => `${VAULT_STYLES_DIR}/${rel}`;

test('the plugin styles folder is prop-styles beside lib', () => {
  assert.strictEqual(PLUGIN_STYLES_DIR, path.join(__dirname, '..', '..', 'prop-styles'));
});

test('a plugin style is found', () => {
  const pluginDir = plugin();
  const { style, problem } = loadStyle('terminal', { vaultPath: vault(), pluginDir });
  assert.strictEqual(problem, undefined);
  assert.strictEqual(style.name, 'terminal');
  assert.strictEqual(style.from, 'plugin');
  assert.strictEqual(style.replaces, false);
  assert.strictEqual(style.dir, fs.realpathSync(path.join(pluginDir, 'terminal')));
  assert.strictEqual(style.layout, LAYOUT);
  assert.strictEqual(style.sheet, SHEET);
  assert.deepStrictEqual(style.json, { title: 'Terminal', about: 'Green on black', fonts: ['VT323'], fields: { prop_screen: 'green' } });
  assert.strictEqual(style.css, path.join(style.dir, 'style.css'));
  assert.strictEqual(style.script, path.join(style.dir, 'script.js'));
  assert.deepStrictEqual(style.assets, []);
});

test('a vault style of the same name replaces it whole', () => {
  const pluginDir = plugin();
  const root = vault({ [vs('terminal/layout.html')]: '<p>{{{body}}}</p>', [vs('terminal/style.css')]: 'p{}' });
  const { style } = loadStyle('terminal', { vaultPath: root, pluginDir });
  assert.strictEqual(style.from, 'vault');
  assert.strictEqual(style.replaces, true);
  assert.strictEqual(style.layout, '<p>{{{body}}}</p>');
  assert.strictEqual(style.sheet, '<section class="sheet">{{{text}}}</section>');
  assert.deepStrictEqual(style.json, { title: 'terminal', about: '', fonts: [], fields: {} });
  assert.strictEqual(style.script, null);
  assert.ok(style.css.startsWith(fs.realpathSync(root)));
});

test('listStyles names plugin and vault styles, and which replace', () => {
  const pluginDir = plugin({ 'ledger/layout.html': LAYOUT, 'ledger/style.css': CSS, 'Not A Style/layout.html': LAYOUT });
  const root = vault({ [vs('terminal/layout.html')]: LAYOUT, [vs('terminal/style.css')]: CSS, [vs('memo/layout.html')]: LAYOUT });
  fs.writeFileSync(path.join(root, VAULT_STYLES_DIR, 'loose.txt'), 'x');
  assert.deepStrictEqual(listStyles({ vaultPath: root, pluginDir }), [
    { name: 'ledger', from: 'plugin', replaces: false },
    { name: 'memo', from: 'vault', replaces: false },
    { name: 'terminal', from: 'vault', replaces: true },
  ]);
});

test('an unknown style names the ones there are', () => {
  const pluginDir = plugin({ 'ledger/layout.html': LAYOUT, 'ledger/style.css': CSS });
  const { problem } = loadStyle('fax', { vaultPath: vault(), pluginDir });
  assert.deepStrictEqual(problem, {
    detail: 'the style "fax" is not one the plugin has or the vault adds in _meta/prop-styles/',
    fix: 'use one of: ledger, terminal, or add the style',
  });
});

test('a bad name is reported as written', () => {
  const { problem } = loadStyle('../x', { vaultPath: vault(), pluginDir: plugin() });
  assert.deepStrictEqual(problem, {
    detail: 'prop_style "../x" is not a style name (lower-case letters, digits and hyphens)',
    fix: 'write a style name such as terminal',
  });
});

test('a bad layout makes the style unusable', () => {
  const pluginDir = plugin({ 'bad/layout.html': '<a href="{{prop_x}}">x</a>', 'bad/style.css': CSS });
  const { problem } = loadStyle('bad', { vaultPath: vault(), pluginDir });
  assert.ok(problem.detail.startsWith('the style "bad" cannot be used: layout.html line 1'), problem.detail);
  assert.strictEqual(problem.fix, "fix the style's layout.html");
});

test('a bad sheet makes the style unusable', () => {
  const pluginDir = plugin({ 'bad/layout.html': LAYOUT, 'bad/sheet.html': '<p>{{{prop_x}}}</p>', 'bad/style.css': CSS });
  const { problem } = loadStyle('bad', { vaultPath: vault(), pluginDir });
  assert.ok(problem.detail.startsWith('the style "bad" cannot be used: sheet.html line 1'), problem.detail);
  assert.strictEqual(problem.fix, "fix the style's sheet.html");
});

test('missing layout.html', () => {
  const pluginDir = plugin({ 'bad/style.css': CSS });
  assert.deepStrictEqual(loadStyle('bad', { vaultPath: vault(), pluginDir }).problem, {
    detail: 'the style "bad" cannot be used: layout.html is missing',
    fix: "fix the style's layout.html",
  });
});

test('missing style.css', () => {
  const pluginDir = plugin({ 'bad/layout.html': LAYOUT });
  assert.deepStrictEqual(loadStyle('bad', { vaultPath: vault(), pluginDir }).problem, {
    detail: 'the style "bad" cannot be used: style.css is missing',
    fix: "fix the style's style.css",
  });
});

test('style.json that is not JSON', () => {
  const pluginDir = plugin({ 'bad/layout.html': LAYOUT, 'bad/style.css': CSS, 'bad/style.json': '{ title: nope' });
  const { problem } = loadStyle('bad', { vaultPath: vault(), pluginDir });
  assert.match(problem.detail, /^the style "bad" cannot be used: style\.json is not JSON \(.+\)$/);
  assert.strictEqual(problem.fix, "fix the style's style.json");
});

test('a symlinked script.js pointing out of the folder', () => {
  const pluginDir = plugin({ 'bad/layout.html': LAYOUT, 'bad/style.css': CSS });
  const outside = tree('props-out-', { 'evil.js': 'alert(1)' });
  fs.symlinkSync(path.join(outside, 'evil.js'), path.join(pluginDir, 'bad/script.js'));
  assert.deepStrictEqual(loadStyle('bad', { vaultPath: vault(), pluginDir }).problem, {
    detail: 'the style "bad" cannot be used: script.js is outside the style\'s folder',
    fix: "fix the style's script.js",
  });
});

test('a symlinked layout.html pointing to a sibling style is outside', () => {
  const pluginDir = plugin({ 'bad/style.css': CSS });
  fs.symlinkSync(path.join(pluginDir, 'terminal/layout.html'), path.join(pluginDir, 'bad/layout.html'));
  assert.strictEqual(loadStyle('bad', { vaultPath: vault(), pluginDir }).problem.detail,
    'the style "bad" cannot be used: layout.html is outside the style\'s folder');
});

test('a symlinked style folder pointing out is outside', () => {
  const outside = tree('props-out-', { 'away/layout.html': LAYOUT, 'away/style.css': CSS });
  const root = vault({ [vs('.keep')]: '' });
  fs.symlinkSync(path.join(outside, 'away'), path.join(root, VAULT_STYLES_DIR, 'away'));
  const { problem } = loadStyle('away', { vaultPath: root, pluginDir: plugin() });
  assert.strictEqual(problem.detail, 'the style "away" cannot be used: away/ is outside the style\'s folder');
});

test('a symlinked asset pointing out is outside', () => {
  const pluginDir = plugin();
  const outside = tree('props-out-', { 'secret.png': 'PNG' });
  fs.mkdirSync(path.join(pluginDir, 'terminal/assets'));
  fs.symlinkSync(path.join(outside, 'secret.png'), path.join(pluginDir, 'terminal/assets/pic.png'));
  assert.strictEqual(loadStyle('terminal', { vaultPath: vault(), pluginDir }).problem.detail,
    'the style "terminal" cannot be used: assets/pic.png is outside the style\'s folder');
});

test('fonts keep only valid family names', () => {
  const json = { fonts: ['VT323', 'Special Elite', 'bad;name', 42, '../x'], fields: {} };
  const pluginDir = plugin({ 'f/layout.html': LAYOUT, 'f/style.css': CSS, 'f/style.json': JSON.stringify(json) });
  assert.deepStrictEqual(loadStyle('f', { vaultPath: vault(), pluginDir }).style.json.fonts, ['VT323', 'Special Elite']);
});

test('fields keep only prop_ keys with string values', () => {
  const json = { title: 'F', fields: { prop_ink: 'blue', prop_n: 3, colour: 'red', prop_list: ['a'] } };
  const pluginDir = plugin({ 'f/layout.html': LAYOUT, 'f/style.css': CSS, 'f/style.json': JSON.stringify(json) });
  assert.deepStrictEqual(loadStyle('f', { vaultPath: vault(), pluginDir }).style.json.fields, { prop_ink: 'blue' });
});

test('assets keep only the listed kinds', () => {
  const pluginDir = plugin({
    'terminal/assets/paper.jpg': 'JPG',
    'terminal/assets/Stamp.PNG': 'PNG',
    'terminal/assets/x.html': '<p>',
    'terminal/assets/deep/more.png': 'PNG',
  });
  const { style } = loadStyle('terminal', { vaultPath: vault(), pluginDir });
  assert.deepStrictEqual(style.assets, [
    { source: path.join(style.dir, 'assets', 'Stamp.PNG'), rel: 'assets/Stamp.PNG' },
    { source: path.join(style.dir, 'assets', 'paper.jpg'), rel: 'assets/paper.jpg' },
  ]);
});

test('styleLoader memoises per name and takes pluginDir', () => {
  const pluginDir = plugin();
  const load = styleLoader({ vaultPath: vault(), pluginDir });
  const first = load('terminal');
  assert.strictEqual(first.style.from, 'plugin');
  assert.strictEqual(load('terminal'), first);
  assert.ok(load('nope').problem);
});

test('propStyleOf', () => {
  assert.strictEqual(propStyleOf({ prop_style: ' Terminal ' }), 'terminal');
  assert.strictEqual(propStyleOf({ prop_style: '' }), null);
  assert.strictEqual(propStyleOf({}), null);
  assert.strictEqual(propStyleOf(null), null);
  assert.strictEqual(propStyleOf({ prop_style: '../x' }), '../x');
  assert.ok(PROP_STYLE_RE.test('terminal'));
  assert.ok(!PROP_STYLE_RE.test('../x'));
});

test('a symlinked _meta/prop-styles pointing out of the vault is outside', () => {
  const outside = tree('props-out-', { 'away/layout.html': LAYOUT, 'away/style.css': CSS });
  const root = vault({ '_meta/.keep': '' });
  fs.symlinkSync(outside, path.join(root, VAULT_STYLES_DIR));
  assert.deepStrictEqual(loadStyle('away', { vaultPath: root, pluginDir: plugin() }).problem, {
    detail: 'the style "away" cannot be used: _meta/prop-styles/ is outside the vault',
    fix: 'make _meta/prop-styles/ a folder inside the vault, not a link out of it',
  });
});

test('a vault override that is a plain file is a problem, not the plugin\'s style', () => {
  const root = vault({ [vs('terminal')]: 'not a folder' });
  const { style, problem } = loadStyle('terminal', { vaultPath: root, pluginDir: plugin() });
  assert.strictEqual(style, undefined);
  assert.deepStrictEqual(problem, {
    detail: 'the style "terminal" cannot be used: _meta/prop-styles/terminal is not a folder',
    fix: "make _meta/prop-styles/terminal/ a folder holding layout.html and style.css, or remove it to use the plugin's",
  });
});

test('a vault override that is a dangling link is a problem, not the plugin\'s style', () => {
  const root = vault({ [vs('.keep')]: '' });
  fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, VAULT_STYLES_DIR, 'terminal'));
  const { problem } = loadStyle('terminal', { vaultPath: root, pluginDir: plugin() });
  assert.strictEqual(problem.detail, 'the style "terminal" cannot be used: _meta/prop-styles/terminal is not a folder');
});

test('a wrongly spelled file names the spelling it should have', () => {
  const pluginDir = plugin({ 'bad/Layout.html': LAYOUT, 'bad/style.css': CSS });
  assert.deepStrictEqual(loadStyle('bad', { vaultPath: vault(), pluginDir }).problem, {
    detail: 'the style "bad" cannot be used: Layout.html should be named layout.html',
    fix: "fix the style's Layout.html",
  });
});

test('a wrongly spelled assets folder names the spelling it should have', () => {
  const pluginDir = plugin({ 'terminal/Assets/paper.jpg': 'JPG' });
  assert.strictEqual(loadStyle('terminal', { vaultPath: vault(), pluginDir }).problem.detail,
    'the style "terminal" cannot be used: Assets/ should be named assets/');
});

test('with no styles at all, the fix says where to add one', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-plugin-'));
  assert.deepStrictEqual(loadStyle('fax', { vaultPath: vault(), pluginDir }).problem, {
    detail: 'the style "fax" is not one the plugin has or the vault adds in _meta/prop-styles/',
    fix: 'add the style in _meta/prop-styles/fax/',
  });
});

test('a style.json with a byte-order mark reads', () => {
  const pluginDir = plugin({ 'f/layout.html': LAYOUT, 'f/style.css': CSS, 'f/style.json': '\uFEFF{"title":"F"}' });
  assert.strictEqual(loadStyle('f', { vaultPath: vault(), pluginDir }).style.json.title, 'F');
});
