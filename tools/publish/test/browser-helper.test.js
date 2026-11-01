'use strict';
// When the real-browser checks run (test/helpers/browser.js browserSkip): skipped on the Windows CI runner, failing
// rather than skipping on any other CI without a browser, skipped with a reason off CI without one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { browserSkip, withChromeLock, whyNot, CHROME_TIMEOUT_MS } = require('./helpers/browser');

const found = () => '/usr/bin/chromium';
const none = () => null;

test('the Windows CI runner skips the browser checks, with the reason, browser or no browser', () => {
  for (const chrome of [found, none]) {
    const why = browserSkip({ platform: 'win32', env: { CI: 'true' }, chrome });
    assert.match(why, /same on Windows/);
    assert.match(why, /slows every test/);
  }
});

test('CI on Mac and Ubuntu runs the checks, and so fails when no browser is there', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(browserSkip({ platform, env: { CI: 'true' }, chrome: none }), false, platform);
    assert.equal(browserSkip({ platform, env: { CI: 'true' }, chrome: found }), false, platform);
  }
});

test('off CI the checks run where a browser is found and are skipped, with a reason, where none is', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(browserSkip({ platform, env: {}, chrome: found }), false, platform);
    assert.match(browserSkip({ platform, env: {}, chrome: none }), /no Chrome or Chromium found/, platform);
  }
});

// One browser at a time across the test processes (#516).
function privateLock(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'chrome.lock');
}

// Starts `count` processes that each take the lock at `dir`, work for 100 ms and log `in` and `out`; resolves to
// the log lines and fails with a child's own output if any child exits non-zero.
function contend(dir, count) {
  const log = `${dir}.log`;
  const helper = require.resolve('./helpers/browser');
  const script = `const { withChromeLock } = require(${JSON.stringify(helper)});
    const fs = require('fs');
    withChromeLock(() => { fs.appendFileSync(${JSON.stringify(log)}, 'in\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); fs.appendFileSync(${JSON.stringify(log)}, 'out\\n'); }, { dir: ${JSON.stringify(dir)} });`;
  const kids = Array.from({ length: count }, () => require('node:child_process').spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] }));
  return Promise.all(kids.map((k) => new Promise((resolve) => {
    let err = '';
    k.stderr.on('data', (d) => { err += d; });
    k.on('exit', (code) => resolve({ code, err }));
  }))).then((results) => {
    for (const r of results) assert.equal(r.code, 0, r.err);
    return fs.readFileSync(log, 'utf8').trim().split('\n');
  });
}
const alternating = (n) => Array.from({ length: n }, () => ['in', 'out']).flat();

test('the lock is held while the work runs and let go after, even when the work throws', (t) => {
  const dir = privateLock(t);
  withChromeLock(() => assert.ok(fs.existsSync(dir)), { dir });
  assert.ok(!fs.existsSync(dir));
  assert.throws(() => withChromeLock(() => { throw new Error('boom'); }, { dir }), /boom/);
  assert.ok(!fs.existsSync(dir));
});

test('a lock folder that will not go away does not replace the work\'s result or its error', (t) => {
  const dir = privateLock(t);
  const other = privateLock(t);
  const real = fs.rmSync;
  fs.rmSync = (target, ...rest) => {
    if (target === dir || target === other) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return real(target, ...rest);
  };
  try {
    assert.equal(withChromeLock(() => 'answer', { dir }), 'answer');
    assert.throws(() => withChromeLock(() => { throw new Error('boom'); }, { dir: other }), /boom/);
  } finally {
    fs.rmSync = real;
    for (const d of [dir, other]) real(d, { recursive: true, force: true });
  }
});

test('the lock is held until a promise the work returns settles', async (t) => {
  const dir = privateLock(t);
  const run = withChromeLock(() => new Promise((resolve) => setTimeout(resolve, 30)), { dir });
  assert.ok(fs.existsSync(dir));
  await run;
  assert.ok(!fs.existsSync(dir));
});

test('asking again while this process holds the lock just runs the work', (t) => {
  const dir = privateLock(t);
  assert.equal(withChromeLock(() => withChromeLock(() => 'inner', { dir, waitMs: 100 }), { dir }), 'inner');
  assert.ok(!fs.existsSync(dir));
});

test('a lock left by a process that is gone is taken over', (t) => {
  const dir = privateLock(t);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), String(spawnSync(process.execPath, ['-e', '0']).pid));
  assert.equal(withChromeLock(() => 'ran', { dir }), 'ran');
});

test('a lock held by a live process is waited for, and gives up with a plain message', (t) => {
  const dir = privateLock(t);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  assert.throws(() => withChromeLock(() => 'ran', { dir, waitMs: 150 }), /waited 150 ms for another test's browser/);
});

test('two processes asking for the lock never hold it together', async (t) => {
  assert.deepEqual(await contend(privateLock(t), 3), alternating(3));
});

test('six processes against a dead process\'s lock take it over one at a time, and none fails', async (t) => {
  for (let round = 0; round < 5; round++) {
    const dir = privateLock(t);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'pid'), String(spawnSync(process.execPath, ['-e', '0']).pid));
    assert.deepEqual(await contend(dir, 6), alternating(6), `round ${round}`);
  }
});

test('a failed launch is worded with its status, timeout, spawn error and what Chrome said', () => {
  const said = whyNot({ status: null, timedOut: true, error: new Error('spawnSync chrome ETIMEDOUT'), stderr: 'a\nb\nc\nd\n' });
  assert.match(said, /status null, timed out, spawnSync chrome ETIMEDOUT; Chrome said: b \| c \| d/);
});

test('every browser launch has one shared timeout, long enough for a loaded machine', () => {
  assert.equal(CHROME_TIMEOUT_MS, 120000);
});
