'use strict';
// When the real-browser checks run (test/helpers/browser.js browserSkip): skipped on the Windows CI runner, failing
// rather than skipping on any other CI without a browser, skipped with a reason off CI without one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { browserSkip, withChromeLock, whyNot, runChrome, measure, browserBefore, CHROME_TIMEOUT_MS, HOLD_MS } = require('./helpers/browser');

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
  assert.equal(withChromeLock(() => withChromeLock(() => 'inner', { dir, holdMs: 100 }), { dir }), 'inner');
  assert.ok(!fs.existsSync(dir));
});

test('a lock left by a process that is gone is taken over', (t) => {
  const dir = privateLock(t);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), String(spawnSync(process.execPath, ['-e', '0']).pid));
  assert.equal(withChromeLock(() => 'ran', { dir }), 'ran');
});

test('a lock one live process keeps past a turn is given up on, with a plain message', (t) => {
  const dir = privateLock(t);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  assert.throws(() => withChromeLock(() => 'ran', { dir, holdMs: 150 }),
    new RegExp(`waited \\d+ s for another test's browser: process ${process.pid} has held it longer than any turn takes`));
});

// #561: a long queue is not a fault. Every turn is bounded, so a waiter waits out any number of them; it gives up only
// on one holder that keeps the browser past a turn.
test('a lock passed from holder to holder is waited for longer than one turn may last', async (t) => {
  const dir = privateLock(t);
  // Six turns of 100 ms, each a new holder, 600 ms in all; the waiter allows one holder 250 ms.
  const turns = `const fs = require('fs'); const path = require('path'); const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let i = 0; i < 6; i++) { try { fs.rmSync(${JSON.stringify(dir)}, { recursive: true, force: true }); } catch {} fs.mkdirSync(${JSON.stringify(dir)}); fs.writeFileSync(path.join(${JSON.stringify(dir)}, 'pid'), String(process.pid)); process.stdout.write(i === 0 ? 'go' : ''); nap(100); }
    fs.rmSync(${JSON.stringify(dir)}, { recursive: true, force: true });`;
  const kid = require('node:child_process').spawn(process.execPath, ['-e', turns], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => kid.stdout.once('data', resolve));
  const started = Date.now();
  assert.equal(withChromeLock(() => 'ran', { dir, holdMs: 250 }), 'ran');
  assert.ok(Date.now() - started >= 300, 'it waited past one holder\'s allowance');
  await new Promise((resolve) => (kid.exitCode !== null ? resolve() : kid.on('exit', resolve)));
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

test('a failed launch says how long it waited for the browser and how long it ran, and how many tries', () => {
  assert.match(whyNot({ status: 2, stderr: '', waitedMs: 45200, launchMs: 3100, tries: 2 }), /^status 2, 2 launches, after 45 s waiting for another test's browser and 3 s launching$/);
  assert.match(whyNot({ status: 0, stderr: '', waitedMs: 10, launchMs: 900, tries: 1 }), /^status 0, after 0 s waiting for another test's browser and 1 s launching$/);
});

test('every browser launch has one shared timeout, long enough for a loaded machine', () => {
  assert.equal(CHROME_TIMEOUT_MS, 120000);
  assert.ok(HOLD_MS >= 2 * CHROME_TIMEOUT_MS, 'a turn may be a launch and its one retry');
});

// #561: Chrome on a loaded machine can exit at once with nothing printed. A launch with no answer that did not run out
// of time is tried once more, in the same turn.
describe('a launch that gives no answer', { skip: process.platform === 'win32' && 'a shell script stands in for Chrome' }, () => {
  const fake = (t, script) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-chrome-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'chrome');
    fs.writeFileSync(file, `#!/bin/sh\nn=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/count"\n${script}\n`);
    fs.chmodSync(file, 0o755);
    return { file, count: () => Number(fs.readFileSync(path.join(dir, 'count'), 'utf8')) };
  };
  const answered = (out) => /ANSWER/.test(out);

  it('is tried once more, and the second answer is used', (t) => {
    const c = fake(t, 'if [ $n -eq 1 ]; then exit 2; fi\necho ANSWER');
    const run = runChrome(['--dump-dom'], { chrome: c.file, answered });
    assert.match(run.stdout, /ANSWER/);
    assert.equal(run.tries, 2);
    assert.equal(c.count(), 2);
    assert.ok(Number.isFinite(run.waitedMs) && Number.isFinite(run.launchMs));
  });

  it('is tried twice at most, and an answer the first time is not tried again', (t) => {
    const never = fake(t, 'exit 2');
    const run = runChrome(['--dump-dom'], { chrome: never.file, answered });
    assert.equal(run.tries, 2);
    assert.equal(never.count(), 2);
    const once = fake(t, 'echo ANSWER');
    assert.equal(runChrome(['--dump-dom'], { chrome: once.file, answered }).tries, 1);
    assert.equal(once.count(), 1);
  });

  // Review: the harness's own script holds the text 'RESULT['+got.join(',')+']END', and --dump-dom prints it. A page
  // whose probes never finished (an empty <pre id="out">) is no answer: tried again, then said with its timings.
  it('a printed harness whose answer is empty is no answer, tried again and said with its timings', (t) => {
    const page = `<html><body><pre id="out"></pre><script>var t=setInterval(function(){document.getElementById('out').textContent='RESULT['+got.join(',')+']END';},100);</script></body></html>`;
    const c = fake(t, `echo '${page.replace(/'/g, "'\\''")}'`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-page-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'p.html'), '<html><head></head><body></body></html>');
    assert.throws(() => measure(path.join(dir, 'p.html'), 400, 'function (done) { done({}); }', { chrome: c.file }),
      /^Error: the browser gave no answer \(status 0, 2 launches, after \d+ s waiting for another test's browser and \d+ s launching/);
    assert.equal(c.count(), 2);
  });

  it('that ran out of time is not tried again', (t) => {
    const slow = fake(t, 'sleep 5');
    const run = runChrome(['--dump-dom'], { chrome: slow.file, answered, timeout: 300 });
    assert.equal(run.timedOut, true);
    assert.equal(run.tries, 1);
  });
});

// #561: node:test reports the tests of a suite whose \`before\` throws as "cancelled" ("test did not finish before its
// parent"), and counts no failure. browserBefore keeps the error and fails each test with it.
test('a browser suite whose measuring fails fails each test with the reason, never a cancel', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'browser-before-')), 'suite.test.js');
  fs.writeFileSync(file, `const { describe, it } = require('node:test');
    const { browserBefore } = require(${JSON.stringify(require.resolve('./helpers/browser'))});
    describe('measured', () => {
      browserBefore(() => { throw new Error('the browser gave no answer (status 2)'); });
      it('one', () => {}); it('two', () => {});
    });`);
  // Run as a test run of its own: NODE_TEST_CONTEXT would make it report to this one.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  assert.match(run.stdout, /# fail 2/);
  assert.match(run.stdout, /# cancelled 0/);
  assert.match(run.stdout, /the browser check did not run: the browser gave no answer \(status 2\)/);
});
