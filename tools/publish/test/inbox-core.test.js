const { test, before } = require('node:test');
const assert = require('node:assert');

let inbox;
before(async () => {
  inbox = await import('../templates-scaffold/functions/api/inbox-core.mjs');
});

// In-memory KV that mimics the subset of the Cloudflare KV API the core uses.
// TTL is accepted and ignored (tests don't advance time).
function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      const keys = [...store.keys()]
        .filter(k => !prefix || k.startsWith(prefix))
        .map(name => ({ name }));
      return { keys };
    },
    _store: store,
  };
}

test('normalizeCode trims and uppercases', () => {
  assert.equal(inbox.normalizeCode('  wolf '), 'WOLF');
  assert.equal(inbox.normalizeCode(null), '');
});

test('setCode/getCode round-trip stores normalized code', async () => {
  const kv = fakeKV();
  assert.equal(await inbox.getCode(kv), null);
  assert.equal(await inbox.setCode(kv, 'wolf'), 'WOLF');
  assert.equal(await inbox.getCode(kv), 'WOLF');
});

test('codeMatches is case-insensitive and false when no code set', async () => {
  const kv = fakeKV();
  assert.equal(await inbox.codeMatches(kv, 'WOLF'), false); // none set
  await inbox.setCode(kv, 'WOLF');
  assert.equal(await inbox.codeMatches(kv, 'wolf'), true);
  assert.equal(await inbox.codeMatches(kv, 'BEAR'), false);
});

test('enqueue stores a pending entry under req:<id>', async () => {
  const kv = fakeKV();
  const e = await inbox.enqueue(kv, { id: 'x1', character: 'ana', text: 'spend 1 xp on streetwise', timestamp: '2026-07-11T14:00:00.000Z' });
  assert.equal(e.status, 'pending');
  const raw = await kv.get('req:x1');
  assert.deepEqual(JSON.parse(raw), e);
});

test('readPending returns pending+applied sorted by timestamp, excludes handled/flagged', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'b', character: 'ana', text: 'b', timestamp: '2026-07-11T14:02:00.000Z' });
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'a', timestamp: '2026-07-11T14:01:00.000Z' });
  await inbox.enqueue(kv, { id: 'c', character: 'bo', text: 'c', timestamp: '2026-07-11T14:03:00.000Z' });
  await inbox.markApplied(kv, 'a');
  await inbox.markHandled(kv, 'b');
  await inbox.markFlagged(kv, 'c');
  const pending = await inbox.readPending(kv);
  assert.deepEqual(pending.map(e => e.id), ['a']); // b handled, c flagged
  assert.equal(pending[0].status, 'applied');
});

test('readPending skips a corrupted entry instead of throwing', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'good', character: 'ana', text: 'good', timestamp: '2026-07-11T14:00:00.000Z' });
  await kv.put('req:bad', 'not json{');
  const pending = await inbox.readPending(kv);
  assert.deepEqual(pending.map(e => e.id), ['good']);
});

test('buildEntry seeds response and kind as null', () => {
  const e = inbox.buildEntry({ id: 'x', character: 'a', text: 't', timestamp: '2026-07-12T00:00:00Z' });
  assert.equal(e.response, null);
  assert.equal(e.kind, null);
});

test('setResponse: applied → handled with response+kind', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'a', character: 'Six', text: 'spend 1 on Streetwise', timestamp: '2026-07-12T00:00:00Z' });
  const e = await inbox.setResponse(kv, 'a', 'applied', '✓ Streetwise 2→3 — applied');
  assert.equal(e.status, 'handled');
  assert.equal(e.kind, 'applied');
  assert.equal(e.response, '✓ Streetwise 2→3 — applied');
});

test('setResponse: rejected → flagged, still carries response', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'b', character: 'Ronin', text: 'raise Sex Appeal', timestamp: '2026-07-12T00:00:01Z' });
  const e = await inbox.setResponse(kv, 'b', 'rejected', 'Costs 6; has 5. Nothing applied.');
  assert.equal(e.status, 'flagged');
  assert.equal(e.kind, 'rejected');
  // flagged stays out of readPending
  assert.deepEqual((await inbox.readPending(kv)).map(x => x.id), []);
});

test('setResponse: missing id returns null', async () => {
  const kv = fakeKV();
  assert.equal(await inbox.setResponse(kv, 'nope', 'advice', 'x'), null);
});

test('getResults returns {status,response,kind}; missing → nulls', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'c', character: 'a', text: 't', timestamp: '2026-07-12T00:00:02Z' });
  await inbox.setResponse(kv, 'c', 'advice', '• do this');
  const r = await inbox.getResults(kv, ['c', 'gone']);
  assert.deepEqual(r.c, { status: 'handled', response: '• do this', kind: 'advice' });
  assert.deepEqual(r.gone, { status: 'handled', response: null, kind: null });
});

test('rateLimited allows up to limit then blocks', async () => {
  const kv = fakeKV();
  for (let i = 0; i < 3; i++) {
    assert.equal(await inbox.rateLimited(kv, '1.2.3.4', { limit: 3, windowSec: 60 }), false);
  }
  assert.equal(await inbox.rateLimited(kv, '1.2.3.4', { limit: 3, windowSec: 60 }), true);
});
