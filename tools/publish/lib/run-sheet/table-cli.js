'use strict';
// `gm-publish table <vault>`: pick tonight's session and serve its run sheet on this computer.
// Node never files the Table Log: `gma table` (Python) does that between the pick and the serve.

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn: nodeSpawn, spawnSync: nodeSpawnSync, execFile } = require('node:child_process');
const { listSessions, pickSession, stateFileFor, noPlanIdOf } = require('./sessions');
const { createTableServer, listenLocal } = require('./server');
const { lockHolder, inCloudOnly } = require('./store');
const { siteFileNamedBy } = require('../settings/site-tool');
const { detectStatusBar, detectInbox } = require('../backend-flags');

const DEFAULT_PORT = 4322;
const FLUSH_CAP_MS = 20000;
const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const TAIL = 'the sheet starts from the PC notes as they are.';
// The signals that end the sheet: Ctrl+C, kill, a closed terminal window (SIGHUP; Windows sends a closed
// console as SIGHUP too) and Ctrl+Break on Windows. Each one saves first (PR review M1).
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];

// ---- the --party flag: PC note paths, a JSON array of them, or a .json file holding one ----

function parseParty(values) {
  const party = [];
  for (const v of values || []) {
    const s = String(v);
    let text = null;
    if (s.trim().startsWith('[')) text = s;
    else if (/\.json$/i.test(s)) {
      try { text = fs.readFileSync(s, 'utf8'); } catch (err) { return { error: `--party: cannot read ${s} (${err.code || err.message})` }; }
    }
    if (text === null) { party.push(s); continue; }
    let list;
    try { list = JSON.parse(text); } catch { return { error: `--party: ${s.trim().startsWith('[') ? 'the JSON' : s} is not valid JSON` }; }
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) return { error: '--party: JSON must be an array of PC note paths' };
    party.push(...list);
  }
  return { party };
}

// ---- who holds a port ----

function defaultRun(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => (err && !stdout ? reject(err) : resolve(String(stdout))));
  });
}

// A run sheet answering on the port says which session it is for.
function defaultHello(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/hello', headers: { Host: `127.0.0.1:${port}` }, timeout: 1500 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('error', () => resolve(null)); // a holder that hangs up mid-answer: ask the OS instead
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(text);
          resolve(j && j.app === 'run-sheet' ? j : null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

const outOf = (r) => (typeof r === 'string' ? r : r && r.stdout ? String(r.stdout) : '');

async function whoHolds(port, { platform = process.platform, run = defaultRun, hello = defaultHello } = {}) {
  try {
    const h = await hello(port);
    if (h) return `the run sheet for ${h.session} (pid ${h.pid})`;
  } catch { /* ask the system */ }
  const attempt = async (cmd, args) => { try { return outOf(await run(cmd, args)); } catch { return ''; } };
  if (platform === 'win32') {
    const net = await attempt('netstat', ['-ano', '-p', 'TCP']);
    let pid = null;
    for (const line of net.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5 && /^TCP$/i.test(cols[0]) && cols[1].endsWith(`:${port}`) && /^LISTENING$/i.test(cols[3])) { pid = cols[4]; break; }
    }
    if (!pid) return null;
    const task = await attempt('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const m = /^"([^"]+)","(\d+)"/m.exec(task.replace(/\r/g, ''));
    return m && m[2] === pid ? `${m[1]} (pid ${pid})` : `a process (pid ${pid})`;
  }
  const lsof = await attempt('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  let pid = null;
  let name = null;
  for (const line of lsof.split(/\r?\n/)) {
    if (line[0] === 'p' && pid === null) pid = line.slice(1);
    else if (line[0] === 'c' && pid !== null && name === null) name = line.slice(1);
  }
  if (pid && /^\d+$/.test(pid)) return `${name || 'a process'} (pid ${pid})`;
  if (platform === 'linux') {
    const ss = await attempt('ss', ['-ltnp']);
    for (const line of ss.split(/\r?\n/)) {
      if (!new RegExp(`:${port}\\s`).test(line)) continue;
      const m = /\("([^"]+)",pid=(\d+)/.exec(line);
      if (m) return `${m[1]} (pid ${m[2]})`;
    }
  }
  return null;
}

// ---- flush, capped ----

// Ends the child and everything it started (wrangler under the flush): on Windows `taskkill /T`, else
// the child's own process group, which `runFlushCapped` gives it.
function killTree(child, { platform = process.platform, spawnSync = nodeSpawnSync, kill = process.kill } = {}) {
  if (!child || !child.pid) return;
  if (platform === 'win32') {
    try { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); } catch { /* below */ }
    try { child.kill(); } catch { /* already gone */ }
    return;
  }
  try { kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch { /* already gone */ } }
}

// Runs `gm-publish flush --config <file>` as a child, with its output passed through, stopped (with
// all it started) after the cap. Off Windows the child leads its own process group, so a stop signal
// meant for the sheet no longer reaches it: one that comes during the flush ends the flush's group,
// then this process.
// At the cap the flush is asked to stop, and the sheet waits for it to be gone (killed outright after
// `graceMs`), so nothing it does lands after the sheet has read the PC notes.
function runFlushCapped({ configFile, timeoutMs = FLUSH_CAP_MS, graceMs = 3000, spawn = nodeSpawn, platform = process.platform, kill = process.kill, spawnSync = nodeSpawnSync, proc = process, exit = (c) => process.exit(c) }) {
  return new Promise((resolve) => {
    let child;
    let timer = null;
    let timedOut = false;
    let done = false;
    const onStop = () => {
      killTree(child, { platform, spawnSync, kill });
      finish({ ok: false, why: 'stopped' });
      exit(130);
    };
    const finish = (r) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      for (const sig of STOP_SIGNALS) proc.removeListener(sig, onStop);
      resolve(r);
    };
    try {
      child = spawn(process.execPath, [BIN, 'flush', '--config', configFile], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: platform !== 'win32' });
    } catch (err) {
      finish({ ok: false, why: err.message });
      return;
    }
    for (const sig of STOP_SIGNALS) proc.on(sig, onStop);
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child, { platform, spawnSync, kill });
      timer = setTimeout(() => {
        if (platform !== 'win32') { try { kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
        finish({ ok: false, why: 'timeout' });
      }, graceMs);
    }, timeoutMs);
    child.on('error', (err) => finish({ ok: false, why: timedOut ? 'timeout' : err.message }));
    child.on('close', (code, signal) => finish(timedOut ? { ok: false, why: 'timeout' }
      : code === 0 ? { ok: true, why: null } : { ok: false, why: code === null ? `stopped by ${signal}` : `exit ${code}` }));
  });
}

// ---- the browser ----

function openBrowser(url, { platform = process.platform, spawn = nodeSpawn } = {}) {
  const [cmd, args] = platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); // the address is printed anyway
    child.unref();
  } catch { /* the address is printed anyway */ }
}

// ---- the port ----

// Binds 127.0.0.1:<port> and lets go at once. Resolves null when free, else the error.
function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (err) => resolve(err));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(null)));
  });
}

async function busyMessage(port, err, deps) {
  if (err.code !== 'EADDRINUSE') return `Port ${port} cannot be used (${err.code || err.message}). Start this with --port <another>.`;
  let who = null;
  try { who = await (deps.whoHolds || whoHolds)(port); } catch { who = null; }
  return `Port ${port} is busy: ${who || 'something else'} holds it. Stop it, or start this with --port <another>.`;
}

function inCloudMessage(label, vaultPath, file) {
  const rel = path.relative(vaultPath, file).split(path.sep).join('/');
  return `The saved run sheet for ${label} is in iCloud, not on this computer (${rel}). Download it first (in Finder: Download Now), then start again.`;
}

function lockedMessage(label, { pid, port }) {
  return `The run sheet for ${label} is already running (pid ${pid}${port ? `, port ${port}: http://127.0.0.1:${port}/` : ''}). Use that one, or stop it first.`;
}

// The model's warnings, from the server just started; null when the Plan cannot be read.
function fetchModel(port) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/api/model', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, body: {} }); }
      });
    }).on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
  });
}

// ---- the command ----

async function runTable({ vault, session, port = DEFAULT_PORT, open = true, party = [], pick = false, json = false, fileLog = null } = {}, deps = {}) {
  const out = deps.out || ((l) => console.log(l));
  const err = deps.err || ((l) => console.error(l));
  const refuse = (message) => {
    if (pick && json) out(JSON.stringify({ ok: false, error: message })); else err(message);
    return 1;
  };
  if (!vault || !fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) return refuse(`No vault folder at ${vault || '(none given)'}.`);
  const vaultPath = path.resolve(vault);

  let sessions;
  try { sessions = listSessions(vaultPath); } catch (e) { return refuse(`The vault could not be read: ${String(e.message).split('\n')[0]}`); }
  const picked = pickSession(sessions, session, vaultPath);
  if (picked.error) return refuse(picked.error);
  const chosen = picked.session;

  // The port is checked before anything else is done, so a busy one is refused before `gma table` files a thing.
  const busy = await checkPort(port);
  if (busy) return refuse(await busyMessage(port, busy, deps));
  // One server per session: another one (on another port) would write the same state and Table Log.
  const { file: stateFile, stateId } = stateFileFor(vaultPath, chosen);
  const hello = deps.hello || defaultHello;
  // A session prep filed with a Plan while a no-Plan sheet had it open: that sheet holds the number-named lock, and may
  // have saved nothing yet (CodeRabbit #895). Its lock is asked too, so the session never has two sheets.
  const numbered = chosen.plan && chosen.number !== null && chosen.number !== undefined ? path.join(path.dirname(stateFile), `${noPlanIdOf(chosen)}.json`) : null;
  const lockedNow = async () => (await lockHolder(stateFile, { hello })) || (numbered && numbered !== stateFile ? await lockHolder(numbered, { hello }) : null);
  const holder = await lockedNow();
  if (holder) return refuse(lockedMessage(chosen.label, holder));
  // A saved state iCloud has taken off this computer would read as none: the sheet would start empty.
  if ((deps.inCloud || inCloudOnly)(stateFile)) return refuse(inCloudMessage(chosen.label, vaultPath, stateFile));

  if (pick) {
    if (json) {
      out(JSON.stringify({
        ok: true, index: chosen.index, plan: chosen.plan, tableLog: chosen.tableLog, label: chosen.label, stateId,
        // a session opened from the record: the number, chapter and date `gma table` files it under
        fromRecord: !!chosen.fromRecord, number: chosen.number === undefined ? null : chosen.number,
        chapter: chosen.chapter || null, after: chosen.after || null, planVault: chosen.planVault === undefined ? null : chosen.planVault,
        playDate: chosen.playDate || null,
        others: picked.others.map((s) => s.index),
      }));
    } else out(`${chosen.label}: ${chosen.index || 'not filed yet'}`);
    return 0;
  }

  if (picked.others.length) out(`Also in progress: ${picked.others.map((s) => s.label).join(', ')}. Running ${chosen.label}; name another with --session.`);

  // Flush the PC sheets first, when the site has live stats or an inbox. Never a reason not to start.
  const site = siteFileNamedBy(vaultPath);
  if (!site || !site.exists) {
    out(`No site folder: nothing to flush; ${TAIL}`);
  } else if (detectStatusBar(site.dir) || detectInbox(site.dir)) {
    let res;
    try {
      res = await (deps.runFlushCapped || runFlushCapped)({ configFile: site.file, timeoutMs: FLUSH_CAP_MS, proc: deps.proc || process, exit: deps.exit || ((c) => process.exit(c)) });
    } catch (e) { res = { ok: false, why: String(e.message).split('\n')[0] }; }
    if (res.why === 'stopped') return 130; // stopped during the flush: nothing was served
    if (!res.ok) out(res.why === 'timeout' ? `Flush took over 20 s and was stopped: ${TAIL}` : `Flush failed (${res.why}): ${TAIL}`);
  }

  if (!chosen.index) {
    // a session from the record that is not in the vault yet: it is filed with its Table Log (Task 7)
    out(fileLog ? `${chosen.label} is not in the vault yet: it is filed with its Table Log on the first thing that happens at the table, so a look leaves nothing.`
      : `${chosen.label} is not in the vault yet: start it with \`gma table\` to have it filed and the record written.`);
  } else if (!chosen.tableLog) {
    out(fileLog ? 'No Table Log yet: it is filed on the first thing that happens at the table, so a look leaves nothing.'
      : 'No Table Log note yet: start it with `gma table` to have the record written.');
  }

  // Asked again: another start may have taken the session while this one flushed.
  const late = await lockedNow();
  if (late) return refuse(lockedMessage(chosen.label, late));

  let app;
  try { app = (deps.createTableServer || createTableServer)({ vaultPath, session: chosen, party, stateFile, stateId, fileLog, deps: deps.server }); } catch (e) {
    if (e.code === 'LOCKED') return refuse(lockedMessage(chosen.label, e));
    if (e.code === 'IN_CLOUD') return refuse(inCloudMessage(chosen.label, vaultPath, e.file));
    throw e;
  }
  let bound;
  try { bound = await listenLocal(app.server, port); } catch (e) {
    await app.close();
    return refuse(e.code ? await busyMessage(port, e, deps) : `The run sheet could not start: ${e.message}`);
  }
  const url = `http://127.0.0.1:${bound}/`;

  const model = await fetchModel(bound);
  if (model.status !== 200) {
    await app.close();
    const what = chosen.plan ? 'The Plan' : 'The record';
    return refuse(`${what} for ${chosen.label} cannot be read: ${(model.body && model.body.error) || 'no answer'}`);
  }

  out(`Run sheet for ${chosen.title}: ${url}`);
  out('Ctrl+C to stop.');
  const n = ((model.body.model && model.body.model.warnings) || []).length;
  if (n > 0) out(`${n} prep note${n === 1 ? '' : 's'} on the page`);
  if (open) (deps.openBrowser || openBrowser)(url);

  const proc = deps.proc || process;
  const exit = deps.exit || ((c) => process.exit(c));
  let stopping = null;
  const onSignal = () => {
    if (stopping) return;
    for (const sig of STOP_SIGNALS) proc.removeListener(sig, onSignal);
    stopping = app.close().then(() => exit(0), (e) => { err(`Could not save the sheet's state on the way out: ${e.message}`); exit(1); });
  };
  for (const sig of STOP_SIGNALS) proc.on(sig, onSignal);

  return {
    port: bound,
    url,
    app,
    async close() {
      for (const sig of STOP_SIGNALS) proc.removeListener(sig, onSignal);
      await app.close();
    },
  };
}

module.exports = { runTable, runFlushCapped, killTree, whoHolds, openBrowser, parseParty, checkPort, FLUSH_CAP_MS, DEFAULT_PORT, STOP_SIGNALS };
