'use strict';
// The one home for dice logic (spec §3, §6.6). Real randomness from node:crypto, nothing kept between
// rolls: no smoothing, no re-rolls, no weighting. The run sheet's pages hold no dice code; they ask the
// server (`POST /api/roll`), and the sheet never rolls for a player's character.
const crypto = require('node:crypto');

const SIDES = [4, 6, 8, 10, 12, 20, 100];
const MOD_LIMIT = 99;

// roll({ sides, mod }) -> { sides, mod, die, total }. `randomInt` is injectable for tests only.
function roll(spec, { randomInt = crypto.randomInt } = {}) {
  const { sides, mod = 0 } = spec && typeof spec === 'object' ? spec : {};
  if (!SIDES.includes(sides)) throw new RangeError(`a die has ${SIDES.join(', ')} sides, not ${String(sides)}`);
  if (!Number.isInteger(mod) || mod < -MOD_LIMIT || mod > MOD_LIMIT) throw new RangeError(`a modifier is a whole number from -${MOD_LIMIT} to ${MOD_LIMIT}`);
  const die = randomInt(1, sides + 1);
  return { sides, mod, die, total: die + mod };
}

const rollMany = (list, opts) => list.map((spec) => roll(spec, opts));

module.exports = { SIDES, roll, rollMany };
