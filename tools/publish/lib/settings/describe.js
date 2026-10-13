'use strict';
// What the settings command says about one setting, built from its entry in the list.
const { TYPES } = require('./types');

// A setting the GM can read and write by name: not a parent that only holds others, not a
// retired name, not the tool's own bookkeeping, not a name its children's names stand in for.
function isLeaf(entry, all) {
  if (entry.container || entry.retired || entry.state) return false;
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
    oldNames: (entry.oldNames || []).map((o) => o.name),
  };
}

module.exports = { row, leftOutCell, isLeaf, defaultOf };
