const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'with-gurps-pc');
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

// Runs `gm-publish build` for real, so the function-sync block ahead of the build is what is
// under test. The vault file carries one config warning (an override key nothing reads).
function runBuild(extraPublish) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-sync-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.cpSync(FIXTURE, vault, { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: player\n  system: gurps-4e\n  overrides:\n    bogus: 1\n${extraPublish}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs') }));
  const r = spawnSync(process.execPath, [BIN, 'build', '--config', configPath], { encoding: 'utf8', cwd: root });
  return { root, out: `${r.stdout}\n${r.stderr}`, status: r.status };
}

const count = (text, needle) => text.split(needle).length - 1;

describe('the function-sync step of `build`', () => {
  it('copies no function files with both switches off, and each config warning prints once', () => {
    const { root, out, status } = runBuild('');
    assert.strictEqual(status, 0, out);
    assert.ok(!fs.existsSync(path.join(root, 'functions')), 'no functions dir');
    assert.strictEqual(count(out, 'publish.overrides.bogus is not read'), 1, out);
  });

  it('copies the function files with inbox on, and each config warning still prints once', () => {
    const { root, out, status } = runBuild('  inbox: true\n');
    assert.strictEqual(status, 0, out);
    assert.ok(fs.existsSync(path.join(root, 'functions', 'api', 'request.js')), out);
    assert.strictEqual(count(out, 'publish.overrides.bogus is not read'), 1, out);
  });
});
