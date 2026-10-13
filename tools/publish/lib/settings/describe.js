'use strict';
// What the settings command says about one setting, built from its entry in the list.
const { TYPES, SWITCH_WORDS, emptyIsFault } = require('./types');
const { REGISTRY } = require('./registry');
const { stopsUnknown } = require('./layout');

// A setting the GM can read and write by name: not a parent that only holds others, not a
// retired name, not the tool's own bookkeeping, not a name its children's names stand in for.
function isLeaf(entry, all) {
  if (entry.container || entry.retired || entry.state || entry.legacyOnly) return false;
  return !all.some((e) => e.name.startsWith(`${entry.name}.`));
}

// The default a GM is told: the entry's own, or the words that say what happens when it is left out.
const defaultOf = (entry) => (entry.default !== undefined ? entry.default : (entry.left_out !== undefined ? entry.left_out : null));

// The "when left out" text: the entry's own words, or its default written out.
function leftOutCell(entry) {
  if (entry.left_out !== undefined) return entry.left_out;
  if (entry.default === undefined) return 'Not set';
  const d = entry.default;
  if (Array.isArray(d)) return d.length ? d.map((x) => `\`${x}\``).join(', ') : 'An empty list';
  if (typeof d === 'boolean') return d ? 'On' : 'Off';
  if (d !== null && typeof d === 'object') return Object.keys(d).length ? JSON.stringify(d) : 'Empty';
  return `\`${d}\``;
}

function row(entry) {
  return {
    name: entry.name,
    kind: entry.type,
    does: entry.does || null,
    takes: TYPES[entry.type].takes(entry),
    default: defaultOf(entry),
    guards: !!entry.guards,
    // The names it had before, in the old vault file first; a site-file key is named as the key.
    oldNames: (entry.was || []).map((o) => o.name),
  };
}

// ---- The JSON Schema of vault-config.yaml ----
// Built from the list and from types.js's own switch words; it describes the file as a GM writes
// it (not resolved values), as far as the reader accepts it.

const SCHEMA_ID = 'https://github.com/AntTheLimey/gm-apprentice/blob/main/tools/publish/schema/vault-config.schema.json';
const caseless = (word) => [...word].map((c) => (c.toLowerCase() === c.toUpperCase() ? c.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&') : `[${c}${c.toUpperCase()}]`)).join('');
const stringOrNumber = { type: ['string', 'number', 'boolean'] };

// The reader trims a word and lowercases it, so the pattern allows spaces round it and any casing.
const switchSchema = () => ({ anyOf: [{ type: 'boolean' }, { type: 'string', pattern: `^\\s*(?:${[...SWITCH_WORDS.keys()].map(caseless).join('|')})\\s*$` }] });

// The schema of one value, from the type's own definition. A choice lists the canonical words and
// the aliases in any casing with spaces round them (as the reader accepts), and the booleans when
// the word `true` or `false` is one of them.
const SCHEMAS = {
  switch: () => switchSchema(),
  choice(e) {
    const words = [...e.values, ...Object.keys(e.aliases || {})];
    const bools = ['true', 'false'].filter((w) => words.includes(w)).map((w) => w === 'true');
    const word = { type: 'string', pattern: `^\\s*(?:${[...new Set(words)].map(caseless).join('|')})\\s*$` };
    return bools.length ? { anyOf: [word, ...bools.map((b) => ({ const: b }))] } : word;
  },
  number(e) {
    const limits = {};
    if (e.min !== undefined) limits.minimum = e.min;
    if (e.max !== undefined) limits.maximum = e.max;
    // The reader also takes a number written as text; limits are described for the number form.
    const text = e.integer ? '^\\s*-?\\d+\\s*$' : '^\\s*-?\\d+(\\.\\d+)?\\s*$';
    return { anyOf: [{ type: e.integer ? 'integer' : 'number', ...limits }, { type: 'string', pattern: text }] };
  },
  list: () => ({ type: 'array', items: stringOrNumber }),
  switchOrList: () => ({ anyOf: [...switchSchema().anyOf, { type: 'array', items: stringOrNumber }] }),
  map(e) {
    if (!e.keys) return { type: 'object' };
    return { type: 'object', properties: Object.fromEntries(e.keys.map((k) => [k, {}])) };
  },
  text: () => ({ type: ['string', 'number'] }),
  any: () => ({}),
};

function valueSchema(e) {
  const s = SCHEMAS[e.type](e);
  if (!emptyIsFault(e) && e.type !== 'any') {
    if (s.anyOf) s.anyOf.push({ type: 'null' });
    else s.type = [].concat(s.type, 'null');
  }
  const out = {};
  if (e.does) out.description = e.does;
  if (e.default !== undefined) out.default = e.default;
  return { ...out, ...s };
}

function schema() {
  const root = { type: 'object', properties: {} };
  const groupAt = (segs) => {
    let node = root;
    for (const seg of segs) {
      if (!node.properties[seg]) node.properties[seg] = { type: ['object', 'null'], properties: {} };
      node = node.properties[seg];
    }
    return node;
  };
  for (const e of REGISTRY.filter((x) => !x.legacyOnly)) {
    const segs = e.name.split('.');
    const hasKids = REGISTRY.some((x) => !x.legacyOnly && x.name.startsWith(`${e.name}.`));
    if (hasKids) { groupAt(segs); continue; }
    groupAt(segs.slice(0, -1)).properties[segs[segs.length - 1]] = valueSchema(e);
  }
  const close = (node, name) => {
    if (!node.properties) return node;
    for (const [k, v] of Object.entries(node.properties)) if (v.properties) close(v, name ? `${name}.${k}` : k);
    if (stopsUnknown(name)) node.additionalProperties = false;
    return node;
  };
  close(root, '');
  const { vault, player_site: playerSite } = root.properties;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_ID,
    title: 'gm-apprentice vault settings',
    description: "The settings of a campaign vault, as written in _meta/vault-config.yaml. Generated from the tool's list of settings; do not edit by hand.",
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { description: "The layout's number", const: 1 },
      vault,
      player_site: playerSite,
      gm_site: { description: 'Reserved for the GM site; nothing under it is read yet', type: ['object', 'null'] },
    },
  };
}

// The committed file's exact text: two-space JSON and a final newline, with \n always.
const schemaText = () => `${JSON.stringify(schema(), null, 2)}\n`;

module.exports = { row, leftOutCell, isLeaf, defaultOf, schema, schemaText, SCHEMA_ID };
