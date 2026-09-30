const { test } = require('node:test');
const assert = require('node:assert');
const { isOutOfPlay } = require('../../lib/pc-status');

test('isOutOfPlay: retired, dead, departed and missing PCs are out of play (#265)', () => {
  for (const status of ['retired', 'Dead', 'deceased', 'KIA', 'departed', 'missing', 'unknown', 'inactive', 'NPC', ' Retired ']) {
    assert.strictEqual(isOutOfPlay({ status }), true, status);
  }
});

test('isOutOfPlay: active, blank or absent status stays in play', () => {
  for (const fm of [{ status: 'active' }, { status: 'alive' }, { status: '' }, {}, null, undefined]) {
    assert.strictEqual(isOutOfPlay(fm), false, JSON.stringify(fm));
  }
});
