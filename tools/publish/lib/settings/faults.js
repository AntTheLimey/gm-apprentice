'use strict';
const { TYPES } = require('./types');

// Damerau-Levenshtein distance.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// A neighbour is within 2 edits and within a third of the length.
function nearest(name, candidates) {
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const dist = distance(name, c);
    if (dist < bestD) { best = c; bestD = dist; }
  }
  return bestD <= 2 && bestD <= Math.ceil(name.length / 3) ? best : null;
}

// A value as it is quoted in a message, never more than about 60 characters of it.
const show = (v) => {
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v);
  const text = JSON.stringify(v);
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
};

function formatFault(f) {
  if (f.hint) return f.hint;
  if (f.kind === 'misplaced') return f.suggest
    ? `${f.name} is written beside publish:; it belongs under it, as ${f.suggest}.`
    : `${f.name} is written beside publish:, where it hides nothing, and no setting has that name; it would belong under publish:.`;
  if (f.kind === 'unknown-name') return `${f.name} is not a setting.${f.suggest ? ` Did you mean ${f.suggest}?` : ''}`;
  if (f.kind === 'old-name') return `${f.name} is an old name; use ${f.use}.`;
  if (f.kind === 'retired') return `${f.name} is no longer used; remove it.`;
  if (f.kind === 'dropped') return f.message;
  return `${f.name}${f.now ? ` (now ${f.now})` : ''} is ${f.value === null ? 'empty' : show(f.value)}; it takes ${TYPES[f.entry.type].takes(f.entry)}.`;
}

// A fault with its ready-to-print line. `entry` stays on it for formatFault.
function makeFault(fields) {
  const f = { value: null, ...fields };
  f.message = formatFault(f);
  return f;
}

const stops = (faults) => faults.filter((f) => f.level === 'stop');

module.exports = { distance, nearest, formatFault, makeFault, stops, show };
