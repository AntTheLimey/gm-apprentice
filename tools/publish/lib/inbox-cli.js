// Local inbox subcommands, invoked by the publish-site loop (never typed by the
// GM). Reuses Part 1's inbox-core.mjs over a wrangler-backed KV adapter.
const fs = require('fs');
const path = require('path');
const { runCommand, WRANGLER_TIMEOUT_MS } = require('./run-command.js');
const { readNamespaceId, makeAdapter } = require('./inbox-wrangler.js');

// The change-request watcher polls `inbox pull` in a loop and writes
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

async function runInbox(argv, deps = {}) {
  const out = deps.out || console.log;
  const inbox = await import('../templates-scaffold/functions/api/inbox-core.mjs');
  const [sub, ...rest] = argv;

  const KNOWN = ['open', 'code', 'pull', 'handled', 'flag', 'reply'];
  if (!KNOWN.includes(sub)) {
    out('Usage: inbox <open|code|pull|handled|flag|reply> [args]');
    return 1;
  }
  // Build the wrangler-backed adapter only for real subcommands, so the usage
  // path never needs a wrangler.toml.
  const kv = deps.adapter || defaultAdapter(deps.cwd);

  switch (sub) {
    case 'open': {
      if (!rest[0]) { out('Usage: inbox open <CODE>'); return 1; }
      const code = await inbox.setCode(kv, rest[0]);
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
    case 'handled':
    case 'flag': {
      // Report the outcome of our OWN write. KV is eventually consistent, so a
      // follow-up read is not a trustworthy check (#176); the return value is.
      const mark = sub === 'handled' ? inbox.markHandled : inbox.markFlagged;
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
      out('Usage: inbox <open|code|pull|handled|flag|reply> [args]');
      return 1;
  }
}

module.exports = { runInbox, defaultRunWrangler, WRANGLER_TIMEOUT_MS };
