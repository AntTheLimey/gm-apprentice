#!/usr/bin/env node
'use strict';
// Local preview of a site with live stats on, for testing the live sheets without
// Cloudflare. It builds the site, serves it on 127.0.0.1, and answers the live-state
// API with the site's own function handlers over a store that lives in memory.
// It never reads the deploy config, never starts a deploy tool, and refuses a site that
// could be deployed. Dev only: not a gm-publish command.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { runFlush } = require('../lib/flush-cli');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// Why this site must not be previewed, or null. A deploy config beside the site is the
// thing the scratch-copy rules forbid, so its presence stops the preview. Only existence
// is checked; the file is never opened.
function refusal(configPath) {
  const resolved = path.resolve(configPath);
  if (fs.existsSync(path.join(path.dirname(resolved), 'wrangler.toml'))) return 'Refusing: wrangler.toml is present beside ' + resolved + '. Preview a scratch copy with it deleted.';
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (raw.host) return 'Refusing: "host" is set in ' + resolved + '. Preview a scratch copy with it removed.';
  return null;
}

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [...store.keys()].map(name => ({ name })) }; },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const loadHandlers = async () => ({
  loadout: await import('../templates-scaffold/functions/api/loadout.js'),
  list: await import('../templates-scaffold/functions/api/loadout-list.js'),
});

// `handlers` is a seam for tests; the real handlers are the default.
async function createPreview({ configPath, handlers = loadHandlers }) {
  const no = refusal(configPath);
  if (no) throw new Error(no);
  const resolved = path.resolve(configPath);
  // Build into a fresh temp directory, never the site's own output directory: a real site's
  // docs/ must not be wiped or filled with pages built as if a store were wired.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-preview-site-'));
  try {
    build({ configPath: resolved, assumeKv: true, outputDirOverride: outputDir });
  } catch (e) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw e;
  }

  const kv = memoryKv();
  const env = { INBOX: kv };
  let loadout, list;
  try {
    ({ loadout, list } = await handlers());
  } catch (e) {
    fs.rmSync(outputDir, { recursive: true, force: true });   // nothing else owns it yet
    throw e;
  }

  async function send(res, response) {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = (req.method === 'PUT' || req.method === 'POST') ? await readBody(req) : undefined;
      // Only the content type is passed on: Node's own hop-by-hop headers are not the handlers' business.
      const headers = req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {};
      const request = new Request(url, { method: req.method, headers, body: body && body.length ? body : undefined });
      if (url.pathname === '/api/loadout' && req.method === 'GET') return send(res, await loadout.onRequestGet({ request, env }));
      if (url.pathname === '/api/loadout' && req.method === 'PUT') return send(res, await loadout.onRequestPut({ request, env }));
      if (url.pathname === '/api/loadout-list' && req.method === 'GET') return send(res, await list.onRequestGet({ request, env }));
      if (url.pathname === '/__store') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(Object.fromEntries(kv.store)));
      }
      if (url.pathname === '/__flush' && req.method === 'POST') {
        const lines = [];
        await runFlush({ configPath: resolved, adapter: kv, out: l => lines.push(l), dryRun: url.searchParams.get('dry') === '1' });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(lines.join('\n') + '\n');
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__')) { res.writeHead(404); return res.end(); }

      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(outputDir, '.' + rel);
      if (file !== outputDir && !file.startsWith(outputDir + path.sep)) { res.writeHead(404); return res.end(); }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(e && e.message || e));
    }
  });
  server.on('close', () => fs.rmSync(outputDir, { recursive: true, force: true }));
  return { server, kv, outputDir };
}

module.exports = { createPreview, refusal };

if (require.main === module) {
  const arg = name => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
  const configPath = arg('--config') || './vault.config.json';
  const port = Number(arg('--port') || 8788);
  createPreview({ configPath }).then(({ server }) => {
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
    server.listen(port, '127.0.0.1', () => {
      console.log('Live preview at http://127.0.0.1:' + port + '/  (store in memory; nothing leaves this machine)');
      console.log('  Flush the store to the vault:  curl -X POST http://127.0.0.1:' + port + '/__flush   (add ?dry=1 to preview)');
    });
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
