// Local inbox subcommands, invoked by the publish-site loop (never typed by the
// GM). Reuses Part 1's inbox-core.mjs over a wrangler-backed KV adapter.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runCommand, WRANGLER_TIMEOUT_MS } = require('./run-command.js');
const { readNamespaceId, makeAdapter } = require('./inbox-wrangler.js');
const { ensureIgnored } = require('./gitignore.js');

// The change-request watcher (`inbox watch`) polls the queue and writes
// `.watcher-heartbeat` only once the poll returns. An unbounded spawn on a
// wrangler call that never comes back stalls the heartbeat with no exit and no
// failure line, so the loop is indistinguishable from a dead one — the exact
// case the heartbeat exists to rule out. Bound it: a hung call becomes a failed
// poll, which the loop's failure streak already reports. The bound itself now
// lives in run-command.js, shared with the flush and backend-setup entry points.

function defaultRunWrangler(args, run = runCommand) {
  const res = run('npx', ['wrangler@4', ...args], { timeoutMs: WRANGLER_TIMEOUT_MS });
  return { code: res.code, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error || null };
}

function defaultAdapter(cwd) {
  const dir = cwd || process.cwd();
  const tomlPath = path.join(dir, 'wrangler.toml');
  // A write that cannot happen must not look like one that did (#176): name the
  // directory so "run it from the site folder" is the obvious next step.
  if (!fs.existsSync(tomlPath)) {
    throw new Error(`No wrangler.toml in ${dir} — inbox commands must run from the site directory.`);
  }
  const namespaceId = readNamespaceId(fs.readFileSync(tomlPath, 'utf8'));
  if (!namespaceId) throw new Error('No INBOX namespace id in wrangler.toml — run the inbox setup first.');
  return makeAdapter({ runWrangler: defaultRunWrangler, namespaceId });
}

const USAGE = 'Usage: inbox <open|code|pull|watch|handled|flag|reply> [args]';

// `inbox watch` does the waiting for the change-request loop, so the model never
// writes its own poller. Each poll reads the pending queue, writes the Unix time to
// .watcher-heartbeat (the Stop check reads it), and prints a batch only when it holds
// an id not printed before. The printed ids, each with the time it was last shown,
// are kept in .watcher-seen.json, so a relaunch stays quiet about a batch it already
// handed over; `inbox open` clears it. An id still pending --remind-after seconds
// after it was last shown is named on a reminder line, so a batch whose deploy
// failed wakes the loop again to retry it.
const HEARTBEAT_FILE = '.watcher-heartbeat';
const SEEN_FILE = '.watcher-seen.json';
// `inbox open` writes {start: Unix seconds, hours} here; `inbox watch` stops once
// that time has passed (#451). A missing or broken file means no limit, as before.
const SESSION_FILE = '.watcher-session.json';
const DEFAULT_HOURS = 5;
const MIN_HOURS = 1;
const MAX_HOURS = 12;
const TIME_UP = 'WATCHER: session time is up';
// One watcher per site (#884). The running one holds {pid, id, every, started} here; a second exits at once, so a
// relaunch never doubles the polling. `inbox watch --stop` writes the holder's id to the stop file, and the watcher
// ends before its next poll.
const LOCK_FILE = '.watcher-lock.json';
const STOP_FILE = '.watcher-stop';
const STOPPED = 'WATCHER: stopped';
const BUSY_EXIT = 3;
const WATCH_FILES = [HEARTBEAT_FILE, SEEN_FILE, SESSION_FILE, LOCK_FILE, STOP_FILE];
const OPEN_USAGE = `Usage: inbox open <CODE> [--hours N]
  --hours N  hours the watcher runs from now (default ${DEFAULT_HOURS}, kept between ${MIN_HOURS} and ${MAX_HOURS})`;
const DEFAULT_EVERY = 30;
const DEFAULT_REMIND = 300;
const STREAK = 5;
const USAGE_EXIT = 2;
const WATCH_USAGE = `Usage: inbox watch [--every N] [--remind-after N] [--exit-on-batch]
       inbox watch --status | --stop
  --every N         seconds between polls (default ${DEFAULT_EVERY}, kept between 1 and 300)
  --remind-after N  seconds before a request still pending is named again
                    (default ${DEFAULT_REMIND}, kept between 60 and 3600)
  --exit-on-batch   exit 0 after a new batch or a reminder line, 1 after a failure line
  --status          say whether a watcher is running for this site and when it last polled;
                    exits 0 when one is, 1 when none is
  --stop            stop the running watcher (it prints "${STOPPED}"), make sure it ended,
                    and remove the watcher's files
Prints a new batch as the JSON array \`inbox pull\` prints, once; a batch it printed before
prints nothing. An id shown before and still pending N seconds later prints
"WATCHER: still pending: <id> <id>...", and again every N seconds while it stays pending.
After ${STREAK} failed polls in a row it prints "WATCHER: inbox pull failed N times in a row",
and again every ${STREAK} more. Once the hours set by \`inbox open\` have passed it prints
"${TIME_UP}" and exits 0. Without --exit-on-batch it otherwise runs until stopped.
One watcher runs per site: while one is running, another prints "WATCHER: already watching"
and exits ${BUSY_EXIT}, and the running one carries on.
Exit codes: 0 batch, reminder, time up or stopped (or polls done), 1 failure line, 2 usage error,
${BUSY_EXIT} already watching.`;

// The session opened by `inbox open`: {start, end} in ms, or null for no limit.
function readSession(file) {
  try {
    const { start, hours } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isFinite(start) || !Number.isFinite(hours)) return null;
    return { start: start * 1000, end: (start + hours * 3600) * 1000 };
  } catch {
    return null;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// The Unix seconds of the last poll, or null.
function readBeat(dir) {
  const t = Number.parseInt(fs.existsSync(path.join(dir, HEARTBEAT_FILE)) ? fs.readFileSync(path.join(dir, HEARTBEAT_FILE), 'utf8') : '', 10);
  return Number.isFinite(t) ? t : null;
}

// The watcher running for this site, as its lock with `last` (Unix seconds of its last poll, or of its start), or
// null. A lock counts only while its process is alive and has polled lately: within its interval, the bound on one
// pull and a minute. A pid the system has given to another program since the watcher died is never taken for it.
function liveWatcher(dir, nowMs, alive = pidAlive) {
  const lock = readJson(path.join(dir, LOCK_FILE));
  if (!lock || !Number.isInteger(lock.pid) || typeof lock.id !== 'string' || !alive(lock.pid)) return null;
  const last = Math.max(Number(lock.started) || 0, readBeat(dir) || 0);
  const every = Number.isFinite(lock.every) ? lock.every : DEFAULT_EVERY;
  if (nowMs / 1000 - last > every + WRANGLER_TIMEOUT_MS / 1000 + 60) return null;
  return { ...lock, last };
}

// Takes the site's lock, or returns the live watcher that holds it. A lock left by a watcher that ended without
// letting go (a host that killed it at a time limit) is taken over.
function claimLock(dir, lock, nowMs, alive) {
  const file = path.join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${JSON.stringify(lock)}\n`, { flag: 'wx' });
      return null;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const live = liveWatcher(dir, nowMs, alive);
      if (live) return live;
      fs.rmSync(file, { force: true });
    }
  }
  return liveWatcher(dir, nowMs, alive) || { pid: '?' };
}

// Lets go of the lock only while it is still this watcher's.
function releaseLock(dir, id) {
  const file = path.join(dir, LOCK_FILE);
  if ((readJson(file) || {}).id === id) fs.rmSync(file, { force: true });
  if (stopAsked(dir, id)) fs.rmSync(path.join(dir, STOP_FILE), { force: true });
}

function stopAsked(dir, id) {
  try { return fs.readFileSync(path.join(dir, STOP_FILE), 'utf8').trim() === id; } catch { return false; }
}

// The wait between polls, cut short by a stop request.
function stopAwareSleep(dir, id) {
  return async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !stopAsked(dir, id)) {
      await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
    }
  };
}

const ago = (s) => (s < 120 ? `${Math.max(0, Math.round(s))} s` : `${Math.round(s / 60)} min`);
function inTime(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// `inbox watch --status`: 0 while a watcher is running for the site, 1 when none is.
function watchStatus(dir, deps) {
  const out = deps.out || console.log;
  const nowMs = (deps.now || Date.now)();
  const live = liveWatcher(dir, nowMs, deps.pidAlive);
  const session = readSession(path.join(dir, SESSION_FILE));
  const ends = !session ? '' : nowMs >= session.end ? ' The session time is up.' : ` The session ends in ${inTime(session.end - nowMs)}.`;
  const beat = readBeat(dir);
  if (live) {
    out(`Watching (pid ${live.pid}): ${beat !== null && beat >= live.started ? `last poll ${ago(nowMs / 1000 - beat)} ago` : 'first poll under way'}.${ends}`);
    return 0;
  }
  out(`Not watching.${beat !== null ? ` The last poll was ${ago(nowMs / 1000 - beat)} ago.` : ''}${ends}`);
  return 1;
}

async function waitUntil(check, timeoutMs, sleep) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return true;
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}

// `inbox watch --stop`: asks the running watcher to stop, makes sure it ended (ending its process if it is stuck
// in a pull), then removes the watcher's files: they belong to one session.
async function watchStop(dir, deps) {
  const out = deps.out || console.log;
  const alive = deps.pidAlive || pidAlive;
  const kill = deps.kill || ((pid, sig) => process.kill(pid, sig));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const live = liveWatcher(dir, (deps.now || Date.now)(), alive);
  if (live) {
    fs.writeFileSync(path.join(dir, STOP_FILE), `${live.id}\n`);
    const gone = () => !alive(live.pid) || (readJson(path.join(dir, LOCK_FILE)) || {}).id !== live.id;
    let stopped = await waitUntil(gone, deps.graceMs ?? 5000, sleep);
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      if (stopped) break;
      try { kill(live.pid, sig); } catch { /* ended in between */ }
      stopped = await waitUntil(gone, 3000, sleep);
    }
    if (!stopped) {
      out(`The watcher (pid ${live.pid}) would not stop. Its files are kept: end process ${live.pid}, then run inbox watch --stop again.`);
      return 1;
    }
    out(`Stopped the watcher (pid ${live.pid}).`);
  } else {
    out('No watcher was running.');
  }
  for (const f of WATCH_FILES) fs.rmSync(path.join(dir, f), { force: true });
  out('Removed the watcher files.');
  return 0;
}

function parseOpenArgs(args) {
  const opts = { code: null, hours: DEFAULT_HOURS, notes: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--hours') {
      const raw = args[++i];
      if (raw === undefined || raw.startsWith('--')) return { error: '--hours needs a number of hours' };
      if (/^\d+$/.test(raw)) opts.hours = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Number(raw)));
      else opts.notes.push(`Note: --hours ${JSON.stringify(raw)} is not a whole number of hours; running ${DEFAULT_HOURS} hours.`);
      continue;
    }
    if (a.startsWith('--') || opts.code) return { error: `Unknown argument: ${a}` };
    opts.code = a;
  }
  if (!opts.code) return { error: 'inbox open needs a session code' };
  return opts;
}

// The seen file maps id -> ms when it was last shown (or reminded). The old
// {"ids":[...]} shape reads as "shown now"; a missing or broken file as empty.
function readSeen(file, nowMs) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const seen = new Map();
    if (data && data.shown && typeof data.shown === 'object') {
      for (const [id, t] of Object.entries(data.shown)) seen.set(id, Number.isFinite(t) ? t : nowMs);
    } else if (data && Array.isArray(data.ids)) {
      for (const id of data.ids) seen.set(id, nowMs);
    }
    return seen;
  } catch {
    return new Map();
  }
}

// Written to a temporary file and renamed over the old one, so a watcher
// stopped mid-write never leaves a truncated file that reads as empty.
function writeSeen(file, seen) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ shown: Object.fromEntries(seen) }) + '\n');
  fs.renameSync(tmp, file);
}

// A whole number of seconds, clamped; anything else falls back to the default
// with a one-line note.
function secondsArg(flag, raw, def, min, max, what, notes) {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    notes.push(`Note: ${flag} ${JSON.stringify(raw === undefined ? '' : raw)} is not a whole number of seconds; ${what} ${def}s.`);
    return def;
  }
  return Math.min(max, Math.max(min, Number(raw)));
}

function parseWatchArgs(args) {
  const opts = { every: DEFAULT_EVERY, remindAfter: DEFAULT_REMIND, exitOnBatch: false, notes: [], mode: null };
  const control = args.filter((a) => a === '--status' || a === '--stop');
  if (control.length) {
    if (args.length > 1) return { error: `${control[0]} takes no other argument` };
    opts.mode = control[0];
    return opts;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--exit-on-batch') { opts.exitOnBatch = true; continue; }
    if ((a === '--every' || a === '--remind-after')
        && (args[i + 1] === undefined || args[i + 1].startsWith('--'))) {
      return { error: `${a} needs a number of seconds` };
    }
    if (a === '--every') {
      opts.every = secondsArg(a, args[++i], DEFAULT_EVERY, 1, 300, 'polling every', opts.notes);
      continue;
    }
    if (a === '--remind-after') {
      opts.remindAfter = secondsArg(a, args[++i], DEFAULT_REMIND, 60, 3600, 'reminding after', opts.notes);
      continue;
    }
    return { error: `Unknown argument: ${a}` };
  }
  return opts;
}

async function runWatch(inbox, kv, args, deps) {
  const out = deps.out || console.log;
  const opts = parseWatchArgs(args);
  if (opts.error) { out(opts.error); out(WATCH_USAGE); return USAGE_EXIT; }
  const dir = deps.cwd || process.cwd();
  if (opts.mode === '--status') return watchStatus(dir, deps);
  if (opts.mode === '--stop') return watchStop(dir, deps);
  opts.notes.forEach((n) => out(n));
  const now = deps.now || Date.now;
  const id = crypto.randomBytes(8).toString('hex');
  const held = claimLock(dir, { pid: process.pid, id, every: opts.every, started: Math.floor(now() / 1000) }, now(), deps.pidAlive);
  if (held) {
    out(`WATCHER: already watching (pid ${held.pid}): this one exits and that one carries on`);
    return BUSY_EXIT;
  }
  try {
    return await pollLoop(inbox, kv, opts, deps, dir, id);
  } finally {
    releaseLock(dir, id);
  }
}

async function pollLoop(inbox, kv, opts, deps, dir, id) {
  const out = deps.out || console.log;
  const sleep = deps.sleep || stopAwareSleep(dir, id);
  const now = deps.now || Date.now;
  const seenFile = path.join(dir, SEEN_FILE);
  const seen = readSeen(seenFile, now());
  const remindMs = opts.remindAfter * 1000;
  const sessionFile = path.join(dir, SESSION_FILE);
  let sessionStart = (readSession(sessionFile) || {}).start;
  let fails = 0;
  for (let polls = 0; deps.maxPolls === undefined || polls < deps.maxPolls; polls++) {
    if (polls > 0) await sleep(opts.every * 1000);
    if (stopAsked(dir, id)) { out(STOPPED); return 0; }
    // Read each poll, so an `inbox open` while this runs moves the end, and starts a new session: the ids shown
    // in the old one are forgotten, as the open's clearing of the seen file says.
    const session = readSession(sessionFile);
    if (session && session.start !== sessionStart) { seen.clear(); sessionStart = session.start; }
    if (session && now() >= session.end) { out(TIME_UP); return 0; }
    let pending = null;
    try {
      pending = await inbox.readPending(kv);
    } catch {
      pending = null;
    }
    fs.writeFileSync(path.join(dir, HEARTBEAT_FILE), `${Math.floor(now() / 1000)}\n`);
    if (pending === null) {
      fails++;
      if (fails % STREAK === 0) {
        out(`WATCHER: inbox pull failed ${fails} times in a row`);
        if (opts.exitOnBatch) return 1;
      }
      continue;
    }
    fails = 0;
    const t = now();
    if (pending.some((e) => !seen.has(e.id))) {
      // Printing the whole batch shows every id in it, so each one's clock restarts.
      out(JSON.stringify(pending));
      pending.forEach((e) => seen.set(e.id, t));
      writeSeen(seenFile, seen);
      if (opts.exitOnBatch) return 0;
      continue;
    }
    const stale = pending.filter((e) => t - seen.get(e.id) >= remindMs).map((e) => e.id);
    if (!stale.length) continue;
    out(`WATCHER: still pending: ${stale.join(' ')}`);
    stale.forEach((id) => seen.set(id, t));
    writeSeen(seenFile, seen);
    if (opts.exitOnBatch) return 0;
  }
  return 0;
}

// After a reply during a session, a missing watcher is said at once: nothing would wake the loop for the next
// request (#884).
function nudgeIfNotWatching(deps) {
  const dir = deps.cwd || process.cwd();
  const nowMs = (deps.now || Date.now)();
  const session = readSession(path.join(dir, SESSION_FILE));
  if (!session || nowMs >= session.end || liveWatcher(dir, nowMs, deps.pidAlive)) return;
  (deps.out || console.log)('Note: no inbox watch is running for this site, so the next request will not wake you. Launch it again, the way you started it.');
}

async function runInbox(argv, deps = {}) {
  const out = deps.out || console.log;
  const inbox = await import('../templates-scaffold/functions/api/inbox-core.mjs');
  const [sub, ...rest] = argv;

  const KNOWN = ['open', 'code', 'pull', 'watch', 'handled', 'flag', 'reply'];
  if (!KNOWN.includes(sub)) {
    out(USAGE);
    return USAGE_EXIT;
  }
  if (sub === 'watch' && (rest.includes('--help') || rest.includes('-h'))) { out(WATCH_USAGE); return 0; }
  // Build the wrangler-backed adapter only for real subcommands, so the usage
  // path never needs a wrangler.toml.
  const kv = deps.adapter || defaultAdapter(deps.cwd);

  switch (sub) {
    case 'open': {
      const opts = parseOpenArgs(rest);
      if (opts.error) { out(opts.error); out(OPEN_USAGE); return 1; }
      opts.notes.forEach((n) => out(n));
      const code = await inbox.setCode(kv, opts.code);
      const dir = deps.cwd || process.cwd();
      // A new code is a new session: forget the ids the last watcher printed,
      // and start the session clock.
      fs.rmSync(path.join(dir, SEEN_FILE), { force: true });
      const start = Math.floor((deps.now || Date.now)() / 1000);
      fs.writeFileSync(path.join(dir, SESSION_FILE), JSON.stringify({ start, hours: opts.hours }) + '\n');
      // Sites made before the scaffold named these files get them too.
      ensureIgnored(dir, WATCH_FILES, 'the watcher files');
      out(`Session code set: ${code} (the watcher stops after ${opts.hours} hours)`);
      return 0;
    }
    case 'code': {
      out((await inbox.getCode(kv)) || '(none)');
      return 0;
    }
    case 'pull': {
      out(JSON.stringify(await inbox.readPending(kv)));
      return 0;
    }
    case 'watch':
      return runWatch(inbox, kv, rest, deps);
    case 'handled':
    case 'flag': {
      // Report the outcome of our OWN write. KV is eventually consistent, so a
      // follow-up read is not a trustworthy check (#176); the return value is.
      const mark = sub === 'handled' ? inbox.markHandled : inbox.markFlagged;
      if (!rest.length) { out(`Usage: inbox ${sub} <id> [<id>...]`); return 1; }
      let rc = 0;
      for (const id of rest) {
        if (await mark(kv, id)) out(`${id}: marked ${sub === 'handled' ? 'handled' : 'flagged'}`);
        else { out(`${id}: NOT ${sub === 'handled' ? 'marked handled' : 'flagged'} — no such request (expired, or never enqueued)`); rc = 1; }
      }
      return rc;
    }
    case 'reply': {
      const [id, kind, ...textParts] = rest;
      const text = textParts.join(' ');
      if (!id || !['applied', 'rejected', 'advice'].includes(kind)) {
        out('Usage: inbox reply <id> <applied|rejected|advice> "<text>"');
        return 1;
      }
      const entry = await inbox.setResponse(kv, id, kind, text);
      if (!entry) {
        // Nothing was written. Exit non-zero so the loop never reports a reply
        // the player can never receive (#176).
        out(`${id}: reply NOT stored — no such request (it may have expired, or the id is wrong). Nothing was written.`);
        return 1;
      }
      out(`${id}: reply stored (${kind}) → status ${entry.status}`);
      nudgeIfNotWatching(deps);
      return 0;
    }
    default:
      out(USAGE);
      return USAGE_EXIT;
  }
}

module.exports = {
  runInbox, defaultRunWrangler, WRANGLER_TIMEOUT_MS, HEARTBEAT_FILE, SEEN_FILE, SESSION_FILE, LOCK_FILE, STOP_FILE,
};
