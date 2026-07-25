const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { init } = require('../lib/init.js');

test('init scaffolds a Tier-1 wrangler.toml with no KV binding and no Functions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tier1-init-'));
  await init(dir, { siteTitle: 'Dead End', toolDep: 'file:../tool' });

  // wrangler.toml: keeps the deploy config, drops the inbox KV binding.
  const wrangler = await fs.readFile(path.join(dir, 'wrangler.toml'), 'utf8');
  assert.match(wrangler, /pages_build_output_dir = "docs"/);
  assert.match(wrangler, /dead-end/);                 // {{PACKAGE_NAME}} substituted
  assert.doesNotMatch(wrangler, /\[\[kv_namespaces\]\]/);
  assert.doesNotMatch(wrangler, /binding = "INBOX"/);
  assert.doesNotMatch(wrangler, /PUT-YOUR-KV-NAMESPACE-ID-HERE/);

  // Tier-1 ships no Functions.
  await assert.rejects(fs.access(path.join(dir, 'functions')), /ENOENT/);

  // The local build config is gitignored (it holds an absolute vaultPath).
  const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /^vault\.config\.json$/m);
});
