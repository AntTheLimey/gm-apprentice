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
