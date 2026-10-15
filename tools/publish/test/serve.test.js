'use strict';
// tools/publish/test/serve.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { handler, runServe } = require('../lib/serve');
const { buildBoth } = require('./helpers/gm-build');

function request(port, method, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serve', () => {
  let server; let port; let root; let outside; let base; let linked = true;
  before(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serve-')));
    root = path.join(base, 'site');
    outside = path.join(base, 'secret.txt');
    fs.mkdirSync(path.join(root, 'npcs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<p>home</p>');
    fs.writeFileSync(path.join(root, 'npcs', 'index.html'), '<p>npcs</p>');
    fs.writeFileSync(path.join(root, '404.html'), '<p>gone</p>');
    fs.writeFileSync(path.join(root, 'a b.css'), 'x{}');
    fs.writeFileSync(outside, 'TOP SECRET');
    try { fs.symlinkSync(outside, path.join(root, 'link.txt')); } catch { linked = false; }
    server = http.createServer(handler(root));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('serves a page, a folder\'s index and an encoded name', async () => {
    assert.equal((await request(port, 'GET', '/')).body, '<p>home</p>');
    assert.equal((await request(port, 'GET', '/npcs/')).body, '<p>npcs</p>');
    const css = await request(port, 'GET', '/a%20b.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /text\/css/);
    assert.equal(css.headers['x-content-type-options'], 'nosniff');
  });

  it('a folder named without its closing slash goes to the slash form', async () => {
    const r = await request(port, 'GET', '/npcs');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/npcs/');
  });

  for (const p of ['//evil.com/..', '//evil.com/%2e%2e', '//npcs', '/npcs/..', '/%2e%2e', '/npcs?x=1']) {
    it(`a redirect for ${p} never leaves the site`, async () => {
      const r = await request(port, 'GET', p);
      if (r.status === 301) {
        const loc = r.headers.location;
        assert.match(loc, /^\/(?!\/)/, loc);
        assert.doesNotMatch(loc, /evil/);
      } else {
        assert.ok([200, 400, 403, 404].includes(r.status), String(r.status));
      }
    });
  }

  it('every folder redirect keeps one leading slash', async () => {
    const r = await request(port, 'GET', '//evil.com/..');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/');
    const q = await request(port, 'GET', '/npcs?x=1');
    assert.equal(q.headers.location, '/npcs/?x=1');
  });

  it('a miss gets the site\'s 404 page with status 404', async () => {
    const r = await request(port, 'GET', '/nothing.html');
    assert.equal(r.status, 404);
    assert.equal(r.body, '<p>gone</p>');
  });

  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/npcs/%2e%2e%2f%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/..\\secret.txt', '//secret.txt', '/link.txt']) {
    it(`refuses ${p}`, async (t) => {
      if (p === '/link.txt' && !linked) { t.skip('no symlinks on this machine'); return; }
      const r = await request(port, 'GET', p);
      assert.ok([400, 403, 404].includes(r.status), String(r.status));
      assert.doesNotMatch(r.body, /TOP SECRET/);
    });
  }

  it('a link that leads outside the folder is a 403', async (t) => {
    if (!linked) { t.skip('no symlinks on this machine'); return; }
    assert.equal((await request(port, 'GET', '/link.txt')).status, 403);
  });

  it('refuses a malformed escape and a NUL', async () => {
    assert.equal((await request(port, 'GET', '/%E0%A4%A')).status, 400);
    assert.equal((await request(port, 'GET', '/a%00b')).status, 400);
  });

  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    it(`refuses ${method}`, async () => {
      const r = await request(port, method, '/');
      assert.equal(r.status, 405);
      assert.equal(r.headers.allow, 'GET, HEAD');
    });
  }

  it('HEAD sends headers and no body', async () => {
    const r = await request(port, 'HEAD', '/');
    assert.equal(r.status, 200);
    assert.equal(r.body, '');
  });

  it('a site with no 404 page says Not found in plain text', async () => {
    const bare = path.join(base, 'bare');
    fs.mkdirSync(bare);
    const s = http.createServer(handler(bare));
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    try {
      const r = await request(s.address().port, 'GET', '/x');
      assert.equal(r.status, 404);
      assert.equal(r.body, 'Not found');
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe('runServe', () => {
  const lines = [];
  const quiet = { out: (l) => lines.push(l) };
  const localListen = (server) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const stop = (result) => new Promise((r) => result.server.close(r));

  it('refuses a GM folder with no build in it', async () => {
    const built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' }, { sites: ['player'] });
    try {
      await assert.rejects(runServe({ configPath: built.configPath, site: 'gm', port: 4321 }, { ...quiet, listen: localListen }),
        /nothing built in .* yet\. Run gm-apprentice-publish build --site gm first\./);
    } finally { built.cleanup(); }
  });

  it('refuses a player folder with no build in it', async () => {
    const built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' }, { sites: ['gm'] });
    try {
      await assert.rejects(runServe({ configPath: built.configPath, site: 'player' }, { ...quiet, listen: localListen }),
        /nothing built in .* yet\. Run gm-apprentice-publish build --site player first\./);
    } finally { built.cleanup(); }
  });

  for (const bad of [70000, 0, -1, 1.5, 'abc', NaN]) {
    it(`refuses the port ${String(bad)}`, async () => {
      await assert.rejects(runServe({ configPath: 'unused', site: 'gm', port: bad }, { ...quiet, listen: localListen }),
        /port must be a whole number from 1 to 65535/i);
    });
  }

  it('serves the built GM site and lists where to reach it', async () => {
    const built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' });
    lines.length = 0;
    let result;
    try {
      result = await runServe({ configPath: built.configPath, site: 'gm', port: 4321 }, { ...quiet, listen: localListen });
      const port = result.server.address().port;
      assert.ok(result.urls.includes(`http://localhost:${port}/`), result.urls.join(' '));
      assert.ok(lines.some((l) => l.startsWith('Serving the GM site from ') && l.includes(built.gm.dir)), lines.join('\n'));
      assert.ok(lines.includes(`http://localhost:${port}/`));
      assert.equal(lines[lines.length - 1], 'Press Ctrl+C to stop.');
      const home = await request(port, 'GET', '/');
      assert.equal(home.status, 200);
      assert.match(home.body, /gm-apprentice-build/);
    } finally {
      if (result) await stop(result);
      built.cleanup();
    }
  });

  it('serves the built player site', async () => {
    const built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' });
    lines.length = 0;
    let result;
    try {
      result = await runServe({ configPath: built.configPath, site: 'player' }, { ...quiet, listen: localListen });
      assert.ok(lines.some((l) => l.startsWith('Serving the player site from ') && l.includes(built.player.dir)), lines.join('\n'));
      const home = await request(result.server.address().port, 'GET', '/');
      assert.equal(home.status, 200);
      assert.doesNotMatch(home.body, /gm-apprentice-build/);
    } finally {
      if (result) await stop(result);
      built.cleanup();
    }
  });

  it('prints one line per network address', async () => {
    const built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' });
    lines.length = 0;
    let result;
    const networkInterfaces = () => ({
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }],
    });
    try {
      result = await runServe({ configPath: built.configPath, site: 'gm' }, { ...quiet, listen: localListen, networkInterfaces });
      const port = result.server.address().port;
      assert.deepEqual(result.urls, [`http://192.168.1.20:${port}/`, `http://localhost:${port}/`]);
      assert.ok(!lines.some((l) => l.includes('127.0.0.1') || l.includes('fe80')));
    } finally {
      if (result) await stop(result);
      built.cleanup();
    }
  });
});
