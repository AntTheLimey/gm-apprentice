const { test } = require('node:test');
const assert = require('node:assert');
const ls = require('../js/live-state.js');

function fakeStorage(init) {
  const m = Object.assign({}, init);
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    _m: m,
  };
}

// A fetch double whose promises resolve only when the test calls .resolve().
function deferredFetch() {
  const calls = [];
  function f(url, opts) {
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    calls.push({ url, opts, resolve: () => resolve({ json: () => Promise.resolve({}) }) });
    return p;
  }
  f.calls = calls;
  return f;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('playerKey prefers the cr:code session code', () => {
  const s = fakeStorage({ 'cr:code': JSON.stringify({ code: 'ABCD' }) });
  assert.equal(ls.playerKey(s), 'ABCD');
});

test('playerKey generates and persists a device id when no code', () => {
  const s = fakeStorage({});
  const id = ls.playerKey(s);
  assert.match(id, /^d[a-z0-9]+$/);
  assert.equal(ls.playerKey(s), id); // stable across calls
});

test('kvKey has the loadout:<campaign>:<pc>:<player> shape', () => {
  assert.equal(ls.kvKey('camp', ' ada-lovelace', 'ABCD'), 'loadout:camp: ada-lovelace:ABCD');
});

test('save writes localStorage and PUTs {key,state} to /api/loadout', async () => {
  const s = fakeStorage({ 'loadout:device': 'dX' });
  const f = deferredFetch();
  const store = ls.createStore({ campaignId: 'c', pcSlug: 'p', storage: s, fetch: f });
  store.save({ hp: 3 });
  assert.deepEqual(JSON.parse(s.getItem(store.key)), { hp: 3 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/loadout');
  assert.equal(f.calls[0].opts.method, 'PUT');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { key: store.key, state: { hp: 3 } });
});

test('save coalesces: two rapid saves -> one in-flight PUT, then the latest', async () => {
  const s = fakeStorage({ 'loadout:device': 'dX' });
  const f = deferredFetch();
  const store = ls.createStore({ campaignId: 'c', pcSlug: 'p', storage: s, fetch: f });
  store.save({ hp: 1 });
  store.save({ hp: 2 }); // coalesced while #1 in flight
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve();
  await tick();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.calls[1].opts.body).state, { hp: 2 });
});

test('hydrate applies remote state when no local change has occurred', async () => {
  const s = fakeStorage({ 'loadout:device': 'dX' });
  const f = (url) => Promise.resolve({ json: () => Promise.resolve({ state: { hp: 7 } }) });
  const store = ls.createStore({ campaignId: 'c', pcSlug: 'p', storage: s, fetch: f });
  let got = null;
  store.hydrate((blob) => { got = blob; });
  await tick(); await tick();
  assert.deepEqual(got, { hp: 7 });
});

test('hydrate is skipped once a local save has happened', async () => {
  const s = fakeStorage({ 'loadout:device': 'dX' });
  const f = (url) => Promise.resolve({ json: () => Promise.resolve({ state: { hp: 7 } }) });
  const store2 = ls.createStore({ campaignId: 'c', pcSlug: 'p', storage: s, fetch: f });
  store2.save({ hp: 1 });             // sets locallyChanged on store2
  let got = 'untouched';
  store2.hydrate((blob) => { got = blob; });
  await tick(); await tick();
  assert.equal(got, 'untouched');
});
