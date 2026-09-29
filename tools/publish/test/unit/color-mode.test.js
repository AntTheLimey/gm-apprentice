const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scopeColorScheme, normalizeDefaultMode, headScript, storageKey } = require('../../lib/color-mode');

// #260: palettes switch on the reader's choice (data-theme) as well as the OS.
describe('scopeColorScheme', () => {
  const css = [
    ':root { --bg: #000; }',
    '@media (prefers-color-scheme: light) {',
    '  :root { --bg: #fff; }',
    '  .enc .e0, .wide .dmg { background: red; }',
    '}',
    '.after { color: blue; }',
  ].join('\n');
  const out = scopeColorScheme(css);
  const NOT_DARK_ROOT = ':root:not(:where([data-theme="dark"]))';
  const NOT_DARK = ':where(:root:not([data-theme="dark"]))';
  const LIGHT_ROOT = ':root:where([data-theme="light"])';
  const LIGHT = ':where(:root[data-theme="light"])';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('keeps the OS rule on screen, switched off when the reader chose dark', () => {
    assert.match(out, new RegExp(`@media screen and \\(prefers-color-scheme: light\\) \\{[\\s\\S]*${esc(NOT_DARK_ROOT)} \\{ --bg: #fff; \\}`));
    assert.ok(out.includes(`${NOT_DARK} .enc .e0, ${NOT_DARK} .wide .dmg {`), out);
  });

  it('adds a forced-light copy for screen', () => {
    assert.ok(out.includes(`@media screen {\n  ${LIGHT_ROOT} { --bg: #fff; }`), out);
    assert.ok(out.includes(`${LIGHT} .enc .e0, ${LIGHT} .wide .dmg {`), out);
  });

  it('prints with the light rules whatever the attribute says', () => {
    assert.ok(out.includes('@media print {\n  :root { --bg: #fff; }'), out);
  });

  it('leaves everything else alone and is a no-op without light blocks', () => {
    assert.match(out, /^:root \{ --bg: #000; \}/);
    assert.match(out, /\.after \{ color: blue; \}\s*$/);
    assert.strictEqual(scopeColorScheme('.a { b: c; }'), '.a { b: c; }');
  });

  it('leaves a rule that already names data-theme untouched', () => {
    const own = '@media (prefers-color-scheme: light) {\n  :root[data-theme="dark"] { --x: 1; }\n}';
    assert.strictEqual(scopeColorScheme(own), own);
  });

  it('keeps each selector\'s specificity, so a later bare :root still wins', () => {
    // a custom palette (theme.css) or overrides.css after a preset must still win
    for (const sel of [NOT_DARK_ROOT, LIGHT_ROOT]) assert.ok(out.includes(sel));
    assert.doesNotMatch(out, /(?<!:where\():root:not\(\[data-theme/);
    assert.doesNotMatch(out, /(?<!:where\():root\[data-theme="light"\]/);
  });

  it('copes with the CSS a GM might write in overrides.css', () => {
    const tricky = [
      '/* see @media (prefers-color-scheme: light) below */',
      '@media (prefers-color-scheme: light) {',
      '  .x:is(h1, h2), a[title="a,b"] { color: red; }',
      '  @supports (color: lab(0 0 0)) { .y { color: lab(50 0 0); } }',
      '  html.foo, :root.bar, html-foo, * { color: blue; }',
      '}',
    ].join('\n');
    const o = scopeColorScheme(tricky);
    assert.ok(o.includes(`${NOT_DARK} .x:is(h1, h2), ${NOT_DARK} a[title="a,b"]`), o);
    assert.ok(o.includes(`@supports (color: lab(0 0 0)) {`), o);
    assert.ok(o.includes(`${NOT_DARK} .y`) && o.includes(`${LIGHT} .y`), o);
    assert.ok(o.includes('html:not(:where([data-theme="dark"])).foo'), o);   // html keeps (0,1,1)
    assert.ok(o.includes(`${NOT_DARK_ROOT}.bar`), o);
    assert.ok(o.includes(`${NOT_DARK} html-foo`), o);
    assert.ok(o.includes(`${NOT_DARK}, ${NOT_DARK} *`), o);                     // * keeps zero
    assert.ok(o.startsWith('/* see @media (prefers-color-scheme: light) below */'), o);
  });

  it('copies @keyframes and @font-face through untouched', () => {
    const o = scopeColorScheme('@media (prefers-color-scheme: light) {\n  .a { color: red; }\n'
      + '  @keyframes glow { from { opacity: 0; } to { opacity: 1; } }\n'
      + '  @font-face { font-family: X; src: url(x.woff2); }\n}');
    assert.doesNotMatch(o, /:where\([^)]*\)\) (from|to) /);
    assert.strictEqual((o.match(/@keyframes glow \{ from/g) || []).length, 3, o);   // screen, forced, print
    assert.strictEqual((o.match(/@font-face \{/g) || []).length, 3, o);
  });

  it('finds a light query nested in @supports or @layer', () => {
    const o = scopeColorScheme('@supports (display: grid) {\n  @media (prefers-color-scheme: light) {\n    .a { color: red; }\n  }\n}');
    assert.ok(o.startsWith('@supports (display: grid) {'), o);
    assert.ok(o.includes(`${NOT_DARK} .a`) && o.includes(`${LIGHT} .a`), o);
  });

  it('rewrites a compound light query and keeps its other conditions', () => {
    const o = scopeColorScheme('@media screen and (prefers-color-scheme: light) and (min-width: 600px) {\n  .a { color: red; }\n}');
    assert.ok(o.includes('@media screen and (min-width: 600px) and (prefers-color-scheme: light) {'), o);
    assert.ok(o.includes(`@media screen and (min-width: 600px) {\n  ${LIGHT} .a`), o);
    assert.ok(!o.includes('@media print'), o);                   // a screen-only query never printed
    const p = scopeColorScheme('@media (prefers-color-scheme: light) and (min-width: 600px) {\n  .a { color: red; }\n}');
    assert.ok(p.includes('@media print and (min-width: 600px) {'), p);
  });

  it('handles every light block the tool ships', () => {
    const files = [path.join(__dirname, '../../css/style.css'),
      ...fs.readdirSync(path.join(__dirname, '../../css/themes')).map(f => path.join(__dirname, '../../css/themes', f))];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const blocks = (src.match(/@media[^{]*prefers-color-scheme[^{]*\{/g) || []);
      for (const b of blocks) assert.match(b, /^@media \(prefers-color-scheme: light\) \{$/, `${f}: ${b}`);
      const scoped = scopeColorScheme(src);
      assert.strictEqual(scoped.includes('data-theme="light"'), blocks.length > 0, f);
    }
  });
});

describe('default mode and the head script', () => {
  it('normalizes the configured default', () => {
    assert.strictEqual(normalizeDefaultMode(undefined), 'system');
    assert.strictEqual(normalizeDefaultMode('Dark'), 'dark');
    assert.strictEqual(normalizeDefaultMode('light'), 'light');
    assert.strictEqual(normalizeDefaultMode('purple'), 'system');
  });

  it('keys the saved choice per site', () => {
    assert.notStrictEqual(storageKey('Canticle'), storageKey('Dead End'));
  });

  function run(script, { saved, throws } = {}) {
    const attrs = {};
    const store = { getItem: () => { if (throws) throw new Error('blocked'); return saved ?? null; } };
    const fn = new Function('document', 'localStorage', 'window',
      script.replace(/^<script>|<\/script>$/g, ''));
    fn({ documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } }, store, {});
    return attrs['data-theme'];
  }

  it('applies a saved choice, else the site default, else nothing', () => {
    assert.strictEqual(run(headScript('dark', 'k'), { saved: 'light' }), 'light');
    assert.strictEqual(run(headScript('dark', 'k')), 'dark');
    assert.strictEqual(run(headScript('system', 'k')), undefined);
    assert.strictEqual(run(headScript('dark', 'k'), { throws: true }), 'dark');
    assert.strictEqual(run(headScript('system', 'k'), { saved: 'garbage' }), undefined);
  });
});

describe('the toggle renders only when a head script is configured', () => {
  const { configureColorMode, colorModeHeadHtml } = require('../../lib/templates/base');
  const { renderTopNav } = require('../../lib/templates/nav');
  it('on for a preset site, off otherwise', () => {
    configureColorMode(headScript('dark', 'k'));
    const on = renderTopNav([], 'index.html', { siteTitle: 'X' });
    assert.match(on, /nav-color-mode-btn/);
    assert.match(on, /mobile-color-mode-btn/);
    assert.match(colorModeHeadHtml(), /data-theme/);
    configureColorMode('');
    const off = renderTopNav([], 'index.html', { siteTitle: 'X' });
    assert.doesNotMatch(off, /color-mode-btn/);
    assert.strictEqual(colorModeHeadHtml(), '');
  });
});
