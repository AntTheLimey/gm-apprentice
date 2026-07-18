// tools/publish/test/loadout-list.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');

let fn, core;
before(async () => {
  fn = await import('../templates-scaffold/functions/api/loadout-list.js');
  core = await import('../templates-scaffold/functions/api/loadout-core.mjs');
});

// Fake KV that COUNTS every operation. `list` is present so a stray caller would
// work — but the read path must never touch it, which the tests assert.
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
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) };
    },
  };
}
function getCtx(kv, qs) {
  return { request: new Request('https://s.pages.dev/api/loadout-list?' + qs), env: { INBOX: kv } };
}

test('isValidCampaign rejects colons and empty', () => {
  assert.equal(core.isValidCampaign('space-game'), true);
  assert.equal(core.isValidCampaign(''), false);
  assert.equal(core.isValidCampaign('a:b'), false);
  assert.equal(core.isValidCampaign('x'.repeat(101)), false);
});

test('getStates reads the roster index and each member — never lists', async () => {
  const kv = countingKV({
    'roster:space-game': JSON.stringify(['loadout:space-game:six:d1', 'loadout:space-game:rock:d9']),
    'loadout:space-game:six:d1': JSON.stringify({ v: 'v1', hp: { cur: 4, max: 13 } }),
    'loadout:space-game:rock:d9': JSON.stringify({ v: 'v1', hp: { cur: 3, max: 10 } }),
    'loadout:other-game:zed:d1': JSON.stringify({ v: 'v1' }),
  });
  const out = await core.getStates(kv, 'space-game');
  assert.deepEqual(Object.keys(out).sort(), ['loadout:space-game:rock:d9', 'loadout:space-game:six:d1']);
  assert.equal(out['loadout:space-game:six:d1'].hp.cur, 4);
  assert.equal(kv.counts.list, 0);   // the whole point of this fix
});

test('getStates returns {} with no list for an empty/missing roster', async () => {
  const kv = countingKV();
  const out = await core.getStates(kv, 'nobody-here');
  assert.deepEqual(out, {});
  assert.equal(kv.counts.list, 0);
  assert.equal(kv.counts.put, 0);   // read path does not write when nothing is stale
});

test('getStates skips members that resolve to null or unparseable values', async () => {
  const kv = countingKV({
    'roster:c': JSON.stringify(['loadout:c:p:d', 'loadout:c:q:d', 'loadout:c:gone:d']),
    'loadout:c:p:d': '{bad json',
    'loadout:c:q:d': JSON.stringify({ v: 'v1' }),
    // loadout:c:gone:d absent → resolves null (e.g. TTL-expired)
  });
  const out = await core.getStates(kv, 'c');
  assert.deepEqual(Object.keys(out), ['loadout:c:q:d']);
  assert.equal(kv.counts.list, 0);
});

test('getStates prunes stale keys from the roster with a single put', async () => {
  const kv = countingKV({
    'roster:c': JSON.stringify(['loadout:c:live:d', 'loadout:c:gone:d']),
    'loadout:c:live:d': JSON.stringify({ v: 'v1' }),
  });
  await core.getStates(kv, 'c');
  assert.equal(kv.counts.put, 1);   // roster rewritten once to drop the dead key
  assert.deepEqual(JSON.parse(kv._store.get('roster:c')), ['loadout:c:live:d']);
});

test('getStates prune re-reads the roster and preserves a concurrently-added member', async () => {
  // Simulate a registerMember landing between getStates' first roster read and
  // its prune write: the pre-prune re-read sees a newer member ('b') that the
  // prune must not clobber while it drops the dead key ('gone').
  const store = new Map([
    ['loadout:c:a:d', JSON.stringify({ v: 'v1' })],
  ]);
  let rosterReads = 0;
  const kv = {
    counts: { list: 0, get: 0, put: 0 },
    async get(k) {
      this.counts.get++;
      if (k === 'roster:c') {
        rosterReads++;
        const keys = rosterReads === 1
          ? ['loadout:c:a:d', 'loadout:c:gone:d']
          : ['loadout:c:a:d', 'loadout:c:gone:d', 'loadout:c:b:d']; // 'b' registered concurrently
        return JSON.stringify(keys);
      }
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) { this.counts.put++; store.set(k, v); },
    async list() { this.counts.list++; return { keys: [] }; },
  };
  await core.getStates(kv, 'c');
  assert.deepEqual(JSON.parse(store.get('roster:c')).sort(), ['loadout:c:a:d', 'loadout:c:b:d']);
  assert.equal(kv.counts.list, 0);
});

test('registerMember appends new keys and refreshes the roster TTL without duplicating', async () => {
  const kv = countingKV();
  await core.registerMember(kv, 'loadout:c:six:d1');
  assert.deepEqual(JSON.parse(kv._store.get('roster:c')), ['loadout:c:six:d1']);
  const putsAfterFirst = kv.counts.put;
  // Re-registering an existing member re-puts the roster (to keep its TTL ahead of
  // the member keys, which refresh on every save) but must NOT grow it.
  await core.registerMember(kv, 'loadout:c:six:d1');
  assert.equal(kv.counts.put, putsAfterFirst + 1);   // one TTL-refresh put
  assert.deepEqual(JSON.parse(kv._store.get('roster:c')), ['loadout:c:six:d1']);   // no duplicate
  // A different member appends.
  await core.registerMember(kv, 'loadout:c:rock:d9');
  assert.deepEqual(JSON.parse(kv._store.get('roster:c')).sort(), ['loadout:c:rock:d9', 'loadout:c:six:d1']);
  assert.equal(kv.counts.list, 0);
});

test('registerMember ignores an invalid key without writing', async () => {
  const kv = countingKV();
  await core.registerMember(kv, 'req:not-a-loadout');
  await core.registerMember(kv, 'loadout:');   // no campaign segment
  assert.equal(kv.counts.put, 0);
});

test('overlapping registerMember on one edge keeps both members (read-your-writes)', async () => {
  // Two co-located players register in quick succession. On a single edge KV is
  // read-your-writes, so the second read already reflects the first member, and
  // the union keeps both. (Truly simultaneous cross-edge adds are the documented
  // KV residual — no CAS is available — and self-heal: a clobbered member is
  // re-added on their next save, which happens on every board poll/change.)
  const kv = countingKV({ 'roster:c': JSON.stringify(['loadout:c:rock:d9']) });
  await core.registerMember(kv, 'loadout:c:six:d1');
  assert.deepEqual(JSON.parse(kv._store.get('roster:c')).sort(), ['loadout:c:rock:d9', 'loadout:c:six:d1']);
  assert.equal(kv.counts.list, 0);
});

test('GET returns states for a valid campaign, no list calls', async () => {
  const kv = countingKV({
    'roster:c': JSON.stringify(['loadout:c:p:d']),
    'loadout:c:p:d': JSON.stringify({ v: 'v1', hp: { cur: 1, max: 9 } }),
  });
  const res = await fn.onRequestGet(getCtx(kv, 'campaign=c'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.states['loadout:c:p:d'].hp.cur, 1);
  assert.equal(kv.counts.list, 0);
});

test('GET rejects an invalid/missing campaign with 400', async () => {
  const res = await fn.onRequestGet(getCtx(countingKV(), 'campaign=a:b'));
  assert.equal(res.status, 400);
  const res2 = await fn.onRequestGet(getCtx(countingKV(), ''));
  assert.equal(res2.status, 400);
});

test('the Function module exposes no write handler', () => {
  assert.equal(typeof fn.onRequestGet, 'function');
  assert.equal(fn.onRequestPut, undefined);
  assert.equal(fn.onRequestPost, undefined);
});

test('listStates is gone — no kv.list caller remains in the loadout path', () => {
  assert.equal(core.listStates, undefined);
});
