const { test } = require('node:test');
const assert = require('node:assert');
const cl = require('../js/coc-live.js');

test('cocNotes flags 0-or-below HP and 0 Sanity, nothing when healthy', () => {
  assert.deepEqual(cl.cocNotes({ hp: { cur: 9 }, san: { cur: 55 } }), []);
  assert.deepEqual(cl.cocNotes({ hp: { cur: 0 }, san: { cur: 55 } }), ['0 HP — unconscious / dying (CON roll)']);
  assert.deepEqual(cl.cocNotes({ hp: { cur: -2 }, san: { cur: 55 } }), ['0 HP — unconscious / dying (CON roll)']);
  assert.deepEqual(cl.cocNotes({ hp: { cur: 9 }, san: { cur: 0 } }), ['Sanity 0 — permanently insane']);
});

test('reassocTicks keeps ticks whose skill still exists and drops the rest', () => {
  const ticks = { 'Spot Hidden': true, 'Obscure Skill': true };
  assert.deepEqual(cl.reassocTicks(ticks, ['Spot Hidden', 'Library Use']), { 'Spot Hidden': true });
  assert.deepEqual(cl.reassocTicks({}, ['Spot Hidden']), {});
  assert.deepEqual(cl.reassocTicks(null, ['Spot Hidden']), {});
});

test('clampScalar clamps to [0, max] and floors when max is null', () => {
  assert.equal(cl.clampScalar(5, 10), 5);
  assert.equal(cl.clampScalar(-3, 10), 0);
  assert.equal(cl.clampScalar(14, 10), 10);
  assert.equal(cl.clampScalar(-1, null), 0);
  assert.equal(cl.clampScalar(7, null), 7);
});

test('pipTarget sets to the tapped ordinal, but drops one when tapping the topmost filled pip', () => {
  assert.equal(cl.pipTarget(3, 5), 6);   // 4 filled shown as 3? tap 6th pip → raise to 6
  assert.equal(cl.pipTarget(6, 5), 5);   // 6 filled, tap the 6th (topmost) → drop to 5
  assert.equal(cl.pipTarget(1, 0), 0);   // 1 filled, tap the 1st (topmost) → drop to 0
  assert.equal(cl.pipTarget(0, 0), 1);   // empty, tap the 1st → raise to 1
  assert.equal(cl.pipTarget(2, 4), 5);   // tap above the fill → set to that ordinal
});

test('barPct is value/max as a rounded percent, 0 when value or max is missing', () => {
  assert.equal(cl.barPct(46, 92), 50);
  assert.equal(cl.barPct(92, 92), 100);
  assert.equal(cl.barPct(0, 92), 0);
  assert.equal(cl.barPct(null, 92), 0);
  assert.equal(cl.barPct(46, 0), 0);
});
