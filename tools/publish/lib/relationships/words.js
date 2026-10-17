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
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('|')) {
      line.split('|').slice(1).forEach((cell, i) => {
        spans(cell, i > 0);
        cell.split(',').forEach((w) => add(w, i > 0));
      });
    } else {
      // A bullet or numbered item may also hold code spans; a line that is only a comma list of names counts too.
      const item = /^(?:[-*]|\d+\.)\s+/.test(line);
      if (item) spans(line, true);
      const bare = line.replace(/^(?:[-*]|\d+\.)\s+/, '');
      if (bare && bare.split(',').every((w) => IDENT.test(w.trim()))) bare.split(',').forEach((w) => add(w, true));
    }
  }
  return { named, extra };
}

function wordsData({ vaultPath } = {}) {
  const all = ontology.predicates;
  const file = readTypesFile(vaultPath);
  let predicates = all;
  let unknown = [];
  if (file !== null) {
    const found = candidates(file);
    const named = all.filter((p) => found.named.has(p.type));
    if (named.length > 0 && named.length < all.length) predicates = named;
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

module.exports = { words, wordsData };
