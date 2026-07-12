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

test('getStatuses maps known ids and treats missing as handled', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'k', character: 'ana', text: 'k', timestamp: '2026-07-11T14:00:00.000Z' });
  const s = await inbox.getStatuses(kv, ['k', 'gone']);
  assert.deepEqual(s, { k: 'pending', gone: 'handled' });
});

test('rateLimited allows up to limit then blocks', async () => {
  const kv = fakeKV();
  for (let i = 0; i < 3; i++) {
    assert.equal(await inbox.rateLimited(kv, '1.2.3.4', { limit: 3, windowSec: 60 }), false);
  }
  assert.equal(await inbox.rateLimited(kv, '1.2.3.4', { limit: 3, windowSec: 60 }), true);
});
