'use strict';
// The run sheet's game systems: `systemFor(id)` picks the one a vault's `system` names (its id or an alias, through
// shared-lists' `systemId`). A system reads a foe's block (`readFoe`) and a PC's sheet (`readPc`), and describes what
// the page and the fight need (`describe()`, plain data, model.rules). A vault with no system runs as D&D. A system
// with no module here yet (GURPS until step 6b Task 4, PF2e, FitD) and an unknown one read as D&D,
// as before 6b, but with no Fight button (`fights: false`).

const { systemId, SYSTEM_NAMES } = require('../../shared-lists');
const { dnd, describeAs } = require('./dnd');

const { coc, cocRegency } = require('./coc');

const SYSTEMS = { [dnd.id]: dnd, [coc.id]: coc, [cocRegency.id]: cocRegency };

// D&D's reading under another system's id and name, with no fights.
function noFights(id) {
  return { ...dnd, id, fights: false, describe: () => describeAs(id, id ? SYSTEM_NAMES[id] : '', false) };
}

function systemFor(raw) {
  if (raw == null) return dnd;
  const id = systemId(raw);
  return (id && SYSTEMS[id]) || noFights(id);
}

module.exports = { systemFor };
