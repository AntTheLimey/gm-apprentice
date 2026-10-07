// Every skin's text and marks meet contrast, in dark and in light, measured from the skin files themselves.
// Thresholds: 4.5:1 for text, 3:1 for marks (WCAG 2.x). Colours are read as hex from each skin file's base
// rule (dark) and its trailing light block; a token that is missing or not hex fails the pair loudly.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SKINS } = require('../../lib/skins');

const SKIN_DIR = path.join(__dirname, '../../css/skins');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (f) => stripComments(fs.readFileSync(path.join(SKIN_DIR, f), 'utf8'));
const LIGHT = '@media (prefers-color-scheme: light)';

const hex = (h) => { const s = h.replace('#', ''); const f = s.length === 3 ? s.replace(/./g, '$&$&') : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// color-mix(in srgb, a pa%, b): a straight per-channel blend of the gamma-encoded values, which is exactly
// what this models. The browser keeps fractions where this rounds, so the two differ by at most 0.5 of a channel step.
const mix = (a, b, pa) => a.map((v, i) => Math.round(v * pa + b[i] * (1 - pa)));
// Six- or three-digit hex only. An eight-digit value (the translucent --accent-dim) must not match, or its
// first six digits would be read as an opaque colour; the `;` anchor after the alternation guarantees that.
const HEX_DECL = /(--[a-z0-9-]+)\s*:\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\s*;/g;
const tokens = (block) => Object.fromEntries([...block.matchAll(HEX_DECL)].map((m) => [m[1], hex(m[2])]));
// --accent-dim: eight-digit hex, colour plus alpha
const dimAlpha = (block) => { const m = block.match(/--accent-dim\s*:\s*#[0-9a-fA-F]{6}([0-9a-fA-F]{2})\s*;/); return m ? parseInt(m[1], 16) / 255 : undefined; };
// the colour stops of a (possibly gradient) value, or the accent when the skin leaves it unset or points at it
const stops = (block, name, accent) => {
  const m = block.match(new RegExp(name + '\\s*:\\s*([^;]+);'));
  if (!m) return null;
  const found = [...m[1].matchAll(/#[0-9a-fA-F]{6}\b/g)].map((x) => hex(x[0]));
  return found.length ? found : /var\(--accent\)/.test(m[1]) ? [accent] : null;
};

function modes(id) {
  const css = read(id + '.css');
  const at = css.indexOf(LIGHT);
  assert.ok(at > 0, id + ': has a light block');
  const [baseCss, lightCss] = [css.slice(0, at), css.slice(at)];
  const dark = { ...tokens(baseCss), alpha: dimAlpha(baseCss) };
  dark.pip = stops(baseCss, '--sk-pip-on', dark['--accent']) || [dark['--accent']];
  const light = { ...dark, ...tokens(lightCss) };
  light.alpha = dimAlpha(lightCss) ?? dark.alpha;
  light.pip = stops(lightCss, '--sk-pip-on', light['--accent']) || (stops(baseCss, '--sk-pip-on', light['--accent']) || [light['--accent']]);
  return { dark, light };
}

// The two constants the pairs depend on come from the layer, so the test and the layer cannot drift.
const layer = read('_layer.css');
const layerLightAt = layer.indexOf(LIGHT);
const CMIX = { dark: +layer.slice(0, layerLightAt).match(/--sk-cmix:\s*(\d+)%/)[1] / 100, light: +layer.slice(layerLightAt).match(/--sk-cmix:\s*(\d+)%/)[1] / 100 };
const tintPcts = [...layer.matchAll(/color-mix\(in srgb, var\(--sk-c([1-8])\) (\d+)%, var\(--bg-card\)\)/g)];
const inkExprs = [...layer.matchAll(/color-mix\(in srgb, var\(--sk-c([1-8])\) var\(--sk-cmix\), var\(--text\)\)/g)];
const TINT = +tintPcts[0][2] / 100;

describe('skins: contrast model matches the layer', () => {
  it('the category ink is each pigment mixed into the text colour, by the layer\'s --sk-cmix', () => {
    assert.strictEqual(inkExprs.length, 8, 'eight ink mixes, each "in srgb, pigment cmix, text"');
    assert.deepStrictEqual(CMIX, { dark: 0.52, light: 1 }, 'cmix: 52% in the dark base, 100% in the light block');
  });
  it('the row tint is each pigment mixed into the tile, by one shared percentage', () => {
    assert.strictEqual(tintPcts.length, 8, 'eight tint mixes, each "in srgb, pigment N%, tile"');
    assert.ok(tintPcts.every((m) => m[2] === tintPcts[0][2]), 'one percentage for all eight');
    assert.strictEqual(TINT, 0.13);
  });
  it('an eight-digit hex is never read as a six-digit colour', () => {
    assert.deepStrictEqual(tokens('--accent-dim: #e58a6d24;'), {});
    assert.deepStrictEqual(tokens('--x: #e58a6d;'), { '--x': [229, 138, 109] });
    assert.deepStrictEqual(tokens('--x: #fa0;'), { '--x': [255, 170, 0] });
    assert.strictEqual(dimAlpha('--accent-dim: #e58a6d24;'), 0x24 / 255);
  });
});

describe('skins: contrast', () => {
  for (const id of Object.keys(SKINS).filter((s) => s !== 'plain')) {
    for (const [mode, t] of Object.entries(modes(id))) {
      const ground = t['--bg'], tile = t['--bg-card'], well = t['--sk-well'];
      const gText = t['--sk-g-text'] || t['--text'], gMuted = t['--sk-g-muted'] || t['--text-muted'], gAccent = t['--sk-g-accent'] || t['--accent'];
      const dim = t.alpha !== undefined && tile && t['--accent'] ? mix(t['--accent'], tile, t.alpha) : undefined;
      const pairs = [
        ['text on tile', t['--text'], tile, 4.5], ['muted on tile', t['--text-muted'], tile, 4.5], ['text on well', t['--text'], well, 4.5],
        ['muted on well', t['--text-muted'], well, 4.5], ['accent on tile', t['--accent'], tile, 4.5], ['accent on well', t['--accent'], well, 4.5],
        ['danger on tile', t['--danger'], tile, 4.5], ['warning on tile', t['--warning'], tile, 4.5], ['success on tile', t['--success'], tile, 4.5],
        ['ground text', gText, ground, 4.5], ['ground muted', gMuted, ground, 4.5], ['ground link', gAccent, ground, 4.5],
        ['frame on tile', t['--accent'], tile, 3],
        // the framed portrait sits in the hero tile or in CoC's well, never on the bare ground (lib/templates/pc.js)
        ['frame on well', t['--accent'], well, 3],
        // CoC (and the layer's mobile folio tab) paints tile-coloured text on a filled accent bar: chips, send button, hover steps
        ['tile text on accent fill', tile, t['--accent'], 4.5],
        ['danger on well', t['--danger'], well, 4.5],
        // a selected chip or button: body text over the translucent accent fill; the console's active tab: accent text over it
        ['text on accent-dim fill', t['--text'], dim, 4.5], ['accent on accent-dim fill', t['--accent'], dim, 4.5],
      ];
      // a filled mark (spent is the hollow one): every colour stop of its fill must stand off the tile and the well
      t.pip.forEach((p, i) => pairs.push([`filled mark colour ${i + 1} on tile`, p, tile, 3], [`filled mark colour ${i + 1} on well`, p, well, 3]));
      const cmix = CMIX[mode];
      for (let n = 1; n <= 8; n++) {
        const ink = mix(t['--sk-c' + n], t['--text'], cmix);
        const tint = mix(t['--sk-c' + n], tile, TINT);
        pairs.push([`category ${n} ink on tile`, ink, tile, 4.5], [`text on category ${n} tint`, t['--text'], tint, 4.5]);
      }
      for (const [name, fg, bg, min] of pairs) {
        it(`${id} ${mode}: ${name} is at least ${min}:1`, () => {
          assert.ok(fg && bg, 'both colours are set as hex');
          assert.ok(ratio(fg, bg) >= min, `${ratio(fg, bg).toFixed(2)}:1`);
        });
      }
    }
  }
});
