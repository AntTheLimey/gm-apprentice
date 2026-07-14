const { test, before } = require('node:test');
const assert = require('node:assert');

let fn, core;
before(async () => {
  fn = await import('../templates-scaffold/functions/api/loadout.js');
  core = await import('../templates-scaffold/functions/api/loadout-core.mjs');
});

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
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

test('PUT then GET round-trips state', async () => {
  const kv = fakeKV();
  const state = { v: 'v1', items: { Axe: true }, hp: null, fp: null };
  const put = await fn.onRequestPut(putCtx(kv, { key: 'loadout:c:p:d', state }));
  assert.equal(put.status, 200);
  const got = await fn.onRequestGet(getCtx(kv, 'loadout:c:p:d'));
  assert.deepEqual((await got.json()).state, state);
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
