'use strict';
// `relationships words`: the relationship words in a few lines, read from the generated ontology copy. With a vault,
// only the types its `_meta/relationship-types.md` names.
const fs = require('fs');
const path = require('path');
const { ontology } = require('../ontology');

const FAMILIES = ['positive', 'negative', 'neutral'];
const IDENT = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function readTypesFile(vaultPath) {
  if (!vaultPath) return null;
  try {
    return fs.readFileSync(path.join(vaultPath, '_meta', 'relationship-types.md'), 'utf8');
  } catch {
    return null;
  }
}

// Names the file puts forward as relationship types, from structured positions only: the cells of a table row,
// bullet or numbered items (a bare list of names, or code spans in the item), and a line that is only a list of
// names. Prose lines are ignored: a word in a sentence is not a type. `named` is every name found; `extra` leaves out a row's first cell (its category) so a
// category word is not mistaken for a stray type.
function candidates(text) {
  const named = new Set();
  const extra = new Set();
  const add = (word, isExtra) => {
    const w = word.trim();
    if (!IDENT.test(w)) return;
    named.add(w);
    if (isExtra) extra.add(w);
  };
  const spans = (line, isExtra) => {
    for (const m of line.matchAll(/`([^`]+)`/g)) add(m[1], isExtra);
  };
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  lines.forEach((line, n) => {
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|');
      // A one-column table has no category cell: its only cell is a type, unless the row is the header.
      const header = /^\|?\s*:?-{3,}/.test(lines[n + 1] || '');
      const single = cells.length === 1 && !header;
      cells.forEach((cell, i) => {
        spans(cell, i > 0 || single);
        cell.split(',').forEach((w) => add(w, i > 0 || single));
      });
    } else {
      // A bullet or numbered item may also hold code spans; a line that is only a comma list of names counts too.
      const item = /^(?:[-*]|\d+\.)\s+/.test(line);
      if (item) spans(line, true);
      // `- located_at: where it is`: a bare name before a colon is named. It is not offered as a stray
      // type, because a prose label such as `- note: ...` looks the same.
      const labelled = /^(?:[-*]|\d+\.)\s+([a-z][a-z0-9_]*)\s*:/.exec(line);
      if (labelled) add(labelled[1], false);
      const bare = line.replace(/^(?:[-*]|\d+\.)\s+/, '');
      if (bare && bare.split(',').every((w) => IDENT.test(w.trim()))) bare.split(',').forEach((w) => add(w, true));
    }
  });
  return { named, extra };
}

// The types a vault's own `_meta/relationship-types.md` puts forward: `subset` is true when it names some but not
// all of the vocabulary, `types` then holds the predicate types it names; `found` is what candidates() read (null
// when there is no file).
function vaultVocabulary(vaultPath) {
  const all = ontology.predicates;
  const file = readTypesFile(vaultPath);
  if (file === null) return { subset: false, types: null, found: null };
  const found = candidates(file);
  const named = all.filter((p) => found.named.has(p.type));
  const subset = named.length > 0 && named.length < all.length;
  return { subset, types: subset ? new Set(named.map((p) => p.type)) : null, found };
}

function wordsData({ vaultPath } = {}) {
  const all = ontology.predicates;
  const vocab = vaultVocabulary(vaultPath);
  let predicates = all;
  let unknown = [];
  if (vocab.found !== null) {
    const found = vocab.found;
    if (vocab.subset) predicates = all.filter((p) => vocab.types.has(p.type));
    const known = new Set([
      ...all.flatMap((p) => [p.type, p.inverse]),
      ...all.flatMap((p) => p.genre || []),
    ]);
    unknown = [...found.extra].filter((w) => !known.has(w));
  }
  return {
    subset: predicates.length < all.length,
    predicates: predicates.map(({ type, inverse, symmetric, category }) => ({ type, inverse, symmetric, category })),
    tones: Object.fromEntries(FAMILIES.map((f) => [f, ontology.tones[f]])),
    strength: ontology.strength_scale,
    notInVocabulary: unknown,
  };
}

function words(opts = {}) {
  const data = wordsData(opts);
  const total = ontology.predicates.length;
  const lines = [];
  lines.push(data.subset
    ? `Relationship types this vault uses (${data.predicates.length} of ${total}). ${ontology.storage_rule}`
    : `Relationship types (${total}). ${ontology.storage_rule}`);
  const byCategory = new Map();
  for (const p of data.predicates) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p.symmetric ? `${p.type}=` : `${p.type}>${p.inverse}`);
  }
  for (const [category, items] of byCategory) lines.push(`${category}: ${items.join(', ')}`);
  lines.push('(a>b: write a, b is implied. a=: two-way, stored once with bidirectional: true)');
  if (data.notInVocabulary.length) {
    lines.push(`Not in the vocabulary: ${data.notInVocabulary.join(', ')}`);
  }
  lines.push(`Tones: ${FAMILIES.map((f) => `${f}: ${data.tones[f].join(', ')}`).join(' | ')}`);
  const scale = Object.entries(data.strength).map(([range, word]) => `${range} ${word}`).join(', ');
  // The ontology file holds the scale but no default strength, so "5 when unknown" is kept here.
  lines.push(`Strength 1-10: ${scale} (5 when unknown)`);
  return lines.join('\n');
}

module.exports = { words, wordsData, vaultVocabulary };
