'use strict';
// What a style, a prop_style or a prop_kind gets wrong is said, never passed over: a style folder that cannot be read,
// assets left out, a style file that cannot be read or is not UTF-8, a prop_style that is not text, a prop_kind the tool
// does not know. And the build and the leak gate ask one question of whether a styled page is made.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadStyle, styleLoader, VAULT_STYLES_DIR } = require('../../lib/props/styles');
const { propStyleOf } = require('../../lib/props/note');
const { planProps } = require('../../lib/props/plan');
const { takenAddresses } = require('../../lib/props/address');
const { styledPageProblem } = require('../../lib/props/page');

function tree(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}
const plugin = (extra = {}) => tree('props-plugin-', {
  'terminal/layout.html': '<div class="paper">{{{body}}}</div>',
  'terminal/style.css': '.paper{color:#222}',
  ...extra,
});
const vs = (rel) => `${VAULT_STYLES_DIR}/${rel}`;
const MINE = { [vs('mine/layout.html')]: '<main>{{{body}}}</main>', [vs('mine/style.css')]: 'body{background:url(assets/paper.bmp)}' };
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('a _meta/prop-styles that is a file is a problem, never a quiet fall back to the plugin style', () => {
  const vaultPath = tree('props-vault-', { [VAULT_STYLES_DIR]: 'oops, a file' });
  const { style, problem } = loadStyle('terminal', { vaultPath, pluginDir: plugin() });
  assert.strictEqual(style, undefined);
  assert.match(problem.detail, /the style "terminal" cannot be used: _meta\/prop-styles\/ cannot be read \(ENOTDIR\)/);
  assert.match(problem.fix, /_meta\/prop-styles\//);
});

test('no _meta/prop-styles at all is no problem: the plugin style is used', () => {
  const { style } = loadStyle('terminal', { vaultPath: tree('props-vault-', {}), pluginDir: plugin() });
  assert.strictEqual(style.from, 'plugin');
});

test("what a style's assets/ holds that is not copied is listed: another kind, a folder, a link to nothing", () => {
  const vaultPath = tree('props-vault-', { ...MINE, [vs('mine/assets/paper.bmp')]: 'x', [vs('mine/assets/img/seal.png')]: 'x', [vs('mine/assets/ok.png')]: 'x' });
  fs.symlinkSync(path.join(vaultPath, 'nowhere.png'), path.join(vaultPath, vs('mine/assets/gone.png')));
  const { style, problem } = loadStyle('mine', { vaultPath, pluginDir: plugin() });
  assert.strictEqual(problem, undefined);
  assert.deepStrictEqual(style.assets.map((a) => a.rel), ['assets/ok.png']);
  assert.deepStrictEqual(style.skipped, [
    'assets/gone.png (a link to nothing)',
    "assets/img/ (a folder: a style's assets sit directly in assets/)",
    'assets/paper.bmp (not a kind a style copies)',
  ]);
});

test('an assets that is a file is listed as left out', () => {
  const vaultPath = tree('props-vault-', { ...MINE, [vs('mine/assets')]: 'a file' });
  const { style } = loadStyle('mine', { vaultPath, pluginDir: plugin() });
  assert.deepStrictEqual(style.skipped, ['assets (a file, not a folder)']);
});

test('a style with nothing left out has an empty skipped list', () => {
  const { style } = loadStyle('terminal', { vaultPath: tree('props-vault-', {}), pluginDir: plugin({ 'terminal/assets/a.png': 'x' }) });
  assert.deepStrictEqual(style.skipped, []);
});

test('a style file that cannot be read is a problem, not a crash', { skip: asRoot && 'root reads any file' }, () => {
  const vaultPath = tree('props-vault-', MINE);
  fs.chmodSync(path.join(vaultPath, vs('mine/layout.html')), 0);
  try {
    const { problem } = loadStyle('mine', { vaultPath, pluginDir: plugin() });
    assert.match(problem.detail, /the style "mine" cannot be used: layout\.html cannot be read \(EACCES\)/);
  } finally { fs.chmodSync(path.join(vaultPath, vs('mine/layout.html')), 0o644); }
});

test('a style file that is not UTF-8 is a problem, never read as replacement characters', () => {
  const vaultPath = tree('props-vault-', { ...MINE, [vs('mine/sheet.html')]: '' });
  fs.writeFileSync(path.join(vaultPath, vs('mine/sheet.html')), Buffer.from('<section>caf\xe9 {{{text}}}</section>', 'latin1'));
  const { problem } = loadStyle('mine', { vaultPath, pluginDir: plugin() });
  assert.match(problem.detail, /the style "mine" cannot be used: sheet\.html is not UTF-8 text/);
  assert.match(problem.fix, /UTF-8/);
});

test("a UTF-8 style file's byte-order mark is dropped", () => {
  const vaultPath = tree('props-vault-', { ...MINE, [vs('mine/layout.html')]: '﻿<main>{{{body}}}</main>' });
  assert.strictEqual(loadStyle('mine', { vaultPath, pluginDir: plugin() }).style.layout, '<main>{{{body}}}</main>');
});

test('an error with no code while reading a style file is thrown, not turned into a problem', (t) => {
  const vaultPath = tree('props-vault-', MINE);
  const real = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (p, ...rest) => {
    if (String(p).endsWith('layout.html')) throw new TypeError('a fault of the tool');
    return real(p, ...rest);
  });
  assert.throws(() => loadStyle('mine', { vaultPath, pluginDir: plugin() }), /a fault of the tool/);
});

test('a prop_style that is not text is kept, and loadStyle reports it as no style name', () => {
  assert.deepStrictEqual(propStyleOf({ prop_style: ['terminal'] }), ['terminal']);
  assert.strictEqual(propStyleOf({ prop_style: 1920 }), 1920);
  assert.strictEqual(propStyleOf({ prop_style: '' }), null);
  assert.strictEqual(propStyleOf({ prop_style: null }), null);
  assert.strictEqual(propStyleOf({ prop_style: ' Terminal ' }), 'terminal');
  const { problem } = loadStyle(['terminal'], { vaultPath: tree('props-vault-', {}), pluginDir: plugin() });
  assert.match(problem.detail, /^prop_style \["terminal"\] is not a style name/);
});

// planProps over notes with the given frontmatter, all shipping unless `held` names them.
function plan(notes, { held = [], vault = {}, pluginDir = plugin() } = {}) {
  const root = tree('props-vault-', { ...vault, ...Object.fromEntries(Object.keys(notes).map((rel) => [rel, ''])) });
  const pages = Object.entries(notes).map(([rel, frontmatter]) => ({ rel, sourcePath: path.join(root, rel), frontmatter }));
  return planProps({
    vaultPath: root, pages, relOf: (p) => p.rel, ships: (p) => !held.includes(p.rel), taken: takenAddresses(), cutKeeper: true,
    styles: styleLoader({ vaultPath: root, pluginDir }),
  });
}
const rows = (result) => result.problems.map((p) => [p.rel, p.code, p.detail]);

test('a shipping prop whose prop_style is a list or a number gets a row, and no page', () => {
  const result = plan({ 'Props/A.md': { type: 'prop', prop_style: ['terminal'] }, 'Props/B.md': { type: 'prop', prop_style: 1920 } });
  assert.deepStrictEqual(rows(result), [
    ['Props/A.md', 'PROP_NOT_COPIED', 'prop_style ["terminal"] is not a style name (lower-case letters, digits and hyphens)'],
    ['Props/B.md', 'PROP_NOT_COPIED', 'prop_style 1920 is not a style name (lower-case letters, digits and hyphens)'],
  ]);
  assert.ok(result.props.every((p) => p.made === null && p.files.length === 0));
});

test('an unknown prop_kind on a shipping prop is a row naming it and the kinds, and it reads as document', () => {
  const result = plan({
    'Props/Shelf.md': { type: 'prop', prop_kind: 'contianer' },
    'Props/Odd.md': { type: 'prop', prop_kind: 7 },
    'Props/Held.md': { type: 'prop', prop_kind: 'contianer' },
    'Props/Fine.md': { type: 'prop', prop_kind: 'Container' },
    'Props/Doc.md': { type: 'document', prop_kind: 'contianer' },
  }, { held: ['Props/Held.md'] });
  const kinds = 'document, object, diagram, supplied, container';
  assert.deepStrictEqual(rows(result), [
    ['Props/Shelf.md', 'PROP_NOT_COPIED', `prop_kind "contianer" is not one of ${kinds}; it is read as document`],
    ['Props/Odd.md', 'PROP_NOT_COPIED', `prop_kind 7 is not one of ${kinds}; it is read as document`],
  ]);
  assert.strictEqual(result.props.find((p) => p.rel === 'Props/Shelf.md').kind, 'document');
  assert.strictEqual(result.props.find((p) => p.rel === 'Props/Fine.md').kind, 'container');
});

test("a style's left-out assets are one row per style, on the first shipping prop using it", () => {
  const pluginDir = plugin({ 'terminal/assets/paper.bmp': 'x', 'terminal/assets/ok.png': 'x' });
  const result = plan({
    'Props/Held.md': { type: 'prop', prop_style: 'terminal' },
    'Props/One.md': { type: 'prop', prop_style: 'terminal' },
    'Props/Two.md': { type: 'prop', prop_style: 'terminal' },
  }, { held: ['Props/Held.md'], pluginDir });
  assert.deepStrictEqual(rows(result), [['Props/One.md', 'PROP_NOT_COPIED', 'the style "terminal" leaves out assets/paper.bmp (not a kind a style copies)']]);
  assert.match(result.problems[0].fix, /assets\/ folder \(png, jpg/);
  assert.deepStrictEqual(result.styles[0].files.map((f) => f.out), ['props/styles/terminal/style.css', 'props/styles/terminal/assets/ok.png']);
});

test('the build and the leak gate ask one question: is this styled page made', () => {
  const words = '## The Text\n\nCome at nine.\n';
  assert.strictEqual(styledPageProblem({ made: 'style', kind: 'document' }, words), null);
  assert.match(styledPageProblem({ made: 'style', kind: 'document' }, 'No text section.').detail, /no ## The Text|The Text/);
  assert.strictEqual(styledPageProblem({ made: 'style', kind: 'container' }, 'No text section.'), null);
  assert.strictEqual(styledPageProblem({ made: 'container', kind: 'container' }, ''), null);
});

test('a note with CR-only line ends reads as its LF form to the gate, so its styled page is made as the build makes it', () => {
  const { playerSafeMarkdown } = require('../../lib/processor');
  const lf = 'Intro\n\n## The Text\n\nCome at nine.\n';
  const read = (src) => playerSafeMarkdown(src, { excludeSections: ['GM Notes'], excludeCallouts: ['gm'], frontmatter: { type: 'prop' } }).text;
  assert.strictEqual(read(lf.replace(/\n/g, '\r')), read(lf));
  assert.strictEqual(read(lf.replace(/\n/g, '\r\n')), read(lf));
  assert.strictEqual(styledPageProblem({ made: 'style', kind: 'document' }, read(lf.replace(/\n/g, '\r'))), null);
});
