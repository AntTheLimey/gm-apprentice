const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../../css/style.css'), 'utf8').replace(/\r\n/g, '\n');
const lib = path.join(__dirname, '../../../lib/templates/dnd');
const sources = [...fs.readdirSync(lib), ...fs.readdirSync(path.join(lib, 'blocks')).map(f => 'blocks/' + f)]
  .filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(lib, f), 'utf8')).join('\n');

describe('D&D sheet styles', () => {
  it('every dnd5e class the renderer writes has a rule', () => {
    const used = new Set([...sources.matchAll(/dnd5e-[a-z0-9-]+/g)].map(m => m[0]));
    // Modifier-built names: `dnd5e-blk-${key}`, `dnd5e-tab-${name}` need no rule of their own.
    const missing = [...used].filter(c => !/^dnd5e-(blk|tab)-/.test(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(missing, []);
  });
  it('the pieces that carry a note\'s own words wrap a long unbroken word', () => {
    // A rule that lists the class and sets overflow-wrap; selectors are split on commas.
    const wraps = cls => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .some(([, sel, body]) => sel.split(',').some(x => x.trim() === cls) && /overflow-wrap:\s*anywhere/.test(body));
    for (const c of ['.dnd5e-entry-name', '.dnd5e-tag', '.dnd5e-entry-text', '.dnd5e-v', '.dnd5e-why', '.dnd5e-recovers', '.dnd5e-skill-name', '.dnd5e-chip']) assert.ok(wraps(c), c);
  });
  it('uses only the site tokens for colour', () => {
    const block = css.slice(css.indexOf('.dnd5e-'), css.indexOf('/* PF2e */'));
    assert.ok(block.length > 500);
    assert.deepEqual(block.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
  });
  // The phone proof's findings (task 11): small labels under a campaign palette, the tall strip, a wrapped track label.
  const block = () => css.slice(css.indexOf('/* D&D 5e full sheet'), css.indexOf('/* PF2e */'));
  const rules = () => [...block().matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => [sel.trim(), body]);
  it('no sheet text takes the muted or the accent colour: a palette can put either under 4.5:1 at label size', () => {
    const coloured = rules().filter(([, body]) => /(?:^|[;\s])color:\s*var\(--(?:text-muted|accent|warning)\)/.test(body)).map(([sel]) => sel);
    assert.deepEqual(coloured, []);
  });
  it('a number field\'s placeholder is the text colour thinned towards the field, and meets 4.5:1 on the default palette and every preset', () => {
    const rule = rules().find(([sel]) => sel.endsWith('.dnd5e-field::placeholder'));
    assert.ok(rule, 'the placeholder has a rule: the browser\'s own grey is under 4.5:1');
    const m = rule[1].match(/color:\s*color-mix\(in srgb, var\(--text\) (\d+)%, var\(--bg\)\)/);
    assert.ok(m, rule[1]);
    assert.match(rule[1], /opacity:\s*1/);
    assert.match(block(), /\.dnd5e-field \{[^}]*background:\s*var\(--bg\)/, 'the field paints --bg, which the mix thins towards');
    const share = +m[1] / 100;
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (c) => c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const token = (s, n) => { const k = s.match(new RegExp(n + ':\\s*(#[0-9a-fA-F]{6})')); return k && hex(k[1]); };
    const palettes = [['default', css.slice(0, css.indexOf('html {'))]];
    const dir = path.join(__dirname, '../../../css/themes');
    for (const f of fs.readdirSync(dir)) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8'); const at = s.indexOf('prefers-color-scheme: light');
      palettes.push([f + ' dark', s.slice(0, at)], [f + ' light', s.slice(at)]);
    }
    assert.ok(palettes.length >= 11);
    for (const [name, s] of palettes) {
      const text = token(s, '--text'), bg = token(s, '--bg');
      assert.ok(text && bg, name);
      const ph = text.map((v, i) => v * share + bg[i] * (1 - share));
      assert.ok(ratio(ph, bg) >= 4.5, `${name}: ${ratio(ph, bg).toFixed(2)}:1`);
    }
  });
  it('a track label has no fixed width to wrap inside', () => {
    const [, body] = rules().find(([sel]) => sel.endsWith('.dnd5e-track-name') && !sel.includes(','));
    assert.ok(!/(?:^|[;\s])width:/.test(body) && /min-width:/.test(body));
  });
  it('on a phone the strip is one row of five tiles and quiet chips are left out', () => {
    const phone = block().slice(block().indexOf('@media (max-width: 480px)'));
    assert.match(phone, /\.dnd5e-vrow \{ grid-template-columns: 1\.7fr 1fr 1fr 1\.2fr 1fr;/);
    assert.match(phone, /\.dnd5e-chips\.is-quiet, \.dnd5e-chip\.is-quiet \{ display: none; \}/);
    assert.ok(!/\.dnd5e-hp \{ grid-column/.test(phone), 'the HP tile no longer takes a row of its own');
  });
  it('the half-proficient mark and the source tag have rules', () => {
    for (const c of ['.dnd5e-skill.is-half .dnd5e-dot', '.dnd5e-tag.is-source']) assert.ok(block().includes(c + ' {'), c);
  });
  it('the existing .dnd- rules Pathfinder uses are still there', () => {
    for (const c of ['.dnd-sheet', '.dnd-ability-card', '.dnd-skill', '.dnd-header']) assert.ok(css.includes(c + ' '), c);
  });
});
