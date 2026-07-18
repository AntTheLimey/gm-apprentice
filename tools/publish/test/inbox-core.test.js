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

// KV that COUNTS list ops, to prove the inbox stops listing on every poll.
function countingKV(entries = {}) {
  const store = new Map(Object.entries(entries));
  const counts = { list: 0, get: 0, put: 0, delete: 0 };
  return {
    counts,
    _store: store,
    async get(k) { counts.get++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { counts.put++; store.set(k, v); },
    async delete(k) { counts.delete++; store.delete(k); },
    async list({ prefix } = {}) {
      counts.list++;
      return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}

test('steady-state readPending never lists — it reads the req index', async () => {
  const kv = countingKV();
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'a', timestamp: '2026-07-11T14:01:00.000Z' });
  await inbox.enqueue(kv, { id: 'b', character: 'bo', text: 'b', timestamp: '2026-07-11T14:02:00.000Z' });
  const listsAfterEnqueue = kv.counts.list;
  const p1 = await inbox.readPending(kv);
  const p2 = await inbox.readPending(kv);
  assert.deepEqual(p1.map(e => e.id), ['a', 'b']);
  assert.deepEqual(p2.map(e => e.id), ['a', 'b']);
  assert.equal(kv.counts.list, listsAfterEnqueue);   // polling adds zero lists
});

test('cold-start readPending seeds the index from ONE list, then never lists again', async () => {
  // A site upgraded from a pre-index deployment: req: entries already exist, no
  // index key yet. The first read must recover them (via a single list) and seed
  // the index; subsequent reads must not list.
  const kv = countingKV({
    'req:old1': JSON.stringify(inbox.buildEntry({ id: 'old1', character: 'ana', text: 'x', timestamp: '2026-07-11T14:00:00.000Z' })),
    'req:old2': JSON.stringify(inbox.buildEntry({ id: 'old2', character: 'bo', text: 'y', timestamp: '2026-07-11T14:01:00.000Z' })),
  });
  const p1 = await inbox.readPending(kv);
  assert.deepEqual(p1.map(e => e.id).sort(), ['old1', 'old2']);   // nothing lost on migration
  assert.equal(kv.counts.list, 1);   // seeded with exactly one list
  await inbox.readPending(kv);
  await inbox.readPending(kv);
  assert.equal(kv.counts.list, 1);   // and never again
});

test('enqueue re-reads the index before writing and preserves a concurrently-added id', async () => {
  // The index starts empty; a second enqueue "lands" between our ensureIndex
  // read and our pre-write re-read. The re-read+union must keep both ids.
  const store = new Map([[inbox.INDEX_KEY, JSON.stringify([])]]);
  let idxGets = 0;
  const kv = {
    async get(k) {
      if (k === inbox.INDEX_KEY) { idxGets++; if (idxGets === 2) store.set(k, JSON.stringify(['other'])); }
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) { store.set(k, v); },
    async list() { return { keys: [] }; },
  };
  await inbox.enqueue(kv, { id: 'mine', character: 'a', text: 't', timestamp: '2026-07-11T00:00:00Z' });
  assert.deepEqual(JSON.parse(store.get(inbox.INDEX_KEY)).sort(), ['mine', 'other']);
});

test('ensureIndex seed unions an index a concurrent enqueue created mid-migration', async () => {
  // Pre-index site with an existing entry 'x'; a concurrent enqueue lands 'y'
  // (both req:y and the index) while our seed is listing. The seed must union,
  // not clobber. Injected on the seed's pre-write re-read (2nd index get).
  const store = new Map([
    ['req:x', JSON.stringify(inbox.buildEntry({ id: 'x', character: 'a', text: 't', timestamp: '2026-07-11T00:00:00Z' }))],
  ]);
  let idxGets = 0;
  const kv = {
    async get(k) {
      if (k === inbox.INDEX_KEY) {
        idxGets++;
        if (idxGets === 2) {   // concurrent enqueue completes just before our seed write
          store.set('req:y', JSON.stringify(inbox.buildEntry({ id: 'y', character: 'b', text: 't', timestamp: '2026-07-11T00:01:00Z' })));
          store.set(k, JSON.stringify(['y']));
        }
      }
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) { store.set(k, v); },
    async list({ prefix } = {}) { return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })) }; },
  };
  const pending = await inbox.readPending(kv);
  assert.deepEqual(pending.map(e => e.id).sort(), ['x', 'y']);   // neither lost
  assert.deepEqual(JSON.parse(store.get(inbox.INDEX_KEY)).sort(), ['x', 'y']);
});

// KV whose list() paginates like Cloudflare: `pageSize` keys per call, exposing
// `cursor` + `list_complete`. A seed that reads only the first page would miss
// the tail here.
function paginatingKV(entries = {}, pageSize = 2) {
  const store = new Map(Object.entries(entries));
  const counts = { list: 0, get: 0, put: 0 };
  return {
    counts,
    _store: store,
    async get(k) { counts.get++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { counts.put++; store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '', cursor } = {}) {
      counts.list++;
      const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? parseInt(cursor, 10) : 0;
      const slice = all.slice(start, start + pageSize);
      const next = start + pageSize;
      const list_complete = next >= all.length;
      return { keys: slice.map(name => ({ name })), list_complete, cursor: list_complete ? undefined : String(next) };
    },
  };
}

test('cold-start seed follows the KV cursor and recovers every pre-index req: key', async () => {
  const entries = {};
  for (let i = 1; i <= 5; i++) {
    entries['req:m' + i] = JSON.stringify(
      inbox.buildEntry({ id: 'm' + i, character: 'a', text: 't', timestamp: '2026-07-11T14:0' + i + ':00.000Z' }));
  }
  const kv = paginatingKV(entries, 2);   // 5 keys spread over 3 pages
  const pending = await inbox.readPending(kv);
  assert.deepEqual(pending.map(e => e.id).sort(), ['m1', 'm2', 'm3', 'm4', 'm5']); // tail not dropped
  assert.equal(kv.counts.list, 3);       // walked all three pages via the cursor
  assert.deepEqual(JSON.parse(kv._store.get(inbox.INDEX_KEY)).sort(), ['m1', 'm2', 'm3', 'm4', 'm5']);
});

test('readPending prune re-reads the index and preserves a concurrently-enqueued id', async () => {
  // 'a' is flagged (terminal) so the prune drops it. Between readPending's first
  // index read and its pre-prune re-read, a concurrent enqueue lands 'new'. The
  // re-read+filter must drop only 'a' and keep 'new'.
  const store = new Map();
  store.set('req:a', JSON.stringify({ ...inbox.buildEntry({ id: 'a', character: 'x', text: 't', timestamp: '2026-07-11T00:00:00Z' }), status: 'flagged' }));
  store.set(inbox.INDEX_KEY, JSON.stringify(['a']));
  let idxGets = 0;
  const kv = {
    async get(k) {
      if (k === inbox.INDEX_KEY) {
        idxGets++;
        if (idxGets === 2) {   // concurrent enqueue lands just before the prune write
          store.set('req:new', JSON.stringify(inbox.buildEntry({ id: 'new', character: 'y', text: 't', timestamp: '2026-07-11T00:01:00Z' })));
          store.set(k, JSON.stringify(['a', 'new']));
        }
      }
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) { store.set(k, v); },
    async list() { return { keys: [] }; },
  };
  await inbox.readPending(kv);
  assert.deepEqual(JSON.parse(store.get(inbox.INDEX_KEY)).sort(), ['new']);   // 'a' dropped, 'new' kept
});

test('readPending drops a flagged (terminal, no-TTL) id from the index', async () => {
  const kv = countingKV();
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'x', timestamp: '2026-07-11T14:00:00.000Z' });
  await inbox.enqueue(kv, { id: 'b', character: 'bo', text: 'y', timestamp: '2026-07-11T14:01:00.000Z' });
  await inbox.markFlagged(kv, 'b');
  const listsBefore = kv.counts.list;
  const pending = await inbox.readPending(kv);
  assert.deepEqual(pending.map(e => e.id), ['a']);
  assert.deepEqual(JSON.parse(kv._store.get(inbox.INDEX_KEY)), ['a']);   // flagged 'b' removed
  assert.equal(kv.counts.list, listsBefore);
  // 'b' is still fetchable by id for the player's widget.
  assert.equal((await inbox.getResults(kv, ['b'])).b.status, 'flagged');
});

test('readPending prunes a reaped (TTL-expired) id from the index without listing', async () => {
  const kv = countingKV();
  await inbox.enqueue(kv, { id: 'live', character: 'ana', text: 'x', timestamp: '2026-07-11T14:00:00.000Z' });
  await inbox.enqueue(kv, { id: 'gone', character: 'bo', text: 'y', timestamp: '2026-07-11T14:01:00.000Z' });
  await kv.delete('req:gone');   // simulate TTL reap of a handled entry
  const listsBefore = kv.counts.list;
  const pending = await inbox.readPending(kv);
  assert.deepEqual(pending.map(e => e.id), ['live']);
  assert.deepEqual(JSON.parse(kv._store.get(inbox.INDEX_KEY)), ['live']);   // dead id dropped
  assert.equal(kv.counts.list, listsBefore);
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
