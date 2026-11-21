'use strict';
// Side colours on the GM page (plan 6a Task 9), the parts a plain node run can judge: the one colour table
// (`SIDE_PRESETS` in web/gm.js), its contrast against the page's backgrounds, the swatches the Colours menu
// draws from it, and the players' page staying clear of them.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'lib', 'run-sheet', 'web');
const gm = require(path.join(WEB, 'gm.js'));
const { SIDE_PRESETS, sideCss, swatches } = gm;
const css = fs.readFileSync(path.join(WEB, 'gm.css'), 'utf8').replace(/\r\n/g, '\n');
const NAMES = ['pc', 'ally', 'foe', 'neutral'];

// The tokens of one gm.css block, by the selector that opens it.
function tokens(open) {
  const at = css.indexOf(open);
  assert.ok(at >= 0, `gm.css has ${open}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}
const light = tokens(':root {');
const dark = tokens(':root:not([data-theme="light"]) {');
const darkForced = tokens(':root[data-theme="dark"] {');

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('the side colour table', () => {
  it('has Pens and Colour-blind safe, four colours each, light and dark', () => {
    assert.deepStrictEqual(Object.keys(SIDE_PRESETS).sort(), ['colour_blind', 'pens']);
    for (const p of Object.values(SIDE_PRESETS)) for (const mode of ['light', 'dark']) {
      assert.strictEqual(p[mode].length, 4);
      for (const c of p[mode]) assert.match(c, /^#[0-9a-f]{6}$/);
    }
    assert.deepStrictEqual(SIDE_PRESETS.pens.light, ['#2c7739', '#7a3fb0', '#b3261e', '#646870']);
    assert.deepStrictEqual(SIDE_PRESETS.colour_blind.dark, ['#56b4e9', '#cc79a7', '#f0e442', '#a7abb2']);
  });

  it('every preset colour reaches 4.5:1 as text on the page and current-row backgrounds, both modes', () => {
    assert.deepStrictEqual(dark, darkForced, 'the two dark blocks hold the same tokens');
    const rows = [];
    for (const [preset, p] of Object.entries(SIDE_PRESETS)) {
      for (const [mode, bg] of [['light', light], ['dark', dark]]) {
        p[mode].forEach((colour, i) => {
          for (const token of ['bg', 'panel', 'lamp-soft']) {
            const r = ratio(colour, bg[token]);
            rows.push(`${preset} ${mode} ${NAMES[i]} ${colour} on ${token} ${bg[token]}: ${r.toFixed(2)}`);
            assert.ok(r >= 4.5, `${preset} ${mode} ${NAMES[i]} ${colour} on ${token} is ${r.toFixed(2)}:1`);
          }
        });
      }
    }
    if (process.env.RS_CONTRAST) console.log(rows.join('\n'));
  });

  it('the swatches equal the applied variables', () => {
    for (const preset of Object.keys(SIDE_PRESETS)) for (const mode of ['light', 'dark']) {
      const swatch = swatches({ preset, own: {} }, mode);
      assert.deepStrictEqual(swatch, SIDE_PRESETS[preset][mode]);
      const applied = sideCss({ preset, own: {} });
      const block = mode === 'light' ? applied.split('@media')[0] : applied.slice(applied.indexOf('@media'));
      const vars = NAMES.map((n) => new RegExp(`--${n}:(#[0-9a-f]{6})`, 'i').exec(block)[1]);
      assert.deepStrictEqual(vars, swatch, `${preset} ${mode}`);
    }
    const own = { pc: '#010203', ally: '#040506', foe: '#070809', neutral: '#0a0b0c' };
    assert.deepStrictEqual(swatches({ preset: 'own', own }, 'dark'), ['#010203', '#040506', '#070809', '#0a0b0c']);
    assert.doesNotMatch(sideCss({ preset: 'own', own }), /@media/, 'my own colours are one set for both modes');
  });

  it('the vault setting\'s own-colour defaults are the Pens light set, so the two cannot drift', () => {
    const { DEFAULT_OWN } = require('../lib/run-sheet/side-colours');
    assert.deepStrictEqual(NAMES.map((n) => DEFAULT_OWN[n]), SIDE_PRESETS.pens.light);
  });

  it('an unknown preset reads as Pens', () => {
    assert.deepStrictEqual(swatches({ preset: 'nonsense', own: {} }, 'light'), SIDE_PRESETS.pens.light);
  });
});

describe('the players page', () => {
  it('has no side colour in its CSS', () => {
    const dir = path.join(WEB, 'players');
    const files = fs.readdirSync(dir).filter((f) => /\.css$/.test(f));
    assert.ok(files.length > 0, 'the players folder holds a stylesheet');
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /--(foe|ally|neutral|pc)\b/, f);
  });
});
