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

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const nodeFs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const serve = require('../serve');
const { readRunSheet } = require('./read');
const { buildIndex, stemOf } = require('./notes');
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

const WEB_DIR = path.join(__dirname, 'web');
const PLAYERS_DIR = path.join(WEB_DIR, 'players');
const PICTURE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
// What every players' route answers on any error: never the error's own words.
const UNAVAILABLE = { error: 'unavailable' };
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const RECORD_RETRY_MS = [2000, 5000, 10000, 30000];
const MAX_BODY = 2 * 1024 * 1024;
const MAX_ROLLS = 64;
const MAX_ACTIONS = 200;
const PICTURE = /\.(jpe?g|png|webp|gif|svg|avif)$/i; // the same list as present.js
// A miss in a served folder is a plain 404, never a 404.html page the folder happens to hold.
const NO_PAGE = '.run-sheet-no-404-page';

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function createTableServer({ vaultPath, session, party = [], stateFile, fileLog = null, deps = {} } = {}) {
  const fs = deps.fs || nodeFs;
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line) => console.error(line));
  const read = deps.readRunSheet || readRunSheet;
  const index = deps.buildIndex || buildIndex;
  const vaultDeps = deps.vaultDeps;
  const serverId = deps.serverId || crypto.randomUUID();
  const stateId = stateIdOf(session);
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
  const status = { saving: 'ok', saveError: null, record: 'ok', recordError: null, players: 'ok', playersError: null };
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
  const logOf = (idx) => tableLogOf(idx, session.index).log;
  const loadModel = () => {
    const idx = index(vaultPath, { deps: vaultDeps });
    const model = read(vaultPath, session.plan, { party, deps: vaultDeps });
    // tonight's Table Log link, when it is refused (another session's log), is a prep note
    const tl = tableLogOf(idx, session.index);
    if (tl.warning && Array.isArray(model.warnings) && !model.warnings.some((w) => w.text === tl.warning.text)) model.warnings.push(tl.warning);
    lastIndex = idx;
    lastModel = model;
    return { model, idx };
  };

  // The Table Log is filed on the first thing that happens at the table (#855): the first write with something in it.
  // A look (reading the Plan, opening beats) leaves no note, so it never puts the session in play. `fileLog` is the
  // `gma vault-write ... table-log-new` command `gma table` hands over, so the note's shape stays the vault scripts'.
  // Without it (the sheet started some other way) there is no Table Log: the state is kept, nothing else written.
  const runFileLog = deps.runFileLog || ((cmd) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    if (r.error) return { ok: false, why: r.error.message };
    const said = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').map((l) => l.trim()).find(Boolean);
    return r.status === 0 ? { ok: true } : { ok: false, why: said || `exit ${r.status}` };
  });
  function fileTableLog(model, state, idx) {
    if (!fileLog || isEmptySkeleton(tableLogBody(model, state, { linkFor: linkFor(idx) }))) return null;
    const done = runFileLog(fileLog);
    lastIndex = index(vaultPath, { deps: vaultDeps });
    const rel = logOf(lastIndex);
    // A command that wrote the note and then failed (a timeout, an exit after the write) has still filed it: the log
    // found is the log, or every retry would be refused with "already has a Table Log".
    if (!done.ok && !rel) throw new Error(`filing it failed: ${done.why}`);
    if (!rel) throw new Error('it was filed, but the session does not link it');
    log(`run sheet: filed the Table Log, ${rel}: the session is in play.`);
    broadcast('record-filed', { path: rel });
    return rel;
  }

  // The Table Log, brought up to date from the state just written.
  function writeRecord(state) {
    if (closed) return;
    try {
      let idx = indexNow();
      let rel = logOf(idx);
      const model = lastModel || loadModel().model;
      if (!rel) {
        rel = fileTableLog(model, state, idx);
        if (!rel) return; // nothing to write yet, or no way to file one: the state is kept
        idx = indexNow();
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
    } catch (err) {
      const error = String((err && err.message) || err).split('\n')[0];
      if (status.record !== 'failing' || status.recordError !== error) {
        status.record = 'failing';
        status.recordError = error;
        log(`run sheet: the Table Log could not be written (${error}); the state is kept${err && err.code === 'NOT_A_TABLE_LOG' ? '' : ' and the write is tried again'}.`);
        broadcast('record-failed', { error });
      }
      if (err && err.code === 'NOT_A_TABLE_LOG') return; // a note that is not a Table Log is never written
      if (!recordRetry && !closed) {
        const wait = recordRetryMs[Math.min(recordAttempt, recordRetryMs.length - 1)];
        recordAttempt++;
        recordRetry = setTimeout(() => { recordRetry = null; writeRecord(lastWritten || store.get().state); }, wait);
        if (recordRetry.unref) recordRetry.unref();
      }
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
    if (!rel) { if (fileLog) writeRecord(store.get().state); return; }
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
  const sessionInfo = () => ({ label, index: session.index, plan: session.plan, title: session.title, number: session.number });

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
    { method: 'GET', path: '/api/hello', handle: (req, res) => json(res, 200, { app: 'run-sheet', session: label, serverId, pid: process.pid }) },
    {
      method: 'GET',
      path: '/api/model',
      handle: (req, res) => {
        let model;
        let idx;
        try { ({ model, idx } = loadModel()); } catch (err) {
          json(res, 500, { error: String(err.message).split('\n')[0] });
          return;
        }
        refreshPlayers();
        json(res, 200, { model: present(model, { index: idx }), session: sessionInfo(), stateId, tableLog: logOf(idx), tableLogOnFirst: !!fileLog, serverId, notices: [...notices, ...statusNotices()] });
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
        const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : stemOf(p);
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
      try { await store.close(); } catch (err) { saveError = err; } // the last write, and its record, land before the end
      // A record write still waiting on its retry gets one last try; if it fails, the next start's
      // reconcile brings the log up to date (it was the server's own last write, or the skeleton).
      if (recordRetry) { clearTimeout(recordRetry); recordRetry = null; if (lastWritten) writeRecord(lastWritten); }
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
