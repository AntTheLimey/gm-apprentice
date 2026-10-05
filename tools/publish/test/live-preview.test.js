require('./helpers/quiet-legacy-warning.js');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createPreview, refusal } = require('../scripts/live-preview');

// build() narrates every file it writes; keep that out of the test output. Errors still throw.
async function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}
const FIXTURES = path.join(__dirname, 'fixtures');
let work, configPath, preview, base, token;

function scratch(fixture, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-preview-'));
  const vault = path.join(dir, 'vault');
  fs.cpSync(path.join(FIXTURES, fixture || 'with-dnd-pc'), vault, { recursive: true });
  const cfg = path.join(vault, '_meta', 'vault-config.md');
  if (!fixture) fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('system: dnd-5e-2024', 'system: dnd-5e-2024\n  live_stats: true'));
  const p = path.join(dir, 'vault.config.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({
    vaultPath: vault, outputDir: path.join(dir, 'docs'), attachmentsDir: '_attachments', siteTitle: 'D&D Test',
    system: 'dnd-5e-2024', excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
    folderMap: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' },
  }, extra || {}), null, 2));
  return { dir, p };
}

before(async () => {
  ({ dir: work, p: configPath } = scratch());
  preview = await quietly(() => createPreview({ configPath }));
  await new Promise(r => preview.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + preview.server.address().port;
  token = preview.token;
});
after(async () => {
  await new Promise(r => preview.server.close(r));
  fs.rmSync(work, { recursive: true, force: true });
});

test('it refuses a site that could be deployed', () => {
  const { dir, p } = scratch();
  try {
    assert.equal(refusal(p), null);
    fs.writeFileSync(path.join(dir, 'wrangler.toml'), 'name = "x"\n');
    assert.match(refusal(p), /wrangler\.toml/);
    fs.rmSync(path.join(dir, 'wrangler.toml'));
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.writeFileSync(p, JSON.stringify(Object.assign(cfg, { host: 'cloudflare-pages' })));
    assert.match(refusal(p), /host/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('createPreview throws on a deployable site and builds nothing', async () => {
  const { dir, p } = scratch();
  try {
    fs.writeFileSync(path.join(dir, 'wrangler.toml'), 'name = "x"\n');
    await assert.rejects(createPreview({ configPath: p }), /wrangler\.toml/);
    assert.equal(fs.existsSync(path.join(dir, 'docs')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const h = scratch('with-dnd-pc', { host: 'cloudflare-pages' });
  try {
    await assert.rejects(createPreview({ configPath: h.p }), /host/);
    assert.equal(fs.existsSync(path.join(h.dir, 'docs')), false);
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
});

test('a real site\'s output directory is left alone', async () => {
  const { dir, p } = scratch();
  const docs = path.join(dir, 'docs');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, 'marker.txt'), 'keep');
  const pv = await quietly(() => createPreview({ configPath: p }));
  const built = pv.outputDir;
  try {
    await new Promise(r => pv.server.listen(0, '127.0.0.1', r));
    const res = await fetch('http://127.0.0.1:' + pv.server.address().port + '/characters/pcs/brannoch-vale.html');
    assert.equal(res.status, 200);
    assert.notEqual(path.resolve(built), path.resolve(docs));
  } finally {
    await new Promise(r => pv.server.close(r));
  }
  assert.deepEqual(fs.readdirSync(docs), ['marker.txt']);
  assert.equal(fs.readFileSync(path.join(docs, 'marker.txt'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(built), false, 'temp site removed on close');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failure after the build removes the temp site', async () => {
  const { dir, p } = scratch();
  const sites = () => new Set(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('gm-publish-preview-site-')));
  const was = sites();
  try {
    await assert.rejects(quietly(() => createPreview({ configPath: p, handlers: async () => { throw new Error('handlers broke'); } })), /handlers broke/);
    assert.deepEqual([...sites()].filter(n => !was.has(n)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a malformed percent-encoding in the path is a 400', async () => {
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
});

test('the script never reads wrangler.toml or runs wrangler', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'live-preview.js'), 'utf8');
  assert.equal(/readFileSync\([^)]*wrangler/.test(src), false);
  assert.equal(/child_process|spawn|exec|npx/.test(src), false);
});

test('it serves a GURPS site too, with nothing live in the pages', async () => {
  const g = scratch('with-gurps-pc');
  const gp = await quietly(() => createPreview({ configPath: g.p }));
  await new Promise(r => gp.server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch('http://127.0.0.1:' + gp.server.address().port + '/');
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /dnd-live-data/);
  } finally {
    await new Promise(r => gp.server.close(r));
    fs.rmSync(g.dir, { recursive: true, force: true });
  }
});

test('it serves a live PC page', async () => {
  const res = await fetch(base + '/characters/pcs/brannoch-vale.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /id="dnd-live-data"/);
});

test('a path outside the site is not served', async () => {
  const res = await fetch(base + '/..%2f..%2fvault.config.json');
  assert.equal(res.status, 404);
});

test('the store round-trips through the real handlers, and the list sees it', async () => {
  const html = await (await fetch(base + '/characters/pcs/brannoch-vale.html')).text();
  const campaign = JSON.parse(html.match(/id="dnd-live-data">([^<]*)</)[1]).campaignId;
  const key = 'loadout:' + campaign + ':brannoch-vale:dev1';
  const put = await fetch(base + '/api/loadout', { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, state: { v: 1, hp: 20, used: { 'slot:1st': 3 } } }) });
  assert.equal(put.status, 200);
  const got = await (await fetch(base + '/api/loadout?key=' + encodeURIComponent(key))).json();
  assert.equal(got.state.hp, 20);
  assert.equal(typeof got.state.updatedAt, 'number');
  const list = await (await fetch(base + '/api/loadout-list?campaign=' + campaign)).json();
  assert.equal(list.states[key].hp, 20);
  assert.ok(key in await (await fetch(base + '/__store', { headers: { 'x-preview-token': token } })).json());
  assert.equal((await fetch(base + '/api/loadout?key=bad')).status, 400);
});

// The store above holds hp 20 and one 1st-level slot more spent; flush writes them into the note.
test('flush writes the store into the note; a dry run says so and writes nothing', async () => {
  const note = path.join(work, 'vault', 'Characters', 'PCs', 'Brannoch_Vale.md');
  const before = fs.readFileSync(note, 'utf8');
  const dry = await (await fetch(base + '/__flush?dry=1', { method: 'POST', headers: { 'x-preview-token': token } })).text();
  assert.match(dry, /DRY RUN/);
  assert.match(dry, /✓ Brannoch Vale/);
  assert.equal(fs.readFileSync(note, 'utf8'), before);
  const report = await (await fetch(base + '/__flush', { method: 'POST', headers: { 'x-preview-token': token } })).text();
  assert.match(report, /✓ Brannoch Vale/);
  assert.match(report, /HP \(Current\)/);
  assert.doesNotMatch(report, /DRY RUN|✖/);
  const after = fs.readFileSync(note, 'utf8');
  assert.match(after, /\| HP \(Current\) \| 20 \|/);
  assert.match(after, /\| 1st \| 4 \| 3 \|/);
  assert.equal(after.split('\n').length, before.split('\n').length);
});

test('flush without the token, or with a wrong one, is 403 and runs nothing', async () => {
  const note = path.join(work, 'vault', 'Characters', 'PCs', 'Brannoch_Vale.md');
  const was = fs.readFileSync(note, 'utf8');
  for (const headers of [{}, { 'x-preview-token': 'nope' }, { 'x-preview-token': 'a'.repeat(token.length) }]) {
    for (const p of ['/__flush', '/__flush?dry=1']) {
      assert.equal((await fetch(base + p, { method: 'POST', headers })).status, 403);
    }
    assert.equal((await fetch(base + '/__store', { headers })).status, 403);
  }
  assert.equal(fs.readFileSync(note, 'utf8'), was);
  assert.match(token, /^[0-9a-f]{32,}$/);
});

test('a request for a foreign Host is 403', async () => {
  const http = require('http');
  const port = preview.server.address().port;
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers: { Host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
  const ok = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers: { Host: 'localhost:' + port } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(ok, 200);
});

test('a cross-origin write is 403 and stores nothing; the own origin and no origin work', async () => {
  const http = require('http');
  const port = preview.server.address().port;
  const put = (origin, key) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ key, state: { v: 1, hp: 7 } });
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    if (origin) headers.Origin = origin;
    const r = http.request({ host: '127.0.0.1', port, path: '/api/loadout', method: 'PUT', headers }, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject); r.end(body);
  });
  const k = n => 'loadout:camp:x:' + n;
  assert.equal(await put('http://evil.example', k('evil')), 403);
  assert.equal(await put('null', k('null')), 403);
  assert.equal(await put('http://127.0.0.1:' + port, k('own')), 200);
  assert.equal(await put(null, k('none')), 200);
  const store = await (await fetch(base + '/__store', { headers: { 'x-preview-token': token } })).json();
  assert.equal(k('evil') in store, false);
  assert.equal(k('null') in store, false);
  assert.ok(k('own') in store && k('none') in store);
});

test('the token is in no served file', async () => {
  const page = await (await fetch(base + '/characters/pcs/brannoch-vale.html')).text();
  assert.match(page, /id="dnd-live-data"/);
  assert.equal(page.includes(token), false);
  const srcs = [...page.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
  for (const s of srcs) {
    const res = await fetch(new URL(s, base + '/characters/pcs/'));
    assert.equal((await res.text()).includes(token), false);
  }
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(preview.outputDir)) assert.equal(fs.readFileSync(f).includes(token), false, f);
});

test('the change-request inbox is not there', async () => {
  assert.equal((await fetch(base + '/api/request', { method: 'POST' })).status, 404);
});
