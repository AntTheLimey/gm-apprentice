'use strict';
// Where a foe's numbers live, for every system's reader. Real vaults put an NPC's block under many spellings
// (`### Stats`, `## Statistics`, `## Combat Stats (CoC 7e)`, `### **Attributes**`), so the finder takes the first
// heading that holds a stats word (S6-D4 as widened), and `### Stats` under `## GM Notes` when the note has one.
// `statSection(body)` -> { heading, md } | null; `currentOf(md)` -> the HP a foe starts at when the block says so.

const { toNumber } = require('../signed');

const STAT_WORDS = ['stats', 'statistics', 'stat block', 'characteristics', 'combat stats', 'attributes'];
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

// `*`, `_` and backticks around or inside a title do not count.
const plain = (title) => String(title).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

// The heading lines of `lines`, fenced code skipped: [{ level, title, at }].
function headingsOf(lines) {
  const out = [];
  let fence = null;
  lines.forEach((line, at) => {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) { fence = fence === null ? f[1] : (fence === f[1] ? null : fence); return; }
    if (fence) return;
    const m = HEADING.exec(line);
    if (m) out.push({ level: m[1].length, title: plain(m[2]), at });
  });
  return out;
}

// The section a heading opens: to the next heading of its level or higher.
function runOf(lines, heads, i) {
  const next = heads.slice(i + 1).find((h) => h.level <= heads[i].level);
  return { heading: heads[i].title, md: lines.slice(heads[i].at + 1, next ? next.at : lines.length).join('\n').trim() };
}

function statSection(body) {
  const lines = String(body == null ? '' : body).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const heads = headingsOf(lines);
  const gm = heads.findIndex((h) => h.level === 2 && h.title.toLowerCase() === 'gm notes');
  if (gm >= 0) {
    const end = heads.slice(gm + 1).find((h) => h.level <= 2);
    const at = heads.findIndex((h, i) => i > gm && (!end || h.at < end.at) && h.level === 3 && h.title.toLowerCase() === 'stats');
    if (at >= 0) return runOf(lines, heads, at);
  }
  const at = heads.findIndex((h) => STAT_WORDS.some((w) => h.title.toLowerCase().includes(w)));
  return at >= 0 ? runOf(lines, heads, at) : null;
}

// The current HP a block states, or null: `HP 10 (currently 4)` is 4, `HP 6/9` is 6 (current over max). The last
// one written wins, as the last HP figure does.
const HP_WORD = String.raw`\b(?:HP|Hit Points)[ \t*:]*`;
function currentOf(md) {
  const text = String(md == null ? '' : md);
  const found = [];
  for (const m of text.matchAll(new RegExp(`${HP_WORD}\\d+[ \\t*]*\\(\\s*currently[ \\t]+(\\d+)\\s*\\)`, 'gi'))) found.push([m.index, m[1]]);
  for (const m of text.matchAll(new RegExp(`${HP_WORD}(\\d+)[ \\t]*/[ \\t]*\\d+`, 'gi'))) found.push([m.index, m[1]]);
  if (!found.length) return null;
  found.sort((a, b) => a[0] - b[0]);
  return toNumber(found[found.length - 1][1]);
}

module.exports = { statSection, currentOf, STAT_WORDS };
