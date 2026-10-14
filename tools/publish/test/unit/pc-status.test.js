const { test } = require('node:test');
const assert = require('node:assert');
const { isOutOfPlay } = require('../../lib/pc-status');
const { entry } = require('../../lib/settings');

// The list a vault that sets nothing gets: the registry's own default, as config.js reads it.
const OUT = new Set(entry('vault.statuses.out_of_play').default);

test('isOutOfPlay: retired, dead, departed and missing PCs are out of play (#265)', () => {
  for (const status of ['retired', 'Dead', 'deceased', 'KIA', 'departed', 'missing', 'unknown', 'inactive', 'NPC', ' Retired ', 'destroyed', 'Dissolved']) {
    assert.strictEqual(isOutOfPlay({ status }, OUT), true, status);
  }
});

test('isOutOfPlay: active, blank or absent status stays in play', () => {
  for (const fm of [{ status: 'active' }, { status: 'alive' }, { status: '' }, {}, null, undefined]) {
    assert.strictEqual(isOutOfPlay(fm, OUT), false, JSON.stringify(fm));
  }
});

test('isOutOfPlay: the list it is given decides; an empty list means nobody is out of play', () => {
  assert.strictEqual(isOutOfPlay({ status: 'retired' }, new Set(['dead'])), false);
  assert.strictEqual(isOutOfPlay({ status: 'dead' }, new Set(['dead'])), true);
  assert.strictEqual(isOutOfPlay({ status: 'dead' }, new Set()), false);
});

test('isOutOfPlay: a missing list fails loudly instead of meaning "nobody"', () => {
  assert.throws(() => isOutOfPlay({ status: 'dead' }), TypeError);
});
