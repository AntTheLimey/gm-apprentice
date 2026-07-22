const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { resolveShellTarget, upsertEnvExport, setPersistentEnv } = require('../../lib/shell-env');

describe('resolveShellTarget', () => {
  it('windows → setx', () => {
    assert.deepStrictEqual(resolveShellTarget({ platform: 'win32', env: {}, homedir: '/h' }), { kind: 'setx' });
  });
  it('zsh → ~/.zshenv', () => {
    assert.deepStrictEqual(
      resolveShellTarget({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, homedir: '/h' }),
      { kind: 'file', path: '/h/.zshenv' });
  });
  it('bash → ~/.bashrc', () => {
    assert.deepStrictEqual(
      resolveShellTarget({ platform: 'linux', env: { SHELL: '/usr/bin/bash' }, homedir: '/h' }),
      { kind: 'file', path: '/h/.bashrc' });
  });
  it('unknown/absent shell → ~/.bashrc', () => {
    assert.deepStrictEqual(
      resolveShellTarget({ platform: 'linux', env: {}, homedir: '/h' }),
      { kind: 'file', path: '/h/.bashrc' });
  });
});

describe('upsertEnvExport', () => {
  it('appends when absent (empty file)', () => {
    assert.strictEqual(upsertEnvExport('', 'FOO', 'bar'), 'export FOO="bar"\n');
  });
  it('appends with a separating newline when file lacks trailing newline', () => {
    assert.strictEqual(upsertEnvExport('# hi', 'FOO', 'bar'), '# hi\nexport FOO="bar"\n');
  });
  it('replaces an existing export in place, no duplicate', () => {
    const before = 'export A="1"\nexport FOO="old"\nexport B="2"\n';
    const after = upsertEnvExport(before, 'FOO', 'new');
    assert.strictEqual(after, 'export A="1"\nexport FOO="new"\nexport B="2"\n');
    assert.strictEqual((after.match(/export FOO=/g) || []).length, 1);
  });
});

describe('setPersistentEnv', () => {
  it('writes an idempotent export to a file target (twice → single line)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-env-'));
    const opts = { platform: 'linux', env: { SHELL: '/bin/bash' }, homedir: dir };
    const t1 = setPersistentEnv('CLOUDFLARE_API_TOKEN', 'tok1', opts);
    assert.deepStrictEqual(t1, { kind: 'file', path: path.join(dir, '.bashrc') });
    setPersistentEnv('CLOUDFLARE_API_TOKEN', 'tok2', opts);
    const content = fs.readFileSync(path.join(dir, '.bashrc'), 'utf8');
    assert.strictEqual((content.match(/export CLOUDFLARE_API_TOKEN=/g) || []).length, 1);
    assert.ok(content.includes('export CLOUDFLARE_API_TOKEN="tok2"'));
  });
  it('setx target invokes runCommand and does not touch a file', () => {
    const calls = [];
    const t = setPersistentEnv('FOO', 'bar', {
      platform: 'win32', env: {}, homedir: '/nope',
      runCommand: (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: '', stderr: '' }; },
    });
    assert.deepStrictEqual(t, { kind: 'setx' });
    assert.deepStrictEqual(calls, [['setx', ['FOO', 'bar']]]);
  });
});
