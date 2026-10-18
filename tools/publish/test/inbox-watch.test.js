// `inbox watch`: the change-request loop's poller. Polling is driven with an
// injected sleep, clock and poll cap, so no test waits on a real interval.
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runInbox, HEARTBEAT_FILE, SEEN_FILE, SESSION_FILE } = require('../lib/inbox-cli.js');

let inbox;
before(async () => { inbox = await import('../templates-scaffold/functions/api/inbox-core.mjs'); });

function fakeKV() {
  const store = new Map();
  return {
    failing: false,
    async get(k) { if (this.failing) throw new Error('kv down'); return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      if (this.failing) throw new Error('kv down');
      return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}

function siteDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-inbox-watch-')); }

// Run `inbox watch` for `polls` polls. `onPoll(n)` runs before poll n (from 0), so a
// test can change the queue or break the KV between polls.
async function watch(kv, dir, args, { polls = 1, onPoll, clock = 1_700_000_000_000 } = {}) {
  const lines = []; const sleeps = [];
  let n = 0;
  if (onPoll) await onPoll(0);
  const rc = await runInbox(['watch', ...args], {
    adapter: kv, cwd: dir, out: (s) => lines.push(String(s)), maxPolls: polls,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); n++; if (onPoll) await onPoll(n); },
  });
  return { rc, lines, sleeps };
}

const entry = (id, ts) => ({ id, character: 'Ana', text: 'add 1 xp', timestamp: ts });

test('an empty queue prints nothing and writes the heartbeat as Unix seconds', async () => {
  const dir = siteDir();
  const r = await watch(fakeKV(), dir, [], { polls: 3 });
  assert.equal(r.rc, 0);
  assert.deepEqual(r.lines, []);
  assert.equal(fs.readFileSync(path.join(dir, HEARTBEAT_FILE), 'utf8'), '1700000000\n');
  assert.deepEqual(r.sleeps, [30000, 30000], 'default 30 s between polls, no sleep before the first');
});

test('--every is clamped to 1..300, and a non-number falls back to 30 with one note', async () => {
  const dir = siteDir();
  assert.deepEqual((await watch(fakeKV(), dir, ['--every', '0'], { polls: 2 })).sleeps, [1000]);
  assert.deepEqual((await watch(fakeKV(), dir, ['--every', '9999'], { polls: 2 })).sleeps, [300000]);
  assert.deepEqual((await watch(fakeKV(), dir, ['--every', '45'], { polls: 2 })).sleeps, [45000]);
  const bad = await watch(fakeKV(), dir, ['--every', 'soon'], { polls: 2 });
  assert.deepEqual(bad.sleeps, [30000]);
  assert.equal(bad.lines.length, 1);
  assert.match(bad.lines[0], /--every "soon" is not a whole number.*every 30s/);
});

test('an unknown argument prints the usage and exits 2, apart from the failure exit 1', async () => {
  const r = await watch(fakeKV(), siteDir(), ['--frobnicate']);
  assert.equal(r.rc, 2);
  assert.match(r.lines.join('\n'), /Unknown argument: --frobnicate/);
  assert.match(r.lines.join('\n'), /Usage: inbox watch/);
});

test('--every or --remind-after with no number, or a flag after it, exits 2 without eating the flag', async () => {
  for (const args of [['--every'], ['--remind-after'], ['--every', '--exit-on-batch'], ['--remind-after', '--every', '5']]) {
    const r = await watch(fakeKV(), siteDir(), args);
    assert.equal(r.rc, 2, args.join(' '));
    assert.match(r.lines[0], new RegExp(`^${args[0]} needs a number of seconds`), args.join(' '));
  }
});

test('the seen file is replaced whole, leaving no temporary file behind', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('r1', '2026-07-11T14:01:00.000Z'));
  await watch(kv, dir, []);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, SEEN_FILE), 'utf8')).shown), ['r1']);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('a missing or unknown subcommand prints the usage and exits 2', async () => {
  const lines = [];
  assert.equal(await runInbox([], { out: (s) => lines.push(s) }), 2);
  assert.equal(await runInbox(['frob'], { out: (s) => lines.push(s) }), 2);
  assert.match(lines.join('\n'), /Usage: inbox </);
});

test('--remind-after is clamped to 60..3600, and a non-number falls back to 300 with one note', async () => {
  const bad = await watch(fakeKV(), siteDir(), ['--remind-after', 'later']);
  assert.equal(bad.rc, 0);
  assert.deepEqual(bad.lines, ['Note: --remind-after "later" is not a whole number of seconds; reminding after 300s.']);
  // Clamped low: shown at t0, still pending 60 s later → a reminder even though 10 was asked.
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await clockedWatch(kv, dir, ['--remind-after', '10'], { polls: 4, step: 30000 });
  assert.deepEqual(r.lines.slice(1), ['WATCHER: still pending: a'], 'one reminder at 60 s, none at 30 s or 90 s');
});

// Run `inbox watch` with a clock that moves `step` ms per sleep.
async function clockedWatch(kv, dir, args, { polls, step, start = 1_700_000_000_000, onPoll } = {}) {
  const lines = [];
  let clock = start; let n = 0;
  const rc = await runInbox(['watch', ...args], {
    adapter: kv, cwd: dir, out: (s) => lines.push(String(s)), maxPolls: polls,
    now: () => clock,
    sleep: async () => { n++; clock += step; if (onPoll) await onPoll(n); },
  });
  return { rc, lines, clock };
}

test('an id still pending --remind-after seconds after it was shown is named once, then again after another N', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  await inbox.enqueue(kv, entry('b', '2026-07-11T14:02:00.000Z'));
  // Polls at 0, 60, 120, ... 600 s: shown at 0, reminded at 300 and 600, none in between.
  const r = await clockedWatch(kv, dir, [], { polls: 11, step: 60000 });
  assert.equal(r.rc, 0);
  assert.equal(r.lines.length, 3, r.lines.join('\n'));
  assert.deepEqual(JSON.parse(r.lines[0]).map(e => e.id), ['a', 'b']);
  assert.deepEqual(r.lines.slice(1), ['WATCHER: still pending: a b', 'WATCHER: still pending: a b']);
});

test('no reminder before --remind-after, and none once the id is handled', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  await inbox.enqueue(kv, entry('b', '2026-07-11T14:02:00.000Z'));
  const early = await clockedWatch(kv, dir, [], { polls: 5, step: 60000 });
  assert.equal(early.lines.length, 1, 'polls at 0..240 s: the batch, no reminder yet');
  // A second watcher picks the clock up from the seen file: 'a' is replied to, 'b' is not.
  const r = await clockedWatch(kv, dir, [], {
    polls: 3, step: 60000, start: early.clock,
    onPoll: async (n) => { if (n === 1) await inbox.setResponse(kv, 'a', 'applied', 'done'); },
  });
  assert.deepEqual(r.lines, ['WATCHER: still pending: b']);
});

test('--exit-on-batch exits 0 after a reminder line', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const first = await clockedWatch(kv, dir, ['--exit-on-batch'], { polls: 20, step: 30000 });
  assert.equal(first.rc, 0);
  assert.equal(first.lines.length, 1);
  const second = await clockedWatch(kv, dir, ['--exit-on-batch'], { polls: 20, step: 30000, start: first.clock });
  assert.equal(second.rc, 0);
  assert.deepEqual(second.lines, ['WATCHER: still pending: a']);
  const shown = JSON.parse(fs.readFileSync(path.join(dir, SEEN_FILE), 'utf8')).shown;
  assert.equal(shown.a, second.clock, 'the reminder restarts the id\'s clock');
});

test('the old {"ids":[...]} seen file reads as shown now', async () => {
  const kv = fakeKV(); const dir = siteDir();
  fs.writeFileSync(path.join(dir, SEEN_FILE), JSON.stringify({ ids: ['a'] }));
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await clockedWatch(kv, dir, [], { polls: 6, step: 60000 });
  assert.deepEqual(r.lines, ['WATCHER: still pending: a'], 'quiet at start, reminded at 300 s');
});

test('a new batch prints once as the pull JSON, and a still-pending batch stays quiet', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('b', '2026-07-11T14:02:00.000Z'));
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await watch(kv, dir, [], { polls: 4 });
  assert.equal(r.lines.length, 1, r.lines.join('\n'));
  assert.deepEqual(JSON.parse(r.lines[0]), await inbox.readPending(kv));
  assert.deepEqual(JSON.parse(r.lines[0]).map(e => e.id), ['a', 'b']);
});

test('a new id prints the whole pending batch again, old ids included', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await watch(kv, dir, [], {
    polls: 3,
    onPoll: async (n) => { if (n === 2) await inbox.enqueue(kv, entry('c', '2026-07-11T14:05:00.000Z')); },
  });
  assert.equal(r.lines.length, 2);
  assert.deepEqual(JSON.parse(r.lines[1]).map(e => e.id), ['a', 'c']);
});

test('the printed ids survive a relaunch, so the same batch is not printed again', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const first = await watch(kv, dir, ['--exit-on-batch'], { polls: 10 });
  assert.equal(first.rc, 0);
  assert.equal(first.lines.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, SEEN_FILE), 'utf8')).shown), ['a']);
  const second = await watch(kv, dir, ['--exit-on-batch'], { polls: 3 });
  assert.deepEqual(second.lines, [], 'the same pending id is not announced twice');
  assert.equal(second.rc, 0, 'ran out its polls without a batch');
});

test('a broken seen file reads as empty rather than stopping the watcher', async () => {
  const kv = fakeKV(); const dir = siteDir();
  fs.writeFileSync(path.join(dir, SEEN_FILE), 'not json');
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await watch(kv, dir, [], { polls: 1 });
  assert.equal(r.lines.length, 1);
});

test('the failure line comes at 5 and 10 failed polls, the heartbeat still ticks, and a success resets the count', async () => {
  const kv = fakeKV(); const dir = siteDir();
  let clock = 1_700_000_000_000;
  const lines = [];
  // Fail polls 0-11, succeed at 12, fail 13-17.
  const failing = (n) => (n <= 11) || (n >= 13);
  let n = 0;
  kv.failing = failing(0);
  const rc = await runInbox(['watch'], {
    adapter: kv, cwd: dir, out: (s) => lines.push(String(s)), maxPolls: 18,
    now: () => clock,
    sleep: async () => { n++; clock += 30000; kv.failing = failing(n); },
  });
  assert.equal(rc, 0);
  assert.deepEqual(lines, [
    'WATCHER: inbox pull failed 5 times in a row',
    'WATCHER: inbox pull failed 10 times in a row',
    'WATCHER: inbox pull failed 5 times in a row',
  ]);
  assert.equal(fs.readFileSync(path.join(dir, HEARTBEAT_FILE), 'utf8'), `${Math.floor(clock / 1000)}\n`,
    'the heartbeat is written on a failed poll too');
});

test('--exit-on-batch exits 1 at the first failure line', async () => {
  const kv = fakeKV(); kv.failing = true;
  const r = await watch(kv, siteDir(), ['--exit-on-batch'], { polls: 20 });
  assert.equal(r.rc, 1);
  assert.deepEqual(r.lines, ['WATCHER: inbox pull failed 5 times in a row']);
  assert.equal(r.sleeps.length, 4, 'stopped on the fifth poll');
});

test('--exit-on-batch exits 0 right after a new batch', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await watch(kv, siteDir(), ['--exit-on-batch'], { polls: 20 });
  assert.equal(r.rc, 0);
  assert.equal(r.lines.length, 1);
  assert.equal(r.sleeps.length, 0);
});

test('inbox open clears the seen ids: a new code is a new session', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  await watch(kv, dir, [], { polls: 1 });
  assert.ok(fs.existsSync(path.join(dir, SEEN_FILE)));
  assert.equal(await runInbox(['open', 'wolf'], { adapter: kv, cwd: dir, out: () => {} }), 0);
  assert.equal(fs.existsSync(path.join(dir, SEEN_FILE)), false);
  const again = await watch(kv, dir, [], { polls: 1 });
  assert.equal(again.lines.length, 1, 'the still-pending request is announced in the new session');
});

// The session clock (#451): `inbox open` records when the session started and
// how long it runs; `inbox watch` stops with one line once that time is up.
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
async function open(kv, dir, args, clock = T0) {
  const lines = [];
  const rc = await runInbox(['open', ...args], { adapter: kv, cwd: dir, out: (s) => lines.push(String(s)), now: () => clock });
  return { rc, lines, session: fs.existsSync(path.join(dir, SESSION_FILE)) ? JSON.parse(fs.readFileSync(path.join(dir, SESSION_FILE), 'utf8')) : null };
}

test('inbox open records the session start and a 5-hour length by default', async () => {
  const r = await open(fakeKV(), siteDir(), ['wolf']);
  assert.equal(r.rc, 0);
  assert.deepEqual(r.session, { start: T0 / 1000, hours: 5 });
  assert.match(r.lines.join('\n'), /watcher stops after 5 hours/);
});

test('inbox open --hours sets the length, kept between 1 and 12, before or after the code', async () => {
  const kv = fakeKV(); const dir = siteDir();
  assert.equal((await open(kv, dir, ['wolf', '--hours', '3'])).session.hours, 3);
  assert.equal((await open(kv, dir, ['--hours', '8', 'wolf'])).session.hours, 8);
  assert.equal((await open(kv, dir, ['wolf', '--hours', '0'])).session.hours, 1);
  assert.equal((await open(kv, dir, ['wolf', '--hours', '99'])).session.hours, 12);
  const bad = await open(kv, dir, ['wolf', '--hours', 'long']);
  assert.equal(bad.session.hours, 5);
  assert.match(bad.lines[0], /--hours "long" is not a whole number of hours; running 5 hours/);
  assert.equal(await inbox.getCode(kv), 'WOLF');
});

test('inbox open --hours with no number, or an unknown flag, is a usage error and writes nothing', async () => {
  for (const args of [['wolf', '--hours'], ['--hours', '--x', 'wolf'], ['wolf', '--frob'], ['--hours', '3']]) {
    const kv = fakeKV(); const dir = siteDir();
    const r = await open(kv, dir, args);
    assert.equal(r.rc, 1, args.join(' '));
    assert.match(r.lines.join('\n'), /Usage: inbox open <CODE> \[--hours N\]/, args.join(' '));
    assert.equal(r.session, null, args.join(' '));
    assert.equal(await inbox.getCode(kv), null, args.join(' '));
  }
});

test('opening a new code starts a new clock', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await open(kv, dir, ['wolf', '--hours', '2']);
  const again = await open(kv, dir, ['bear'], T0 + 3 * HOUR);
  assert.deepEqual(again.session, { start: (T0 + 3 * HOUR) / 1000, hours: 5 });
});

test('watch prints "session time is up" and exits 0 once the session has run its hours, in both modes', async () => {
  for (const mode of [[], ['--exit-on-batch']]) {
    const kv = fakeKV(); const dir = siteDir();
    await open(kv, dir, ['wolf', '--hours', '1']);
    // Polls every 10 minutes from the start: 0, 10, ... 50 min poll; at 60 min it stops.
    const r = await clockedWatch(kv, dir, mode, { polls: 100, step: 10 * 60_000, start: T0 });
    assert.equal(r.rc, 0, mode.join(' '));
    assert.deepEqual(r.lines, ['WATCHER: session time is up'], mode.join(' '));
    assert.equal(r.clock, T0 + HOUR, mode.join(' '));
  }
});

test('a watch launched after the session time prints "session time is up" at once', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await open(kv, dir, ['wolf']);
  await inbox.enqueue(kv, entry('a', '2026-07-11T14:01:00.000Z'));
  const r = await clockedWatch(kv, dir, [], { polls: 5, step: 30000, start: T0 + 6 * HOUR });
  assert.deepEqual(r.lines, ['WATCHER: session time is up']);
});

test('a watch keeps running before the session time is up', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await open(kv, dir, ['wolf']);
  const r = await clockedWatch(kv, dir, [], { polls: 50, step: 5 * 60_000, start: T0 });
  assert.deepEqual(r.lines, [], 'about 4 hours of polls, no stop line');
});

test('with no session file (opened by an older tool) or a broken one, the watch never stops for time', async () => {
  for (const content of [null, 'not json', '{"start":"x","hours":5}']) {
    const kv = fakeKV(); const dir = siteDir();
    if (content !== null) fs.writeFileSync(path.join(dir, SESSION_FILE), content);
    const r = await clockedWatch(kv, dir, [], { polls: 30, step: HOUR, start: T0 });
    assert.equal(r.rc, 0);
    assert.deepEqual(r.lines, [], String(content));
  }
});

test('an inbox open during a running watch extends its time', async () => {
  const kv = fakeKV(); const dir = siteDir();
  await open(kv, dir, ['wolf', '--hours', '1']);
  const r = await clockedWatch(kv, dir, [], {
    polls: 100, step: 10 * 60_000, start: T0,
    onPoll: async (n) => { if (n === 3) await open(kv, dir, ['wolf', '--hours', '1'], T0 + 30 * 60_000); },
  });
  assert.deepEqual(r.lines, ['WATCHER: session time is up']);
  assert.equal(r.clock, T0 + 90 * 60_000);
});

test('watch --help prints the usage without needing a site', async () => {
  const lines = [];
  assert.equal(await runInbox(['watch', '--help'], { cwd: siteDir(), out: (s) => lines.push(s) }), 0);
  assert.match(lines.join('\n'), /--exit-on-batch/);
});
