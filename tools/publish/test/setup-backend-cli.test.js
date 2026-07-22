const { test } = require('node:test');
const assert = require('node:assert');
const { runSetupBackend } = require('../lib/setup-backend');

function harness(overrides = {}) {
  const files = {
    './vault.config.json': JSON.stringify({
      cloudflarePagesProject: 'proj-x', siteUrl: 'https://proj-x.pages.dev',
      backend: { statusBar: false, inbox: false },
    }),
    'wrangler.toml': 'name = "old"\npages_build_output_dir = "docs"\n',
  };
  const calls = [];
  const deps = {
    out: () => {},
    runWrangler: (args) => {
      calls.push(args.join(' '));
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
  return { deps, files, calls };
}

test('setup-status-bar: creates KV, patches toml, flips flag, builds, deploys', async () => {
  const { deps, files, calls } = harness();
  const rc = await runSetupBackend('status-bar', { configPath: './vault.config.json' }, deps);
  assert.strictEqual(rc, 0);
  assert.match(files['wrangler.toml'], /name = "proj-x"/);        // name aligned
  assert.match(files['wrangler.toml'], /id = "kv777"/);           // KV bound
  assert.match(files['./vault.config.json'], /"statusBar":\s*true/);
  assert.ok(calls.includes('build'));
  assert.ok(calls.some((c) => c.startsWith('pages deploy')));
  // Functions must be synced BEFORE the deploy, else /api/* 404s on a fresh site.
  const syncIdx = calls.findIndex((c) => c.startsWith('sync '));
  const deployIdx = calls.findIndex((c) => c.startsWith('pages deploy'));
  assert.ok(syncIdx !== -1, 'Functions sync ran');
  assert.ok(syncIdx < deployIdx, 'sync ran before deploy');
});

test('setup-inbox flips the inbox flag (and KV is ensured — inbox⇒KV)', async () => {
  const { deps, files } = harness();
  const rc = await runSetupBackend('inbox', { configPath: './vault.config.json' }, deps);
  assert.strictEqual(rc, 0);
  assert.match(files['./vault.config.json'], /"inbox":\s*true/);
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
