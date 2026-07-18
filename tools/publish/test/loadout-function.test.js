const { test, before } = require('node:test');
const assert = require('node:assert');

let fn, core;
before(async () => {
  fn = await import('../templates-scaffold/functions/api/loadout.js');
  core = await import('../templates-scaffold/functions/api/loadout-core.mjs');
});

function fakeKV() {
  const store = new Map();
  const counts = { list: 0, get: 0, put: 0, delete: 0 };
  return {
    store,
    counts,
    async get(k) { counts.get++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { counts.put++; store.set(k, v); },
    async delete(k) { counts.delete++; store.delete(k); },
    async list() { counts.list++; return { keys: [] }; },
  };
}
function putCtx(kv, body) {
  const request = new Request('https://s.pages.dev/api/loadout', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { request, env: { INBOX: kv } };
}
function getCtx(kv, key) {
  return { request: new Request('https://s.pages.dev/api/loadout?key=' + encodeURIComponent(key)), env: { INBOX: kv } };
}

test('isValidKey requires the loadout: prefix', () => {
  assert.equal(core.isValidKey('loadout:c:p:d'), true);
  assert.equal(core.isValidKey('req:evil'), false);
  assert.equal(core.isValidKey(''), false);
});

test('PUT then GET round-trips state and stamps updatedAt', async () => {
  const kv = fakeKV();
  const state = { v: 'v1', items: { Axe: true }, hp: null, fp: null };
  const put = await fn.onRequestPut(putCtx(kv, { key: 'loadout:c:p:d', state }));
  assert.equal(put.status, 200);
  const got = await fn.onRequestGet(getCtx(kv, 'loadout:c:p:d'));
  const stored = (await got.json()).state;
  assert.equal(stored.v, 'v1');
  assert.deepEqual(stored.items, { Axe: true });
  assert.equal(typeof stored.updatedAt, 'number');
  assert.ok(stored.updatedAt > 0);
});

test('PUT rejects a non-loadout key', async () => {
  const kv = fakeKV();
  const res = await fn.onRequestPut(putCtx(kv, { key: 'req:x', state: {} }));
  assert.equal(res.status, 400);
});

test('PUT rejects an array state', async () => {
  const kv = fakeKV();
  const res = await fn.onRequestPut(putCtx(kv, { key: 'loadout:c:p:d', state: [] }));
  assert.equal(res.status, 400);
});

test('GET of an unknown key returns empty object', async () => {
  const res = await fn.onRequestGet(getCtx(fakeKV(), 'loadout:c:p:none'));
  assert.deepEqual(await res.json(), {});
});

test('PUT registers the member in the campaign roster (no duplicates), never lists', async () => {
  const kv = fakeKV();
  const state = { v: 'v1', items: {}, hp: null, fp: null };
  await fn.onRequestPut(putCtx(kv, { key: 'loadout:c:six:d1', state }));
  assert.deepEqual(JSON.parse(kv.store.get('roster:c')), ['loadout:c:six:d1']);
  const putsAfterFirst = kv.counts.put;
  // A second write from the same member must not grow the roster, but does re-put
  // it to refresh its TTL (state write + roster-TTL refresh = two puts).
  await fn.onRequestPut(putCtx(kv, { key: 'loadout:c:six:d1', state }));
  assert.deepEqual(JSON.parse(kv.store.get('roster:c')), ['loadout:c:six:d1']);
  assert.equal(kv.counts.put, putsAfterFirst + 2);
  assert.equal(kv.counts.list, 0);
});
