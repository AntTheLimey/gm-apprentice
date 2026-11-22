'use strict';
// A block's key/value pairs, for any system's reader. A stat block is written in several shapes; each gives
// (key, value-text) pairs, and the system picks the keys it knows by its own aliases (`keyOf(text)` -> a key or
// null), so nothing here knows a game. Never throws: a block with no pairs gives [].
//   1 `**HP** 13 · **MP** 16`, `ST 11 · DX 11`      2 `**HP:** 13 | **MP:** 12`
//   3 a vertical row `| HP | 13 |`                    4 paired cells `| HP 13 | MP 10 |`
//   5 a header row of keys with the values on the next row `| STR | CON | DEX |`

// Bold, underscores and backticks go; runs of space collapse.
const clean = (s) => String(s == null ? '' : s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const cellsOf = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map(clean);
const isSep = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
const isRow = (line) => /^\s*\|/.test(line);

function pairs(md, keyOf) {
  const out = [];
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isRow(line)) {
      const cells = cellsOf(line);
      if (isSep(cells)) continue;
      const keys = cells.map(keyOf);
      if (cells.length >= 3 && keys.filter(Boolean).length >= Math.max(3, Math.ceil(cells.length / 2))) {
        let j = i + 1;
        while (j < lines.length && isRow(lines[j]) && isSep(cellsOf(lines[j]))) j++;
        if (j < lines.length && isRow(lines[j])) {
          const vals = cellsOf(lines[j]);
          if (vals.length === cells.length && !vals.map(keyOf).some(Boolean)) {
            keys.forEach((k, n) => { if (k) out.push([k, vals[n]]); });
            i = j;
            continue;
          }
        }
      }
      const k0 = keyOf(cells[0]);
      if (k0 && cells.length >= 2 && cells[1] !== '') { out.push([k0, cells[1]]); continue; }
      for (const c of cells) {
        const m = /^(.+?)[:\s]\s*(-?[\d.].*)$/.exec(c);
        if (m && keyOf(m[1])) out.push([keyOf(m[1]), m[2].trim()]);
      }
      continue;
    }
    for (const part of line.split(/\s[·|•]\s|\s\|\s?/)) {
      const words = clean(part).replace(/^[-*+]\s+/, '').split(' ');
      // the key is the first one to four words (`HP`, `Basic Speed`), a colon allowed after it
      for (let n = 1; n <= Math.min(4, words.length - 1); n++) {
        const k = keyOf(words.slice(0, n).join(' ').replace(/:$/, ''));
        if (k) { out.push([k, words.slice(n).join(' ').replace(/^:\s*/, '').replace(/^\([^)]*\)\s*:?\s*/, '')]); break; }
      }
    }
  }
  return out;
}

// The first value written for a key, or null.
const firstOf = (ps, key) => { const p = ps.find(([k]) => k === key); return p ? p[1] : null; };

// The number a value starts with (`7 / 13 flying` is 7, `+2` is 2), or null when it starts with none.
const leadingNumber = (v) => {
  const m = /^\+?(-?\d+(?:\.\d+)?)/.exec(String(v == null ? '' : v).trim());
  return m ? Number(m[1]) : null;
};

module.exports = { pairs, firstOf, leadingNumber, clean };
