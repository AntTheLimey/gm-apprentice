const { test } = require('node:test');
const assert = require('node:assert');
const { CONDITIONS } = require('../js/dnd-live.js');
const { STANDARD_CONDITIONS } = require('../lib/templates/dnd/live-data');

// The browser cannot import the build's list, so each side holds its own copy.
test('the conditions the drawer offers are the ones the build knows', () => {
  assert.equal(CONDITIONS.length, 14);
  assert.deepEqual(CONDITIONS, STANDARD_CONDITIONS);
});
