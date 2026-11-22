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

// What the page received (#852): the last pointer, click, key and scroll events, each with its target and where
// the page stood, kept on every page from its first script on. A wait that times out prints it beside the
// helper's own last moves, so a lost input says whether it never arrived, landed elsewhere, or did nothing.
const INPUT_LOG = `(() => {
  const log = window.__inputLog = [];
  const name = (e) => { if (!e || !e.tagName) return String(e && e.nodeName || e);
    let s = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '');
    if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.');
    for (const k of Object.keys(e.dataset || {}).slice(0, 2)) s += '[data-' + k + ']';
    return s + (e.isConnected ? '' : '(gone)'); };
  const sheet = () => { const e = document.getElementById('sheet'); return e ? Math.round(e.scrollTop) : null; };
  const keep = (ev) => { log.push({ t: Math.round(performance.now()), type: ev.type, x: ev.clientX, y: ev.clientY, key: ev.key,
    target: name(ev.target), scrollY: Math.round(scrollY), sheet: sheet() }); if (log.length > 40) log.shift(); };
  for (const t of ['pointerdown', 'pointerup', 'click', 'keydown', 'wheel']) window.addEventListener(t, keep, true);
  // A click needs its press and release on one element: a redraw that removes the pressed element between them
  // eats the click. While a press is held, any innerHTML write that removes it is logged with who made it.
  let down = null;
  window.addEventListener('pointerdown', (ev) => { down = ev.target; }, true);
  window.addEventListener('pointerup', () => { const d = down; const e = log[log.length - 1];
    if (e && e.type === 'pointerup' && d) e.downGone = !d.isConnected; setTimeout(() => { if (down === d) down = null; }, 0); }, true);
  const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get: html.get, set(v) {
    const held = down && down.isConnected && this.contains(down);
    html.set.call(this, v);
    if (held) { log.push({ t: Math.round(performance.now()), type: 'pressed element replaced', target: name(this),
      by: String(new Error().stack || '').split('\\n').slice(2, 7).map((s) => s.trim().replace(/https?:\\/\\/[^/]+/, '')).join(' < ') });
      if (log.length > 40) log.shift(); }
  } });
  let last = 0;
  window.addEventListener('scroll', (ev) => { const now = performance.now(); if (now - last > 100) { last = now; keep(ev); } }, true);
})()`;

// Runs `fn(page)` in a fresh headless Chrome of the given size and returns what it returns.
// `page`: goto(url), reload(), evaluate(expr), waitFor(expr, ms), screenshot(file), sleep(ms), key(name, { shift }),
// newTab(url) -> page, resize(width, height); real pointer and text: mouse(type, x, y, { buttons }), click(sel, { holdMs }), drag(x1, y1, x2, y2, steps),
// wheel(x, y, dy), type(text), box(sel), clickAt(x, y, { holdMs }), colorScheme('light'|'dark').
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
      // One page object per attached target; `newTab` makes another on the same pipe.
      const makePage = async (sessionId) => {
        const s = (method, params) => send(method, params, sessionId);
        await s('Page.enable');
        await s('Runtime.enable');
        await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await s('Page.addScriptToEvaluateOnNewDocument', { source: INPUT_LOG });
        // The helper's own last moves, for a timed-out wait to print beside what the page received.
        const t0Page = Date.now();
        const moves = [];
        const moved = (m) => { moves.push({ t: Date.now() - t0Page, ...m }); if (moves.length > 12) moves.shift(); };
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
            if (Date.now() - t0 > ms) {
              let got = null;
              try { got = await evaluate('window.__inputLog ? window.__inputLog.slice(-15) : null'); } catch { /* the page is gone */ }
              throw new Error(`timed out after ${ms} ms waiting for: ${expression}\n  the helper's last moves (ms since the page opened): ${JSON.stringify(moves)}\n  what the page received (ms since it loaded): ${JSON.stringify(got)}`);
            }
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
          // The window's size, changed as a user drags its corner: the page gets a resize event.
          resize: (w, h) => s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }),
          // The page's prefers-color-scheme, as the machine's setting would give it ('light' or 'dark'); it holds across loads.
          colorScheme: (value) => s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }),
          // A headless page has no window focus, so focus and blur fire no events; this makes them fire,
          // for a test of what leaving a box does.
          focusEvents: () => s('Emulation.setFocusEmulationEnabled', { enabled: true }),
          evaluate,
          waitFor,
          sleep,
          async screenshot(file, { full = false } = {}) {
            const r = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
          },
          // A real key press (keyDown, then keyUp) on whatever has focus: Enter, Tab, Escape, or one character.
          // `shift` holds Shift down, so `key('Tab', { shift: true })` goes backwards.
          async key(name, { shift = false } = {}) {
            moved({ act: 'key', name });
            const named = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], Backspace: [8, ''] };
            const one = String(name).length === 1;
            if (!named[name] && !one) throw new Error(`key: no such key ${name}`);
            const [vk, text] = named[name] || [String(name).toUpperCase().charCodeAt(0), name];
            const ev = { key: name, code: one ? `Key${String(name).toUpperCase()}` : name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
            await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...ev, ...(text ? { text, unmodifiedText: text } : {}) });
            await s('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
          },
          // Real pointer input (Input.dispatchMouseEvent), the way a hand moves it. `type` is mouseMoved,
          // mousePressed, mouseReleased or mouseWheel; `buttons` is the bit mask held down (1 = left).
          mouse(type, x, y, { buttons = 0, clickCount = 1, deltaX = 0, deltaY = 0 } = {}) {
            const wheel = type === 'mouseWheel';
            return s('Input.dispatchMouseEvent', {
              type, x, y, buttons,
              button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
              clickCount: type === 'mouseMoved' || wheel ? 0 : clickCount,
              ...(wheel ? { deltaX, deltaY } : {}),
            });
          },
          // An element's bounding rect: x, y, width, height, left, top, right, bottom.
          async box(selector) {
            const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
              const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
            if (!r) throw new Error(`nothing matches ${selector}`);
            return r;
          },
          // A real click at (x, y): move, press, hold `holdMs` (a quick press can slip past code that a real
          // hand's press does not), release.
          async clickAt(x, y, { holdMs = 90 } = {}) {
            let under = null;
            try {
              under = await evaluate(`(() => { const e = document.elementFromPoint(${x}, ${y}); if (!e) return null;
                return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : ''); })()`);
            } catch { /* the page is loading */ }
            moved({ act: 'click', x: Math.round(x), y: Math.round(y), under });
            await page.mouse('mouseMoved', x, y);
            await page.mouse('mousePressed', x, y, { buttons: 1 });
            await sleep(holdMs);
            await page.mouse('mouseReleased', x, y);
          },
          // A real click on an element: scrolls it into view first (scrollIntoView, as a hand would scroll),
          // then clicks its centre, or `offsetX`/`offsetY` from its top-left corner. Throws if the point is
          // still outside the viewport. Returns { x, y, inView, hit }: `hit` is false when something else
          // covers the point (the cover gets the click, as it would under a hand; no error).
          async click(selector, { holdMs = 90, offsetX, offsetY } = {}) {
            await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); })()`);
            const r = await page.box(selector);
            const x = r.left + (offsetX === undefined ? r.width / 2 : offsetX);
            const y = r.top + (offsetY === undefined ? r.height / 2 : offsetY);
            const at = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const top = document.elementFromPoint(${x}, ${y});
              return { inView: ${x} >= 0 && ${y} >= 0 && ${x} < innerWidth && ${y} < innerHeight, hit: Boolean(top) && (top === e || e.contains(top)) }; })()`);
            if (!at.inView) throw new Error(`click ${selector}: the point (${x}, ${y}) is outside the viewport`);
            await page.clickAt(x, y, { holdMs });
            return { x, y, ...at };
          },
          // A real drag: press at the start, `steps` moves with the button held, release at the end.
          async drag(fromX, fromY, toX, toY, steps = 8) {
            moved({ act: 'drag', from: [Math.round(fromX), Math.round(fromY)], to: [Math.round(toX), Math.round(toY)] });
            await page.mouse('mouseMoved', fromX, fromY);
            await page.mouse('mousePressed', fromX, fromY, { buttons: 1 });
            for (let i = 1; i <= steps; i++) {
              await page.mouse('mouseMoved', fromX + ((toX - fromX) * i) / steps, fromY + ((toY - fromY) * i) / steps, { buttons: 1 });
              await sleep(16);
            }
            await page.mouse('mouseReleased', toX, toY);
          },
          // A real wheel turn over (x, y); positive `dy` scrolls down.
          async wheel(x, y, dy) {
            moved({ act: 'wheel', x, y, dy });
            await page.mouse('mouseMoved', x, y);
            await page.mouse('mouseWheel', x, y, { deltaY: dy });
          },
          // Text into whatever has focus (Input.insertText: one insert, as a paste or an input method gives).
          type: (text) => s('Input.insertText', { text }),
          // Another tab in the same browser, opened on `url` (its own event streams, its own page).
          async newTab(url) {
            const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
            const att = await send('Target.attachToTarget', { targetId, flatten: true });
            const tab = await makePage(att.sessionId);
            await tab.goto(url);
            return tab;
          },
        };
        return page;
      };
      const page = await makePage(sessionId);
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
