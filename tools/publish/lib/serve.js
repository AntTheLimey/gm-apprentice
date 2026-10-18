'use strict';
// `serve`: an already-built site folder, read only, to the home network. It never builds, watches or asks for a
// passphrase; the folder is the only thing it can reach.
const fs = require('node:fs');
const http = require('node:http');
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

// Starts the server and prints where to reach it. Resolves once it is listening; the caller keeps it running.
async function runServe({ configPath, site = 'gm', port = 4321 } = {}, deps = {}) {
  const out = deps.out || console.log;
  const listen = deps.listen || defaultListen;
  const interfaces = (deps.networkInterfaces || os.networkInterfaces)();
  if (site !== 'gm' && site !== 'player') throw new Error(`Unknown site: ${site}. Use --site player or --site gm.`);
  const wanted = validPort(port);
  if (wanted === null) throw new Error(`The port must be a whole number from 1 to 65535 (got ${String(port)}).`);

  const folder = (deps.folderFor || folderFor)(configPath, site);
  const problem = builtProblem(folder, site);
  if (problem) throw new Error(problem);

  const server = http.createServer(handler(folder));
  await listen(server, wanted);
  const listening = server.address();
  const actual = listening && typeof listening === 'object' ? listening.port : wanted;

  const addresses = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) addresses.push(a.address);
    }
  }
  const urls = [...addresses.map((a) => `http://${a}:${actual}/`), `http://localhost:${actual}/`];
  out(`Serving the ${site === 'gm' ? 'GM' : 'player'} site from ${folder}`);
  for (const url of urls) out(url);
  if (site === 'gm') out('Anyone on this network can open these addresses, players included: serve it only where you trust the network.');
  out('Press Ctrl+C to stop.');
  return { server, urls };
}

module.exports = { handler, runServe, folderFor, TYPES };
