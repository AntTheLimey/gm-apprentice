const { test } = require('node:test');
const assert = require('node:assert');
const { shouldSyncFunctions } = require('../../lib/sync-functions');

test('both switches off: no sync', () => {
  assert.strictEqual(shouldSyncFunctions('/site', { liveStats: false, inbox: false }), false);
});

test('inbox on: sync', () => {
  assert.strictEqual(shouldSyncFunctions('/site', { liveStats: false, inbox: true }), true);
});

test('live stats on: sync', () => {
  assert.strictEqual(shouldSyncFunctions('/site', { liveStats: true, inbox: false }), true);
});

test('no switches at all counts as off, never as on', () => {
  assert.strictEqual(shouldSyncFunctions('/site', undefined), false);
  assert.strictEqual(shouldSyncFunctions('/site', {}), false);
});
