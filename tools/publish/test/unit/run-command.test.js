const { describe, it } = require('node:test');
const assert = require('node:assert');
const { runCommand } = require('../../lib/run-command');

describe('runCommand', () => {
  it('returns code 0, stdout, and null error for a normal command', () => {
    const res = runCommand(process.execPath, ['-e', 'process.stdout.write("hi")']);
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.stdout, 'hi');
    assert.strictEqual(res.error, null);
  });

  it('times out a stalled child instead of hanging (code 1 + error surfaced)', () => {
    // 60s-sleeping child, 50ms timeout → spawnSync kills it and sets res.error.
    const res = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 50 });
    assert.strictEqual(res.code, 1);
    assert.ok(res.error, 'error code surfaced on timeout');
  });
});

// `npx` exits 0 when it times out the `wrangler` it started; spawnSync reports that only through `error` (#350).
describe('runCommand: a killed child is a failure whatever the status says', () => {
  const cp = require('node:child_process');
  const modPath = require.resolve('../../lib/run-command');
  const withSpawn = (result, fn) => {
    const real = cp.spawnSync;
    cp.spawnSync = () => result;
    delete require.cache[modPath];
    try { return fn(require('../../lib/run-command')); } finally { cp.spawnSync = real; delete require.cache[modPath]; }
  };

  it('status 0 with an error is code 1', () => {
    const err = Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const res = withSpawn({ status: 0, signal: null, error: err, stdout: '', stderr: '' }, (m) => m.runCommand('npx', []));
    assert.strictEqual(res.code, 1);
    assert.strictEqual(res.error, 'ETIMEDOUT');
  });

  it('status 0 with a signal is code 1', () => {
    const res = withSpawn({ status: 0, signal: 'SIGTERM', stdout: '', stderr: '' }, (m) => m.runCommand('npx', []));
    assert.strictEqual(res.code, 1);
    assert.strictEqual(res.signal, 'SIGTERM');
  });

  it('a clean status 0 stays 0, and a real exit code is kept', () => {
    assert.strictEqual(withSpawn({ status: 0, signal: null, stdout: '', stderr: '' }, (m) => m.runCommand('x', [])).code, 0);
    assert.strictEqual(withSpawn({ status: 3, signal: null, stdout: '', stderr: '' }, (m) => m.runCommand('x', [])).code, 3);
  });

  it('the deploy upload bound is ten minutes', () => {
    assert.strictEqual(require('../../lib/run-command').WRANGLER_DEPLOY_TIMEOUT_MS, 600000);
  });
});

// A bounded wrangler call that times out has NOTHING in stdout/stderr — spawnSync
// reports it via `error`. Diagnostics built from stdout/stderr alone therefore come
// out blank, which is the same blank a caller sees on success-with-no-output. The
// timeouts added in #160 are only useful if the resulting failure says something.
describe('failureDetail', () => {
  const { failureDetail } = require('../../lib/run-command');

  it('falls back to the process error when there is no output', () => {
    assert.equal(failureDetail({ code: 1, stdout: '', stderr: '', error: 'ETIMEDOUT' }), 'ETIMEDOUT');
  });

  it('prefers real output over the process error', () => {
    assert.equal(failureDetail({ code: 1, stdout: '', stderr: 'boom', error: 'ETIMEDOUT' }), 'boom');
    assert.equal(failureDetail({ code: 1, stdout: 'out', stderr: '', error: 'ETIMEDOUT' }), 'out');
  });

  it('falls back to the exit code when there is nothing else', () => {
    assert.equal(failureDetail({ code: 3, stdout: '', stderr: '', error: null }), 'exit 3');
  });
});
