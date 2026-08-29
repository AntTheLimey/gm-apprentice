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

test('unreadCount counts replies the player has not opened the log on', () => {
  const log = [
    { id: 'a', ts: 1, message: 'q', reply: 'answered', kind: 'advice' },   // unread
    { id: 'b', ts: 2, message: 'r', reply: 'seen', kind: 'advice', read: true },
    { id: 'c', ts: 3, message: 's' },                                      // no reply yet
  ];
  assert.equal(cr.unreadCount(log), 1);
  assert.equal(cr.unreadCount([]), 0);
  assert.equal(cr.unreadCount(undefined), 0);
});

// Entries written before this feature carry no `read` flag. They must read as UNREAD:
// the bug being fixed is a reply the player never saw, so defaulting them to read
// would hide exactly the case the badge exists for.
test('unreadCount treats a pre-feature reply with no read flag as unread', () => {
  assert.equal(cr.unreadCount([{ id: 'a', ts: 1, message: 'q', reply: 'old answer' }]), 1);
});

test('markAllRead flags replies only, leaves unanswered entries alone', () => {
  const log = [
    { id: 'a', ts: 1, message: 'q', reply: 'answered' },
    { id: 'b', ts: 2, message: 's' },
  ];
  const out = cr.markAllRead(log);
  assert.equal(out[0].read, true);
  assert.equal(out[1].read, undefined);   // nothing to have read
  assert.equal(cr.unreadCount(out), 0);
  assert.equal(log[0].read, undefined);   // input not mutated
});

test('classifySubmitError maps HTTP status', () => {
  assert.equal(cr.classifySubmitError(403), 'code');
  assert.equal(cr.classifySubmitError(429), 'rate');
  assert.equal(cr.classifySubmitError(400), 'bad');
  assert.equal(cr.classifySubmitError(500), 'bad');
});

test('goneIds returns ids the server no longer holds, and nothing else (#176)', () => {
  const results = {
    a: { status: 'gone', response: null, kind: null },
    b: { status: 'pending', response: null, kind: null },
    c: { status: 'handled', response: null, kind: null },
    d: { status: 'handled', response: '✓', kind: 'applied' },
  };
  assert.deepEqual(cr.goneIds(results, ['a', 'b', 'c', 'd']), ['a']);
  // gone is NOT stale: stale drops silently, gone must be surfaced to the player
  assert.deepEqual(cr.staleIds(results, ['a', 'b', 'c', 'd']), ['c']);
  assert.match(cr.GONE_TEXT, /expired/);
});
