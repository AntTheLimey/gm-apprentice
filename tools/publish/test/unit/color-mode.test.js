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

  it('keeps the OS rule but switches it off when the reader chose dark', () => {
    assert.match(out, /@media \(prefers-color-scheme: light\) \{[\s\S]*:root:not\(\[data-theme="dark"\]\) \{ --bg: #fff; \}/);
    assert.match(out, /:root:not\(\[data-theme="dark"\]\) \.enc \.e0, :root:not\(\[data-theme="dark"\]\) \.wide \.dmg \{/);
  });

  it('adds a forced-light copy outside the media query', () => {
    const outside = out.split(/@media[^{]*\{[\s\S]*?\n\}/).join('');
    assert.match(outside, /:root\[data-theme="light"\] \{ --bg: #fff; \}/);
    assert.match(outside, /:root\[data-theme="light"\] \.enc \.e0, :root\[data-theme="light"\] \.wide \.dmg \{/);
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

  it('handles every light block the tool ships', () => {
    const files = [path.join(__dirname, '../../css/style.css'),
      ...fs.readdirSync(path.join(__dirname, '../../css/themes')).map(f => path.join(__dirname, '../../css/themes', f))];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const blocks = (src.match(/@media[^{]*prefers-color-scheme[^{]*\{/g) || []);
      for (const b of blocks) assert.match(b, /^@media \(prefers-color-scheme: light\) \{$/, `${f}: ${b}`);
      const scoped = scopeColorScheme(src);
      assert.strictEqual((scoped.match(/data-theme="light"\]/g) || []).length > 0, blocks.length > 0, f);
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
