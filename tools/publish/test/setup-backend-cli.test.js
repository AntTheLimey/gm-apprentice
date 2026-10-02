const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { runSetupBackend } = require('../lib/setup-backend');

// A throwaway vault whose _meta/vault-config.md is where the switch is written.
function tempVault(configText) {
  const vault = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gm-setup-vault-'));
  if (configText !== undefined) {
    fs.mkdirSync(nodePath.join(vault, '_meta'));
    fs.writeFileSync(nodePath.join(vault, '_meta', 'vault-config.md'), configText);
  }
  return vault;
}
const vaultConfig = (vault) => fs.readFileSync(nodePath.join(vault, '_meta', 'vault-config.md'), 'utf8');

function harness(overrides = {}, vault = tempVault('---\ntype: meta\npublish:\n  mode: player\n---\n')) {
  const files = {
    './vault.config.json': JSON.stringify({
      cloudflarePagesProject: 'proj-x', siteUrl: 'https://proj-x.pages.dev', vaultPath: vault,
    }),
    'wrangler.toml': 'name = "old"\npages_build_output_dir = "docs"\n',
  };
  const calls = [];
  const recorded = { deployCwd: undefined };
  const deps = {
    out: () => {},
    runWrangler: (args, opts) => {
      calls.push(args.join(' '));
      if (args[0] === 'pages' && args[1] === 'deploy') recorded.deployCwd = opts && opts.cwd;
      if (args[1] === 'namespace' && args[2] === 'list') return { code: 0, stdout: '[]', stderr: '' };
      if (args[1] === 'namespace' && args[2] === 'create') return { code: 0, stdout: 'id = "kv777"', stderr: '' };
      return { code: 0, stdout: 'https://proj-x.pages.dev', stderr: '' }; // pages deploy
    },
    build: () => { calls.push('build'); },
    syncFunctions: (root) => { calls.push('sync ' + root); },
    readFile: (p) => files[p] ?? files[require('path').basename(p)],
    writeFile: (p, c) => { files[p] = c; files[require('path').basename(p)] = c; },
    ...overrides,
  };
  return { deps, files, calls, recorded, vault };
}

test('setup-status-bar: creates KV, patches toml, flips flag, builds, deploys', async () => {
  const { deps, files, calls, recorded, vault } = harness();
  const rc = await runSetupBackend('status-bar', { configPath: './vault.config.json' }, deps);
  assert.strictEqual(rc, 0);
  assert.match(files['wrangler.toml'], /name = "proj-x"/);        // name aligned
  assert.match(files['wrangler.toml'], /id = "kv777"/);           // KV bound
  assert.match(vaultConfig(vault), /^  live_stats: true$/m);
  assert.doesNotMatch(files['./vault.config.json'], /backend/);   // the site file is not touched
  assert.ok(calls.includes('build'));
  assert.ok(calls.some((c) => c.startsWith('pages deploy')));
  // Bare `pages deploy` must run in the site root so it finds wrangler.toml's
  // pages_build_output_dir; otherwise it errors on a fresh checkout.
  const siteRoot = require('path').dirname(require('path').resolve('./vault.config.json'));
  assert.strictEqual(recorded.deployCwd, siteRoot, 'deploy ran with cwd === siteRoot');
  // Functions must be synced BEFORE the deploy, else /api/* 404s on a fresh site.
  const syncIdx = calls.findIndex((c) => c.startsWith('sync '));
  const deployIdx = calls.findIndex((c) => c.startsWith('pages deploy'));
  assert.ok(syncIdx !== -1, 'Functions sync ran');
  assert.ok(syncIdx < deployIdx, 'sync ran before deploy');
});

test('setup-inbox flips the inbox flag (and KV is ensured — inbox⇒KV)', async () => {
  const { deps, files, vault } = harness();
  const rc = await runSetupBackend('inbox', { configPath: './vault.config.json' }, deps);
  assert.strictEqual(rc, 0);
  assert.match(vaultConfig(vault), /^  inbox: true$/m);
  assert.match(vaultConfig(vault), /^  mode: player$/m);   // other keys untouched
  assert.match(files['wrangler.toml'], /id = "kv777"/);
});

test('stops with the KV-permission fix and does not deploy when the token lacks KV', async () => {
  const { deps, calls } = harness({
    runWrangler: (args) => {
      calls.push(args.join(' '));
      if (args[1] === 'namespace' && args[2] === 'list') return { code: 1, stdout: '', stderr: 'code: 10000' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const rc = await runSetupBackend('status-bar', { configPath: './vault.config.json' }, deps);
  assert.notStrictEqual(rc, 0);
  assert.ok(!calls.some((c) => c.startsWith('pages deploy')));   // never deployed
  assert.ok(!calls.some((c) => c.startsWith('sync ')));          // sync must not run when preflight fails
});

test('idempotent: a second run with KV already bound + flag true still succeeds and does not re-create', async () => {
  const { deps, files, calls } = harness();
  await runSetupBackend('status-bar', { configPath: './vault.config.json' }, deps);
  const before = calls.filter((c) => c.includes('namespace create')).length;
  await runSetupBackend('status-bar', { configPath: './vault.config.json' }, deps);
  const after = calls.filter((c) => c.includes('namespace create')).length;
  assert.strictEqual(after, before);   // no second create (real id now in toml)
});

test('a vault file the edit refuses is the command fails, and nothing deploys', async () => {
  const vault = tempVault('---\npublish: [1, 2\n---\n');
  const lines = [];
  const { deps, calls } = harness({ out: (m) => lines.push(m) }, vault);
  const rc = await runSetupBackend('status-bar', { configPath: './vault.config.json' }, deps);
  assert.strictEqual(rc, 1);
  assert.match(lines.join('\n'), /cannot edit _meta\/vault-config\.md/);
  assert.ok(!calls.some((c) => c.startsWith('pages deploy')));
  assert.ok(!calls.includes('build'));
});
