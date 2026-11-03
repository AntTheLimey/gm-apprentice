'use strict';
// A real browser for the few checks a vm cannot make (layout: wrapping, stacking, measured lines). It drives an
// installed Chrome or Chromium straight from the command line (no npm package): the page under test is shown in an
// iframe of the width asked for, so its media queries see that width, a probe script written into the page measures it,
// and `--dump-dom` carries the answer out. Without a browser the test is skipped, and says so, except on CI, where
// it fails: CI's runners have one, and a check that skips there is a check that never runs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { findChrome, fileUrl, stopChrome } = require('../../lib/chrome');

// The `skip` for a browser check: a reason without a browser, but never on CI, where the check runs and fails;
// except on the Windows CI runner, where it is always skipped. The checks test Chrome's layout, which is the same
// engine on every system; the Windows job is there for path and shell problems, and a Chrome start there is slow
// enough to slow every test beside it. `platform`, `env` and `chrome` are given to the helper's own test.
function browserSkip({ platform = process.platform, env = process.env, chrome = findChrome } = {}) {
  if (platform === 'win32' && env.CI) return 'real-browser layout checks run on the Mac and Ubuntu CI jobs: the layout engine is the same on Windows, and a Chrome start on the Windows runner slows every test beside it';
  return chrome() || env.CI ? false : 'no Chrome or Chromium found (set GM_TEST_CHROME to point at one)';
}

// One Chrome at a time (#516). `node --test` runs the test files in separate processes at once, and a dozen
// headless Chromes starting beside the other suites' work are slow enough to pass the old per-file timeouts. Every
// launch goes through runChrome: it takes a lock shared by all the test processes, gives the browser its own profile
// folder, and uses one timeout, so a test waits its turn instead of racing the rest for the machine. A test that
// starts Chrome some other way (the `props pages` command) wraps the call in withChromeLock.
// The lock lives in the OS temp folder, so test runs in parallel worktrees on one machine share it and queue for
// Chrome too; that is wanted. A waiter gives up, loudly, after WAIT_MS.
const CHROME_TIMEOUT_MS = 120000;
const LOCK_DIR = path.join(os.tmpdir(), 'gm-publish-test-chrome.lock');
const WAIT_MS = 600000;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Windows and busy disks refuse a removal for a moment; rmSync retries these itself.
const RM_RETRY = { maxRetries: 5, retryDelay: 50 };
// Folder errors that mean "another process is changing it right now" (Windows reports a pending delete as EPERM or
// EACCES): wait and look again.
const BUSY = new Set(['EEXIST', 'ENOENT', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EBUSY']);
const ageOf = (dir) => { try { return Date.now() - fs.statSync(dir).mtimeMs; } catch (_) { return 0; } };

// A lock is stale when its holder is gone. A holder that is alive is waited for however long it takes (the waiter's
// own WAIT_MS bounds that); a folder with no pid yet is its owner mid-write, stale only once it is old.
function lockIsStale(dir) {
  let pid;
  try { pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')); } catch (_) { return ageOf(dir) > 10000; }
  return !alive(pid);
}

// Clears a stale lock. Takeovers are serialised by a second folder, and the verdict is read again inside it, so a
// process that judged the lock stale a moment ago can never remove a fresh lock another process has since taken.
function clearStale(dir) {
  // A removal that still fails after its retries leaves the folder for the next pass of the wait loop.
  const rm = (target) => { try { fs.rmSync(target, { recursive: true, force: true, ...RM_RETRY }); } catch { /* retried next pass */ } };
  const reap = `${dir}.reap`;
  try { fs.mkdirSync(reap); } catch (e) {
    if (!BUSY.has(e.code)) throw e;
    if (ageOf(reap) > 30000) rm(reap);   // its owner died inside the few lines below
    return;
  }
  try {
    if (lockIsStale(dir)) {
      // Its holder died mid-launch (a test process killed on a timeout): end the Chrome it left running (#565).
      let profile = '';
      try { profile = fs.readFileSync(path.join(dir, 'profile'), 'utf8'); } catch (_) { /* never launched */ }
      if (profile) { stopChrome(profile); rm(profile); }
      rm(dir);
    }
  } finally { rm(reap); }
}

// Runs `fn` while holding the lock; when `fn` returns a promise the lock is held until it settles. Called while this
// process already holds the lock, it just runs `fn`. `dir` is the lock folder (the helper's own test gives it a private one).
let held = null;
function withChromeLock(fn, { dir = LOCK_DIR, waitMs = WAIT_MS } = {}) {
  if (held === dir) return fn();
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if (!BUSY.has(e.code)) throw e;
      if (lockIsStale(dir)) clearStale(dir);
      else if (Date.now() > until) throw new Error(`waited ${waitMs} ms for another test's browser to finish`);
      sleep(20);
    }
  }
  held = dir;
  const release = () => {
    held = null;
    // A removal that keeps failing must not replace what `fn` returned or threw; the next waiter reaps a stale lock.
    try { fs.rmSync(dir, { recursive: true, force: true, ...RM_RETRY }); } catch { /* left for clearStale */ }
  };
  let result;
  try { result = fn(); } catch (e) { release(); throw e; }
  if (result && typeof result.then === 'function') return result.finally(release);
  release();
  return result;
}

// Starts headless Chrome on `args` (flags and the address), alone and with a profile of its own, and returns the
// spawnSync result: `stdout` is the printed page, `stderr` Chrome's complaints, `error` why it did not start.
// Chrome can exit non-zero on its way out under load after it has printed the page, so callers read `stdout` rather
// than trusting `status`; `timedOut` says the launch ran out of time. `whyNot(run)` words a failure for a message.
function runChrome(args, { timeout = CHROME_TIMEOUT_MS } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no browser');
  return withChromeLock(() => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-test-chrome-'));
    // Recorded beside the lock, so whoever finds the lock stale can end this Chrome if this process dies (#565).
    try { fs.writeFileSync(path.join(LOCK_DIR, 'profile'), profile); } catch (_) { /* a test's private lock folder */ }
    try {
      const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${profile}`, ...args],
        { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
      run.timedOut = Boolean(run.error && run.error.code === 'ETIMEDOUT');
      return run;
    } finally {
      stopChrome(profile);   // a launch that timed out leaves the browser's helpers running (#565)
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

// Why a launch gave no answer: its exit status, a timeout, the spawn error, the last lines Chrome printed.
function whyNot(run) {
  const tail = String(run.stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 300);
  return `status ${run.status}${run.timedOut ? ', timed out' : ''}${run.error ? `, ${run.error.message}` : ''}${tail ? `; Chrome said: ${tail}` : ''}`;
}

// `script` runs in the page once it has loaded, with `done(result)` to call with a JSON-able answer. A page error
// raised at any time is added to the result as `errors`. Returns the result. Given a list of pages (all in one
// folder), one launch of the browser measures each, side by side, and the results come back as a list.
function measure(pagePaths, width, script, { height = 900, wait = 6000 } = {}) {
  if (!findChrome()) throw new Error('no browser');
  const pages = [].concat(pagePaths);
  const dir = path.dirname(pages[0]);
  // A phone's scrollbars overlay the page; a desktop Chrome's (Linux, Windows) take 15px of the width.
  const head = '<style>::-webkit-scrollbar{width:0;height:0}</style><script>window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(String(e.message))});</script>';
  const tail = `<script>window.addEventListener('load',function(){var finish=function(r){r=r||{};r.errors=window.__errors;`
    + `var p=document.createElement('pre');p.id='probe';p.textContent=JSON.stringify(r);document.body.appendChild(p);};`
    + `setTimeout(function(){(${script})(finish);},600);});</script>`;
  pages.forEach((page, n) => {
    if (path.dirname(page) !== dir) throw new Error('measure: the pages must share a folder');
    const html = fs.readFileSync(page, 'utf8').replace('<head>', `<head>${head}`).replace('</body>', `${tail}</body>`);
    fs.writeFileSync(path.join(dir, `__probe${n}.html`), html);
  });
  const frames = pages.map((_, n) => `<iframe src="__probe${n}.html" style="display:block;border:0;width:${width}px;height:${height}px"></iframe>`).join('');
  const harness = path.join(dir, '__harness.html');
  fs.writeFileSync(harness, `<!doctype html><body style="margin:0">${frames}`
    + `<pre id="out"></pre><script>var t=setInterval(function(){try{var got=[].map.call(document.querySelectorAll('iframe'),function(f){var p=f.contentDocument.getElementById('probe');return p&&p.textContent;});`
    + `if(got.every(Boolean)){document.getElementById('out').textContent='RESULT['+got.join(',')+']END';clearInterval(t);}}catch(e){document.getElementById('out').textContent='RESULT['+JSON.stringify({harnessError:String(e)})+']END';clearInterval(t);}},100);</script>`);
  const run = runChrome(['--allow-file-access-from-files', '--window-size=1200,1000', `--virtual-time-budget=${wait}`, '--dump-dom', fileUrl(harness)]);
  const m = /RESULT([\s\S]*?)END/.exec(run.stdout || '');
  if (!m) throw new Error(`the browser gave no answer (${whyNot(run)})`);
  const text = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const results = JSON.parse(text);
  return Array.isArray(pagePaths) ? results : results[0];
}

module.exports = { findChrome, browserSkip, measure, runChrome, whyNot, withChromeLock, CHROME_TIMEOUT_MS };
