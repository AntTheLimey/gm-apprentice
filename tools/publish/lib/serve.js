'use strict';
// `serve`: an already-built site folder, read only, to the home network. It never builds, watches or asks for a
// passphrase; the folder is the only thing it can reach.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { resolveGmFolder, MARKER_FILE } = require('./gm-site');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// A file that is not there is a plain miss; any other read failure (no permission, a folder, too many open files) is
// said on the console so a broken page at the table has a cause.
const isMissing = (err) => err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
function logRead(err, file) {
  if (!isMissing(err)) console.error(`serve: could not read ${file} (${(err && err.code) || err})`);
}

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

// handler(root, { notFound }) -> (req, res). `notFound` is the name of the page a miss gets (default 404.html).
function handler(root, { notFound = '404.html' } = {}) {
  const lexicalRoot = path.resolve(root);

  function send(req, res, status, type, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const plain = (req, res, status, text, extra) => send(req, res, status, 'text/plain; charset=utf-8', text, extra);

  // The file at `file` when it is a regular file inside the folder once links are followed; 'outside' when a link
  // leads out of the folder; null when there is no such file.
  function readable(file) {
    let real;
    try { real = fs.realpathSync(file); } catch (err) { logRead(err, file); return null; }
    let realRoot;
    try { realRoot = fs.realpathSync(lexicalRoot); } catch (err) { logRead(err, lexicalRoot); return null; }
    if (!within(real, realRoot)) return 'outside';
    try { return fs.statSync(real).isFile() ? real : null; } catch (err) { logRead(err, real); return null; }
  }

  function sendFile(req, res, status, real) {
    let data;
    try { data = fs.readFileSync(real); } catch (err) {
      logRead(err, real);
      if (isMissing(err)) plain(req, res, 404, 'Not found'); else plain(req, res, 500, 'Could not read the file');
      return;
    }
    const type = TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream';
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  function miss(req, res) {
    const page = readable(path.join(lexicalRoot, notFound));
    if (page && page !== 'outside') sendFile(req, res, 404, page);
    else plain(req, res, 404, 'Not found');
  }

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      plain(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    // The URL's path only: never parsed as a full URL, so "//host/x" cannot name another place.
    const target = String(req.url || '');
    const rawPath = target.split('#')[0].split('?')[0];
    if (!rawPath.startsWith('/')) { plain(req, res, 400, 'Bad request'); return; }
    let pathname;
    try { pathname = decodeURIComponent(rawPath); } catch { plain(req, res, 400, 'Bad request'); return; }
    if (pathname.includes('\0')) { plain(req, res, 400, 'Bad request'); return; }
    // A backslash is a separator on some machines and a letter on others: refuse it everywhere.
    if (pathname.includes('\\')) { plain(req, res, 403, 'Forbidden'); return; }

    const resolved = path.resolve(lexicalRoot, `.${pathname}`);
    if (!within(resolved, lexicalRoot)) { plain(req, res, 403, 'Forbidden'); return; }

    let file = resolved;
    let stat = null;
    try { stat = fs.statSync(resolved); } catch { /* a miss, below */ }
    if (stat && stat.isDirectory()) {
      // Relative links in a folder's page only work from the slash form.
      if (!rawPath.endsWith('/')) {
        // Built from where the path landed inside the folder, never from the request text: one leading slash, then
        // the folder's own segments, so a path like "//evil.com/.." cannot name another host.
        const segments = path.relative(lexicalRoot, resolved).split(path.sep).filter(Boolean).map(encodeURIComponent);
        const location = `/${segments.map((s) => `${s}/`).join('')}`;
        // The query string is not carried over: nothing the request text holds goes into the Location.
        res.writeHead(301, { Location: location, 'X-Content-Type-Options': 'nosniff' });
        res.end();
        return;
      }
      file = path.join(resolved, 'index.html');
    }
    const found = readable(file);
    if (found === 'outside') { plain(req, res, 403, 'Forbidden'); return; }
    if (!found) { miss(req, res); return; }
    sendFile(req, res, 200, found);
  };
}

function defaultListen(server, port) {
  return new Promise((resolve, reject) => {
    const onStartError = (err) => {
      reject(err.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is already in use. Pick another with --port.`)
        : err);
    };
    server.once('error', onStartError);
    server.listen(port, '0.0.0.0', () => {
      // From here a server error is logged, not handed to a promise that has already settled.
      server.removeListener('error', onStartError);
      server.on('error', (err) => console.error(`serve: ${err.message}`));
      server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
      resolve();
    });
  });
}

// Where `site` was built: the GM folder (gm_site.folder) or the player site's output folder. The same settings the
// build reads, through the same resolvers.
function folderFor(configPath, site) {
  const configLib = require('./config');
  const resolved = path.resolve(configPath);
  const raw = configLib.loadVaultConfig(resolved);
  const siteDir = path.dirname(resolved);
  const vaultPath = path.resolve(siteDir, raw.vaultPath);
  const { config, publishConfig } = configLib.resolveConfig(raw, vaultPath, () => {},
    site === 'gm' ? { quietStops: true, siteDir, site: 'gm' } : { quietStops: true, siteDir });
  if (site === 'gm') {
    if (!publishConfig.gm || !publishConfig.gm.folder) throw new Error('The GM site has no folder (gm_site.folder).');
    return resolveGmFolder(publishConfig.gm.folder, siteDir);
  }
  return path.resolve(siteDir, configLib.outputFolderOf(config));
}

function builtProblem(folder, site) {
  const marker = site === 'gm' ? MARKER_FILE : 'index.html';
  return fs.existsSync(path.join(folder, marker)) ? null : `There is nothing built in ${folder} yet. Run gm-apprentice-publish build --site ${site} first.`;
}

function validPort(port) {
  const n = typeof port === 'string' && /^\d+$/.test(port) ? Number(port) : port;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

const siteName = (site) => (site === 'gm' ? 'GM' : 'player');
const TRUST_LINE = 'Anyone on this network can open these addresses, players included: serve it only where you trust the network.';

// The checks every serve makes before it starts: the site, the port, and a build in the folder.
function prepare({ configPath, site, port }, deps) {
  if (site !== 'gm' && site !== 'player') throw new Error(`Unknown site: ${site}. Use --site player or --site gm.`);
  const wanted = validPort(port);
  if (wanted === null) throw new Error(`The port must be a whole number from 1 to 65535 (got ${String(port)}).`);
  const folder = (deps.folderFor || folderFor)(configPath, site);
  const problem = builtProblem(folder, site);
  if (problem) throw new Error(problem);
  return { folder, wanted };
}

function alreadyRunning(site, r) {
  return `The ${siteName(site)} site is already being served (pid ${r.pid}${r.background ? ', in the background' : ', from a terminal or task'}), at ${r.urls.join(' ')}`;
}

// Set by `serve --background` for the server it starts: the record says how it runs, and what it prints is not
// written for a terminal.
const BACKGROUND_ENV = 'GM_APPRENTICE_SERVE_BACKGROUND';

// The signals that end a server started in a terminal: Ctrl+C, kill, a closed window, Ctrl+Break on Windows.
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];

// Starts the server and prints where to reach it. Resolves once it is listening; the caller keeps it running.
// With `keepRecord` (the command line) it also writes its record, so `--status` and `--stop` find it, refuses to
// start a second server for the same folder, and stops on a stop request or a stop signal: every connection is
// closed, the record removed, and `closed` resolves.
async function runServe({ configPath, site = 'gm', port = 4321, keepRecord = false } = {}, deps = {}) {
  const out = deps.out || console.log;
  const listen = deps.listen || defaultListen;
  const interfaces = (deps.networkInterfaces || os.networkInterfaces)();
  const { folder, wanted } = prepare({ configPath, site, port }, deps);

  const records = require('./serve-record');
  const env = deps.env || process.env;
  const background = env[BACKGROUND_ENV] === '1';
  const proc = deps.proc || process;
  const rec = keepRecord ? records.recordFor(folder, env) : null;
  if (rec) {
    const running = await records.runningRecord(rec);
    if (running) throw new Error(`${alreadyRunning(site, running)}. Stop it first with serve --stop.`);
    if (!records.claim(rec, proc.pid)) {
      throw new Error(`Another ${siteName(site)} site server is starting, or is not answering. Check with serve --status, or stop it with serve --stop.`);
    }
  }

  const id = crypto.randomBytes(16).toString('hex');
  const files = handler(folder);
  const idPath = `${records.ID_PREFIX}${id}`;
  const server = http.createServer((req, res) => {
    if (rec && req.method === 'GET' && req.url === idPath) { res.writeHead(204); res.end(); return; }
    files(req, res);
  });
  try { await listen(server, wanted); } catch (err) {
    if (rec) records.clearRecord(rec, proc.pid);
    throw err;
  }
  const listening = server.address();
  const actual = listening && typeof listening === 'object' ? listening.port : wanted;

  const addresses = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) addresses.push(a.address);
    }
  }
  const urls = [...addresses.map((a) => `http://${a}:${actual}/`), `http://localhost:${actual}/`];

  let closed = Promise.resolve();
  if (rec) {
    let finish;
    closed = new Promise((r) => { finish = r; });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      clearInterval(watch);
      for (const sig of STOP_SIGNALS) proc.removeListener(sig, stop);
      // A tablet keeps its connection open: close them all, or the server would wait on them.
      server.close(() => { records.clearRecord(rec, proc.pid); finish(); });
      server.closeAllConnections();
    };
    try { fs.rmSync(rec.stop, { force: true }); } catch { /* none left over */ }
    records.writeRecord(rec, { pid: proc.pid, port: actual, site, folder, urls, id, background, started: new Date().toISOString() });
    // A stop request is a file, not a signal: Windows cannot send a background process one it could act on.
    const watch = setInterval(() => { if (fs.existsSync(rec.stop)) stop(); }, deps.stopPollMs || 500);
    for (const sig of STOP_SIGNALS) proc.on(sig, stop);
  }

  out(`Serving the ${siteName(site)} site from ${folder}`);
  for (const url of urls) out(url);
  if (site === 'gm') out(TRUST_LINE);
  out(background ? 'Stop it with serve --stop.' : 'Press Ctrl+C to stop.');
  return { server, urls, closed };
}

// `serve --background`: starts the server as a process of its own, apart from this terminal and from any agent's
// session, so no command limit, closed window or ended chat stops it; only `serve --stop` (or the computer shutting
// down) does. Resolves once it is listening. A server already running for the folder is reported, not doubled.
async function startBackground({ configPath, site = 'gm', port = 4321 } = {}, deps = {}) {
  const out = deps.out || console.log;
  const { folder } = prepare({ configPath, site, port }, deps);
  const records = require('./serve-record');
  const env = deps.env || process.env;
  const rec = records.recordFor(folder, env);
  // One already running: reported when it runs in the background; one in a terminal or an agent's task stops with
  // it, which is what --background is for, so it is named and not taken for a lasting one.
  const report = (running) => {
    if (!running.background) {
      throw new Error(`${alreadyRunning(site, running)}. It stops when that terminal or task ends: stop it with serve --stop, then start it again with serve --background.`);
    }
    out(`${alreadyRunning(site, running)}. It keeps running until serve --stop.`);
    return { pid: running.pid, urls: running.urls, already: true };
  };
  const running = await records.runningRecord(rec);
  if (running) return report(running);

  // Each start has its own output file, so two at once cannot write over each other's reason; earlier ones go.
  fs.mkdirSync(rec.dir, { recursive: true });
  const stem = path.basename(rec.log, '.log');
  for (const f of fs.readdirSync(rec.dir)) {
    if (f.startsWith(`${stem}.`) && f.endsWith('.log')) { try { fs.rmSync(path.join(rec.dir, f), { force: true }); } catch { /* in use */ } }
  }
  const logFile = path.join(rec.dir, `${stem}.${crypto.randomBytes(4).toString('hex')}.log`);
  const log = fs.openSync(logFile, 'w');
  const bin = path.join(__dirname, '..', 'bin', 'gm-publish.js');
  const args = [bin, 'serve', '--site', site, '--port', String(port), '--config', path.resolve(configPath)];
  let child;
  try {
    // detached: its own session (POSIX) or no console (Windows), so whatever ends this process's group leaves it.
    child = (deps.spawn || spawn)(process.execPath, args,
      { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: { ...env, [BACKGROUND_ENV]: '1' } });
  } finally { fs.closeSync(log); }
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  child.on('error', (err) => { exited = { code: null, signal: null, error: err.message }; });
  child.unref();

  const startTimeoutMs = deps.startTimeoutMs || 15000;
  let record = null;
  await records.waitFor(() => {
    const r = records.readRecord(rec);
    if (r && r.pid === child.pid) { record = r; return true; }
    return exited !== null;
  }, startTimeoutMs);
  if (!record) {
    if (exited === null) { try { child.kill(); } catch { /* gone */ } }
    // Another start won the race: report its server.
    const other = await records.runningRecord(rec);
    if (other) return report(other);
    let said = '';
    try { said = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).slice(-3).join(' '); } catch { /* no output */ }
    throw new Error(`The ${siteName(site)} site server did not start${said ? `: ${said}` : (exited ? '' : ` within ${Math.round(startTimeoutMs / 1000)} s`)}`);
  }
  out(`Serving the ${siteName(site)} site from ${folder}, in the background (pid ${record.pid}).`);
  for (const url of record.urls) out(url);
  if (site === 'gm') out(TRUST_LINE);
  out('It keeps running when this terminal or session closes, until serve --stop (or the computer restarts).');
  return { pid: record.pid, urls: record.urls, already: false };
}

// `serve --status`: whether the site is being served, and where.
async function serveStatus({ configPath, site = 'gm' } = {}, deps = {}) {
  const out = deps.out || console.log;
  if (site !== 'gm' && site !== 'player') throw new Error(`Unknown site: ${site}. Use --site player or --site gm.`);
  const records = require('./serve-record');
  const folder = (deps.folderFor || folderFor)(configPath, site);
  const r = await records.runningRecord(records.recordFor(folder, deps.env));
  if (!r) { out(`The ${siteName(site)} site is not being served.`); return { running: false }; }
  out(`The ${siteName(site)} site is being served (pid ${r.pid}, since ${r.started}, ${r.background ? 'in the background until serve --stop' : 'from a terminal or task: it stops when that ends'}):`);
  for (const url of r.urls) out(url);
  return { running: true, pid: r.pid, urls: r.urls };
}

// `serve --stop`: stops the server for the site, however it was started, and says whether the port is free.
async function serveStop({ configPath, site = 'gm' } = {}, deps = {}) {
  const out = deps.out || console.log;
  if (site !== 'gm' && site !== 'player') throw new Error(`Unknown site: ${site}. Use --site player or --site gm.`);
  const records = require('./serve-record');
  const folder = (deps.folderFor || folderFor)(configPath, site);
  const res = await records.stopServer(records.recordFor(folder, deps.env), deps);
  if (!res.stopped && res.pid === undefined) { out(`The ${siteName(site)} site is not being served: nothing to stop.`); return res; }
  if (!res.stopped) throw new Error(`The ${siteName(site)} site server (pid ${res.pid}) would not stop.`);
  out(`Stopped the ${siteName(site)} site server (pid ${res.pid}).${res.portFree ? ` Port ${res.port} is free.` : ` Port ${res.port} is still held by something else.`}`);
  return res;
}

module.exports = { handler, runServe, startBackground, serveStatus, serveStop, folderFor, TYPES, STOP_SIGNALS };
