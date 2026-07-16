// tools/publish/test/loadout-list.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');

let fn, core;
before(async () => {
  fn = await import('../templates-scaffold/functions/api/loadout-list.js');
  core = await import('../templates-scaffold/functions/api/loadout-core.mjs');
});

function fakeKV(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
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

test('listStates returns only keys under the campaign prefix, parsed', async () => {
  const kv = fakeKV({
    'loadout:space-game:six:d1': JSON.stringify({ v: 'v1', hp: { cur: 4, max: 13 } }),
    'loadout:space-game:rock:d9': JSON.stringify({ v: 'v1', hp: { cur: 3, max: 10 } }),
    'loadout:other-game:zed:d1': JSON.stringify({ v: 'v1' }),
    'req:not-a-loadout': 'x',
  });
  const out = await core.listStates(kv, 'space-game');
  assert.deepEqual(Object.keys(out).sort(), ['loadout:space-game:rock:d9', 'loadout:space-game:six:d1']);
  assert.equal(out['loadout:space-game:six:d1'].hp.cur, 4);
});

test('listStates skips unparseable values', async () => {
  const kv = fakeKV({ 'loadout:c:p:d': '{bad json', 'loadout:c:q:d': JSON.stringify({ v: 'v1' }) });
  const out = await core.listStates(kv, 'c');
  assert.deepEqual(Object.keys(out), ['loadout:c:q:d']);
});

test('GET returns states for a valid campaign', async () => {
  const kv = fakeKV({ 'loadout:c:p:d': JSON.stringify({ v: 'v1', hp: { cur: 1, max: 9 } }) });
  const res = await fn.onRequestGet(getCtx(kv, 'campaign=c'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.states['loadout:c:p:d'].hp.cur, 1);
});

test('GET rejects an invalid/missing campaign with 400', async () => {
  const res = await fn.onRequestGet(getCtx(fakeKV(), 'campaign=a:b'));
  assert.equal(res.status, 400);
  const res2 = await fn.onRequestGet(getCtx(fakeKV(), ''));
  assert.equal(res2.status, 400);
});

test('the Function module exposes no write handler', () => {
  assert.equal(typeof fn.onRequestGet, 'function');
  assert.equal(fn.onRequestPut, undefined);
  assert.equal(fn.onRequestPost, undefined);
});
