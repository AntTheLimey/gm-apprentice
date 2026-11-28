'use strict';
// The run sheet's local server (spec §5, §6.7): the GM page, the model (re-read on every load), note
// text for the drawer, vault pictures, the play state and an event stream. Node built-ins only; bound
// to 127.0.0.1. The page holds every secret, so every answer is local-only: a foreign Host is refused
// (DNS rebinding), a write from a foreign Origin is refused, no CORS header is ever sent and OPTIONS
// gets 405. Every answer carries a CSP that lets nothing load from outside (plan decisions 10, 11).
//
// After each state write the Table Log note is brought up to date from the state (plan decision 7):
// a file body that is neither what the server last wrote (`recordHash`) nor the empty skeleton is
// copied aside first, so text is never lost. The record is built from the model cached at the last
// `/api/model` (what the page shows), not a fresh read of the Plan per write. At start one reconcile
// adopts a Table Log the state already renders, or rewrites one a crash left a change behind.
//
// Whether the state and the record are being written is kept here and given to every page that
// connects (SSE `hello`, `/api/model` notices), so a page loaded after a failure still says so. A
// record that fails is retried quietly with backoff, said once per distinct error.
//
// 5b adds `/api/roll`, `/api/actions` and the players' half: `/players` (their page), `/api/players/view`,
// `/api/players/events` and `/players/pic/<id>`. The players' view is players.js's `forPlayers`, a whitelist
// built here after each accepted write and each model load and sent only when it changed. The players'
// stream is its own client set: it carries `hello` ({}) and `view`, never a GM event. Every players' error
// answer is a fixed body; the detail goes to the terminal only (plan 5b decisions 10 and 23, Review M4).
//
// A session with no Plan (opened from the record, `session.plan` null) reads its model with read-record.js and may
// not be in the vault yet: `fileLog` is then `{ cmd, takesTitle: true }` (`gma table-file`), and the first thing that
// happens at the table files the session and its Table Log, under the title the GM typed or the date the sheet opened.
// Filing runs as a child in the background, one at a time: writes that land meanwhile are kept in the state and
// written to the log when it ends. "Filed" is read from the vault (the index links a Table Log), never from the state
// alone; the state's `filed` is for the page and for a Plan session that adopts this state later (Task 7, D2, D3, D9).

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const serve = require('../serve');
const { readRunSheet } = require('./read');
const { readRecord } = require('./read-record');
const { buildIndex, stemName, stemOf } = require('./notes');
const { tableLogOf, stateIdOf } = require('./sessions');
const { createStore, stampOf } = require('./store');
const { present, toHtml } = require('./present');
const { forPlayers } = require('./players');
const { tableLogBody, rewriteTableLog, recordBodyOf, bodyHash, needsBackup, isEmptySkeleton, linkFor } = require('./record');
const { isWithheld } = require('../processor');
const RS = require('./web/state');
const dice = require('../dice');
const { applyChanges } = require('../settings/write');
const { siteFileNamedBy, siteToolOlderThan } = require('../settings/site-tool');
const { SIDES, HEX, PRESETS, SITE_TOOL_FROM, readSideColours } = require('./side-colours');
const { readSettings } = require('../settings/read');
const { systemFor } = require('./systems');
const { pcTohit, typedTohit, servedCss } = require('./tohit');
const { slugify, pcLiveKey, displayTitleOf } = require('../scanner');

const WEB_DIR = path.join(__dirname, 'web');
// the player site's to-hit calculator, served to the GM page as the site ships it (Task 24)
const TOHIT_JS = path.join(__dirname, '..', '..', 'js', 'gurps-tohit.js');
const TOHIT_CSS = path.join(__dirname, '..', '..', 'css', 'tohit.css');
const PLAYERS_DIR = path.join(WEB_DIR, 'players');
const PICTURE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
// What every players' route answers on any error: never the error's own words.
const UNAVAILABLE = { error: 'unavailable' };
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const RECORD_RETRY_MS = [2000, 5000, 10000, 30000];
const FILE_LOG_TIMEOUT_MS = 60000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
// The sheet's open date in local time, as the frontmatter takes it and as a blank title reads (D3). Never the locale.
const openDateOf = (d) => ({ iso: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, title: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
// The command's first CREATED or ADDED row names the index it filed (`gma table-file` prints the index's row first).
const filedIndexOf = (out) => {
  const row = String(out || '').split(/\r?\n/).find((l) => /^(CREATED|ADDED)\t/.test(l));
  return row ? row.split('\t')[1] || null : null;
};
// A refusal that says the index already has its Table Log (a filing that wrote, then timed out): that index and log.
const alreadyFiledOf = (why) => {
  const m = /^(.+?\.md): already has a Table Log: (.+?\.md)\s*$/.exec(String(why || ''));
  return m ? { index: m[1], log: m[2] } : null;
};
const MAX_BODY = 2 * 1024 * 1024;
const MAX_ROLLS = 64;
const MAX_ACTIONS = 200;
const PICTURE = /\.(jpe?g|png|webp|gif|svg|avif)$/i; // the same list as present.js
// A miss in a served folder is a plain 404, never a 404.html page the folder happens to hold.
const NO_PAGE = '.run-sheet-no-404-page';

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function createTableServer({ vaultPath, session, party = [], stateFile, stateId: givenId, fileLog = null, deps = {} } = {}) {
  const fs = deps.fs || nodeFs;
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line) => console.error(line));
  const read = deps.readRunSheet || readRunSheet;
  const readFromRecord = deps.readRecord || readRecord;
  session = { ...session }; // its index is set here once the session is filed
  const opened = openDateOf(now()); // taken once: a night that runs past midnight keeps its date (D3)
  // `fileLog`: the command array (`table-log-new`, the index exists), or `{ cmd, takesTitle }` (`table-file`).
  const fileCmd = Array.isArray(fileLog) ? { cmd: fileLog, takesTitle: false }
    : fileLog && Array.isArray(fileLog.cmd) ? { cmd: fileLog.cmd, takesTitle: fileLog.takesTitle === true } : null;
  const index = deps.buildIndex || buildIndex;
  const vaultDeps = deps.vaultDeps;
  const serverId = deps.serverId || crypto.randomUUID();
  const stateId = givenId || stateIdOf(session);
  const label = session.label;
  const file = stateFile || path.join(vaultPath, '_meta', 'table', `${stateId}.json`);
  const tableDir = path.dirname(file);
  const vaultRoot = path.resolve(vaultPath);
  const reduce = deps.reduce || RS.reduce;
  const buildPlayers = deps.forPlayers || forPlayers;
  // the dice's random source: crypto's, or a fixed one a test hands in (lib/dice takes it for tests only)
  const diceOpts = typeof deps.randomInt === 'function' ? { randomInt: deps.randomInt } : undefined;

  const clients = new Set();
  // The players' half: its own stream clients, the last good view, and the picture ids of the current
  // view and the one before it (a picture asked for just as the view changed still serves).
  const playersClients = new Set();
  const players = { view: null, json: null, pics: new Map(), before: new Map() };
  const notices = [];
  let lastModel = null;
  let lastIndex = null;
  let closed = false;
  let recordRetry = null;
  let recordAttempt = 0;
  let keptBody = null;
  // The state last written to disk: a record retry renders this, never a newer state still in memory,
  // so the log is never ahead of the saved state.
  let lastWritten = null;
  let savedRev = null;
  const recordRetryMs = deps.recordRetryMs || RECORD_RETRY_MS;
  // What a page that connects now needs to know: is the state being saved, is the record being written.
  // `filing`: a filing of this session runs now (Task 11b, F3): the page says so and holds the title box until it ends.
  const status = { saving: 'ok', saveError: null, record: 'ok', recordError: null, players: 'ok', playersError: null, filing: false };
  const playersText = (error) => `The players' screen could not be updated: ${error}`;
  const statusNotices = () => [
    ...(status.saving === 'failing' ? [{ kind: 'save-failing', error: status.saveError }] : []),
    ...(status.record === 'failing' ? [{ kind: 'record-failing', error: status.recordError }] : []),
    ...(status.players === 'failing' ? [{ kind: 'players-failing', error: status.playersError, text: playersText(status.playersError) }] : []),
  ];

  function broadcast(event, data) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(chunk);
  }

  // The players' view, rebuilt from the cached model and the newest state; sent to the players' stream only
  // when it changed. A build that throws keeps the last good view up and tells the GM (Review M4.2).
  function refreshPlayers() {
    if (closed) return;
    const pics = new Map();
    const picId = (p) => {
      const id = crypto.createHash('sha256').update(`${serverId}\n${p}`).digest('hex').slice(0, 20);
      pics.set(id, p);
      return id;
    };
    let view;
    try {
      const model = lastModel || loadModel().model;
      view = buildPlayers(model, store.get().state, { withheldWords: model.withheldWords, campaign: model.campaign, picId });
    } catch (err) {
      const error = String((err && err.message) || err).split('\n')[0];
      if (status.players !== 'failing' || status.playersError !== error) {
        status.players = 'failing';
        status.playersError = error;
        log(`run sheet: the players' screen could not be updated (${error}); it keeps what it showed.`);
        broadcast('players-failed', { error, text: playersText(error) });
      }
      return;
    }
    if (status.players === 'failing') {
      status.players = 'ok';
      status.playersError = null;
      log("run sheet: the players' screen is updated again.");
      broadcast('players-ok', {});
    }
    const text = JSON.stringify(view);
    if (text === players.json) return;
    players.before = players.pics;
    players.pics = pics;
    players.view = view;
    players.json = text;
    for (const res of playersClients) res.write(`event: view\ndata: ${text}\n\n`);
  }

  const indexNow = () => {
    if (!lastIndex) lastIndex = index(vaultPath, { deps: vaultDeps });
    return lastIndex;
  };
  // A session not filed yet has no index and so no Table Log to read.
  const logOf = (idx) => (session.index ? tableLogOf(idx, session.index).log : null);
  // Filed, by the vault: the index is there and links its Table Log.
  const isFiled = (idx) => Boolean(session.index && idx.has(session.index) && logOf(idx));
  // `given`: an index built a moment ago (the filing's own), so the vault is not read twice (Task 11b, F3). The record
  // reader takes the same index, never building its own.
  const loadModel = (given = null) => {
    const idx = given || index(vaultPath, { deps: vaultDeps });
    const model = session.plan ? read(vaultPath, session.plan, { party, deps: vaultDeps }) : readFromRecord(vaultPath, session, { party, deps: vaultDeps, index: idx });
    // tonight's Table Log link, when it is refused (another session's log), is a prep note
    const tl = session.index ? tableLogOf(idx, session.index) : { log: null, warning: null };
    if (tl.warning && Array.isArray(model.warnings) && !model.warnings.some((w) => w.text === tl.warning.text)) model.warnings.push(tl.warning);
    lastIndex = idx;
    lastModel = model;
    return { model, idx };
  };

  // The Table Log is filed on the first thing that happens at the table (#855): the first write with something in it.
  // A look (reading the Plan, opening beats) leaves no note, so it never puts the session in play. `fileLog` is the
  // command `gma table` hands over, so the note's shape stays the vault scripts'. Without it (the sheet started some
  // other way) there is no Table Log: the state is kept, nothing else written.
  // The command runs as a child (D9), so the server answers while it runs. `refused` is an exit 1 with an ERROR row:
  // the vault said no, so it is tried again on the GM's next action, never on the timer.
  const runFileLog = deps.runFileLog || ((cmd) => new Promise((resolve) => {
    let child;
    try { child = spawn(cmd[0], cmd.slice(1), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) {
      resolve({ ok: false, why: err.message });
      return;
    }
    let out = '';
    let errText = '';
    let ended = false;
    const finish = (r) => { if (ended) return; ended = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, why: `it took over ${FILE_LOG_TIMEOUT_MS / 1000} s and was stopped`, out });
    }, FILE_LOG_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { errText += c; });
    child.on('error', (err) => finish({ ok: false, why: err.message, out }));
    child.on('close', (code, signal) => {
      if (code === 0) { finish({ ok: true, out }); return; }
      const errorRow = out.split(/\r?\n/).find((l) => l.startsWith('ERROR\t'));
      const said = errorRow ? errorRow.split('\t').slice(3).join('\t').trim() : `${errText}\n${out}`.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      finish({ ok: false, refused: code === 1 && Boolean(errorRow), why: said || (code === null ? `stopped by ${signal}` : `exit ${code}`), out });
    });
  }));

  let filing = null; // the filing running now: one at a time
  // A filing of a new session ended with no answer (a crash, a timeout): it may have written the index and its log
  // all the same, and only then is a refusal naming them taken as this session's filing.
  let unsure = false;
  // The command for this filing: a session not filed yet takes the title the GM typed, else the open date (D2, D3).
  function fileCommand() {
    if (!fileCmd.takesTitle) return fileCmd.cmd;
    const title = String(store.get().state.title || '').trim() || opened.title;
    return [...fileCmd.cmd, `--title=${title}`, '--play-date', opened.iso];
  }
  // Starts the filing in the background. Writes that land while it runs find `filing` set and are kept in the state;
  // the write after it ends renders them all.
  function startFiling() {
    if (filing || closed) return;
    const cmd = fileCommand();
    const p = (async () => {
      // `filing` is set before any of this runs: a runFileLog that throws at once must still clear it
      await null;
      let done;
      try { done = await runFileLog(cmd); } catch (err) { done = { ok: false, why: String((err && err.message) || err) }; }
      if (!done || typeof done !== 'object') done = { ok: false, why: 'the filing gave no answer' };
      if (filing === p) filing = null;
      try { filed(done); } catch (err) { recordFailed(err); }
      filingIs(false);
    })();
    filing = p;
    filingIs(true);
  }
  function filingIs(on) {
    if (status.filing === on) return;
    status.filing = on;
    broadcast('filing', { on });
  }
  // The model the filing's own read gave, for the page's next model, once and briefly: the page asks for it the moment
  // the filing is told, and a second read of the vault then is a second of waiting (Task 11b, F3).
  let justRead = null;
  const FRESH_MS = 5000;
  // The first thing at the table files the session at once: the state is saved now, not after the save delay, and the
  // filing starts from that save (the log is never ahead of the saved state). Later writes keep the delay.
  function fileSoon() {
    if (closed || filing || !fileCmd || logOf(indexNow())) return;
    store.flushNow();
  }
  // The filing ended: take the index from its first CREATED or ADDED row (never a re-list), check the vault links its
  // Table Log, and write the log from the newest saved state.
  function filed(done) {
    lastIndex = index(vaultPath, { deps: vaultDeps });
    justRead = null;
    if (fileCmd.takesTitle && !session.index) {
      let at = filedIndexOf(done.out);
      // a filing that wrote and then failed (a timeout) is refused next time with "already has a Table Log": that index
      // is the one it filed, or every retry would be refused
      const already = !done.ok && done.refused && unsure ? alreadyFiledOf(done.why) : null;
      if (!at && already && tableLogOf(lastIndex, already.index).log === already.log) at = already.index;
      if (at && lastIndex.has(at)) {
        session.index = at;
        session.title = displayTitleOf(lastIndex.read(at).fm || {}, stemOf(at));
      }
    }
    const rel = logOf(lastIndex);
    // A command that wrote the note and then failed (a timeout, an exit after the write) has still filed it: the log
    // found is the log, or every retry would be refused with "already has a Table Log".
    if (!rel) {
      if (fileCmd.takesTitle && !done.refused) unsure = true;
      const err = new Error(done.ok ? 'it was filed, but the session does not link it' : `filing it failed: ${done.why}`);
      if (!done.ok && done.refused) err.refused = true;
      throw err;
    }
    log(`run sheet: filed the Table Log, ${rel}: the session is in play.`);
    try { const r = loadModel(lastIndex); justRead = { ...r, at: Date.now() }; } catch { /* the model re-reads on the next load */ }
    // only a session from the record: a Plan session is named by its Plan, and only a no-Plan state is adopted by it
    if (session.fromRecord) store.setServer({ filed: { index: session.index, at: now().toISOString() } });
    // the title the vault filed it under (a title it could not hold files under the date, D8)
    const filedTitle = fileCmd.takesTitle ? stemOf(session.index).replace(/^Session\s+\d+\s+-\s+/i, '') : session.title;
    broadcast('record-filed', { path: rel, index: session.index, title: filedTitle });
    writeRecord(lastWritten || store.get().state);
  }

  // The Table Log, brought up to date from the state just written.
  function writeRecord(state) {
    if (closed) return;
    try {
      const idx = indexNow();
      const rel = logOf(idx);
      const model = lastModel || loadModel().model;
      if (!rel) {
        // nothing to write yet, or no way to file one: the state is kept. A filing running now writes it when it ends.
        if (!fileCmd || isEmptySkeleton(tableLogBody(model, state, { linkFor: linkFor(idx) }))) return;
        startFiling();
        return;
      }
      const logFile = path.join(vaultRoot, ...rel.split('/'));
      const text = fs.readFileSync(logFile, 'utf8');
      const body = tableLogBody(model, state, { linkFor: linkFor(idx) });
      const hash = bodyHash(body);
      const fileBody = recordBodyOf(text);
      if (bodyHash(fileBody) === hash) {
        if (store.get().state.recordHash !== hash) store.setServer({ recordHash: hash });
        recordOk();
        return;
      }
      const out = rewriteTableLog(text, body); // refuses a note that is not type: session-table-log
      if (needsBackup(text, store.get().state.recordHash) && keptBody !== bodyHash(fileBody)) {
        fs.mkdirSync(tableDir, { recursive: true });
        const stamp = stampOf(now());
        // not .md: a kept copy is never read as a second Table Log note by a vault scan
        let name = `${stateId}.table-log-${stamp}.txt`;
        for (let i = 2; fs.existsSync(path.join(tableDir, name)); i++) name = `${stateId}.table-log-${stamp}-${i}.txt`;
        fs.copyFileSync(logFile, path.join(tableDir, name));
        keptBody = bodyHash(fileBody);
        const keptRel = path.relative(vaultRoot, path.join(tableDir, name)).split(path.sep).join('/');
        notices.push({ kind: 'record-kept', path: keptRel });
        broadcast('record-kept', { path: keptRel });
      }
      const tmp = `${logFile}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, out, 'utf8');
      fs.renameSync(tmp, logFile);
      store.setServer({ recordHash: hash });
      recordOk();
    } catch (err) { recordFailed(err); }
  }

  // Said once per distinct error. Retried on the timer, except a note that is not a Table Log (never written) and a
  // filing the vault refused (tried again on the GM's next action, D9).
  function recordFailed(err) {
    const error = String((err && err.message) || err).split('\n')[0];
    const notAgain = err && err.code === 'NOT_A_TABLE_LOG';
    const waits = err && err.refused;
    if (status.record !== 'failing' || status.recordError !== error) {
      status.record = 'failing';
      status.recordError = error;
      log(`run sheet: the Table Log could not be written (${error}); the state is kept${notAgain ? '' : waits ? ' and it is tried again on the next change' : ' and the write is tried again'}.`);
      broadcast('record-failed', { error });
    }
    if (waits && recordRetry) { clearTimeout(recordRetry); recordRetry = null; }
    if (notAgain || waits) return; // a note that is not a Table Log is never written; a refusal waits for the GM
    if (!recordRetry && !closed) {
      const wait = recordRetryMs[Math.min(recordAttempt, recordRetryMs.length - 1)];
      recordAttempt++;
      recordRetry = setTimeout(() => { recordRetry = null; writeRecord(lastWritten || store.get().state); }, wait);
      if (recordRetry.unref) recordRetry.unref();
    }
  }

  function recordOk() {
    recordAttempt = 0;
    if (recordRetry) { clearTimeout(recordRetry); recordRetry = null; }
    if (status.record === 'ok') return;
    status.record = 'ok';
    status.recordError = null;
    log('run sheet: the Table Log is written again.');
    broadcast('record-ok', {});
  }

  // Once, at start: a Table Log the loaded state already renders is adopted (a kill after the log
  // write, before its recordHash reached disk); a log that is the server's own last write but behind
  // the state is rewritten (a kill after the state write, before the log's). Anything else waits for
  // the next change, as before.
  function reconcile() {
    const idx = indexNow();
    const rel = logOf(idx);
    // No log yet: a start after a filing that failed, with play already in the state, files it now (#855).
    if (!rel) { if (fileCmd) writeRecord(store.get().state); return; }
    const { model } = loadModel();
    const state = store.get().state;
    const text = fs.readFileSync(path.join(vaultRoot, ...rel.split('/')), 'utf8');
    const fileBody = recordBodyOf(text);
    const fileHash = bodyHash(fileBody);
    const ourBody = tableLogBody(model, state, { linkFor: linkFor(lastIndex || idx) });
    const ours = bodyHash(ourBody);
    // An empty skeleton behind a state with content too: a first log write that failed before a stop.
    const behind = isEmptySkeleton(fileBody) && !isEmptySkeleton(ourBody);
    if (fileHash === ours || (state.recordHash && fileHash === state.recordHash) || behind) writeRecord(state);
  }

  const store = createStore({
    file,
    stateId,
    fs,
    now,
    delayMs: deps.delayMs,
    retryMs: deps.retryMs,
    pid: deps.pid,
    held: deps.lockHeld,
    inCloud: deps.inCloud,
    fresh: () => RS.emptyState({ stateId, session: session.index, plan: session.plan }),
    upgrade: (state) => RS.upgrade(state, RS.emptyState({ stateId, session: session.index, plan: session.plan })),
    onSaved: (rev) => {
      savedRev = rev;
      if (status.saving === 'failing') {
        status.saving = 'ok';
        status.saveError = null;
        log('run sheet: the state is saved again.');
      }
      broadcast('saved', { rev });
    },
    onFailed: (rev, err) => {
      const error = String((err && err.message) || err).split('\n')[0];
      if (status.saving === 'failing' && status.saveError === error) return;
      status.saving = 'failing';
      status.saveError = error;
      log(`run sheet: the state could not be saved (${error}); it is tried again.`);
      broadcast('save-failed', { rev, error });
    },
    onWrite: (state) => { lastWritten = state; writeRecord(state); },
  });
  store.load(); // throws code LOCKED for a session another server holds, IN_CLOUD for a state iCloud took off the disk
  savedRev = store.get().rev; // every rev this server hands out is above it
  if (store.broken) {
    const rel = path.relative(vaultRoot, store.broken).split(path.sep).join('/');
    notices.push({ kind: 'state-broken', path: rel, text: `The saved state did not read; it is kept at ${rel} and the sheet starts fresh.` });
    log(`run sheet: the saved state did not read; it is kept at ${rel}.`);
  }

  // A session from the record, filed before a restart: the vault says so (Q1). The state's `filed` names the index when
  // the pick did not (it is used only when the vault has that index and it links its log), and is set again when the
  // state write after the filing was lost, so the page's title box knows.
  try {
    const saved = store.get().state.filed;
    if (session.fromRecord && !session.index && saved && typeof saved.index === 'string') {
      const idx = indexNow();
      if (idx.has(saved.index) && tableLogOf(idx, saved.index).log) {
        session.index = saved.index;
        session.title = displayTitleOf(idx.read(saved.index).fm || {}, stemOf(saved.index));
      }
    }
    if (session.fromRecord && isFiled(indexNow()) && !(saved && saved.index === session.index)) {
      store.setServer({ filed: { index: session.index, at: (saved && saved.at) || now().toISOString() } });
    }
  } catch (err) {
    log(`run sheet: could not check whether the session is filed (${String((err && err.message) || err).split('\n')[0]}).`);
  }

  // Temp files a crash left beside the Table Log are removed at start.
  try {
    const rel = logOf(indexNow());
    if (rel) {
      const logFile = path.join(vaultRoot, ...rel.split('/'));
      const dir = path.dirname(logFile);
      for (const n of fs.readdirSync(dir)) {
        if (n.startsWith(`${path.basename(logFile)}.tmp-`)) fs.rmSync(path.join(dir, n), { force: true });
      }
    }
  } catch (err) {
    log(`run sheet: could not tidy the Table Log's folder (${String(err.message).split('\n')[0]}).`);
  }
  try { reconcile(); } catch { /* the Plan or the log does not read: the first change tries again */ }

  // --- answers ---------------------------------------------------------------------------------
  const json = (res, status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const plain = (res, status, text, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra });
    res.end(text);
  };
  const sendFile = (res, text, type) => {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
    res.end(text);
  };
  // The model, for a to-hit route: null (and a 404 sent) on a vault that is not GURPS.
  function tohitModel(res) {
    const m = lastModel || loadModel().model;
    if (systemFor(m.system).id === 'gurps-4e') return m;
    json(res, 404, { error: 'the to-hit calculator is for GURPS' });
    return null;
  }
  const webFiles = serve.handler(WEB_DIR, { notFound: NO_PAGE });
  const playersFiles = serve.handler(PLAYERS_DIR, { notFound: NO_PAGE });

  // A picture by its id, for an id in the current or the previous view only. Inside the vault once links
  // are followed, a picture's extension, a file: else 404 with the fixed body, the reason on the terminal.
  function playersPicture(res, id) {
    const notFound = (why) => {
      if (why) log(`run sheet: a players' picture was not served (${why}).`);
      plain(res, 404, 'Not found');
    };
    const rel = players.pics.get(id) || players.before.get(id);
    if (!rel) { notFound(null); return; }
    if (!PICTURE.test(rel) || rel.includes('\0') || rel.includes('\\')) { notFound(`${rel} is not a picture`); return; }
    let data;
    try {
      const real = fs.realpathSync(path.resolve(vaultRoot, ...rel.split('/')));
      if (!within(real, fs.realpathSync(vaultRoot))) { notFound(`${rel} leads outside the vault`); return; }
      if (!fs.statSync(real).isFile()) { notFound(`${rel} is not a file`); return; }
      data = fs.readFileSync(real);
    } catch (err) { notFound(`${rel}: ${(err && err.code) || String((err && err.message) || err).split('\n')[0]}`); return; }
    res.writeHead(200, { 'Content-Type': PICTURE_TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
    res.end(data);
  }
  const vaultFiles = serve.handler(vaultRoot, { notFound: NO_PAGE });
  const sessionInfo = (idx) => ({ label, index: session.index, plan: session.plan, title: session.title, number: session.number, fromRecord: Boolean(session.fromRecord), filed: isFiled(idx), openTitle: opened.title });

  function readBody(req, done) {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => done(tooBig, Buffer.concat(chunks).toString('utf8')));
  }

  // A JSON body for a POST: 415 for another type, 413 over 2 MB, 400 for text that is not JSON.
  function withJson(req, res, then) {
    if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) {
      req.resume();
      json(res, 415, { error: 'the body must be JSON' });
      return;
    }
    readBody(req, (tooBig, text) => {
      if (tooBig) { json(res, 413, { error: 'the body is over 2 MB' }); return; }
      let msg;
      try { msg = JSON.parse(text); } catch { json(res, 400, { error: 'the body is not JSON' }); return; }
      then(msg);
    });
  }

  const ROUTES = [
    { method: 'GET', path: '/', handle: (req, res) => webFiles({ method: 'GET', url: '/gm.html' }, res) },
    { method: 'GET', prefix: '/web/', handle: (req, res, u) => webFiles({ method: 'GET', url: u.raw.slice('/web'.length) }, res) },
    // The GURPS to-hit calculator (Task 24, D7): the site's own script as it is, its styles with the narrow copy, and
    // the data blocks, a PC's from the sheet or a typed skill's. GURPS vaults only; never sent to the players' screen.
    { method: 'GET', path: '/tohit/gurps-tohit.js', handle: (req, res) => sendFile(res, nodeFs.readFileSync(TOHIT_JS, 'utf8'), 'text/javascript; charset=utf-8') },
    { method: 'GET', path: '/tohit/tohit.css', handle: (req, res) => sendFile(res, servedCss(nodeFs.readFileSync(TOHIT_CSS, 'utf8')), 'text/css; charset=utf-8') },
    {
      method: 'GET',
      path: '/api/tohit',
      handle: (req, res, u) => {
        const m = tohitModel(res);
        if (!m) return;
        const idx = index(vaultPath, { deps: vaultDeps });
        const pc = u.query.get('pc');
        // one PC's block, by its note: only a PC of tonight's party
        if (pc !== null) {
          const p = (m.pcs || []).find((x) => x.note === pc);
          const data = p ? pcTohit(idx, p.note, { campaignId: slugify(m.campaign || 'campaign'), pcSlug: pcLiveKey(idx.read(p.note).fm, p.name) }) : null;
          if (!data) { json(res, 404, { error: 'no attack on that sheet' }); return; }
          json(res, 200, { data });
          return;
        }
        json(res, 200, { pcs: (m.pcs || []).filter((p) => pcTohit(idx, p.note)).map((p) => ({ note: p.note, name: p.name })) });
      },
    },
    {
      method: 'POST',
      path: '/api/tohit/typed',
      handle: (req, res) => {
        if (!tohitModel(res)) { req.resume(); return; }
        withJson(req, res, (msg) => {
          let data;
          try { data = typedTohit(msg || {}); } catch (err) { json(res, 400, { error: String(err.message).split('\n')[0] }); return; }
          json(res, 200, { data });
        });
      },
    },
    { method: 'GET', path: '/api/hello', handle: (req, res) => json(res, 200, { app: 'run-sheet', session: label, serverId, pid: process.pid }) },
    {
      method: 'GET',
      path: '/api/model',
      handle: (req, res) => {
        let model;
        let idx;
        if (justRead && Date.now() - justRead.at < FRESH_MS) ({ model, idx } = justRead);
        else {
          try { ({ model, idx } = loadModel()); } catch (err) {
            json(res, 500, { error: String(err.message).split('\n')[0] });
            return;
          }
        }
        justRead = null;
        refreshPlayers();
        json(res, 200, { model: present(model, { index: idx }), session: sessionInfo(idx), stateId, tableLog: logOf(idx), tableLogOnFirst: !!fileCmd, serverId, notices: [...notices, ...statusNotices()] });
      },
    },
    {
      method: 'GET',
      path: '/api/note',
      handle: (req, res, u) => {
        const p = u.query.get('path');
        const idx = indexNow();
        if (!p || !idx.has(p)) { json(res, 404, { error: 'no such note' }); return; }
        const { fm, body } = idx.read(p);
        const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : stemName(p);
        json(res, 200, { path: p, name, type: String(fm.type || ''), portrait: idx.portrait(p), withheld: isWithheld(fm), html: toHtml(body, idx) });
      },
    },
    {
      method: 'GET',
      path: '/api/person',
      handle: (req, res, u) => {
        const p = u.query.get('path');
        const hit = lastModel && (lastModel.cast || []).find((c) => c.note === p);
        if (!hit) { json(res, 404, { error: 'no such person' }); return; }
        json(res, 200, { playAs: hit.playAs || '', wants: hit.wants || '' });
      },
    },
    {
      method: 'GET',
      prefix: '/vault/',
      handle: (req, res, u) => {
        // The same string the file handler resolves: the path alone, without `?` or `#`, decoded.
        const rest = u.raw.slice('/vault'.length);
        let decoded;
        try { decoded = decodeURIComponent(rest); } catch { plain(res, 400, 'Bad request'); return; }
        if (decoded.includes('\0') || decoded.includes('\\')) { plain(res, 403, 'Forbidden'); return; }
        if (decoded.endsWith('/') || !PICTURE.test(decoded)) { plain(res, 404, 'Not found'); return; }
        const resolved = path.resolve(vaultRoot, `.${decoded}`);
        if (!within(resolved, vaultRoot)) { plain(res, 403, 'Forbidden'); return; }
        let isDir = false;
        try { isDir = fs.statSync(resolved).isDirectory(); } catch { /* a miss: the handler says so */ }
        if (isDir) { plain(res, 404, 'Not found'); return; }
        vaultFiles({ method: 'GET', url: rest }, res);
      },
    },
    { method: 'GET', path: '/api/state', handle: (req, res) => { const { state, rev } = store.get(); json(res, 200, { state, rev, stateId, serverId, label }); } },
    {
      method: 'PUT',
      path: '/api/state',
      handle: (req, res) => {
        if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) {
          req.resume();
          json(res, 415, { error: 'the body must be JSON' });
          return;
        }
        readBody(req, (tooBig, text) => {
          if (tooBig) { json(res, 413, { error: 'the body is over 2 MB' }); return; }
          let msg;
          try { msg = JSON.parse(text); } catch { json(res, 400, { error: 'the body is not JSON' }); return; }
          if (!msg || typeof msg !== 'object' || !msg.state || typeof msg.state !== 'object' || Array.isArray(msg.state)) {
            json(res, 400, { error: 'the body needs { stateId, base, state }' });
            return;
          }
          // A page built on another server's revisions (this one restarted) is stale whatever its base
          // says: two unclean restarts can hand out the same rev numbers.
          if (msg.serverId !== undefined && msg.serverId !== serverId && msg.stateId === stateId) {
            json(res, 409, { reason: 'stale', stateId, rev: store.get().rev, label });
            return;
          }
          let r;
          try { r = store.put({ stateId: msg.stateId, base: msg.base, state: msg.state }); } catch (err) {
            json(res, 400, { error: String((err && err.message) || err).split('\n')[0] });
            return;
          }
          if (r.conflict) { json(res, 409, { reason: r.conflict, stateId, rev: r.rev, label }); return; }
          json(res, 200, { rev: r.rev });
          broadcast('state', { rev: r.rev, clientId: typeof msg.clientId === 'string' ? msg.clientId : null });
          refreshPlayers();
          fileSoon();
        });
      },
    },
    {
      method: 'POST',
      path: '/api/roll',
      handle: (req, res) => {
        withJson(req, res, (msg) => {
          if (!msg || !Array.isArray(msg.rolls) || msg.rolls.length > MAX_ROLLS) { json(res, 400, { error: `the body needs { rolls: [...] }, each { sides, mod }, { against: N }, { d100: { target } } or { damage: "2d+1" }, at most ${MAX_ROLLS}` }); return; }
          let results;
          try { results = dice.rollSpecs(msg.rolls, diceOpts); } catch (err) { json(res, 400, { error: String(err.message).split('\n')[0] }); return; }
          json(res, 200, { results });
        });
      },
    },
    {
      method: 'POST',
      path: '/api/actions',
      handle: (req, res) => {
        withJson(req, res, (msg) => {
          if (!msg || !Array.isArray(msg.actions) || msg.actions.length > MAX_ACTIONS) { json(res, 400, { error: `the body needs { stateId, base, actions }, at most ${MAX_ACTIONS} actions` }); return; }
          const before = store.get().rev;
          let r;
          // a throw outside any one action (Review L6): a 400, which the page drops and names, never re-sends
          try { r = store.apply({ stateId: msg.stateId, actions: msg.actions, reduce }); } catch (err) {
            const error = String((err && err.message) || err).split('\n')[0];
            log(`run sheet: ${msg.actions.length} action(s) could not be applied (${error}).`);
            json(res, 400, { error });
            return;
          }
          if (r.conflict) { json(res, 409, { reason: r.conflict, stateId, rev: r.rev, label }); return; }
          for (const x of r.rejected) log(`run sheet: an action could not be applied (${x.type}: ${x.error}).`);
          json(res, 200, { rev: r.rev, state: r.state, rejected: r.rejected });
          if (r.rev !== before) {
            broadcast('state', { rev: r.rev, clientId: typeof msg.clientId === 'string' ? msg.clientId : null });
            refreshPlayers();
            fileSoon();
          }
        });
      },
    },
    {
      method: 'POST',
      path: '/api/settings/side-colours',
      handle: (req, res) => {
        withJson(req, res, (msg) => {
          const own = msg && msg.own;
          const ownOk = own === undefined || (own && typeof own === 'object' && !Array.isArray(own) && Object.keys(own).every((k) => SIDES.includes(k) && typeof own[k] === 'string' && HEX.test(own[k].trim())));
          if (!msg || !PRESETS.includes(msg.preset) || !ownOk) {
            json(res, 400, { error: `the body needs { preset: ${PRESETS.join(' | ')}, own?: { pc, ally, foe, neutral } } with each colour like #2c7739` });
            return;
          }
          // An older site tool stops a player build on a key it does not know under `vault`: only a vault with a site is held.
          // A vault on the old settings layout (siteFileNamedBy gives null) is not gated: applyChanges refuses it outright (OLD_FILE_STOP), so nothing is written there either.
          const site = siteFileNamedBy(vaultRoot);
          if (site && fs.existsSync(site.dir)) {
            let old;
            try { old = siteToolOlderThan(site.dir, SITE_TOOL_FROM, deps.pinCheck ? { pinCheck: deps.pinCheck } : {}); } catch (err) {
              json(res, 409, { error: `the site's publish tool version could not be checked (${String((err && err.message) || err).split('\n')[0].trim()}): nothing was written; try again, or update the site first (gma update)` });
              return;
            }
            if (old) {
              json(res, 409, { error: `the site's publish tool (${old.shown}) is older than ${SITE_TOOL_FROM} and would stop on this setting: update the site first (gma update)` });
              return;
            }
          }
          const changes = [{ op: 'set', name: 'vault.run_sheet.side_colours', value: msg.preset }];
          for (const k of SIDES) if (own && own[k] !== undefined) changes.push({ op: 'set', name: `vault.run_sheet.own_colours.${k}`, value: own[k].trim().toLowerCase() });
          try { applyChanges(vaultRoot, changes); } catch (err) {
            json(res, 400, { error: (err && err.refusals && err.refusals.join('\n')) || String((err && err.message) || err).split('\n')[0] });
            return;
          }
          let model;
          try { ({ model } = loadModel()); } catch {
            // This path skips broadcast and refreshPlayers: other open pages update on their next model fetch.
            let written;
            try { written = readSideColours(readSettings({ vaultPath: vaultRoot, deps: vaultDeps }).values || {}).sideColours; } catch { written = { preset: msg.preset, own: null }; }
            json(res, 200, { sideColours: written, note: 'saved, but the sheet could not be re-read' });
            return;
          }
          json(res, 200, { sideColours: model.sideColours });
          broadcast('side-colours', model.sideColours);
          refreshPlayers();
        });
      },
    },
    {
      method: 'GET',
      path: '/api/record',
      handle: (req, res) => {
        let model;
        let idx;
        try {
          idx = indexNow();
          model = lastModel || loadModel().model;
        } catch (err) { json(res, 500, { error: String(err.message).split('\n')[0] }); return; }
        json(res, 200, { text: tableLogBody(model, store.get().state, { linkFor: linkFor(lastIndex || idx) }) });
      },
    },
    {
      method: 'GET',
      path: '/api/events',
      handle: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
        res.write(`event: hello\ndata: ${JSON.stringify({ serverId, rev: store.get().rev, savedRev, status })}\n\n`);
        clients.add(res);
        const drop = () => clients.delete(res);
        req.on('close', drop);
        res.on('close', drop);
      },
    },
    // --- the players' half: their page, their view, their stream, their pictures. Nothing else. ---
    { method: 'GET', path: '/players', handle: (req, res) => playersFiles({ method: 'GET', url: '/players.html' }, res) },
    // listed before `/players/`, which would take it otherwise
    { method: 'GET', prefix: '/players/pic/', handle: (req, res, u) => playersPicture(res, u.raw.slice('/players/pic/'.length)) },
    { method: 'GET', prefix: '/players/', handle: (req, res, u) => playersFiles({ method: 'GET', url: u.raw.slice('/players'.length) }, res) },
    {
      method: 'GET',
      path: '/api/players/view',
      handle: (req, res) => {
        if (!players.view) refreshPlayers();
        if (!players.view) { json(res, 503, UNAVAILABLE); return; }
        json(res, 200, players.view);
      },
    },
    {
      method: 'GET',
      path: '/api/players/events',
      handle: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
        res.write('event: hello\ndata: {}\n\n');
        playersClients.add(res);
        const drop = () => playersClients.delete(res);
        req.on('close', drop);
        res.on('close', drop);
        // the first build reaches this client through the set; an existing view is sent to it alone
        if (!players.view) refreshPlayers();
        else res.write(`event: view\ndata: ${players.json}\n\n`);
      },
    },
  ];

  const ping = setInterval(() => { for (const res of [...clients, ...playersClients]) res.write(': ping\n\n'); }, deps.pingMs || 15000);
  if (ping.unref) ping.unref();

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      const local = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!local.has(String(req.headers.host || '').toLowerCase())) { plain(res, 403, 'Forbidden'); return; }
      if (req.method === 'OPTIONS') { req.resume(); plain(res, 405, 'Method not allowed'); return; }

      const target = String(req.url || '');
      const raw = target.split('#')[0].split('?')[0];
      const qAt = target.split('#')[0].indexOf('?');
      const u = { raw, query: new URLSearchParams(qAt >= 0 ? target.split('#')[0].slice(qAt + 1) : '') };
      const matches = ROUTES.filter((r) => (r.path ? r.path === raw : raw.startsWith(r.prefix)));
      if (!matches.length) { req.resume(); plain(res, 404, 'Not found'); return; }
      const route = matches.find((r) => r.method === req.method);
      if (!route) { req.resume(); plain(res, 405, 'Method not allowed', { Allow: [...new Set(matches.map((r) => r.method))].join(', ') }); return; }

      // Another site (or another port: same-site) may not frame, embed or fire requests at the sheet.
      // Only a top-level navigation to the page itself is let through, so a link to it still opens.
      const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      if (site === 'cross-site' || site === 'same-site') {
        const navigation = req.method === 'GET' && raw === '/'
          && String(req.headers['sec-fetch-mode'] || '').toLowerCase() === 'navigate'
          && String(req.headers['sec-fetch-dest'] || '').toLowerCase() === 'document';
        if (!navigation) { req.resume(); plain(res, 403, 'Forbidden'); return; }
      }

      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin !== undefined && !new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(String(origin).toLowerCase())) {
          req.resume();
          plain(res, 403, 'Forbidden');
          return;
        }
      }
      route.handle(req, res, u);
    } catch (err) {
      log(`run sheet: ${String((err && err.message) || err).split('\n')[0]}`);
      const raw = String(req.url || '').split('#')[0].split('?')[0];
      const forPlayersRoute = raw === '/players' || raw.startsWith('/players/') || raw.startsWith('/api/players/');
      if (res.headersSent) res.end();
      else if (forPlayersRoute) json(res, 500, UNAVAILABLE);
      else json(res, 500, { error: String((err && err.message) || err).split('\n')[0] });
    }
  });

  let closing = null;
  function close() {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(ping);
      let saveError = null;
      // A filing running now ends first, so the log it files gets the play it was filed for, and no child is left
      // writing the vault after the sheet has stopped.
      let said = false;
      const settle = async () => {
        while (filing) {
          if (!said) { said = true; log("Finishing the session's filing before stopping…"); }
          await filing;
        }
      };
      await settle();
      try { await store.close(); } catch (err) { saveError = err; } // the last write, and its record, land before the end
      await settle(); // the last write may have started one
      // A record write still waiting on its retry gets one last try; if it fails, the next start's
      // reconcile brings the log up to date (it was the server's own last write, or the skeleton).
      if (recordRetry) { clearTimeout(recordRetry); recordRetry = null; if (lastWritten) writeRecord(lastWritten); }
      await settle(); // that last try may have started a filing too
      closed = true;
      if (recordRetry) { clearTimeout(recordRetry); recordRetry = null; }
      for (const res of [...clients, ...playersClients]) res.end();
      clients.clear();
      playersClients.clear();
      await new Promise((resolve) => {
        if (!server.listening) { resolve(); return; }
        server.close(() => resolve());
        if (server.closeAllConnections) server.closeAllConnections();
      });
      if (saveError) throw saveError;
    })();
    return closing;
  }

  server.on('listening', () => { const a = server.address(); if (a && typeof a === 'object') store.lockPort(a.port); });

  return { server, store, close, stateId, serverId, routes: ROUTES };
}

// Listens on 127.0.0.1 only; resolves to the port. A busy port rejects with err.code 'EADDRINUSE'.
function listenLocal(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      server.on('error', (err) => console.error(`run sheet: ${err.message}`));
      resolve(server.address().port);
    });
  });
}

module.exports = { createTableServer, listenLocal, CSP };
