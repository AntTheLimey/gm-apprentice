'use strict';
// A real browser driven over the DevTools protocol, for a page that talks to a live server. The
// `--dump-dom` route in browser.js cannot do this: its virtual time stands still while any request
// is open, and a page with an event stream always has one. Here Chrome runs in real time on a pipe
// (`--remote-debugging-pipe`), and the test clicks, types, reloads and takes screenshots itself.
// Launches take the same lock as every other test browser (withChromeLock) and leave nothing behind:
// the browser is closed (killed if it will not go), its helpers stopped, its profile removed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findChrome, chromeEnv, stopChrome, chromeTempNow, removeNewChromeTemp } = require('../../lib/chrome');
const { withChromeLock, PROFILE_PREFIX, LOCK_DIR } = require('./browser');

const STEP_MS = 30000;

function connect(child) {
  const out = child.stdio[3];
  const inp = child.stdio[4];
  let id = 0;
  let buf = '';
  const waiting = new Map();
  const events = [];
  let closed = null;
  // one decoder for the pipe: a character split across two chunks arrives whole
  inp.setEncoding('utf8');
  inp.on('data', (chunk) => {
    buf += chunk;
    let at;
    while ((at = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      if (msg.id && waiting.has(msg.id)) {
        const w = waiting.get(msg.id);
        waiting.delete(msg.id);
        clearTimeout(w.timer);
        if (msg.error) w.reject(new Error(`${w.method}: ${msg.error.message}`));
        else w.resolve(msg.result);
      } else if (msg.method) events.push(msg);
    }
  });
  // The first cause is kept: once the browser is gone every command fails at once with it.
  const fail = (err) => {
    if (!closed) closed = err;
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(closed); }
    waiting.clear();
  };
  child.on('error', (err) => fail(new Error(`the browser did not start: ${err.message}`)));
  child.on('exit', () => fail(new Error('the browser exited')));
  out.on('error', (err) => fail(new Error(`the pipe to the browser broke: ${err.message}`)));
  inp.on('error', (err) => fail(new Error(`the pipe from the browser broke: ${err.message}`)));
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (closed) { reject(closed); return; }
    const n = ++id;
    const timer = setTimeout(() => { waiting.delete(n); reject(new Error(`${method}: no answer in ${STEP_MS / 1000} s`)); }, STEP_MS);
    waiting.set(n, { resolve, reject, timer, method });
    out.write(`${JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  return { send, events };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Runs `fn(page)` in a fresh headless Chrome of the given size and returns what it returns.
// `page`: goto(url), reload(), evaluate(expr), waitFor(expr, ms), screenshot(file), sleep(ms).
async function withPage({ width = 1449, height = 762, chrome = findChrome() } = {}, fn) {
  if (!chrome) throw new Error('no browser');
  return withChromeLock(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
    // Recorded beside the lock (as launchChrome does), so a stale lock's reaper can end this Chrome;
    // a launch that could not be recorded does not start.
    try { fs.writeFileSync(path.join(LOCK_DIR, 'profile'), profile); } catch (e) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      throw e;
    }
    const before = chromeTempNow();
    const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
      `--user-data-dir=${profile}`, '--remote-debugging-pipe', `--window-size=${width},${height}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: chromeEnv(profile) });
    try {
      const { send } = connect(child);
      const { targetInfos } = await send('Target.getTargets');
      let target = targetInfos.find((t) => t.type === 'page');
      if (!target) target = { targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId };
      const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const s = (method, params) => send(method, params, sessionId);
      await s('Page.enable');
      await s('Runtime.enable');
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const evaluate = async (expression) => {
        const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`in the page: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
        return r.result.value;
      };
      const waitFor = async (expression, ms = 15000) => {
        const t0 = Date.now();
        for (;;) {
          let v = null;
          try { v = await evaluate(expression); } catch { /* the page is loading */ }
          if (v) return v;
          if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${expression}`);
          await sleep(50);
        }
      };
      const page = {
        async goto(url) {
          const r = await s('Page.navigate', { url });
          if (r && r.errorText) throw new Error(`could not open ${url}: ${r.errorText}`);
          return r;
        },
        reload: () => s('Page.reload', { ignoreCache: true }),
        evaluate,
        waitFor,
        sleep,
        async screenshot(file, { full = false } = {}) {
          const r = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
          fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        },
      };
      const result = await fn(page);
      try { await send('Browser.close'); } catch { /* gone already */ }
      return result;
    } finally {
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) { resolve(); return; }
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
        try { child.kill(); } catch { /* gone */ }
      });
      stopChrome(profile);
      removeNewChromeTemp(before);
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

module.exports = { withPage };
