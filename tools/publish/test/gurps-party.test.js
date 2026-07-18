// tools/publish/test/gurps-party.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const gp = require('../js/gurps-party.js');

// Deterministic clock + single-shot timer registry for the poll scheduler.
function fakeClock() {
  let t = 0, seq = 1;
  const timers = new Map();
  return {
    now() { return t; },
    setTimer(fn, ms) { const id = seq++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer(id) { timers.delete(id); },
    pending() { return timers.size; },
    async advance(ms) {
      t += ms;
      // Fire every timer due at/before t, draining microtasks after each so the
      // poll's .then(finish→schedule) chain settles before the next fires.
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, x] = due[0];
        timers.delete(id);
        x.fn();
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const MIN = 60000, IDLE = 15 * 60 * 1000;

test('groupLatestByPc picks the max-updatedAt state per pcSlug', () => {
  const states = {
    'loadout:c:six:d1': { v: 'v1', hp: { cur: 9, max: 13 }, updatedAt: 100 },
    'loadout:c:six:d2': { v: 'v1', hp: { cur: 4, max: 13 }, updatedAt: 300 },  // newest
    'loadout:c:six:CODE': { v: 'v1', hp: { cur: 7, max: 13 }, updatedAt: 200 },
    'loadout:c:rock:d1': { v: 'v1', hp: { cur: 3, max: 10 }, updatedAt: 50 },
  };
  const out = gp.groupLatestByPc(states);
  assert.deepEqual(Object.keys(out).sort(), ['rock', 'six']);
  assert.equal(out.six.hp.cur, 4);      // d2 wins (updatedAt 300)
  assert.equal(out.rock.hp.cur, 3);
});

test('groupLatestByPc treats a missing updatedAt as oldest (0)', () => {
  const states = {
    'loadout:c:six:d1': { v: 'v1', hp: { cur: 9, max: 13 } },                 // no updatedAt → 0
    'loadout:c:six:d2': { v: 'v1', hp: { cur: 4, max: 13 }, updatedAt: 1 },   // wins
  };
  assert.equal(gp.groupLatestByPc(states).six.hp.cur, 4);
});

test('rowCells: healthy view → Ready status, no reeling/tired class, plain stats', () => {
  const view = { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, encLevel: 0, encName: 'None',
    move: { base: 6, enc: 6, cur: 6 }, dodge: { enc: 10, cur: 10 }, st: { base: 13, cur: 13 }, reeling: false, tired: false };
  const c = gp.rowCells(view);
  assert.equal(c.rowClass, '');
  assert.match(c.status, /Ready/);
  assert.match(c.move, /6/);
  assert.doesNotMatch(c.move, /→|gl-was/);   // no strikethrough arrow
  assert.match(c.hp, /13/);
});

test('rowCells: reeling+tired → both class, badges, Move current/basic, ST arrow', () => {
  const view = { hp: { cur: 3, max: 10 }, fp: { cur: 3, max: 12 }, encLevel: 0, encName: 'None',
    move: { base: 6, enc: 5, cur: 2 }, dodge: { enc: 8, cur: 2 }, st: { base: 10, cur: 5 }, reeling: true, tired: true };
  const c = gp.rowCells(view);
  assert.equal(c.rowClass, 'both');
  assert.match(c.status, /Reeling/);
  assert.match(c.status, /Tired/);
  assert.match(c.move, /2/);         // current present
  assert.match(c.move, /gl-of/);     // shown as current/basic
  assert.match(c.move, /6/);         // basic present
  assert.match(c.st, /10/);          // ST arrow shown (tired)
  assert.match(c.st, /5/);
});

test('rowCells: reeling only → reeling class, no ST arrow', () => {
  const view = { hp: { cur: 3, max: 10 }, fp: { cur: 11, max: 11 }, encLevel: 0, encName: 'None',
    move: { base: 6, enc: 6, cur: 3 }, dodge: { enc: 10, cur: 5 }, st: { base: 10, cur: 10 }, reeling: true, tired: false };
  const c = gp.rowCells(view);
  assert.equal(c.rowClass, 'reeling');
  assert.doesNotMatch(c.status, /Tired/);
  assert.doesNotMatch(c.st, /→|base/);   // ST unchanged under reeling → plain
});

test('maxUpdatedAt returns the freshest updatedAt across states, 0 when none', () => {
  assert.equal(gp.maxUpdatedAt({}), 0);
  assert.equal(gp.maxUpdatedAt({ a: { updatedAt: 100 }, b: { updatedAt: 300 }, c: {} }), 300);
  assert.equal(gp.maxUpdatedAt(null), 0);
});

function makePoller(clk, opts) {
  let polls = 0;
  const poller = gp.createPoller(Object.assign({
    now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer,
    isHidden: () => false,
    poll() { polls++; return Promise.resolve({}); },
    pollMs: MIN, idleMs: IDLE,
  }, opts));
  return { poller, polls: () => polls };
}

test('scheduler polls every 60s while active', async () => {
  const clk = fakeClock();
  const { poller, polls } = makePoller(clk);
  poller.start(); await flush();
  assert.equal(polls(), 1);            // immediate poll on start
  await clk.advance(MIN);
  assert.equal(polls(), 2);            // +1 at 60s
  await clk.advance(MIN);
  assert.equal(polls(), 3);            // +1 at 120s
  assert.equal(clk.pending(), 1);      // exactly one timer armed
});

test('scheduler goes silent after 15 min with no activity', async () => {
  const clk = fakeClock();
  const { poller, polls } = makePoller(clk);
  poller.start(); await flush();
  for (let i = 0; i < 20; i++) await clk.advance(MIN);   // run well past the idle window
  const frozen = polls();
  assert.equal(clk.pending(), 0);      // no timer armed → dormant
  await clk.advance(MIN * 10);
  assert.equal(polls(), frozen);       // stays silent
});

test('scheduler resumes immediately on interaction after going idle', async () => {
  const clk = fakeClock();
  const { poller, polls } = makePoller(clk);
  poller.start(); await flush();
  for (let i = 0; i < 20; i++) await clk.advance(MIN);
  assert.equal(clk.pending(), 0);
  const before = polls();
  poller.interact(); await flush();
  assert.equal(polls(), before + 1);   // interaction polls right away
  assert.equal(clk.pending(), 1);      // and re-arms the 60s loop
  await clk.advance(MIN);
  assert.equal(polls(), before + 2);
});

test('scheduler never fetches while hidden, wakes on becoming visible', async () => {
  const clk = fakeClock();
  let hidden = true;
  const { poller, polls } = makePoller(clk, { isHidden: () => hidden });
  poller.start(); await flush();
  assert.equal(polls(), 0);            // hidden → no fetch
  assert.equal(clk.pending(), 0);      // and no timer churning
  hidden = false;
  poller.interact(); await flush();    // visibilitychange→visible is an interaction
  assert.equal(polls(), 1);
  assert.equal(clk.pending(), 1);
});

test('advancing state keeps the board active past the idle window', async () => {
  const clk = fakeClock();
  let n = 0;
  // Each poll reports a newer updatedAt → a live game → activity keeps refreshing.
  const poller = gp.createPoller({
    now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, isHidden: () => false,
    poll() { n++; return Promise.resolve({ pc: { updatedAt: n * 1000000 } }); },
    pollMs: MIN, idleMs: IDLE,
  });
  poller.start(); await flush();
  for (let i = 0; i < 20; i++) await clk.advance(MIN);   // 20 min of live edits
  assert.equal(n, 21);                 // still polling every minute
  assert.equal(clk.pending(), 1);
});
