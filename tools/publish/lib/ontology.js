'use strict';
// What the site needs of the relationship ontology: a tone word's family, and the words a
// reader sees for a relationship kind. Read from ontology.json, a generated copy of
// skills/shared/gm-apprentice-ontology.json (scripts/export_publish_ontology.py), so the
// tool keeps no list of its own.
const data = require('./ontology.json');

const FAMILY_WORD = { positive: 'warm', negative: 'hostile', neutral: 'neutral' };
const families = new Map();
for (const [family, words] of Object.entries(data.tones)) {
  for (const word of words) families.set(word, FAMILY_WORD[family] || 'neutral');
}
const predicates = new Map(data.predicates.map((p) => [p.type, p]));

// 'warm', 'hostile' or 'neutral'; null when the relationship has no tone. A word off the
// list (a vault not yet tidied) is neutral.
function toneFamily(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return 'neutral';
  const word = raw.trim().toLowerCase();
  if (!word) return null;
  return families.get(word) || 'neutral';
}

function words(type) {
  const text = String(type == null ? '' : type).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

// The heading a group of connections sits under. `direction` is 'out' for a relationship
// the page's own note declares and 'in' for one another note declares about it.
function groupLabel(type, direction) {
  const key = typeof type === 'string' ? type.trim() : '';
  const p = predicates.get(key);
  if (p) {
    if (p.category === 'kinship') return 'Family';
    return words(direction === 'in' && !p.symmetric ? p.inverse : p.type);
  }
  const label = words(key);
  if (!label) return 'Connected';
  return direction === 'in' ? `${label} (named by)` : label;
}

module.exports = { toneFamily, groupLabel };
