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

function namedIn(text, name) {
  return new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text);
}

// Names the file puts forward as relationship types: items of a table row's cells after the first, code spans, bullet
// items and lines that are a bare list of names. Prose words are not names.
function candidates(text) {
  const found = new Set();
  const add = (word) => { const w = word.trim(); if (IDENT.test(w)) found.add(w); };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    for (const m of line.matchAll(/`([^`]+)`/g)) add(m[1]);
    if (line.startsWith('|')) {
      line.split('|').slice(2).forEach((cell) => cell.split(',').forEach(add));
    } else {
      const bare = line.replace(/^[-*]\s+/, '');
      if (bare.split(',').every((w) => IDENT.test(w.trim()))) bare.split(',').forEach(add);
    }
  }
  return found;
}

function wordsData({ vaultPath } = {}) {
  const all = ontology.predicates;
  const file = readTypesFile(vaultPath);
  let predicates = all;
  let unknown = [];
  if (file !== null) {
    const named = all.filter((p) => namedIn(file, p.type));
    if (named.length > 0 && named.length < all.length) {
      predicates = named;
      const known = new Set([
        ...all.flatMap((p) => [p.type, p.inverse]),
        ...all.flatMap((p) => p.genre || []),
      ]);
      unknown = [...candidates(file)].filter((w) => !known.has(w));
    }
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
    ? `Relationship types this vault uses (${data.predicates.length} of ${total}). Store one direction only; the reverse name is implied, never written.`
    : `Relationship types (${total}). Store one direction only; the reverse name is implied, never written.`);
  const byCategory = new Map();
  for (const p of data.predicates) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p.symmetric ? `${p.type}=` : `${p.type}>${p.inverse}`);
  }
  for (const [category, items] of byCategory) lines.push(`${category}: ${items.join(', ')}`);
  lines.push('(a>b: write a, b is implied. a=: two-way, stored once with bidirectional: true)');
  if (data.notInVocabulary.length) {
    lines.push(`Not in the vocabulary (flagged by the check): ${data.notInVocabulary.join(', ')}`);
  }
  lines.push(`Tones: ${FAMILIES.map((f) => `${f}: ${data.tones[f].join(', ')}`).join(' | ')}`);
  const scale = Object.entries(data.strength).map(([range, word]) => `${range} ${word}`).join(', ');
  lines.push(`Strength 1-10: ${scale} (5 when unknown)`);
  return lines.join('\n');
}

module.exports = { words, wordsData };
