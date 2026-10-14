'use strict';
// Every theme preset's muted text and accent (links) can be read on its page and its cards, and
// the header's own muted text and accent on the header and hero (which stay dark in the light
// palette): at least 4.5:1 (WCAG AA for body text), in the dark palette and the light.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'css', 'themes');
const AA = 4.5;

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const TOKENS = { bg: 'bg', card: 'bg-card', header: 'bg-header', hero: 'bg-hero', muted: 'text-muted', accent: 'accent',
  headerMuted: 'text-muted-on-header', headerAccent: 'accent-on-header' };
// Each innermost `{ … }` block that sets a background: its colour tokens. A later palette (the
// light one) keeps what it does not set from the first.
function palettes(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const p = {};
    for (const [key, name] of Object.entries(TOKENS)) {
      const hit = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(m[2]);
      if (hit) p[key] = hit[1];
    }
    if (p.bg || p.card) out.push(out.length ? { ...out[0], ...p } : p);
  }
  return out;
}
const PAIRS = [['muted', 'bg'], ['muted', 'card'], ['accent', 'bg'], ['accent', 'card'],
  ['headerMuted', 'header'], ['headerMuted', 'hero'], ['headerAccent', 'header'], ['headerAccent', 'hero']];

describe('theme presets: readable muted text and links', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.css'));
  it('finds the presets and both palettes of each', () => {
    assert.ok(files.length >= 5);
    for (const f of files) assert.strictEqual(palettes(fs.readFileSync(path.join(DIR, f), 'utf8')).length, 2, f);
  });
  for (const f of files) {
    it(f, () => {
      palettes(fs.readFileSync(path.join(DIR, f), 'utf8')).forEach((p, i) => {
        for (const [ink, ground] of PAIRS) {
          assert.ok(p[ink] && p[ground], `${f} palette ${i + 1} sets ${TOKENS[ink]} and ${TOKENS[ground]}`);
          const r = contrast(p[ink], p[ground]);
          assert.ok(r >= AA, `${f} palette ${i + 1}: ${TOKENS[ink]} ${p[ink]} on ${TOKENS[ground]} ${p[ground]} is ${r.toFixed(2)}:1`);
        }
      });
    });
  }
});
