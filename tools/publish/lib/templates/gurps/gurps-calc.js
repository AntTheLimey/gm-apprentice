'use strict';
// JS port of skills/shared/scripts/gurps_calc.py pure formulas (GURPS Basic Set 4e).
// Proven equal to tests/test_gurps_check.py oracle numbers. No I/O.

// (name, level number, Basic Lift multiplier) — B17
const ENC_LEVELS = [
  ['None', 0, 1], ['Light', 1, 2], ['Medium', 2, 3], ['Heavy', 3, 6], ['X-Heavy', 4, 10],
];

// RAW encumbrance-penalized skills — B17 (climbing/stealth/swimming), B203 (judo/karate),
// and the fencing category B208 (rapier/saber/smallsword/main-gauche). Kept identical to
// gurps_calc.py's ENC_PENALIZED_SKILLS. Perk offsets (Armor Familiarity) are a sheet-level
// judgement (Base/Current delta), never decided here.
const ENC_PENALIZED_SKILLS = [
  'climbing', 'stealth', 'swimming', 'judo', 'karate',
  'rapier', 'saber', 'smallsword', 'main-gauche',
];

function roundHalfUp(x) { return Math.floor(x + 0.5); }

// B419 (Reeling: <1/3 HP) / B426 (Tired: <1/3 FP). Halve Move/Dodge (and ST when
// Tired), rounding up. Integer-safe strict-<1/3 thresholds avoid float drift.
function halveUp(x) { return Math.ceil(x / 2); }
function isReeling(hp, maxHp) { return 3 * hp < maxHp; }
function isTired(fp, maxFp) { return 3 * fp < maxFp; }

function basicLift(st) {
  const bl = (st * st) / 5;
  return bl >= 10 ? roundHalfUp(bl) : Math.round(bl * 100) / 100;
}

function encMaxWeights(bl) {
  return ENC_LEVELS.map(([name, level, mult]) => ({ name, level, max: bl * mult }));
}

function encMove(basicMove, level) {
  return Math.max(1, Math.floor((basicMove * (5 - level)) / 5));
}

function encDodge(basicSpeed, level, combatReflexes) {
  return Math.floor(basicSpeed) + 3 + (combatReflexes ? 1 : 0) - level;
}

function parry(skill, combatReflexes) {
  return 3 + Math.floor(skill / 2) + (combatReflexes ? 1 : 0);
}

function block(skill, combatReflexes) {
  return 3 + Math.floor(skill / 2) + (combatReflexes ? 1 : 0);
}

// A weight cell in pounds. Sheets write lb or lbs (or no unit, read as lb); a number written in
// ounces ("9.6 oz") is converted, 16 oz to the pound (#510). The unit read is the one right after
// the first number.
function parseWeight(str) {
  if (str == null) return 0;
  const m = String(str).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(oz\b|ounces?\b)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] ? Math.round((n / 16) * 10000) / 10000 : n;
}

module.exports = {
  ENC_LEVELS, ENC_PENALIZED_SKILLS,
  basicLift, encMaxWeights, encMove, encDodge, parry, block, parseWeight,
  halveUp, isReeling, isTired,
};
