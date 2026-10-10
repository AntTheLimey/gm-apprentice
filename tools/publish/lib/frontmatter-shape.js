'use strict';

// A frontmatter value of the wrong type must not stop the build.
//
// The fields below are read across the tool as one piece of text (`fm.status.toLowerCase()`)
// or as a list of plain values (`fm.aliases.map(...)`), in more places than can each be
// guarded. So the scanner puts each into its expected shape once, where the note is read,
// and everything downstream may rely on it. A value that cannot be put into shape is not
// read, and the build says which note and which field.
//
// This is not a schema: a field that is not listed here is left exactly as the GM wrote it,
// and the templates that print it read a value or a list. A field belongs here when a
// wrongly-typed value in it would otherwise throw.

// Read as one piece of text.
const TEXT_FIELDS = [
  'type', 'status', 'canon_status', 'source_confidence', 'confidence', 'item_type', 'itemType', 'location_type',
];

// Read as a list of plain values. `scalar: true`: one plain value alone is one item
// (gmAliasList reads a bare `gm_aliases: Name` as one secret name).
const LIST_FIELDS = {
  aliases: {},
  gm_aliases: { scalar: true },
  abilities: {},
  weaknesses: {},
  notable_traits: {},
};

// Read as a list of records (`- target: …`). Only an empty item (`-` and nothing) is taken
// out: each reader looks inside an item without asking whether there is one.
const RECORD_LIST_FIELDS = ['relationships', 'equipment'];

const isPlain = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint';
const isDate = (v) => v instanceof Date;
// An unquoted `2026-07-02` is a Date at UTC midnight: its UTC day is the day as written.
const plainText = (v) => (isDate(v) ? (isNaN(v) ? '' : v.toISOString().slice(0, 10)) : String(v));
// An unquoted `[[planned]]` is a list inside a list to YAML. It is read as its items, so a
// value that keeps a note off the site, or a secret name, is not lost with the brackets.
const flat = (v) => (Array.isArray(v) ? v.flat(Infinity).filter((x) => x != null) : v);

// `frontmatter` with every listed field in its expected shape (the same object when nothing
// had to change), and what was wrong: [{ field, problem }], each problem a clause that
// follows "<field>:" in a warning.
function shapeFrontmatter(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') return { frontmatter, wrong: [] };
  const wrong = [];
  let out = frontmatter;
  const set = (field, value) => {
    if (out === frontmatter) out = { ...frontmatter };
    if (value === undefined) delete out[field]; else out[field] = value;
  };

  for (const field of TEXT_FIELDS) {
    const value = flat(frontmatter[field]);
    if (value == null || typeof value === 'string') continue;
    // `type: false` is no type, as an empty one is.
    if (field === 'type' && typeof value === 'boolean') { set(field, undefined); continue; }
    if (isPlain(value) || isDate(value)) { set(field, plainText(value)); continue; }
    if (Array.isArray(value) && value.length > 0 && value.every((v) => isPlain(v) || isDate(v))) {
      const text = value.map(plainText).join(', ');
      set(field, text);
      wrong.push({ field, problem: `is a list where one value is expected; it is read as "${text}"` });
      continue;
    }
    set(field, undefined);
    wrong.push({ field, problem: 'is not a plain value, so it is not read; write one value' });
  }

  for (const [field, rule] of Object.entries(LIST_FIELDS)) {
    const value = frontmatter[field];
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === 'string')) continue;
      // An empty item (`-` and nothing) goes without a word; a number or a date is its text.
      const full = flat(value);
      const kept = full.filter((v) => isPlain(v) || isDate(v)).map(plainText);
      set(field, kept);
      if (kept.length < full.length) wrong.push({ field, problem: 'holds an item that is not a plain value; that item is not read' });
      continue;
    }
    if (rule.scalar && (isPlain(value) || isDate(value))) {
      if (typeof value !== 'string') set(field, plainText(value));
      continue;
    }
    set(field, undefined);
    wrong.push({ field, problem: 'is not a list, so it is not read; write it as a list, one item to a line' });
  }

  for (const field of RECORD_LIST_FIELDS) {
    const value = frontmatter[field];
    if (Array.isArray(value) && value.some((v) => v == null)) set(field, value.filter((v) => v != null));
  }

  return { frontmatter: out, wrong };
}

module.exports = { shapeFrontmatter, TEXT_FIELDS, LIST_FIELDS, RECORD_LIST_FIELDS };
