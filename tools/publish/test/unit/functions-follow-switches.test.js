const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncSiteFunctions, featuresByFile, SCAFFOLD_FUNCTIONS_DIR } = require('../../lib/sync-functions');
const { runSetupBackend } = require('../../lib/setup-backend');

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

const LIVE = ['api/loadout-core.mjs', 'api/loadout-list.js', 'api/loadout.js'];
const INBOX = ['api/inbox-core.mjs', 'api/request.js'];
const SHARED = ['api/package.json'];

// A site beside a vault whose publish block is `publishYaml`; the site file can carry old keys.
function makeSite(publishYaml, site = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-fn-sw-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  mode: player\n${publishYaml}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault', outputDir: './docs', ...site }));
  return { root, vault, configPath };
}
const listed = (root) => {
  const dir = path.join(root, 'functions');
  const out = [];
  const walk = (d, p) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const r = p ? `${p}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r); } };
  walk(dir, '');
  return out.sort();
};
const run = (s) => {
  const logs = []; const warns = [];
  const result = syncSiteFunctions({ configPath: s.configPath, options: { log: (m) => logs.push(m), warn: (m) => warns.push(m) } });
  return { ...result, logs, warns };
};
const scaffold = (rel) => fs.readFileSync(path.join(SCAFFOLD_FUNCTIONS_DIR, rel));
const put = (root, rel, bytes) => {
  fs.mkdirSync(path.dirname(path.join(root, 'functions', rel)), { recursive: true });
  fs.writeFileSync(path.join(root, 'functions', rel), bytes);
};
const putAll = (root, rels) => rels.forEach((r) => put(root, r, scaffold(r)));

describe('functions: each feature follows its own switch (#285)', () => {
  it('the file-to-feature map is derived from the scaffold imports', () => {
    const map = featuresByFile();
    const of = (f) => [...map.get(f)].sort().join('+');
    for (const f of LIVE) assert.strictEqual(of(f), 'liveStats', f);
    for (const f of INBOX) assert.strictEqual(of(f), 'inbox', f);
    for (const f of SHARED) assert.strictEqual(of(f), 'inbox+liveStats', f);
  });

  it('both on: every file is copied', () => {
    const s = makeSite('  live_stats: true\n  inbox: true\n');
    run(s);
    assert.deepStrictEqual(listed(s.root), [...LIVE, ...INBOX, ...SHARED].sort());
  });

  it('inbox only: the live-stats files are not copied', () => {
    const s = makeSite('  inbox: true\n');
    run(s);
    assert.deepStrictEqual(listed(s.root), [...INBOX, ...SHARED].sort());
  });

  it('live stats only: the inbox files are not copied', () => {
    const s = makeSite('  live_stats: true\n');
    run(s);
    assert.deepStrictEqual(listed(s.root), [...LIVE, ...SHARED].sort());
  });

  it('nothing set: nothing is copied and nothing is removed', () => {
    const s = makeSite('');
    putAll(s.root, [...LIVE, ...INBOX, ...SHARED]);
    const r = run(s);
    assert.deepStrictEqual(listed(s.root), [...LIVE, ...INBOX, ...SHARED].sort());
    assert.deepStrictEqual(r.removed, []);
    assert.deepStrictEqual(r.warns, []);
  });

  it('both explicitly off after being on: the scaffold files go, other files stay, a modified file stays with a warning', () => {
    const s = makeSite('  live_stats: false\n  inbox: false\n');
    putAll(s.root, [...LIVE, ...INBOX, ...SHARED]);
    put(s.root, 'api/mine.js', 'export const x = 1;\n');
    put(s.root, 'other/thing.txt', 'keep\n');
    put(s.root, 'api/request.js', `${scaffold('api/request.js')}// local change\n`);
    const r = run(s);
    assert.deepStrictEqual(listed(s.root), ['api/mine.js', 'api/request.js', 'other/thing.txt']);
    assert.deepStrictEqual(r.removed.sort(), [...LIVE, 'api/inbox-core.mjs', ...SHARED].sort());
    assert.ok(r.logs.some((l) => l.includes('removed functions/api/loadout.js: publish.live_stats is off')), r.logs.join('\n'));
    assert.ok(r.logs.some((l) => l.includes('removed functions/api/inbox-core.mjs: publish.inbox is off')), r.logs.join('\n'));
    assert.strictEqual(r.warns.length, 1);
    assert.ok(r.warns[0].includes('WARNING') && r.warns[0].includes('functions/api/request.js'), r.warns[0]);
    assert.strictEqual(fs.readFileSync(path.join(s.root, 'functions', 'api', 'request.js'), 'utf8'), `${scaffold('api/request.js')}// local change\n`);
  });

  it('sheets off with the inbox on: the live-stats files go, the inbox files stay', () => {
    const s = makeSite('  character_sheets: false\n  live_stats: true\n  inbox: true\n');
    putAll(s.root, [...LIVE, ...INBOX, ...SHARED]);
    const r = run(s);
    assert.deepStrictEqual(listed(s.root), [...INBOX, ...SHARED].sort());
    assert.ok(r.logs.some((l) => l.startsWith('  removed functions/api/loadout-list.js: publish.character_sheets is off')), r.logs.join('\n'));
  });

  it('live stats off by the old site-file name counts as explicit', () => {
    const s = makeSite('  inbox: true\n', { backend: { statusBar: false } });
    putAll(s.root, [...LIVE, ...INBOX, ...SHARED]);
    run(s);
    assert.deepStrictEqual(listed(s.root), [...INBOX, ...SHARED].sort());
  });

  it('an unreadable value counts as explicitly set (off)', () => {
    const s = makeSite('  inbox:\n');
    putAll(s.root, INBOX);
    run(s);
    assert.ok(!fs.existsSync(path.join(s.root, 'functions', 'api', 'request.js')));
  });

  it('a symlinked function file is left alone and named, never followed', () => {
    const s = makeSite('  live_stats: false\n');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-fn-out-'));
    roots.push(outDir);
    const outside = path.join(outDir, 'outside.js');
    fs.writeFileSync(outside, scaffold('api/loadout.js'));
    fs.mkdirSync(path.join(s.root, 'functions', 'api'), { recursive: true });
    fs.symlinkSync(outside, path.join(s.root, 'functions', 'api', 'loadout.js'));
    const r = run(s);
    assert.ok(fs.existsSync(outside));
    assert.ok(fs.lstatSync(path.join(s.root, 'functions', 'api', 'loadout.js')).isSymbolicLink());
    assert.ok(r.warns.some((w) => w.includes('functions/api/loadout.js')), r.warns.join('\n'));
  });

  it('a symlinked api folder pointing outside the site is not entered', () => {
    const s = makeSite('  live_stats: false\n');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-fn-out-'));
    roots.push(outside);
    fs.writeFileSync(path.join(outside, 'loadout.js'), scaffold('api/loadout.js'));
    fs.mkdirSync(path.join(s.root, 'functions'));
    fs.symlinkSync(outside, path.join(s.root, 'functions', 'api'));
    run(s);
    assert.ok(fs.existsSync(path.join(outside, 'loadout.js')));
  });

  it('a stale copy of an on feature is refreshed', () => {
    const s = makeSite('  inbox: true\n');
    put(s.root, 'api/request.js', 'old\n');
    const r = run(s);
    assert.deepStrictEqual(r.updated, ['api/request.js']);
    assert.ok(r.logs.some((l) => l.includes('synced (updated) functions/api/request.js')));
  });

  it('setup-status-bar ends with the live-stats files present, and the inbox files absent', async () => {
    const s = makeSite('');
    fs.writeFileSync(path.join(s.root, 'wrangler.toml'), 'name = "x"\npages_build_output_dir = "docs"\n');
    const deps = {
      out: () => {},
      runWrangler: (args) => {
        if (args[1] === 'namespace' && args[2] === 'list') return { code: 0, stdout: '[]', stderr: '' };
        if (args[1] === 'namespace' && args[2] === 'create') return { code: 0, stdout: 'id = "kv777"', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
      build: () => {},
    };
    const log = console.log;
    console.log = () => {};
    try { assert.strictEqual(await runSetupBackend('status-bar', { configPath: s.configPath }, deps), 0); } finally { console.log = log; }
    assert.deepStrictEqual(listed(s.root), [...LIVE, ...SHARED].sort());
  });
});

describe('the function step as the building commands run it', () => {
  it('an unreadable site file is a warning, not a throw, and removes nothing', () => {
    const { syncSiteFunctionsOrWarn } = require('../../lib/sync-functions');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-fn-bad-'));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, 'vault.config.json'), '{ nope');
    put(dir, 'api/loadout.js', scaffold('api/loadout.js'));
    const warns = [];
    assert.strictEqual(syncSiteFunctionsOrWarn(path.join(dir, 'vault.config.json'), { warn: (m) => warns.push(m) }), null);
    assert.ok(warns[0].includes('Could not sync scaffold Functions'));
    assert.ok(fs.existsSync(path.join(dir, 'functions', 'api', 'loadout.js')));
  });
});
