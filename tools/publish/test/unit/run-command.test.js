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

// #877: on Windows npx and npm are .cmd scripts that spawn cannot start alone, so every wrangler call failed there.
describe('runCommand: npx and npm on Windows', () => {
  const cp = require('node:child_process');
  const modPath = require.resolve('../../lib/run-command');
  const capture = (fn) => {
    const real = cp.spawnSync; const calls = [];
    cp.spawnSync = (...a) => { calls.push(a); return { status: 0, signal: null, stdout: '', stderr: '' }; };
    delete require.cache[modPath];
    try { fn(require('../../lib/run-command')); return calls; } finally { cp.spawnSync = real; delete require.cache[modPath]; }
  };

  it('runs npx through the shell as one line, a path with spaces quoted', () => {
    const calls = capture((m) => m.runCommand('npx', ['wrangler@4', 'pages', 'deploy', 'C:\\My Sites\\docs', '--branch=main'], { platform: 'win32' }));
    assert.strictEqual(calls[0][0], 'npx wrangler@4 pages deploy "C:\\My Sites\\docs" --branch=main');
    assert.strictEqual(calls[0][1].shell, true);
  });

  it('leaves other commands, and npx off Windows, as they were', () => {
    const calls = capture((m) => { m.runCommand('setx', ['A', 'b'], { platform: 'win32' }); m.runCommand('npx', ['wrangler@4'], { platform: 'linux' }); });
    assert.deepStrictEqual(calls.map((c) => [c[0], c[1], c[2].shell]), [['setx', ['A', 'b'], undefined], ['npx', ['wrangler@4'], undefined]]);
  });

  it('really starts npx on this machine (on the Windows runner too)', () => {
    const res = runCommand('npx', ['--version'], { timeoutMs: 60000 });
    assert.strictEqual(res.code, 0, `npx --version failed: ${res.error || res.stderr}`);
    assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+/);
  });
});
