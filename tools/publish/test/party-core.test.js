const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../js/party-core.js');

test('groupLatestByPc picks the max-updatedAt state per pcSlug', () => {
  const states = {
    'loadout:c:six:p1': { updatedAt: 100, hp: { cur: 9 } },
    'loadout:c:six:p2': { updatedAt: 300, hp: { cur: 4 } },
    'loadout:c:ann:p1': { updatedAt: 50, hp: { cur: 7 } },
  };
  const out = core.groupLatestByPc(states);
  assert.equal(out.six.hp.cur, 4);
  assert.equal(out.ann.hp.cur, 7);
});

test('groupLatestByPc treats a missing updatedAt as oldest (0)', () => {
  const states = { 'loadout:c:six:p1': { hp: { cur: 4 } }, 'loadout:c:six:p2': { updatedAt: 10, hp: { cur: 9 } } };
  assert.equal(core.groupLatestByPc(states).six.hp.cur, 9);
});

test('maxUpdatedAt returns the freshest updatedAt, 0 when none', () => {
  assert.equal(core.maxUpdatedAt({}), 0);
  assert.equal(core.maxUpdatedAt({ a: { updatedAt: 100 }, b: { updatedAt: 300 }, c: {} }), 300);
  assert.equal(core.maxUpdatedAt(null), 0);
});

test('createPoller polls while active and stops when idle', () => {
  let t = 0; const timers = {}; let id = 0; let polls = 0;
  const poller = core.createPoller({
    now: () => t,
    setTimer: (fn, ms) => { const k = ++id; timers[k] = { fn, at: t + ms }; return k; },
    clearTimer: (k) => { delete timers[k]; },
    isHidden: () => false,
    poll: () => { polls++; return Promise.resolve({ 'loadout:c:x:p': { updatedAt: t } }); },
    pollMs: 1000, idleMs: 5000,
  });
  return Promise.resolve(poller.start()).then(() => {
    assert.equal(polls, 1);
    assert.ok(Object.keys(timers).length === 1, 'schedules next tick while active');
  });
});

test('createPoller does not schedule while hidden', () => {
  let hidden = true; const timers = {}; let id = 0;
  const poller = core.createPoller({
    now: () => 0,
    setTimer: (fn, ms) => { const k = ++id; timers[k] = fn; return k; },
    clearTimer: (k) => { delete timers[k]; },
    isHidden: () => hidden,
    poll: () => Promise.resolve(undefined),
  });
  poller.start();
  assert.equal(Object.keys(timers).length, 0);
});
