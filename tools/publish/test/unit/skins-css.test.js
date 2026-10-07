// tools/publish/test/unit/skins-css.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SKINS, skinsCss } = require('../../lib/skins');
const { scopeColorScheme } = require('../../lib/color-mode');
const dir = path.join(__dirname, '../../css/skins');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
// every top-level selector of every rule (a comma inside :is() or () does not split)
function selectorsOf(css) {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, '').matchAll(/(?:^|[{}])\s*([^@{}\s][^{}]*)\{/g)) {
    let depth = 0; let cur = '';
    for (const ch of m[1]) {
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
  }
  return out.filter(Boolean);
}
// Selector weight as [ids, classes/attributes/pseudo-classes, elements]. :where() weighs nothing,
// :not() and :is() weigh their heaviest argument.
function specificity(sel) {
  const w = [0, 0, 0];
  const add = (x) => { w[0] += x[0]; w[1] += x[1]; w[2] += x[2]; };
  const heaviest = (args) => args.map(specificity).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).pop() || [0, 0, 0];
  let rest = sel;
  for (;;) {
    const m = rest.match(/:(where|not|is)\(/);
    if (!m) break;
    let depth = 1; let i = m.index + m[0].length; let cur = ''; const args = [];
    for (; i < rest.length && depth > 0; i++) {
      const ch = rest[i];
      if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) break; }
      if (ch === ',' && depth === 1) { args.push(cur); cur = ''; } else cur += ch;
    }
    args.push(cur);
    if (m[1] !== 'where') add(heaviest(args));
    rest = rest.slice(0, m.index) + ' ' + rest.slice(i + 1);
  }
  w[0] += (rest.match(/#[\w-]+/g) || []).length;
  w[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  w[2] += (rest.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return w;
}
const SET = ['--bg', '--bg-card', '--sk-well', '--text', '--text-muted', '--accent', '--accent-dim', '--border', '--danger', '--warning', '--success',
  '--font-heading', '--font-body', '--font-mono', '--sk-c1', '--sk-c2', '--sk-c3', '--sk-c4', '--sk-c5', '--sk-c6', '--sk-c7', '--sk-c8'];
const COLOURS = ['--bg', '--bg-card', '--sk-well', '--text', '--text-muted', '--accent', '--accent-dim', '--border', '--danger', '--warning', '--success'];

describe('skins: css', () => {
  it('the layer holds no colour literal and names no skin', () => {
    const layer = read('_layer.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, '');
    assert.doesNotMatch(layer, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    assert.doesNotMatch(layer, /data-skin="/);
  });
  it('the layer names every Pathfinder and FitD sheet class it dresses', () => {
    const layer = read('_layer.css');
    for (const c of ['pf2e-sheet', 'fitd-sheet', 'dnd-ability-card', 'stat-item', 'dnd-proficiency', 'skill-rank', 'skill-mark', 'dnd-header',
      'fitd-tracker', 'fitd-attribute', 'fitd-dot', 'fitd-box', 'filled', 'is-proficient']) {
      assert.match(layer, new RegExp('[.]' + c + '\\b'), c);
    }
  });
  it('the layer ends with one light block and scopes every Pathfinder and FitD rule under its sheet', () => {
    const layer = read('_layer.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.strictEqual((layer.match(/@media \(prefers-color-scheme: light\)/g) || []).length, 1);
    assert.match(layer, /@media \(prefers-color-scheme: light\) \{[\s\S]*\}\s*$/);
    for (const sel of selectorsOf(layer).filter((x) => /[.]fitd-|[.]skill-|[.]dnd-ability|[.]dnd-header|[.]pf2e-sheet/.test(x))) {
      assert.match(sel, /^main\.content\[data-skin\]:where\(:not\(\[data-skin=plain\]\)\)/, sel.slice(0, 80));
    }
  });
  it("the layer's prefix weighs the same as a skin's, so a skin's later rule wins a tie", () => {
    const layer = 'main.content[data-skin]:where(:not([data-skin=plain]))';
    assert.deepStrictEqual(specificity(layer), specificity('main.content[data-skin="ledger"]'));
    assert.deepStrictEqual(specificity(layer), [0, 2, 1]);
    assert.deepStrictEqual(specificity('main.content[data-skin]:not([data-skin=plain])'), [0, 3, 1]);
    for (const sel of selectorsOf(read('_layer.css')).filter((x) => x.startsWith('main.content[data-skin]:where('))) {
      assert.deepStrictEqual(specificity(sel).slice(0, 1), [0], sel);
    }
  });
  it('no skin selector uses :not() on the skin attribute, which would out-weigh the layer', () => {
    for (const id of Object.keys(SKINS).filter((s) => s !== 'plain')) {
      for (const sel of selectorsOf(read(id + '.css'))) assert.doesNotMatch(sel, /:not\([^)]*data-skin/, sel);
    }
  });
  for (const id of Object.keys(SKINS).filter((s) => s !== 'plain')) {
    it(`${id} sets every setting, dark first, and every colour again for light`, () => {
      const css = read(id + '.css');
      const base = css.slice(0, css.indexOf('@media'));
      for (const name of SET) assert.match(base, new RegExp(name.replace(/-/g, '\\-') + '\\s*:'), `${id} base ${name}`);
      const light = css.match(/@media \(prefers-color-scheme: light\) \{([\s\S]*)\}\s*$/);
      assert.ok(light, `${id} has one trailing light block`);
      for (const name of COLOURS) assert.match(light[1], new RegExp(name.replace(/-/g, '\\-') + '\\s*:'), `${id} light ${name}`);
      assert.doesNotMatch(css, /data-mode|#stage/);
      // every selector is scoped to this skin
      for (const sel of selectorsOf(css)) assert.match(sel, new RegExp(`^main\\.content\\[data-skin="${id}"\\]`), sel);
    });
  }
  it('assembles in registry order and survives the reader light/dark transform', () => {
    const css = skinsCss(['ledger', 'parchment', 'plain']);
    assert.ok(css.indexOf('data-skin="parchment"') < css.indexOf('data-skin="ledger"'));
    const scoped = scopeColorScheme(css);
    assert.match(scoped, /\[data-theme="light"\]/);
    assert.doesNotMatch(scoped, /@media \(prefers-color-scheme: light\) \{/);
  });
});
