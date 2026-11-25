'use strict';
// The to-hit calculator's styles have one source (step 6b Task 24, D8a, D8b): css/tohit.css, cut out of css/style.css
// at a marker line and joined back in there by the site build, so the player site's css/style.css comes out as it was;
// the run sheet's GM page loads css/tohit.css itself, with the narrow copy the table server makes from its 780 px
// block, and maps the variables the calculator reads onto its box from the GM page's own tokens.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { buildPc } = require('./helpers/pc-vault');
const { scopeColorScheme, statements, splitSelectors } = require('../lib/color-mode');
const { TOHIT_MARKER, joinTohitCss } = require('../lib/build');
const { narrowCopy, NARROW_MEDIA } = require('../lib/run-sheet/tohit');

const lf = (s) => s.replace(/\r\n/g, '\n');
const CSS_DIR = path.join(__dirname, '..', 'css');
const read = (...p) => lf(fs.readFileSync(path.join(...p), 'utf8'));
const tohitCss = () => read(CSS_DIR, 'tohit.css');
const styleCss = () => read(CSS_DIR, 'style.css');
const gmCss = () => read(__dirname, '..', 'lib', 'run-sheet', 'web', 'gm.css');
const squash = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
// Every style rule in a sheet, at any depth, with the at-rule preludes it sits under.
function rules(css, under = []) {
  const out = [];
  for (const st of statements(css)) {
    if (st.kind === 'rule') out.push({ selectors: splitSelectors(st.prelude), body: squash(st.body), under });
    else if (st.kind === 'at') out.push(...rules(st.body, [...under, st.prelude]));
  }
  return out;
}

test('the site build joins css/tohit.css back in at its marker: the written css/style.css is the source as it was before the cut', () => {
  const style = styleCss();
  const lines = style.split('\n').filter((l) => l === TOHIT_MARKER);
  assert.strictEqual(lines.length, 1, 'one marker line in css/style.css');
  const tohit = tohitCss();
  assert.ok(tohit.endsWith('\n'), 'css/tohit.css ends its last line');
  const joined = joinTohitCss(style, tohit);
  assert.ok(!joined.includes(TOHIT_MARKER));
  assert.strictEqual(joined, style.replace(`${TOHIT_MARKER}\n`, tohit));
  const ronnie = matter(fs.readFileSync(path.join(__dirname, 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8')).content;
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  let built;
  try { built = buildPc('gurps-4e', ronnie); } finally { console.log = log; console.warn = warn; }
  try {
    const css = lf(fs.readFileSync(path.join(built.out, 'css', 'style.css'), 'utf8'));
    assert.strictEqual(css, scopeColorScheme(joined), 'the built stylesheet is the joined source, as every stylesheet is written');
    assert.ok(!fs.existsSync(path.join(built.out, 'css', 'tohit.css')), 'the site writes no stylesheet of its own for it');
    // the sheet page still carries the calculator's box and its script, as it did
    assert.match(built.html, /<div class="wide cat-table tohit" id="tohit-calc"><\/div>/);
    assert.match(built.html, /<script type="application\/json" id="gurps-tohit-data">/);
    assert.match(built.html, /<script[^>]*src="[^"]*js\/gurps-tohit\.js"/);
  } finally {
    fs.rmSync(built.root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('every .tohit rule but the print one lives in css/tohit.css; the print rule stays in css/style.css', () => {
  const style = rules(styleCss());
  const inStyle = style.filter((r) => r.selectors.some((s) => /(^|\s)\.tohit\b/.test(s)));
  assert.deepStrictEqual(inStyle.map((r) => [r.selectors.join(', '), r.body, r.under]), [['.tohit', 'display: none !important;', ['@media print']]]);
  const own = rules(tohitCss());
  assert.ok(own.length > 60, `${own.length} rules`);
  for (const r of own) for (const s of r.selectors) assert.match(s, /^\.tohit\b/, `${s} is the calculator's`);
});

// The variables a sheet defines in a rule whose selector is `sel` exactly.
function defined(css, test) {
  const out = new Set();
  for (const r of rules(css)) {
    if (!r.selectors.some(test)) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]);
  }
  return out;
}
function definedUnder(css, sel, media) {
  const out = new Set();
  for (const r of rules(css)) {
    if (!r.selectors.includes(sel) || (media ? !r.under.some((u) => u.includes(media)) : r.under.length)) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]);
  }
  return out;
}

test('every variable css/tohit.css reads is defined on the GM page, light and dark: the GM page\'s tokens mapped onto the box', () => {
  const used = new Set(Array.from(tohitCss().matchAll(/var\(\s*(--[\w-]+)/g), (m) => m[1]));
  assert.ok(used.size >= 9, [...used].join(' '));
  const gm = gmCss();
  const light = definedUnder(gm, ':root', null);
  const darkOs = definedUnder(gm, ':root:not([data-theme="light"])', 'prefers-color-scheme: dark');
  const darkSet = definedUnder(gm, ':root[data-theme="dark"]', null);
  // the box's mapping: one rule on the dialog's .tohit, each variable another of the page's
  const map = {};
  for (const r of rules(gm)) {
    if (!r.selectors.some((s) => /\.tohit$/.test(s)) || r.under.length) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)/g)) map[m[1]] = m[2];
  }
  assert.deepStrictEqual(Object.keys(map).sort(), ['--accent', '--accent-dim', '--bg-card', '--border', '--danger', '--success', '--text', '--text-muted']);
  for (const v of used) {
    const token = map[v] || v;
    for (const [mode, set] of [['light', light], ['dark (the machine\'s)', darkOs], ['dark (chosen)', darkSet]]) {
      assert.ok(set.has(token), `${v}${map[v] ? ` (mapped to ${token})` : ''} is not defined in the GM page's ${mode} tokens`);
    }
  }
  assert.ok(defined(gm, (s) => /\.tohit$/.test(s)).size === 8);
});

test("the server's .tohit.th-narrow copy holds the 780 px block's declarations, rule for rule", () => {
  const css = tohitCss();
  const block = statements(css).find((s) => s.kind === 'at' && s.prelude === NARROW_MEDIA);
  assert.ok(block, `css/tohit.css has a ${NARROW_MEDIA} block`);
  const orig = rules(block.body);
  const copy = rules(narrowCopy(css));
  assert.ok(orig.length >= 10, `${orig.length} rules in the block`);
  assert.strictEqual(copy.length, orig.length);
  orig.forEach((r, i) => {
    assert.deepStrictEqual(copy[i].under, [], 'the copy is outside any media query');
    assert.deepStrictEqual(copy[i].selectors, r.selectors.map((s) => s.replace(/^\.tohit\b/, '.tohit.th-narrow')));
    assert.strictEqual(copy[i].body, r.body);
  });
  // the window's own narrow rules under 440 and 360 px stay window-only (D8b): the dialog is wider than both
  assert.ok(!copy.some((r) => r.selectors.some((s) => /th-gfields|th-cell/.test(s))));
});
