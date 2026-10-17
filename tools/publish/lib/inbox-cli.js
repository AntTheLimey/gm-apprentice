// Local inbox subcommands, invoked by the publish-site loop (never typed by the
// GM). Reuses Part 1's inbox-core.mjs over a wrangler-backed KV adapter.
const fs = require('fs');
const path = require('path');
const { runCommand, WRANGLER_TIMEOUT_MS } = require('./run-command.js');
const { readNamespaceId, makeAdapter } = require('./inbox-wrangler.js');

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
// an id not printed before. The printed ids are kept in .watcher-seen.json, so a
// relaunch stays quiet about a batch it already handed over; `inbox open` clears it.
const HEARTBEAT_FILE = '.watcher-heartbeat';
const SEEN_FILE = '.watcher-seen.json';
const DEFAULT_EVERY = 30;
const STREAK = 5;
const WATCH_USAGE = `Usage: inbox watch [--every N] [--exit-on-batch]
  --every N        seconds between polls (default ${DEFAULT_EVERY}, kept between 1 and 300)
  --exit-on-batch  exit after a new batch (code 0) or a failure line (code 1)
Prints a new batch as the JSON array \`inbox pull\` prints, once; a batch it printed before
prints nothing. After ${STREAK} failed polls in a row it prints
"WATCHER: inbox pull failed N times in a row", and again every ${STREAK} more.
Without --exit-on-batch it runs until stopped.`;

function readSeen(file) {
  try {
    const ids = JSON.parse(fs.readFileSync(file, 'utf8')).ids;
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function parseWatchArgs(args) {
  const opts = { every: DEFAULT_EVERY, exitOnBatch: false, notes: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--exit-on-batch') { opts.exitOnBatch = true; continue; }
    if (a === '--every') {
      const raw = args[++i];
      if (raw === undefined || !/^\d+$/.test(raw)) {
        opts.every = DEFAULT_EVERY;
        opts.notes.push(`Note: --every ${JSON.stringify(raw === undefined ? '' : raw)} is not a whole number of seconds; polling every ${DEFAULT_EVERY}s.`);
      } else {
        opts.every = Math.min(300, Math.max(1, Number(raw)));
      }
      continue;
    }
    return { error: `Unknown argument: ${a}` };
  }
  return opts;
}

async function runWatch(inbox, kv, args, deps) {
  const out = deps.out || console.log;
  const opts = parseWatchArgs(args);
  if (opts.error) { out(opts.error); out(WATCH_USAGE); return 1; }
  opts.notes.forEach((n) => out(n));
  const dir = deps.cwd || process.cwd();
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || Date.now;
  const seenFile = path.join(dir, SEEN_FILE);
  const seen = readSeen(seenFile);
  let fails = 0;
  for (let polls = 0; deps.maxPolls === undefined || polls < deps.maxPolls; polls++) {
    if (polls > 0) await sleep(opts.every * 1000);
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
    if (!pending.some((e) => !seen.has(e.id))) continue;
    out(JSON.stringify(pending));
    pending.forEach((e) => seen.add(e.id));
    fs.writeFileSync(seenFile, JSON.stringify({ ids: [...seen] }) + '\n');
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
    return 1;
  }
  if (sub === 'watch' && (rest.includes('--help') || rest.includes('-h'))) { out(WATCH_USAGE); return 0; }
  // Build the wrangler-backed adapter only for real subcommands, so the usage
  // path never needs a wrangler.toml.
  const kv = deps.adapter || defaultAdapter(deps.cwd);

  switch (sub) {
    case 'open': {
      if (!rest[0]) { out('Usage: inbox open <CODE>'); return 1; }
      const code = await inbox.setCode(kv, rest[0]);
      // A new code is a new session: forget the ids the last watcher printed.
      fs.rmSync(path.join(deps.cwd || process.cwd(), SEEN_FILE), { force: true });
      out(`Session code set: ${code}`);
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
      return 1;
  }
}

module.exports = { runInbox, defaultRunWrangler, WRANGLER_TIMEOUT_MS, HEARTBEAT_FILE, SEEN_FILE };
