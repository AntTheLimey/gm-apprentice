const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { init } = require('../lib/init.js');

test('init scaffolds the inbox Function and wrangler.toml', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-init-'));
  await init(dir, { siteTitle: 'Dead End', toolDep: 'file:../tool' });

  const core = await fs.readFile(path.join(dir, 'functions/api/inbox-core.mjs'), 'utf8');
  assert.match(core, /export const PREFIX = 'req:'/);

  const request = await fs.readFile(path.join(dir, 'functions/api/request.js'), 'utf8');
  assert.match(request, /onRequestPost/);

  const wrangler = await fs.readFile(path.join(dir, 'wrangler.toml'), 'utf8');
  assert.match(wrangler, /binding = "INBOX"/);
  assert.match(wrangler, /dead-end/);            // {{PACKAGE_NAME}} substituted
  assert.match(wrangler, /pages_build_output_dir = "docs"/);
});
