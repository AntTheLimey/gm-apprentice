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

const isInt = (v) => Number.isInteger(v);
const three = (randomInt) => [randomInt(1, 7), randomInt(1, 7), randomInt(1, 7)];

// ---- GURPS: 3d6 against a target ----
// The critical ranges are numbers with their pages: success 3-4, 5 at 15+, 6 at 16+; failure 18, 17 at 15 or
// less, or 10 over the target (GURPS Basic Set B348, B556). A target under 3 still rolls.
const AGAINST_LIMIT = 99;

function rollAgainst(spec, { randomInt = crypto.randomInt } = {}) {
  const target = spec && typeof spec === 'object' ? spec.target : undefined;
  if (!isInt(target) || target < -AGAINST_LIMIT || target > AGAINST_LIMIT) throw new RangeError(`a target is a whole number from -${AGAINST_LIMIT} to ${AGAINST_LIMIT}`);
  const dice = three(randomInt);
  return judgeAgainst(dice, dice[0] + dice[1] + dice[2], target);
}
function judgeAgainst(dice, total, target) {
  let outcome;
  if (total <= 4 || (total === 5 && target >= 15) || (total === 6 && target >= 16)) outcome = 'critical success';
  else if (total === 18 || (total === 17 && target <= 15) || total >= target + 10) outcome = 'critical failure';
  else outcome = total <= target ? 'success' : 'failure';
  return { dice, total, target, margin: target - total, outcome };
}

// ---- damage dice: the core of standard dice notation, plus GURPS's `2d+1` ----
// NdS (d or D), a missing count is one (`d6`), any 2-1000 sides, `d%` is d100, a count with no sides is six-sided
// (GURPS's `2d`, `2d+1`; a bare `d` is refused), and dice groups and numbers add and subtract in any order
// (`2d6+1d8`, `2d6-1d4`, `3-1d4`) with at least one group. Keep/drop, exploding and the rest are refused.
// The run sheet's page recognises a typed entry as dice with its own pattern (web/fight-math.js `DICE`); a test
// holds the two to one list of cases.
const DAMAGE_SIDES_MIN = 2;
const DAMAGE_SIDES_MAX = 1000;
const DAMAGE_DICE_LIMIT = 50;
const DAMAGE_MOD_LIMIT = 99;
const REFUSAL = "damage is dice like 2d6+1, d8, 1D8+1D4, 2d6-1d4, d% or GURPS's 2d+1";
// A well-shaped entry over a limit says which limit (U+2212 is the minus sign).
const BAD_SIDES = `a damage die has ${DAMAGE_SIDES_MIN} to ${DAMAGE_SIDES_MAX} sides`;
const OVER_LIMIT = 'damage is at most 50 dice, with a number from \u221299 to +99';

// -> { groups: [{ count, sides, sign }], mod }
function parseDamage(notation) {
  const bad = () => new RangeError(REFUSAL);
  if (typeof notation !== 'string') throw bad();
  const text = notation.replace(/\s+/g, '');
  if (!/^[+-]?[0-9dD%+-]+$/.test(text) || /[+-]$/.test(text)) throw bad();
  const terms = text.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== text) throw bad();
  const groups = [];
  let mod = 0;
  for (const raw of terms) {
    const sign = raw[0] === '-' ? -1 : 1;
    const body = raw.replace(/^[+-]/, '');
    let m;
    if (/^[0-9]+$/.test(body)) { mod += sign * Number(body); continue; }
    if (!(m = /^([0-9]*)[dD]([0-9]+|%)?$/.exec(body))) throw bad();
    if (m[1] === '' && m[2] === undefined) throw bad(); // a bare d
    const count = m[1] === '' ? 1 : Number(m[1]);
    const sides = m[2] === undefined ? 6 : m[2] === '%' ? 100 : Number(m[2]);
    if (count < 1) throw bad();
    if (sides < DAMAGE_SIDES_MIN || sides > DAMAGE_SIDES_MAX) throw new RangeError(BAD_SIDES);
    groups.push({ count, sides, sign });
  }
  if (!groups.length) throw bad();
  if (groups.reduce((n, g) => n + g.count, 0) > DAMAGE_DICE_LIMIT || Math.abs(mod) > DAMAGE_MOD_LIMIT) throw new RangeError(OVER_LIMIT);
  return { groups, mod };
}

// The floor: a result of 0 or less is 0 for crushing and 1 for any other type (GURPS Basic Set B378); no type
// (or an empty one) is crushing's. CoC's floor is 0 and is passed in.
const noType = (type) => type === undefined || type === null || type === '';
const damageFloor = (type, floor) => (isInt(floor) ? floor : (noType(type) || /^cr(ushing)?$/i.test(String(type)) ? 0 : 1));

// `dice` are the faces rolled, a taken-away die as a negative number, so they add up with `mod` to the raw total.
// A damage roll's type and floor, checked: one validator for rollDamage and maxRoll.
function damageOpts(type, floor) {
  if (type !== undefined && type !== null && (typeof type !== 'string' || type.length > 16)) throw new RangeError('a damage type is a short word like cr, cut or imp');
  if (floor !== undefined && !isInt(floor)) throw new RangeError('a damage floor is a whole number');
}

function rollDamage(notation, { type, floor, randomInt = crypto.randomInt } = {}) {
  damageOpts(type, floor);
  const { groups, mod } = parseDamage(notation);
  const dice = [];
  for (const g of groups) for (let i = 0; i < g.count; i++) dice.push(g.sign * randomInt(1, g.sides + 1));
  const raw = dice.reduce((a, b) => a + b, 0) + mod;
  return { notation, type: type === undefined ? null : type, dice, mod, total: Math.max(damageFloor(type, floor), raw) };
}

// The highest the notation can make (an Extreme hit in CoC), with the same floor: added dice at their top,
// taken-away dice at their bottom (one each). `maxRoll` answers in rollDamage's shape, its `dice` the faces at the
// top, so a working line reads the same either way; `maxDamage` is its total.
function maxRoll(notation, { type, floor } = {}) {
  damageOpts(type, floor);
  const { groups, mod } = parseDamage(notation);
  const dice = [];
  for (const g of groups) for (let i = 0; i < g.count; i++) dice.push(g.sign > 0 ? g.sides : -1);
  const raw = dice.reduce((a, b) => a + b, 0) + mod;
  return { notation, type: type === undefined ? null : type, dice, mod, total: Math.max(damageFloor(type, floor), raw), max: true };
}
const maxDamage = (notation, opts) => maxRoll(notation, opts).total;

// ---- CoC 7e: the d100 against a target ----
// Levels by the target's fractions, halves and fifths rounded down (Keeper Rulebook p32, p90); bonus and
// penalty dice cancel one for one and the net stops at two (p91, p407); the fumble range goes by the number the
// difficulty asks for: 100 from 50 up, 96-100 below (p89). Our own description of the mechanics.
const LEVELS = ['fail', 'regular', 'hard', 'extreme', 'critical'];
const DIFFICULTIES = ['regular', 'hard', 'extreme'];
const PERCENT_LIMIT = 999;
const BONUS_LIMIT = 9;

function rollPercent(spec, { randomInt = crypto.randomInt, typed } = {}) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const { target, difficulty = 'regular', bonus = 0, penalty = 0 } = s;
  if (!isInt(target) || target < 0 || target > PERCENT_LIMIT) throw new RangeError(`a skill is a whole number from 0 to ${PERCENT_LIMIT}`);
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`a difficulty is ${DIFFICULTIES.join(', ')}`);
  for (const n of [bonus, penalty]) if (!isInt(n) || n < 0 || n > BONUS_LIMIT) throw new RangeError(`bonus and penalty dice are whole numbers from 0 to ${BONUS_LIMIT}`);
  const net = bonus - penalty;
  const rolledBonus = net > 0 ? Math.min(2, net) : 0;
  const rolledPenalty = net < 0 ? Math.min(2, -net) : 0;
  let tens;
  let units;
  let kept;
  if (typed !== undefined) {
    // the kept roll as the table rolled it: its own tens and units, the bonus or penalty dice already chosen
    units = typed % 10;
    tens = [typed === 100 ? 0 : typed - units];
    kept = typed;
  } else {
    tens = Array.from({ length: 1 + rolledBonus + rolledPenalty }, () => randomInt(0, 10) * 10);
    units = randomInt(0, 10);
    const results = tens.map((t) => (t + units === 0 ? 100 : t + units));
    kept = rolledBonus ? Math.min(...results) : rolledPenalty ? Math.max(...results) : results[0];
  }
  const needed = difficulty === 'regular' ? target : Math.floor(target / (difficulty === 'hard' ? 2 : 5));
  const fumbleFrom = needed >= 50 ? 100 : 96;
  let level;
  if (kept >= fumbleFrom) level = 'fumble';
  else if (kept === 1) level = 'critical';
  else if (kept <= Math.floor(target / 5)) level = 'extreme';
  else if (kept <= Math.floor(target / 2)) level = 'hard';
  else if (kept <= target) level = 'regular';
  else level = 'fail';
  const passed = LEVELS.indexOf(level) >= 1 && LEVELS.indexOf(level) >= LEVELS.indexOf(difficulty);
  return { tens, units, kept, target, difficulty, needed, level, passed, fumbleFrom, bonus: rolledBonus, penalty: rolledPenalty, asked: { bonus, penalty }, ...(typed !== undefined ? { typed: true } : {}) };
}

// ---- a roll made at the table and typed (Task 37): judged here by the same rules, in the same shape, marked `typed` ----
// `{ against: N, typed: T }` (3d6, its total), `{ d100: {...}, typed: T }` (the kept roll), `{ sides, mod, typed: T }`
// (the die's face). The page never judges a roll: it sends what the table rolled.
function typedRoll(spec) {
  const t = spec.typed;
  const whole = (lo, hi, what) => { if (!isInt(t) || t < lo || t > hi) throw new RangeError(`a typed ${what} is a whole number from ${lo} to ${hi}`); };
  if ('against' in spec) {
    const target = spec.against;
    if (!isInt(target) || target < -AGAINST_LIMIT || target > AGAINST_LIMIT) throw new RangeError(`a target is a whole number from -${AGAINST_LIMIT} to ${AGAINST_LIMIT}`);
    whole(3, 18, '3d6 roll');
    return { ...judgeAgainst([], t, target), typed: true };
  }
  if ('d100' in spec) { whole(1, 100, 'd100 roll'); return rollPercent(spec.d100, { typed: t }); }
  if ('sides' in spec && !('damage' in spec)) {
    const { sides, mod = 0 } = spec;
    if (!SIDES.includes(sides)) throw new RangeError(`a die has ${SIDES.join(', ')} sides, not ${String(sides)}`);
    if (!Number.isInteger(mod) || mod < -MOD_LIMIT || mod > MOD_LIMIT) throw new RangeError(`a modifier is a whole number from -${MOD_LIMIT} to ${MOD_LIMIT}`);
    whole(1, sides, `d${sides} roll`);
    return { sides, mod, die: t, total: t + mod, typed: true };
  }
  throw new RangeError('a typed roll is 3d6 against a target, a d100 or one die; damage is typed in its box');
}

// ---- the one dispatcher: a spec rolls by its kind ----
const KINDS = 'a roll is { sides, mod }, { against: N }, { d100: { target } } or { damage: "2d+1" } (with max: true, its highest)';

function rollSpec(spec, opts) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new RangeError(KINDS);
  if ('typed' in spec) return typedRoll(spec);
  if ('against' in spec) return rollAgainst({ target: spec.against }, opts);
  if ('d100' in spec) return rollPercent(spec.d100, opts);
  if ('damage' in spec && 'max' in spec && typeof spec.max !== 'boolean') throw new RangeError('max is true or left out');
  if ('damage' in spec && spec.max === true) return maxRoll(spec.damage, { type: spec.type, floor: spec.floor });
  if ('damage' in spec) return rollDamage(spec.damage, { ...opts, type: spec.type, floor: spec.floor });
  if ('sides' in spec) return roll(spec, opts);
  throw new RangeError(KINDS);
}

const rollSpecs = (list, opts) => list.map((spec) => rollSpec(spec, opts));

module.exports = { SIDES, roll, rollMany, rollAgainst, rollDamage, maxDamage, maxRoll, parseDamage, rollPercent, rollSpec, rollSpecs };
