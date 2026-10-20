'use strict';
// Colour contrast: the GM site's CSS, the skins, the themes and the theme headers.
// Each block below was a test file of its own; the blocks keep their own imports and helpers.

// ---- gm-css-contrast.test.js -----------------------------------------------------------------------------
{
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
}

// ---- skins-contrast.test.js ------------------------------------------------------------------------------
{
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
const read = (f) => stripComments(fs.readFileSync(path.join(SKIN_DIR, f), 'utf8').replace(/\r\n/g, '\n'));
const LIGHT = '@media (prefers-color-scheme: light)';

const hex = (h) => { const s = h.replace('#', ''); const f = s.length === 3 ? s.replace(/./g, '$&$&') : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// color-mix(in srgb, a pa%, b): a straight per-channel blend of the gamma-encoded values, which is exactly
// what this models. The browser keeps fractions where this rounds, so the two differ by at most 0.5 of a channel step.
const mix = (a, b, pa) => a.map((v, i) => Math.round(v * pa + b[i] * (1 - pa)));
// CIE76 colour difference in Lab (D65), for telling the eight category inks apart.
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lab = ([r, g, b]) => {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const [x, y, z] = [(0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, 0.2126729 * R + 0.7151522 * G + 0.072175 * B, (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
// Floor for any two of a skin's eight category inks as rendered. The accepted mock-up has 224 pairs (28 x 8 skin-modes): 219 are at ΔE 10 or more,
// its closest are 8.1 (parchment dark and ledger dark, 3 vs 8). 10 is well above what two patches need to be told apart and is what small coloured text wants.
const MIN_INK_DELTA_E = 10;
// Where each tinted row can hold text coloured with the accent (.nm: skills, melee/ranged, grimoire, social, reactions, points) or the muted ink (.rel, sup.fn, and .cost, the point cost beside every trait, so category 3 too): tints by category number.
const ACCENT_TINTS = [1, 2, 4, 5, 6, 7], MUTED_TINTS = [1, 2, 3, 4, 5, 6, 7, 8];
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
// They are read through functions so a changed layer fails a named test instead of crashing the file.
const layer = read('_layer.css');
const layerLightAt = layer.indexOf(LIGHT);
const cmixOf = (css) => { const m = css.match(/--sk-cmix:\s*(\d+)%/); return m ? +m[1] / 100 : NaN; };
const CMIX = { dark: cmixOf(layer.slice(0, Math.max(layerLightAt, 0))), light: cmixOf(layer.slice(Math.max(layerLightAt, 0))) };
const tintPcts = [...layer.matchAll(/color-mix\(in srgb, var\(--sk-c([1-8])\) (\d+)%, var\(--bg-card\)\)/g)];
const inkExprs = [...layer.matchAll(/color-mix\(in srgb, var\(--sk-c([1-8])\) var\(--sk-cmix\), var\(--text\)\)/g)];
// the GURPS REELING / TIRED badges: the skin's danger / warning ink over a tint of itself on the tile, the percentage read from the layer
const badgeTint = (name, token) => { const m = layer.match(new RegExp('\\.gl-badge-' + name + ' \\{ color: var\\(--' + token + '\\); background: color-mix\\(in srgb, var\\(--' + token + '\\) (\\d+)%, var\\(--bg-card\\)\\); \\}')); return m ? +m[1] / 100 : NaN; };
const BADGE_TINT = { reeling: badgeTint('reeling', 'danger'), tired: badgeTint('tired', 'warning') };
const TINT = tintPcts.length ? +tintPcts[0][2] / 100 : NaN;

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
  it('the REELING and TIRED badges take the skin\'s danger and warning over a tint of themselves, which the model reads', () => {
    assert.ok(BADGE_TINT.reeling > 0 && BADGE_TINT.reeling < 0.5, 'reeling tint');
    assert.ok(BADGE_TINT.tired > 0 && BADGE_TINT.tired < 0.5, 'tired tint');
  });
  it('each skin file has exactly one light block, and it trails the file', () => {
    for (const id of Object.keys(SKINS).filter((s) => s !== 'plain')) {
      const css = read(id + '.css');
      assert.strictEqual(css.split(LIGHT).length - 1, 1, id + ': one light block');
      assert.strictEqual((css.match(/prefers-color-scheme/g) || []).length, 1, id + ': no other spelling of a colour-scheme query');
      let depth = 0, end = -1;
      for (let i = css.indexOf(LIGHT); i < css.length && end < 0; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) end = i;
      }
      assert.ok(end > 0 && css.slice(end + 1).trim() === '', id + ': nothing follows the light block');
    }
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
      // What the layer paints on the ground: a skin's ground ink, or the tile's where the skin sets none (the layer's --sk-gx-* fallbacks).
      const gText = t['--sk-g-text'] || t['--text'], gMuted = t['--sk-g-muted'] || t['--text-muted'], gAccent = t['--sk-g-accent'] || t['--accent'], gDanger = t['--sk-g-danger'] || t['--danger'];
      const dimOver = (bg) => (t.alpha !== undefined && bg && t['--accent'] ? mix(t['--accent'], bg, t.alpha) : undefined);
      // --accent-dim is one translucent value everywhere: a striped table row or a chip shows it over whatever it sits on
      const dim = dimOver(tile), dimWell = dimOver(well), dimGround = dimOver(ground);
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
        // the same fill over a well (a Pathfinder or FitD tag sits in a well)
        ['text on accent-dim fill over well', t['--text'], dimWell, 4.5], ['accent on accent-dim fill over well', t['--accent'], dimWell, 4.5],
        // a striped table row (style.css: tr:nth-child(even)) holding muted text: CoC's "not recorded" cells and note tables, in a tile or a well
        ['muted on accent-dim fill', t['--text-muted'], dim, 4.5], ['muted on accent-dim fill over well', t['--text-muted'], dimWell, 4.5],
        // the same stripe in a table that sits on the ground (a note's own table in a tab or an accordion body), under the ground inks
        ['ground text on accent-dim fill over ground', gText, dimGround, 4.5], ['ground muted on accent-dim fill over ground', gMuted, dimGround, 4.5],
        ['ground link on accent-dim fill over ground', gAccent, dimGround, 4.5],
        // a refused change request is listed in the danger colour, on the ground
        ['ground danger', gDanger, ground, 4.5],
        // a number field's placeholder (style.css: .dnd5e-field::placeholder is the muted ink at full strength) on the field, which paints the well; on a tile it is "muted on tile" above
        ['placeholder (muted) on a field in a well', t['--text-muted'], well, 4.5],
      ];
      // a filled mark (spent is the hollow one): every colour stop of its fill must stand off the tile and the well
      t.pip.forEach((p, i) => pairs.push([`filled mark colour ${i + 1} on tile`, p, tile, 3], [`filled mark colour ${i + 1} on well`, p, well, 3]));
      const cmix = CMIX[mode];
      for (let n = 1; n <= 8; n++) {
        const ink = mix(t['--sk-c' + n], t['--text'], cmix);
        const tint = mix(t['--sk-c' + n], tile, TINT);
        pairs.push([`category ${n} ink on tile`, ink, tile, 4.5], [`category ${n} ink on its own tint`, ink, tint, 4.5], [`text on category ${n} tint`, t['--text'], tint, 4.5]);
        // the Points Summary block (cat-points) tints its even rows with category 7; its unspent row is coloured with category 1's ink
        if (n === 1) pairs.push(['attribute ink (unspent row) on the points tint', ink, mix(t['--sk-c7'], tile, TINT), 4.5]);
      }
      pairs.push(['REELING badge text on its own tint', t['--danger'], t['--danger'] && tile && mix(t['--danger'], tile, BADGE_TINT.reeling), 4.5],
        ['TIRED badge text on its own tint', t['--warning'], t['--warning'] && tile && mix(t['--warning'], tile, BADGE_TINT.tired), 4.5]);
      for (const n of ACCENT_TINTS) pairs.push([`accent on category ${n} tint`, t['--accent'], mix(t['--sk-c' + n], tile, TINT), 4.5]);
      for (const n of MUTED_TINTS) pairs.push([`muted on category ${n} tint`, t['--text-muted'], mix(t['--sk-c' + n], tile, TINT), 4.5]);
      for (const [name, fg, bg, min] of pairs) {
        it(`${id} ${mode}: ${name} is at least ${min}:1`, () => {
          assert.ok(fg && bg, 'both colours are set as hex');
          assert.ok(ratio(fg, bg) >= min, `${ratio(fg, bg).toFixed(2)}:1`);
        });
      }
      for (let a = 1; a <= 8; a++) {
        for (let b = a + 1; b <= 8; b++) {
          it(`${id} ${mode}: category ${a} and ${b} inks differ by at least ΔE ${MIN_INK_DELTA_E}`, () => {
            const ink = (n) => mix(t['--sk-c' + n], t['--text'], cmix);
            assert.ok(t['--sk-c' + a] && t['--sk-c' + b] && t['--text'], 'pigments and text are set as hex');
            assert.ok(deltaE(ink(a), ink(b)) >= MIN_INK_DELTA_E, `ΔE ${deltaE(ink(a), ink(b)).toFixed(1)}`);
          });
        }
      }
    }
  }
});
}

// ---- theme-contrast.test.js ------------------------------------------------------------------------------
{
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
}

// ---- theme-header-contrast.test.js -----------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #259: every preset keeps a dark header and hero in light mode, but switched
// --text to dark ink, and header text fell back to --text: dark on dark. Check
// the header text contrast of every preset in both schemes.
const CSS = path.join(__dirname, '..', '..', 'css');

function vars(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function palettes(css) {
  const light = css.match(/@media\s*\(prefers-color-scheme:\s*light\)\s*{\s*:root\s*{([^}]*)}/);
  const base = css.replace(/@media[^{]*{\s*:root\s*{[^}]*}\s*}/g, '').match(/:root\s*{([^}]*)}/);
  const dark = vars(base ? base[1] : '');
  return { dark, light: Object.assign({}, dark, light ? vars(light[1]) : {}) };
}

function lum(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const base = vars(fs.readFileSync(path.join(CSS, 'style.css'), 'utf8').match(/:root\s*{([^}]*)}/)[1]);

describe('header text is readable on the header in both schemes (#259)', () => {
  for (const file of fs.readdirSync(path.join(CSS, 'themes')).filter(f => f.endsWith('.css'))) {
    for (const scheme of ['dark', 'light']) {
      it(`${file} (${scheme})`, () => {
        const p = Object.assign({}, base, palettes(fs.readFileSync(path.join(CSS, 'themes', file), 'utf8'))[scheme]);
        const text = p['text-on-header'] || p.text;
        for (const bg of ['bg-header', 'bg-hero']) {
          assert.ok(contrast(text, p[bg]) >= 4.5,
            `${file} ${scheme}: header text ${text} on ${bg} ${p[bg]} is ${contrast(text, p[bg]).toFixed(2)}:1`);
        }
        const muted = p['text-muted-on-header'] || p['text-muted'];
        assert.ok(contrast(muted, p['bg-header']) >= 3,
          `${file} ${scheme}: muted header text ${muted} is ${contrast(muted, p['bg-header']).toFixed(2)}:1`);
      });
    }
  }
});

// A story page's copy-link icon says "Copied" in text: its colour is read on the page and on a card, in every look.
describe('the story page\'s "Copied" can be read in both schemes', () => {
  const css = fs.readFileSync(path.join(CSS, 'style.css'), 'utf8');
  const m = css.match(/\.story-anchor\.copied\s*{[^}]*?color:\s*var\(--([a-z-]+)\)/);
  it('takes a colour name', () => assert.ok(m, 'style.css .story-anchor.copied sets color: var(--…)'));
  const looks = [['style.css', 'dark', base]];
  for (const file of fs.readdirSync(path.join(CSS, 'themes')).filter(f => f.endsWith('.css'))) {
    const p = palettes(fs.readFileSync(path.join(CSS, 'themes', file), 'utf8'));
    for (const scheme of ['dark', 'light']) looks.push([file, scheme, Object.assign({}, base, p[scheme])]);
  }
  for (const [file, scheme, p] of looks) {
    it(`${file} (${scheme})`, () => {
      const colour = p[m[1]];
      for (const bg of ['bg', 'bg-card']) {
        assert.ok(contrast(colour, p[bg]) >= 4.5, `${file} ${scheme}: "Copied" ${colour} on ${bg} ${p[bg]} is ${contrast(colour, p[bg]).toFixed(2)}:1`);
      }
    });
  }
});
}
