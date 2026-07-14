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
  assert.deepEqual(r.move, { base: 6, cur: 3 });
  assert.deepEqual(r.dodge, { base: 10, cur: 8 });
  assert.deepEqual(r.skills.Climbing, { base: 13, cur: 11 });
  assert.deepEqual(r.weapons['Vibro-axe'].toHit, { base: 17, cur: 17 });
  assert.deepEqual(r.weapons['Vibro-axe'].parry, { base: 12, cur: 12 });
});
