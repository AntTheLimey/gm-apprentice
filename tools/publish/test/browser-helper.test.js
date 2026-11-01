'use strict';
// When the real-browser checks run (test/helpers/browser.js browserSkip): skipped on the Windows CI runner, failing
// rather than skipping on any other CI without a browser, skipped with a reason off CI without one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { browserSkip, withChromeLock, CHROME_TIMEOUT_MS } = require('./helpers/browser');

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
const privateLock = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-')), 'chrome.lock');

test('the lock is held while the work runs and let go after, even when the work throws', () => {
  const dir = privateLock();
  withChromeLock(() => assert.ok(fs.existsSync(dir)), { dir });
  assert.ok(!fs.existsSync(dir));
  assert.throws(() => withChromeLock(() => { throw new Error('boom'); }, { dir }), /boom/);
  assert.ok(!fs.existsSync(dir));
});

test('the lock is held until a promise the work returns settles', async () => {
  const dir = privateLock();
  const run = withChromeLock(() => new Promise((resolve) => setTimeout(resolve, 30)), { dir });
  assert.ok(fs.existsSync(dir));
  await run;
  assert.ok(!fs.existsSync(dir));
});

test('a lock left by a process that is gone is taken over', () => {
  const dir = privateLock();
  fs.mkdirSync(dir);
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(path.join(dir, 'pid'), String(gone));
  assert.equal(withChromeLock(() => 'ran', { dir }), 'ran');
});

test('a lock held by a live process is waited for, and gives up with a plain message', () => {
  const dir = privateLock();
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  assert.throws(() => withChromeLock(() => 'ran', { dir, waitMs: 150 }), /waited 150 ms for another test's browser/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two processes asking for the lock never hold it together', () => {
  const dir = privateLock();
  const log = path.join(path.dirname(dir), 'log');
  const helper = require.resolve('./helpers/browser');
  const script = `const { withChromeLock } = require(${JSON.stringify(helper)});
    const fs = require('fs');
    withChromeLock(() => { fs.appendFileSync(${JSON.stringify(log)}, 'in\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); fs.appendFileSync(${JSON.stringify(log)}, 'out\\n'); }, { dir: ${JSON.stringify(dir)} });`;
  const kids = [0, 1, 2].map(() => require('node:child_process').spawn(process.execPath, ['-e', script], { stdio: 'ignore' }));
  return Promise.all(kids.map((k) => new Promise((resolve) => k.on('exit', resolve)))).then(() => {
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['in', 'out', 'in', 'out', 'in', 'out']);
  });
});

test('every browser launch has one shared timeout, long enough for a loaded machine', () => {
  assert.equal(CHROME_TIMEOUT_MS, 120000);
});
