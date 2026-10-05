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
let work, configPath, preview, base;

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
  assert.ok(key in await (await fetch(base + '/__store')).json());
  assert.equal((await fetch(base + '/api/loadout?key=bad')).status, 400);
});

// D&D write-back is Task 5: until it lands, flush reads the store, finds the PC, and changes nothing.
test('flush reads the in-memory store and reports on the PC; a dry run says so and writes nothing', async () => {
  const note = path.join(work, 'vault', 'Characters', 'PCs', 'Brannoch_Vale.md');
  const before = fs.readFileSync(note, 'utf8');
  const dry = await (await fetch(base + '/__flush?dry=1', { method: 'POST' })).text();
  assert.match(dry, /DRY RUN/);
  assert.equal(fs.readFileSync(note, 'utf8'), before);
  const report = await (await fetch(base + '/__flush', { method: 'POST' })).text();
  assert.match(report, /Brannoch Vale/);
  assert.doesNotMatch(report, /DRY RUN|✖/);
});

test('the change-request inbox is not there', async () => {
  assert.equal((await fetch(base + '/api/request', { method: 'POST' })).status, 404);
});
