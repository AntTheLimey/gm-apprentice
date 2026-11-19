'use strict';
const { normalise } = require('../../lib/run-sheet/keys');
const { cleanText } = require('../../lib/run-sheet/plan-text');

// Every primitive in the model, as one normalised string.
function haystack(model) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (v !== null && v !== undefined) out.push(String(v));
  };
  walk(model);
  return normalise(out.join('\n¶\n'));
}

// The sections a field takes: their heading lines are the field names, not text.
const TAKEN = /^##\s+(?:session overview|world state|session end objectives|handouts & props|active threads|npc quick reference|planned scenes|contingency scenes|spotlight forecast|touchpoint plan|pc roster & arcs)\s*$/i;
// Bare block heads a beat reads into its fields.
const BLOCK_HEAD = /^\*\*(?:npcs|points to land|if the players\.\.\.|treasure|then|complications)\*\*\s*$/i;
const isRow = (l) => /^\s*\|/.test(l);
const isSep = (l) => /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(l) && isRow(l);

// The Plan lines the model holds nowhere. A line is found whole, or with its markup taken off, or
// (a line a field split up, such as an NPC line) as each of its parts. A short part (`or`, `3`)
// would be found anywhere, so only link targets and parts of three or more characters count, and
// a line needs at least one that counts.
function missingLines(planBody, model) {
  const hay = haystack(model);
  const has = (s) => s === '' || hay.includes(s);
  const strip = (l) => l
    .replace(/^#{1,6}\s+/, '')
    .replace(/^scene\s+\d+\s*:\s*/i, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
    .replace(/^\*\*(?:situation|starts it|trigger|entities|handouts|who):\*\*\s*/i, '');
  // Each link's target and each run of words between them and the punctuation fields split on.
  const parts = (l) => {
    const targets = new Set([...l.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)].map((x) => normalise(x[1])));
    return normalise(l.replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, ';$1;'))
      .split(/[(),:;|—–]|\band\b/).map((x) => x.trim())
      .filter((x) => x.length >= 3 || targets.has(x));
  };
  const partsHeld = (l) => { const ps = parts(l); return ps.length > 0 && ps.every(has); };
  const lines = cleanText(planBody).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (line.trim() === '' || TAKEN.test(line) || BLOCK_HEAD.test(line) || isSep(line)) return;
    if (isRow(line)) {
      if (i + 1 < lines.length && isSep(lines[i + 1])) return; // a table header names columns
      const cells = line.split('|').map((c) => normalise(c)).filter(Boolean);
      if (!cells.every(has)) out.push(line);
      return;
    }
    if (has(normalise(line))) return;
    const core = strip(line);
    if (has(normalise(core)) || partsHeld(core)) return;
    out.push(line);
  });
  return out;
}

module.exports = { haystack, missingLines };
