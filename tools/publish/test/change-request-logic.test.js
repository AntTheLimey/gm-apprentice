const { test } = require('node:test');
const assert = require('node:assert');
const cr = require('../js/change-request.js');

test('shouldPromptForCode: null or expired prompts, fresh does not', () => {
  assert.equal(cr.shouldPromptForCode(null, 1000), true);
  assert.equal(cr.shouldPromptForCode({ code: 'WOLF', at: 0 }, cr.CODE_TTL_MS), true);       // exactly at TTL
  assert.equal(cr.shouldPromptForCode({ code: 'WOLF', at: 0 }, cr.CODE_TTL_MS - 1), false);   // within window
  assert.equal(cr.shouldPromptForCode({ nope: true }, 1000), true);                           // malformed
});

test('partitionStatuses buckets pending/applied together', () => {
  const p = cr.partitionStatuses({ a: 'pending', b: 'applied', c: 'handled', d: 'flagged' });
  assert.deepEqual(p.pending.sort(), ['a', 'b']);
  assert.deepEqual(p.handled, ['c']);
  assert.deepEqual(p.flagged, ['d']);
});

test('decide: reload when any handled', () => {
  assert.equal(cr.decide({ handled: ['c'], flagged: [], pending: ['a'] }), 'reload');
});

test('decide: flagged-only when nothing pending and some flagged', () => {
  assert.equal(cr.decide({ handled: [], flagged: ['d'], pending: [] }), 'flagged-only');
});

test('decide: keep polling when work remains and nothing handled', () => {
  assert.equal(cr.decide({ handled: [], flagged: ['d'], pending: ['a'] }), 'poll');
});

test('classifySubmitError maps HTTP status', () => {
  assert.equal(cr.classifySubmitError(403), 'code');
  assert.equal(cr.classifySubmitError(429), 'rate');
  assert.equal(cr.classifySubmitError(400), 'bad');
  assert.equal(cr.classifySubmitError(500), 'bad');
});
