const { test } = require('node:test');
const assert = require('node:assert');
const gl = require('../js/gurps-live.js');

// A minimal 5-level answer key: index 0 = None (Move 6, Dodge 10), rising encumbrance.
function pc(overrides = {}) {
  return Object.assign({
    buildVersion: 'v1',
    levels: [
      { name: 'None',   num: 0, maxWeight: 26,  move: 6, dodge: 10 },
      { name: 'Light',  num: 1, maxWeight: 52,  move: 4, dodge: 9 },
      { name: 'Medium', num: 2, maxWeight: 78,  move: 3, dodge: 8 },
      { name: 'Heavy',  num: 3, maxWeight: 156, move: 2, dodge: 7 },
      { name: 'X-Heavy',num: 4, maxWeight: 260, move: 1, dodge: 6 },
    ],
    authoredLevel: 0,
    skills: {}, weapons: {},
    items: [
      { key: 'Armor', weight: 45, defaultCarried: false, table: 'main' },
      { key: 'Pack',  weight: 10, defaultCarried: true,  table: 'main' },
    ],
    vitals: { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, st: 13 },
  }, overrides);
}

test('deriveLive with no state uses authored defaults (Pack carried, None enc, healthy)', () => {
  const v = gl.deriveLive(pc(), null);
  assert.equal(v.encLevel, 0);
  assert.equal(v.encName, 'None');
  assert.deepEqual(v.move, { base: 6, enc: 6, cur: 6 });
  assert.deepEqual(v.dodge, { base: 10, enc: 10, cur: 10 });
  assert.equal(v.reeling, false);
  assert.equal(v.tired, false);
  assert.deepEqual(v.hp, { cur: 13, max: 13 });
  assert.deepEqual(v.st, { base: 13, cur: 13 });
});

test('deriveLive with fresh state: armor on (Medium) + reeling halves Move/Dodge', () => {
  // Real KV shape: hp/fp are scalar current values, not {cur,max} objects.
  const state = { v: 'v1', items: { Armor: true, Pack: true }, hp: 4, fp: 12, updatedAt: 100 };
  const v = gl.deriveLive(pc(), state);
  assert.equal(v.encLevel, 2);            // 45 + 10 = 55 lb → Medium
  assert.equal(v.reeling, true);
  assert.equal(v.tired, false);
  assert.deepEqual(v.hp, { cur: 4, max: 13 });    // reconstructed from scalar + manifest max
  assert.deepEqual(v.move, { base: 6, enc: 3, cur: 2 });   // Medium 3 → reeling ceil(3/2)=2
  assert.deepEqual(v.dodge, { base: 10, enc: 8, cur: 4 });   // 8 → 4
  assert.deepEqual(v.st, { base: 13, cur: 13 });   // ST unaffected by reeling
});

test('deriveLive fresh state reeling+tired double-halves and halves ST once', () => {
  const state = { v: 'v1', items: { Pack: true }, hp: 4, fp: 3, updatedAt: 100 };
  const v = gl.deriveLive(pc(), state);
  assert.equal(v.encLevel, 0);
  assert.equal(v.reeling, true);
  assert.equal(v.tired, true);
  assert.deepEqual(v.hp, { cur: 4, max: 13 });
  assert.deepEqual(v.fp, { cur: 3, max: 12 });
  assert.deepEqual(v.move, { base: 6, enc: 6, cur: 2 });    // 6 → reel 3 → tired 2
  assert.deepEqual(v.dodge, { base: 10, enc: 10, cur: 3 });   // 10 → 5 → 3
  assert.deepEqual(v.st, { base: 13, cur: 7 });     // 13 → ceil/2 = 7 (once)
});

test('deriveLive honors 0 HP (not treated as absent by ||)', () => {
  const state = { v: 'v1', items: { Pack: true }, hp: 0, fp: 12, updatedAt: 100 };
  const v = gl.deriveLive(pc(), state);
  assert.equal(v.reeling, true);                  // 3*0 < 13 → reeling
  assert.deepEqual(v.hp, { cur: 0, max: 13 });    // 0 honored; || would fall back to authored 13
});

test('deriveLive ignores stale state (buildVersion mismatch) → authored defaults', () => {
  const state = { v: 'OLD', items: { Armor: true, Pack: true }, hp: { cur: 1, max: 13 }, fp: { cur: 1, max: 12 } };
  const v = gl.deriveLive(pc(), state);
  assert.equal(v.encLevel, 0);            // stale items ignored → defaults (Pack only)
  assert.equal(v.reeling, false);          // stale hp/fp ignored → healthy
  assert.deepEqual(v.move, { base: 6, enc: 6, cur: 6 });
});

test('deriveLive on a PC with no vitals returns null vitals and null st', () => {
  const v = gl.deriveLive(pc({ vitals: null }), null);
  assert.equal(v.hp, null);
  assert.equal(v.fp, null);
  assert.equal(v.st, null);
  assert.equal(v.reeling, false);
});
