const { test } = require('node:test');
const assert = require('node:assert');
const et = require('../js/equipment-toggle.js');

const DATA = {
  levels: [
    { name: 'None', num: 0, maxWeight: 34, move: 6, dodge: 10 },
    { name: 'Light', num: 1, maxWeight: 68, move: 4, dodge: 9 },
    { name: 'Medium', num: 2, maxWeight: 102, move: 3, dodge: 8 },
    { name: 'Heavy', num: 3, maxWeight: 204, move: 2, dodge: 7 },
    { name: 'X-Heavy', num: 4, maxWeight: 340, move: 1, dodge: 6 },
  ],
  vitals: { st: 13 },
  skills: { Climbing: [13, 12, 11, 10, 9] },
  weapons: { 'Vibro-axe': { toHit: [17, 17, 17, 17, 17], parry: [12, 12, 12, 12, 12], block: null } },
  items: [
    { key: 'Armor', weight: 56, defaultCarried: true, table: 'main' },
    { key: 'Axe', weight: 4, defaultCarried: true, table: 'main' },
    { key: 'Thruster', weight: 4, defaultCarried: false, table: 'loadout:Transit' },
  ],
};

test('sumCarriedWeight adds only checked items', () => {
  assert.equal(et.sumCarriedWeight(DATA.items, { Armor: true, Axe: true, Thruster: false }), 60);
  assert.equal(et.sumCarriedWeight(DATA.items, { Armor: true, Axe: true, Thruster: true }), 64);
});

test('levelForWeight maps weight to enc level', () => {
  assert.deepEqual(et.levelForWeight(34, DATA.levels), { level: 0, overloaded: false });
  assert.deepEqual(et.levelForWeight(60, DATA.levels), { level: 1, overloaded: false });
  assert.deepEqual(et.levelForWeight(100, DATA.levels), { level: 2, overloaded: false }); // 100 <= Medium max 102
  assert.deepEqual(et.levelForWeight(103, DATA.levels), { level: 3, overloaded: false }); // 103 > 102 -> Heavy
  assert.deepEqual(et.levelForWeight(999, DATA.levels), { level: 4, overloaded: true });
});

test('applyModifiers returns base + current for the chosen level', () => {
  const r = et.applyModifiers(DATA, 2);
  assert.equal(r.levelName, 'Medium');
  assert.deepEqual(r.move, { base: 6, enc: 3, cur: 3 });
  assert.deepEqual(r.dodge, { base: 10, enc: 8, cur: 8 });
  assert.deepEqual(r.skills.Climbing, { base: 13, cur: 11 });
  assert.deepEqual(r.weapons['Vibro-axe'].toHit, { base: 17, cur: 17 });
  assert.deepEqual(r.weapons['Vibro-axe'].parry, { base: 12, cur: 12 });
});

test('reelingStep halves Move/Dodge (round up), leaves ST', () => {
  const r = et.applyModifiers(DATA, 2, { hp: { cur: 4, max: 13 }, fp: { cur: 12, max: 12 } });
  assert.equal(r.reeling, true);
  assert.equal(r.tired, false);
  assert.deepEqual(r.move, { base: 6, enc: 3, cur: 2 });   // 3 -> ceil(1.5)=2
  assert.deepEqual(r.dodge, { base: 10, enc: 8, cur: 4 }); // 8 -> 4
  assert.deepEqual(r.st, { base: 13, cur: 13 });            // ST unaffected by Reeling
});

test('tiredStep halves Move/Dodge/ST (round up)', () => {
  const r = et.applyModifiers(DATA, 2, { hp: { cur: 13, max: 13 }, fp: { cur: 3, max: 12 } });
  assert.equal(r.reeling, false);
  assert.equal(r.tired, true);
  assert.deepEqual(r.move, { base: 6, enc: 3, cur: 2 });
  assert.deepEqual(r.dodge, { base: 10, enc: 8, cur: 4 });
  assert.deepEqual(r.st, { base: 13, cur: 7 });            // 13 -> ceil(6.5)=7
});

test('cumulative: Reeling + Tired halve Move/Dodge twice (RAW B419/B426)', () => {
  const r = et.applyModifiers(DATA, 2, { hp: { cur: 4, max: 13 }, fp: { cur: 3, max: 12 } });
  assert.equal(r.reeling, true);
  assert.equal(r.tired, true);
  assert.deepEqual(r.move, { base: 6, enc: 3, cur: 1 });   // 3 -> 2 -> 1
  assert.deepEqual(r.dodge, { base: 10, enc: 8, cur: 2 }); // 8 -> 4 -> 2
  assert.deepEqual(r.st, { base: 13, cur: 7 });            // ST halved once (Tired only)
});

test('threshold is strict: exactly 1/3 is not reeling/tired', () => {
  const r = et.applyModifiers(DATA, 2, { hp: { cur: 5, max: 13 }, fp: { cur: 4, max: 12 } });
  // 3*5=15 >= 13, 3*4=12 >= 12 -> neither condition
  assert.equal(r.reeling, false);
  assert.equal(r.tired, false);
  assert.deepEqual(r.move, { base: 6, enc: 3, cur: 3 });
});

test('no vitals arg -> SP1-identical output (reeling/tired false)', () => {
  const r = et.applyModifiers(DATA, 2);
  assert.equal(r.reeling, false);
  assert.equal(r.tired, false);
  assert.equal(r.move.cur, r.move.enc);
  assert.equal(r.dodge.cur, r.dodge.enc);
  assert.deepEqual(r.st, { base: 13, cur: 13 });
});

test('halving floors at 1 (already Move 1 at X-Heavy)', () => {
  const r = et.applyModifiers(DATA, 4, { hp: { cur: 4, max: 13 }, fp: { cur: 3, max: 12 } });
  assert.equal(r.move.cur, 1);  // ceil(ceil(1/2)/2) = 1
});
