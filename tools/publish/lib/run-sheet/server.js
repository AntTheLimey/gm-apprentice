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
// 5b adds rows to ROUTES (`/players`, `/api/players/*`, `/api/roll`) and a `forPlayers` view beside
// `present`; a players' route never sends GM data. The PUT and 409 contract below is the one its
// windows use too.

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
const { tableLogBody, rewriteTableLog, recordBodyOf, bodyHash, needsBackup, linkFor } = require('./record');
const { isWithheld } = require('../processor');
const RS = require('./web/state');

const WEB_DIR = path.join(__dirname, 'web');
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const RECORD_RETRY_MS = [2000, 5000, 10000, 30000];
const MAX_BODY = 2 * 1024 * 1024;
const PICTURE = /\.(jpe?g|png|webp|gif|svg)$/i;
// A miss in a served folder is a plain 404, never a 404.html page the folder happens to hold.
const NO_PAGE = '.run-sheet-no-404-page';

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function createTableServer({ vaultPath, session, party = [], stateFile, deps = {} } = {}) {
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

  const clients = new Set();
  const notices = [];
  let lastModel = null;
  let lastIndex = null;
  let closed = false;
  let recordRetry = null;
  let recordAttempt = 0;
  let keptBody = null;
  const recordRetryMs = deps.recordRetryMs || RECORD_RETRY_MS;
  // What a page that connects now needs to know: is the state being saved, is the record being written.
  const status = { saving: 'ok', saveError: null, record: 'ok', recordError: null };
  const statusNotices = () => [
    ...(status.saving === 'failing' ? [{ kind: 'save-failing', error: status.saveError }] : []),
    ...(status.record === 'failing' ? [{ kind: 'record-failing', error: status.recordError }] : []),
  ];

  function broadcast(event, data) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(chunk);
  }

  const indexNow = () => {
    if (!lastIndex) lastIndex = index(vaultPath, { deps: vaultDeps });
    return lastIndex;
  };
  const logOf = (idx) => tableLogOf(idx, session.index).log;
  const loadModel = () => {
    const idx = index(vaultPath, { deps: vaultDeps });
    const model = read(vaultPath, session.plan, { party, deps: vaultDeps });
    lastIndex = idx;
    lastModel = model;
    return { model, idx };
  };

  // The Table Log, brought up to date from the state just written.
  function writeRecord(state) {
    if (closed) return;
    try {
      const idx = indexNow();
      const rel = logOf(idx);
      if (!rel) return; // no Table Log yet (plan decision 2): the state is kept, nothing else written
      const model = lastModel || loadModel().model;
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
        let name = `${stateId}.table-log-${stamp}.md`;
        for (let i = 2; fs.existsSync(path.join(tableDir, name)); i++) name = `${stateId}.table-log-${stamp}-${i}.md`;
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
        recordRetry = setTimeout(() => { recordRetry = null; writeRecord(store.get().state); }, wait);
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
    if (!rel) return;
    const { model } = loadModel();
    const state = store.get().state;
    const text = fs.readFileSync(path.join(vaultRoot, ...rel.split('/')), 'utf8');
    const fileHash = bodyHash(recordBodyOf(text));
    const ours = bodyHash(tableLogBody(model, state, { linkFor: linkFor(lastIndex || idx) }));
    if (fileHash === ours || (state.recordHash && fileHash === state.recordHash)) writeRecord(state);
  }

  const store = createStore({
    file,
    stateId,
    fs,
    now,
    delayMs: deps.delayMs,
    retryMs: deps.retryMs,
    pid: deps.pid,
    alive: deps.alive,
    fresh: () => RS.emptyState({ stateId, session: session.index, plan: session.plan }),
    upgrade: (state) => RS.upgrade(state, RS.emptyState({ stateId, session: session.index, plan: session.plan })),
    onSaved: (rev) => {
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
    onWrite: (state) => writeRecord(state),
  });
  store.load(); // a session another live server holds throws, code LOCKED
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
        json(res, 200, { model: present(model, { index: idx }), session: sessionInfo(), stateId, tableLog: logOf(idx), serverId, notices: [...notices, ...statusNotices()] });
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
    { method: 'GET', path: '/api/state', handle: (req, res) => { const { state, rev } = store.get(); json(res, 200, { state, rev, stateId, serverId }); } },
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
          let r;
          try { r = store.put({ stateId: msg.stateId, base: msg.base, state: msg.state }); } catch (err) {
            json(res, 400, { error: String((err && err.message) || err).split('\n')[0] });
            return;
          }
          if (r.conflict) { json(res, 409, { reason: r.conflict, stateId, rev: r.rev, label }); return; }
          json(res, 200, { rev: r.rev });
          broadcast('state', { rev: r.rev, clientId: typeof msg.clientId === 'string' ? msg.clientId : null });
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
        res.write(`event: hello\ndata: ${JSON.stringify({ serverId, rev: store.get().rev, status })}\n\n`);
        clients.add(res);
        const drop = () => clients.delete(res);
        req.on('close', drop);
        res.on('close', drop);
      },
    },
  ];

  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, deps.pingMs || 15000);
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
      if (!res.headersSent) json(res, 500, { error: String((err && err.message) || err).split('\n')[0] });
      else res.end();
    }
  });

  let closing = null;
  function close() {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(ping);
      let saveError = null;
      try { await store.close(); } catch (err) { saveError = err; } // the last write, and its record, land before the end
      closed = true;
      if (recordRetry) { clearTimeout(recordRetry); recordRetry = null; }
      for (const res of clients) res.end();
      clients.clear();
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
