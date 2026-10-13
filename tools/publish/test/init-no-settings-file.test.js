'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');

// `init` writes its own deployment-only vault.config.json, so it can never meet a site file that still holds
// a vault's settings: it makes the vault's new settings file instead. The refusal that names `settings move`
// belongs to the commands that read an existing site folder (setup-inbox and the rest).
test('init on a vault with no settings file makes the new file and says nothing about moving', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'init-nosettings-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  const run = spawnSync(process.execPath, [BIN, 'init', path.join(root, 'site'), '--vault', vault, '--title', 'Hollow'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(vault, '_meta', 'vault-config.yaml')));
  assert.ok(!fs.existsSync(path.join(vault, '_meta', 'vault-config.md')));
  assert.ok(!/settings move|run the update/.test(run.stdout + run.stderr));
  assert.match(run.stdout, /wrote .* to _meta\/vault-config\.yaml/);
});
