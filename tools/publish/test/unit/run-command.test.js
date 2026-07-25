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
