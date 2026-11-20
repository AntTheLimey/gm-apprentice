'use strict';
// The whole cast for the page's "Bring anyone in" and the Fight's Add: every npc, creature and pc
// note in the vault, whether or not the Plan names them. Each entry keeps its own warnings, so a vault
// of five hundred people does not bury the Plan's own (read.js attaches the cast after its warnings pass).

const { stemOf } = require('./notes');
const { foesOf } = require('./foes');
const { playAsOf, wantsOf } = require('./people-from-notes');
const { nameList, gmAliasList, isWithheld } = require('../processor');
const fate = require('../fate');

const TYPES = new Set(['npc', 'creature', 'pc']);

// `carried` is the reader's allies' carried vitals (`{ of(note) }`) or null.
function readCast(index, { carried = null } = {}) {
  const cast = [];
  for (const p of index.notes()) {
    const { fm, body } = index.read(p);
    const type = String((fm && fm.type) || '').trim().toLowerCase();
    if (!TYPES.has(type)) continue;
    const pc = type === 'pc';
    const foe = pc ? { foes: [], warnings: [] } : foesOf(p, index, 1, `cast.${p}`, new Set(), carried);
    cast.push({
      note: p,
      name: typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : stemOf(p),
      type,
      aliases: nameList(fm.aliases),
      gmAliases: gmAliasList(fm),
      withheld: isWithheld(fm),
      status: fm.status === undefined || fm.status === null ? '' : String(fm.status),
      dead: fate.isDeadBody(body, fm),
      portrait: index.portrait(p),
      playAs: pc ? '' : playAsOf(p, index),
      wants: pc ? '' : wantsOf(p, index),
      foe: foe.foes[0] || null,
      warnings: foe.warnings,
    });
  }
  return cast.sort((a, b) => a.name.localeCompare(b.name) || (a.note < b.note ? -1 : a.note > b.note ? 1 : 0));
}

module.exports = { readCast };
