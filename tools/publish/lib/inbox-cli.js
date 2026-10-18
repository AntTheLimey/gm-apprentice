// Local inbox subcommands, invoked by the publish-site loop (never typed by the
// GM). Reuses Part 1's inbox-core.mjs over a wrangler-backed KV adapter.
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
const OPEN_USAGE = `Usage: inbox open <CODE> [--hours N]
  --hours N  hours the watcher runs from now (default ${DEFAULT_HOURS}, kept between ${MIN_HOURS} and ${MAX_HOURS})`;
const DEFAULT_EVERY = 30;
const DEFAULT_REMIND = 300;
const STREAK = 5;
const USAGE_EXIT = 2;
const WATCH_USAGE = `Usage: inbox watch [--every N] [--remind-after N] [--exit-on-batch]
  --every N         seconds between polls (default ${DEFAULT_EVERY}, kept between 1 and 300)
  --remind-after N  seconds before a request still pending is named again
                    (default ${DEFAULT_REMIND}, kept between 60 and 3600)
  --exit-on-batch   exit 0 after a new batch or a reminder line, 1 after a failure line
Prints a new batch as the JSON array \`inbox pull\` prints, once; a batch it printed before
prints nothing. An id shown before and still pending N seconds later prints
"WATCHER: still pending: <id> <id>...", and again every N seconds while it stays pending.
After ${STREAK} failed polls in a row it prints "WATCHER: inbox pull failed N times in a row",
and again every ${STREAK} more. Once the hours set by \`inbox open\` have passed it prints
"${TIME_UP}" and exits 0. Without --exit-on-batch it otherwise runs until stopped.
Exit codes: 0 batch, reminder or time up (or polls done), 1 failure line, 2 usage error.`;

// The ms when the session opened by `inbox open` ends, or null for no limit.
function readSessionEnd(file) {
  try {
    const { start, hours } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isFinite(start) || !Number.isFinite(hours)) return null;
    return (start + hours * 3600) * 1000;
  } catch {
    return null;
  }
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
  const opts = { every: DEFAULT_EVERY, remindAfter: DEFAULT_REMIND, exitOnBatch: false, notes: [] };
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
  opts.notes.forEach((n) => out(n));
  const dir = deps.cwd || process.cwd();
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || Date.now;
  const seenFile = path.join(dir, SEEN_FILE);
  const seen = readSeen(seenFile, now());
  const remindMs = opts.remindAfter * 1000;
  const sessionFile = path.join(dir, SESSION_FILE);
  let fails = 0;
  for (let polls = 0; deps.maxPolls === undefined || polls < deps.maxPolls; polls++) {
    if (polls > 0) await sleep(opts.every * 1000);
    // Read each poll, so an `inbox open` while this runs moves the end.
    const end = readSessionEnd(sessionFile);
    if (end !== null && now() >= end) { out(TIME_UP); return 0; }
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
      ensureIgnored(dir, [HEARTBEAT_FILE, SEEN_FILE, SESSION_FILE], 'the watcher files');
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
      return 0;
    }
    default:
      out(USAGE);
      return USAGE_EXIT;
  }
}

module.exports = { runInbox, defaultRunWrangler, WRANGLER_TIMEOUT_MS, HEARTBEAT_FILE, SEEN_FILE, SESSION_FILE };
