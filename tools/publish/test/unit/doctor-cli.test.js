const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { runDoctor } = require('../../lib/doctor-cli');

const WHOAMI_OK = 'Account ID\n│ x │ a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 │\n';

function wranglerAllGood() {
  return (cmd, args) => {
    const a = args || [];
    if (cmd === 'git') return { code: 0, stdout: 'git version 2.44.0\n', stderr: '' };
    if (cmd === 'npx' && a[1] === '--version') return { code: 0, stdout: 'wrangler 4.20.0\n', stderr: '' };
    if (cmd === 'npx' && a[1] === 'whoami') return { code: 0, stdout: WHOAMI_OK, stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
}

describe('runDoctor default report', () => {
  it('--json emits machine-readable state and returns 0 when all required green', async () => {
    const lines = [];
    const rc = await runDoctor(['--json', '--host', 'cloudflare-pages'], {
      out: (s) => lines.push(s), runCommand: wranglerAllGood(), env: {}, nodeVersion: 'v22.5.0',
    });
    const parsed = JSON.parse(lines.join('\n'));
    assert.strictEqual(parsed.wrangler.accountId, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(rc, 0);
  });

  it('returns 1 and names a fix when a required tool is missing', async () => {
    const lines = [];
    const rc = await runDoctor([], {
      out: (s) => lines.push(s),
      runCommand: () => ({ code: 1, stdout: '', stderr: 'not found' }),
      env: {}, nodeVersion: 'v22.5.0',
    });
    assert.strictEqual(rc, 1);
    assert.ok(lines.join('\n').includes('nodejs.org') || lines.join('\n').toLowerCase().includes('token'));
  });
});

describe('runDoctor --set-cloudflare-creds', () => {
  it('writes token + derived account id to the shell file, never echoes the token, verifies', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc-'));
    const lines = [];
    const env = { SHELL: '/bin/bash' };
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: (s) => lines.push(String(s)),
      runCommand: wranglerAllGood(),
      readStdin: async () => 'super-secret-token\n',
      env, platform: 'linux', homedir: dir,
    });
    const written = fs.readFileSync(path.join(dir, '.bashrc'), 'utf8');
    assert.ok(written.includes('export CLOUDFLARE_API_TOKEN="super-secret-token"'), 'token written to file');
    assert.ok(written.includes('export CLOUDFLARE_ACCOUNT_ID="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"'), 'account id written');
    assert.ok(!lines.join('\n').includes('super-secret-token'), 'token NEVER printed');
    assert.strictEqual(rc, 0);
  });

  it('empty token → error, no write, return 1', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-doc2-'));
    const rc = await runDoctor(['--set-cloudflare-creds'], {
      out: () => {}, runCommand: wranglerAllGood(), readStdin: async () => '   \n',
      env: { SHELL: '/bin/bash' }, platform: 'linux', homedir: dir,
    });
    assert.strictEqual(rc, 1);
    assert.ok(!fs.existsSync(path.join(dir, '.bashrc')), 'nothing written on empty token');
  });
});
