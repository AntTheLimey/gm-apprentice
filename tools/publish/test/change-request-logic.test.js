const { test } = require('node:test');
const assert = require('node:assert');
const cr = require('../js/change-request.js');

test('shouldPromptForCode: null or expired prompts, fresh does not', () => {
  assert.equal(cr.shouldPromptForCode(null, 1000), true);
  assert.equal(cr.shouldPromptForCode({ code: 'WOLF', at: 0 }, cr.CODE_TTL_MS), true);       // exactly at TTL
  assert.equal(cr.shouldPromptForCode({ code: 'WOLF', at: 0 }, cr.CODE_TTL_MS - 1), false);   // within window
  assert.equal(cr.shouldPromptForCode({ nope: true }, 1000), true);                           // malformed
});

test('resolvedResults returns only ids whose response arrived', () => {
  const results = {
    a: { status: 'handled', response: '✓ ok', kind: 'applied' },
    b: { status: 'pending', response: null, kind: null },
    c: { status: 'flagged', response: 'no', kind: 'rejected' },
  };
  const r = cr.resolvedResults(results, ['a', 'b', 'c']);
  assert.deepEqual(r.map(x => x.id).sort(), ['a', 'c']);
});

test('staleIds returns handled-with-no-response ids (expired), not pending ones', () => {
  const results = {
    a: { status: 'handled', response: null, kind: null },   // expired/gone
    b: { status: 'pending', response: null, kind: null },   // still waiting
    c: { status: 'handled', response: '✓', kind: 'applied' } // resolved, not stale
  };
  assert.deepEqual(cr.staleIds(results, ['a', 'b', 'c']), ['a']);
});

test('needsReload only when an applied result is present', () => {
  assert.equal(cr.needsReload([{ id: 'a', kind: 'applied' }]), true);
  assert.equal(cr.needsReload([{ id: 'c', kind: 'rejected' }, { id: 'd', kind: 'advice' }]), false);
});

test('appendLog caps to LOG_MAX', () => {
  let log = [];
  for (let i = 0; i < cr.LOG_MAX + 5; i++) log = cr.appendLog(log, { id: 'i' + i, ts: i, message: 'm' });
  assert.equal(log.length, cr.LOG_MAX);
  assert.equal(log[log.length - 1].id, 'i' + (cr.LOG_MAX + 4)); // newest kept
});

test('setLogReply fills the matching entry', () => {
  const log = [{ id: 'a', ts: 1, message: 'q' }, { id: 'b', ts: 2, message: 'r' }];
  const out = cr.setLogReply(log, 'b', '• answer', 'advice');
  assert.deepEqual(out[1], { id: 'b', ts: 2, message: 'r', reply: '• answer', kind: 'advice' });
  assert.equal(out[0].reply, undefined); // others untouched
});

test('classifySubmitError maps HTTP status', () => {
  assert.equal(cr.classifySubmitError(403), 'code');
  assert.equal(cr.classifySubmitError(429), 'rate');
  assert.equal(cr.classifySubmitError(400), 'bad');
  assert.equal(cr.classifySubmitError(500), 'bad');
});
