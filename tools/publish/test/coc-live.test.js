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
