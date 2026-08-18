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
