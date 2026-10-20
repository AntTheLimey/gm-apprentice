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
// A name that is some predicate's `inverse` (child_of, served_by) is that predicate seen
// from the other end. A name that is also a `type` is read as the type (symmetric kinds).
const inverses = new Map();
for (const p of data.predicates) {
  if (!predicates.has(p.inverse) && !inverses.has(p.inverse)) inverses.set(p.inverse, p);
}

// 'warm', 'hostile' or 'neutral'; null when the relationship has no tone. A word off the
// list (a vault not yet tidied) is neutral.
function toneFamily(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return 'neutral';
  const word = raw.trim().toLowerCase();
  if (!word) return null;
  return families.get(word) || 'neutral';
}

const PEOPLE = new Set(['pc', 'npc', 'creature']);

function words(type) {
  const text = String(type == null ? '' : type).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

// The heading a group of connections sits under. `direction` is 'out' for a relationship
// the page's own note declares and 'in' for one another note declares about it.
function groupLabel(type, direction, ends) {
  const written = typeof type === 'string' ? type.trim() : '';
  // A kind typed `Member_Of`, `member of` or `member-of` is the ontology's `member_of`.
  const spelled = written.toLowerCase().replace(/[\s-]+/g, '_');
  const key = predicates.has(spelled) || inverses.has(spelled) ? spelled : written;
  const p = predicates.get(key);
  const base = inverses.get(key);
  // Where something is "located" at a person, "Location of" would call the person a place; the
  // pair reads the same from both ends. `ends` are the types of the page that wrote the edge and
  // of the one it names.
  if (ends && (p || base) && (p || base).type === 'located_at' && PEOPLE.has(String(p ? ends.to : ends.from))) return 'Located with';
  if (p) {
    if (p.category === 'kinship') return 'Family';
    return words(direction === 'in' && !p.symmetric ? p.inverse : p.type);
  }
  if (base) {
    if (base.category === 'kinship') return 'Family';
    return words(direction === 'in' ? base.type : key);
  }
  const label = words(key);
  if (!label) return 'Connected';
  return direction === 'in' ? `${label} (named by)` : label;
}

// The whole export, for the commands that print or check the vocabulary (lib/relationships).
module.exports = { toneFamily, groupLabel, ontology: data };
