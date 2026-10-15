'use strict';
// The GM site's marks can be read in every preset, dark and light: each coloured text in css/gm.css meets 4.5:1
// on what it sits on. Colours are read from style.css (the plain look) and each preset in css/themes, the colour
// names from gm.css itself, so a changed rule or preset fails here by name.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = path.join(__dirname, '..', '..', 'css');
const read = (...p) => fs.readFileSync(path.join(CSS, ...p), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const LIGHT = '@media (prefers-color-scheme: light)';

const hex = (h) => { const s = h.slice(1); const f = s.length === 3 ? s.replace(/./g, '$&$&') : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = (c) => c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
  .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, pa) => a.map((v, i) => Math.round(v * pa + b[i] * (1 - pa)));
const tokens = (block) => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\s*;/g)]
  .map((m) => [m[1], hex(m[2])]));

// The first :root block of a file (the dark look) and its light block.
function looks(css) {
  const at = css.indexOf(LIGHT);
  const base = css.slice(0, at < 0 ? css.length : at);
  const root = base.slice(base.indexOf(':root'), base.indexOf('}', base.indexOf(':root')));
  return { dark: tokens(root), light: at < 0 ? null : tokens(css.slice(at, css.indexOf('}', css.indexOf('}', at) + 1))) };
}
const plain = looks(read('style.css'));
const MODES = [['plain', 'dark', plain.dark]];
for (const f of fs.readdirSync(path.join(CSS, 'themes')).filter((n) => n.endsWith('.css')).sort()) {
  const t = looks(read('themes', f));
  const dark = { ...plain.dark, ...t.dark };
  MODES.push([f.replace(/\.css$/, ''), 'dark', dark]);
  if (t.light) MODES.push([f.replace(/\.css$/, ''), 'light', { ...dark, ...t.light }]);
}

// What gm.css paints: the colour name of a rule's `color`, and a mark's tint of --warning over the card.
const gm = read('gm.css');
const rule = (sel) => {
  const m = gm.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `gm.css has a rule for ${sel}`);
  return m[1];
};
const colourOf = (sel) => { const m = rule(sel).match(/(?:^|[;\s])color:\s*var\((--[a-z-]+)\)/); assert.ok(m, `${sel} takes a colour name`); return m[1]; };
const TINT = (() => { const m = rule('.gm-mark').match(/color-mix\(in srgb, var\(--warning\) (\d+)%, var\(--bg-card\)\)/); assert.ok(m, 'the mark tint'); return +m[1] / 100; })();

describe('gm.css: the marks can be read in every look', () => {
  it('reads every preset, dark and light', () => {
    assert.ok(MODES.length >= 11, MODES.map((m) => m.slice(0, 2).join(' ')).join(', '));
  });
  for (const [look, mode, t] of MODES) {
    it(`${look} ${mode}`, () => {
      const card = t['--bg-card'];
      const tinted = mix(t['--warning'], card, TINT);
      const pairs = [
        ['a mark\'s label', t[colourOf('.gm-mark__label')], tinted],
        ['a mark\'s text', t[colourOf('.gm-mark')], tinted],
        ['the panel title', t[colourOf('.gm-hidden__title')], card],
        // an inline mark sits in running text: its tint is over the page, not a card
        ['an inline mark\'s text', t[colourOf('.gm-mark')], mix(t['--warning'], t['--bg'], TINT)],
        ['an inline mark\'s reason', t[colourOf('span.gm-mark::after')], mix(t['--warning'], t['--bg'], TINT)],
        ['the band', hex(rule('.gm-band').match(/color:\s*(#[0-9a-fA-F]{3,6})/)[1]), t['--warning']],
      ];
      for (const [what, fg, bg] of pairs) {
        assert.ok(fg && bg, `${what}: colours found`);
        const r = ratio(fg, bg);
        assert.ok(r >= 4.5, `${look} ${mode}: ${what} is ${r.toFixed(2)}:1, under 4.5:1`);
      }
    });
  }
});
