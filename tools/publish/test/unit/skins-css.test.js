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
  // The layer's own selectors, read from the file: nothing here is a hard-coded copy of one.
  const PREFIX = 'main.content[data-skin]:where(:not([data-skin=plain]))';
  const layerCss = () => read('_layer.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, '');
  // every rule of the layer as [selector list, declarations], at-rules opened
  const layerRules = () => [...layerCss().matchAll(/(?<=^|[{}])\s*([^@{}\s][^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  it("the layer's prefix weighs the same as a skin's, so a skin's later rule wins a tie", () => {
    const layer = layerCss();
    const skinned = selectorsOf(layer).filter((x) => x.includes('[data-skin]:'));
    assert.ok(skinned.length > 30, 'the layer has its skinned rules');
    // the plain exclusion only ever appears inside :where()
    assert.doesNotMatch(layer.split(PREFIX).join(''), /:not\(\s*\[data-skin/, ':not([data-skin=plain]) outside :where() out-weighs a skin');
    assert.doesNotMatch(layer.split(PREFIX).join(''), /data-skin\s*[~|^$*]?=/, 'the skin attribute is tested only in the prefix');
    for (const sel of skinned) {
      assert.ok(sel.startsWith(PREFIX) || sel.startsWith(`:where(${PREFIX})`), sel.slice(0, 90));
      // the same rule written by a skin weighs exactly as much
      if (sel.startsWith(PREFIX)) assert.deepStrictEqual(specificity(sel), specificity(sel.replace(PREFIX, 'main.content[data-skin="ledger"]')), sel.slice(0, 90));
      assert.strictEqual(specificity(sel)[0], 0, sel.slice(0, 90));
    }
    assert.deepStrictEqual(specificity(PREFIX), [0, 2, 1]);
    assert.deepStrictEqual(specificity('main.content[data-skin]:not([data-skin=plain])'), [0, 3, 1], 'what the :where() avoids');
  });
  it('the tile rule weighs what a skin\'s rule on one tile weighs', () => {
    const tile = layerRules().filter(([, d]) => /border:\s*var\(--sk-edge/.test(d));
    assert.strictEqual(tile.length, 1, 'one rule dresses the tiles');
    // an element name or a second class inside :is() would lift the whole rule over a skin's `main.content[data-skin="x"] .blk`
    assert.deepStrictEqual(specificity(tile[0][0]), specificity('main.content[data-skin="parchment"] .blk'), tile[0][0]);
  });
  describe('ground and tile inks flow by inheritance', () => {
    const root = () => layerRules().filter(([s]) => s === PREFIX).map(([, d]) => d).join(';');
    const INKS = [['--text', 'text'], ['--text-muted', 'muted'], ['--accent', 'accent'], ['--danger', 'danger']];
    it('main.content keeps the tile inks and the ground inks under private names', () => {
      for (const [name, k] of INKS) {
        assert.match(root(), new RegExp(`--sk-t-${k}:\\s*var\\(${name}\\)`), `tile ${k}`);
        assert.match(root(), new RegExp(`--sk-gx-${k}:\\s*var\\(--sk-g-${k},\\s*var\\(${name}\\)\\)`), `ground ${k}, falling back to the tile's`);
      }
      assert.match(root(), /(^|;)\s*color:\s*var\(--sk-gx-text\)/);
    });
    it('its children take the ground inks; nothing else on the ground is named', () => {
      const child = layerRules().filter(([s]) => s === `${PREFIX} > *`);
      assert.strictEqual(child.length, 1);
      for (const [name, k] of INKS) assert.match(child[0][1], new RegExp(`(^|;)\\s*${name}:\\s*var\\(--sk-gx-${k}\\)`), name);
      // a ground ink is read in the two rules above and nowhere else: no per-element reroute
      for (const [s, d] of layerRules()) {
        if (s === PREFIX || s === `${PREFIX} > *`) continue;
        assert.doesNotMatch(d, /--sk-g-|--sk-gx-/, s.slice(0, 90));
      }
    });
    it('every tile, the CoC sheet and every card take the tile inks back, with the well as --bg', () => {
      const ink = layerRules().filter(([, d]) => /--text:\s*var\(--sk-t-text\)/.test(d));
      assert.strictEqual(ink.length, 1);
      const [sel, decl] = ink[0];
      for (const [name, k] of INKS) assert.match(decl, new RegExp(`(^|;)\\s*${name}:\\s*var\\(--sk-t-${k}\\)`), name);
      assert.match(decl, /--bg:\s*var\(--sk-well\)/);
      const names = (s) => s.slice(s.indexOf('(', s.indexOf(') :') + 1) + 1, s.lastIndexOf(')')).split(',').map((x) => x.trim());
      const tile = layerRules().find(([, d]) => /border:\s*var\(--sk-edge/.test(d))[0];
      const inked = names(sel);
      for (const n of [...names(tile), '.coc-sheet-root', '.callout', 'th', '.accordion-header', '.section-nav']) assert.ok(inked.includes(n), `${n} takes the tile inks`);
      // a card left without a colour by style.css gets the tile's text, at no weight
      const plainColour = layerRules().filter(([s, d]) => s.startsWith(`:where(${PREFIX})`) && /color:\s*var\(--text\)/.test(d));
      assert.strictEqual(plainColour.length, 1);
      assert.deepStrictEqual(specificity(plainColour[0][0]), [0, 0, 0]);
      for (const n of names(plainColour[0][0])) assert.ok(inked.includes(n), `${n} has the tile inks it is coloured with`);
    });
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
