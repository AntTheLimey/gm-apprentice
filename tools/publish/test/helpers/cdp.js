'use strict';
// A real browser driven over the DevTools protocol, for a page that talks to a live server. The
// `--dump-dom` route in browser.js cannot do this: its virtual time stands still while any request
// is open, and a page with an event stream always has one. Here Chrome runs in real time on a pipe
// (`--remote-debugging-pipe`), and the test clicks, types, reloads and takes screenshots itself.
// Each page takes the same lock as every other test browser (withChromeLock). One Chrome serves every page a test
// process opens, each in a browser context of its own (its own storage, cookies and tabs), so a file's tests do not
// each pay a launch; it leaves nothing behind: killed with its helpers when the process exits, its profile removed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findChrome, chromeEnv, stopChrome, chromeTempNow, removeNewChromeTemp } = require('../../lib/chrome');
const { withChromeLock, PROFILE_PREFIX, LOCK_DIR } = require('./browser');

const STEP_MS = 30000;

function connect(child, stepMs = STEP_MS) {
  const out = child.stdio[3];
  const inp = child.stdio[4];
  let id = 0;
  let buf = '';
  const waiting = new Map();
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
      }
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
    const timer = setTimeout(() => { waiting.delete(n); reject(new Error(`${method}: no answer in ${stepMs / 1000} s`)); }, stepMs);
    waiting.set(n, { resolve, reject, timer, method });
    out.write(`${JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  return { send };
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
  window.__scrollN = 0;
  window.__scrollAt = 0;
  window.addEventListener('scroll', (ev) => { const now = performance.now(); window.__scrollN++; window.__scrollAt = now;
    if (now - last > 100) { last = now; keep(ev); } }, true);
})()`;

// The test process's one Chrome: { child, profile, send, chrome, stepMs, ours }. `ours` names the Chrome temp files
// (lib/chrome.js's CHROME_TEMP) that appeared during this process's own turns with the lock: only those are removed.
let shared = null;
let exitHooked = false;
const alive = (b) => Boolean(b) && b.child.exitCode === null && !b.child.signalCode;
function removeOurs(b) {
  for (const name of b.ours) {
    try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); } catch { /* gone, or held: left */ }
  }
}
// The file in a shared Chrome's profile naming the test process that owns it. Between that process's turns the lock
// folder is gone, so a stale-lock reaper never learns of this Chrome: a process killed then (Ctrl-C, a harness
// timeout, SIGKILL; no `exit` handler runs) would leave its profile for good. The next launch, inside its own turn,
// ends the Chrome of any profile whose owner is dead and removes it.
const OWNER_FILE = 'gm-owner-pid';
const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
function reapOrphanProfiles(dir = os.tmpdir()) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((name) => name.startsWith(PROFILE_PREFIX)); } catch { return; }
  for (const name of names) {
    const profile = path.join(dir, name);
    let pid;
    // No owner file: a runChrome launch's profile, which the lock's own reaper looks after.
    try { pid = Number(fs.readFileSync(path.join(profile, OWNER_FILE), 'utf8')); } catch { continue; }
    if (!Number.isInteger(pid) || pid <= 0 || pidAlive(pid)) continue;
    try { stopChrome(profile); } catch { /* none left */ }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* left for the next launch */ }
  }
}
function launchShared(chrome, stepMs) {
  reapOrphanProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  try { fs.writeFileSync(path.join(profile, OWNER_FILE), String(process.pid)); } catch (e) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    throw e;
  }
  // Recorded beside the lock (as launchChrome does), so a stale lock's reaper can end this Chrome;
  // a launch that could not be recorded does not start.
  try { fs.writeFileSync(path.join(LOCK_DIR, 'profile'), profile); } catch (e) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    throw e;
  }
  // No component updates or background fetches: an idle Chrome between turns would otherwise keep writing temp
  // files nobody's turn records, and the exit SIGKILL can catch one mid-write.
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    '--disable-component-update', '--disable-background-networking',
    `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: chromeEnv(profile) });
  const { send } = connect(child, stepMs);
  // An idle browser must not keep the test process alive: a command waiting for its answer holds the process
  // through its timer, and the `exit` handler below ends the browser.
  child.unref();
  for (const io of [child.stdio[3], child.stdio[4]]) if (io && io.unref) io.unref();
  shared = { child, profile, send, chrome, stepMs, ours: new Set() };
  if (!exitHooked) {
    exitHooked = true;
    // `exit` handlers run synchronously: the browser is killed outright, then its helpers and files go.
    process.on('exit', () => {
      const b = shared;
      shared = null;
      if (!b) return;
      try { b.child.kill('SIGKILL'); } catch { /* gone */ }
      try { stopChrome(b.profile); } catch { /* gone */ }
      removeOurs(b);
      try { fs.rmSync(b.profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* left */ }
    });
  }
  return shared;
}
// The browser closed (killed if it will not go), its helpers stopped, its files and profile removed.
async function stopShared() {
  const b = shared;
  shared = null;
  if (!b) return;
  await new Promise((resolve) => {
    if (!alive(b)) { resolve(); return; }
    const t = setTimeout(() => { try { b.child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5000);
    b.child.once('exit', () => { clearTimeout(t); resolve(); });
    try { b.child.kill(); } catch { /* gone */ }
  });
  stopChrome(b.profile);
  removeOurs(b);
  fs.rmSync(b.profile, { recursive: true, force: true, maxRetries: 3 });
}

// Runs `fn(page)` in a fresh browser context of the test process's Chrome, at the given size, and returns what it
// returns; the context (its storage and every tab it opened) is thrown away after.
// `page`: goto(url), reload(), evaluate(expr), waitFor(expr, ms), screenshot(file), sleep(ms), key(name, { shift }),
// newTab(url) -> page, resize(width, height); real pointer and text: mouse(type, x, y, { buttons }), click(sel, { holdMs }), drag(x1, y1, x2, y2, steps),
// wheel(x, y, dy), type(text), box(sel), clickAt(x, y, { holdMs }), choose(sel, text) (a native select), colorScheme('light'|'dark').
async function withPage({ width = 1449, height = 762, chrome = findChrome(), stepMs = STEP_MS } = {}, fn) {
  if (!chrome) throw new Error('no browser');
  return withChromeLock(async () => {
    const turnBefore = chromeTempNow();
    let send = null;
    let ctx = null;
    let browser = null;
    try {
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
              // what the page shows now: the Saved indicator, the probe as it stands, and any error its probe threw
              let live = null;
              try { live = await evaluate(`({ saved: (document.getElementById('saved') || {}).textContent, probe: (document.body.dataset.probe || '').slice(0, 1500), probeError: document.body.dataset.probeError || null, focus: (() => { const a = document.activeElement; return a ? { tag: a.tagName, id: a.id || undefined, value: a.value, selection: [a.selectionStart, a.selectionEnd], invalid: a.getAttribute('aria-invalid'), committed: a.dataset ? a.dataset.committed : undefined } : null; })(), secondLines: Array.from(document.querySelectorAll('li[data-row2]'), (e) => e.dataset.row2 + ': ' + e.textContent).slice(0, 12) })`); } catch { /* the page is gone */ }
              throw new Error(`timed out after ${ms} ms waiting for: ${expression}\n  the page now (#saved text, body.dataset.probe, body.dataset.probeError, the focused box, the rows' second lines): ${JSON.stringify(live)}\n  the helper's last moves (ms since the page opened): ${JSON.stringify(moves)}\n  what the page received (ms since it loaded): ${JSON.stringify(got)}`);
            }
            await sleep(50);
          }
        };
        let lastChosen = 0; // when `choose` last typed
        let lastClick = 0; // when a click last released
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
          // A real key press (keyDown, then keyUp) on whatever has focus: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, Home, or one character.
          // `shift` holds Shift down, so `key('Tab', { shift: true })` goes backwards.
          async key(name, { shift = false } = {}) {
            moved({ act: 'key', name });
            const named = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], Backspace: [8, ''], ArrowDown: [40, ''], ArrowUp: [38, ''], Home: [36, ''] };
            const one = String(name).length === 1;
            if (!named[name] && !one) throw new Error(`key: no such key ${name}`);
            const [vk, text] = named[name] || [String(name).toUpperCase().charCodeAt(0), name];
            const ev = { key: name, code: one ? `Key${String(name).toUpperCase()}` : name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
            await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...ev, ...(text ? { text, unmodifiedText: text } : {}) });
            await s('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
          },
          // Chooses the option of a native <select> whose text starts with `text`, by real input only. A held click
          // focuses the select; `text` is typed as real key events, quickly (the browser's type-to-select match resets
          // after a pause), and the select's value is read. If it did not change to the wanted option, ArrowDown (which
          // changes a closed select on Windows and Linux) steps on, reading again, until the option is chosen or the
          // list ends. Letters pick the first option that starts with them, so type far enough to be unique ("All"
          // for All-Out Attack (Determined), "(Do" for All-Out Attack (Double)). Fails naming the system when
          // neither route moved it. Returns the chosen option's text.
          async choose(selector, text) {
            const sel = JSON.stringify(selector);
            const want = JSON.stringify(String(text).toLowerCase());
            const read = () => evaluate(`(() => { const e = document.querySelector(${sel}); if (!e) return null;
              const o = e.options[e.selectedIndex]; return { value: e.value, text: o ? o.textContent.trim() : '', at: e.selectedIndex,
              wanted: o ? o.textContent.trim().toLowerCase().startsWith(${want}) : false,
              exists: Array.from(e.options).some((x) => x.textContent.trim().toLowerCase().startsWith(${want})) }; })()`);
            const first = await read();
            if (!first) throw new Error(`choose: nothing matches ${selector}`);
            if (!first.exists) throw new Error(`choose: ${selector} has no option starting "${text}"`);
            await page.click(selector);
            moved({ act: 'choose', selector, text: String(text) });
            // the browser keeps what was typed for a second: letters from an earlier choose would join these
            await sleep(Math.max(0, lastChosen + 1100 - Date.now()));
            for (const ch of String(text)) {
              const code = ch === ' ' ? 'Space' : (/[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : (/\d/.test(ch) ? `Digit${ch}` : ''));
              const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
              const ev = { key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 };
              await s('Input.dispatchKeyEvent', { type: 'keyDown', ...ev, text: ch, unmodifiedText: ch });
              await s('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
            }
            lastChosen = Date.now();
            await sleep(150);
            let now = await read();
            let route = 'letters';
            if (!now.wanted) {
              route = 'arrow';
              const count = await evaluate(`document.querySelector(${sel}).options.length`);
              for (let i = 0; i < count && !now.wanted; i++) {
                await page.key('ArrowDown');
                await sleep(100);
                const next = await read();
                if (next.at === now.at && next.at !== 0) break;
                now = next;
              }
            }
            if (!now.wanted) throw new Error(`could not choose "${text}" on ${selector} on ${process.platform}: the letters and ArrowDown both left it on "${now.text}"`);
            // an open list takes the choice on Enter; a closed select has nothing to take, and Enter does no harm
            await page.key('Enter');
            await sleep(100);
            const done = await read();
            if (!done.wanted) throw new Error(`could not choose "${text}" on ${selector} on ${process.platform}: Enter left it on "${done.text}" (route ${route})`);
            return done.text;
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
            // No question to the page here: it would wait for the page to go idle before the press, and a press that
            // comes while the page is busy is the case #852 was about. The page's own log says what the press met.
            moved({ act: 'click', x: Math.round(x), y: Math.round(y) });
            await page.mouse('mouseMoved', x, y);
            await page.mouse('mousePressed', x, y, { buttons: 1 });
            await sleep(holdMs);
            await page.mouse('mouseReleased', x, y);
            lastClick = Date.now();
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
          // A real wheel turn over (x, y); positive `dy` scrolls down. It returns once the scroll it started has
          // stopped, as a hand waits to see where the page went (#852): on a slow machine the scroll lands after the
          // turn, and a box measured before then puts the next click on whatever scrolled under it. A turn that
          // scrolls nothing (the page at its end) returns after 300 ms.
          async wheel(x, y, dy) {
            moved({ act: 'wheel', x, y, dy });
            const count = () => evaluate('[window.__scrollN || 0, performance.now() - (window.__scrollAt || 0)]').catch(() => [0, Infinity]);
            const [n0] = await count();
            await page.mouse('mouseMoved', x, y);
            await page.mouse('mouseWheel', x, y, { deltaY: dy });
            const t0 = Date.now();
            for (;;) {
              const [n, quiet] = await count();
              if (n === n0 ? Date.now() - t0 > 300 : quiet > 100) return;
              if (Date.now() - t0 > 3000) return;
              await sleep(20);
            }
          },
          // Text into whatever has focus (Input.insertText: one insert, as a paste or an input method gives).
          // A number box selects its text in a timer after the click's mouseup, so text typed straight after a click
          // would land before it: when a click released a moment ago on a box that holds text, it waits for that timer
          // (and up to 400 ms more; a box that does not select on a click just goes on) until the selection covers
          // the whole value.
          async type(text) {
            moved({ act: 'type', text: String(text).slice(0, 20) });
            if (Date.now() - lastClick < 1000) {
              // The box is selected at the release too, then the browser collapses that selection once the click is
              // done and the page's timer selects it again: a full selection seen before that timer has run proves
              // nothing. A timer of the page's own, queued after it, runs after it.
              try { await evaluate('new Promise((r) => setTimeout(r, 30))'); } catch { /* the page is loading */ }
              try {
                await waitFor(`(() => { const a = document.activeElement; if (!a || typeof a.value !== 'string' || typeof a.selectionStart !== 'number' || !a.value) return true;
                  return a.selectionStart === 0 && a.selectionEnd === a.value.length; })()`, 400);
              } catch { /* this box keeps its caret on a click */ }
            }
            return s('Input.insertText', { text });
          },
          // Another window in the same browser context, opened on `url` (its own event streams, its own page, the
          // same storage). A window, as Chrome sizes only a new window: a second tab in the context refuses width.
          // A tab that never answers its setup (as a fresh launch can, #852) is closed and made once more.
          async newTab(url) {
            let tab = null;
            for (let attempt = 1; !tab; attempt++) {
              const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx, newWindow: true, width, height });
              try {
                const att = await send('Target.attachToTarget', { targetId, flatten: true });
                tab = await makePage(att.sessionId);
              } catch (e) {
                try { await send('Target.closeTarget', { targetId }); } catch { /* gone already */ }
                if (attempt >= 2) throw e;
              }
            }
            await tab.goto(url);
            return tab;
          },
        };
        return page;
      };
      // A fresh Chrome on a busy macOS runner now and then never answers its first commands (Runtime.enable: no
      // answer in 30 s, #852), and a Chrome can die between pages. Nothing of the test has run yet, so that browser is
      // stopped and one more is launched.
      let page = null;
      for (let attempt = 1; !page; attempt++) {
        try {
          if (!alive(shared) || shared.chrome !== chrome || shared.stepMs !== stepMs) {
            await stopShared();
            launchShared(chrome, stepMs);
          } else {
            // a new turn's lock folder names the running Chrome too, for the same reaper
            try { fs.writeFileSync(path.join(LOCK_DIR, 'profile'), shared.profile); } catch { /* it dies with this process anyway */ }
          }
          browser = shared;
          send = browser.send;
          ({ browserContextId: ctx } = await send('Target.createBrowserContext', { disposeOnDetach: false }));
          const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx, width, height });
          const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
          page = await makePage(sessionId);
        } catch (e) {
          ctx = null;
          await stopShared();
          if (attempt >= 2) throw new Error(`${e.message} (the browser's setup failed on two launches)`);
        }
      }
      return await fn(page);
    } finally {
      if (ctx && alive(browser) && shared === browser) {
        try { await send('Target.disposeBrowserContext', { browserContextId: ctx }); } catch { await stopShared(); }
      }
      // The turn's new Chrome temp files go with the browser at exit; a browser stopped in this turn already went,
      // so they are removed now, as a per-turn launch would.
      if (shared && shared === browser) {
        for (const name of chromeTempNow()) if (!turnBefore.has(name)) shared.ours.add(name);
      } else {
        removeNewChromeTemp(turnBefore);
      }
    }
  });
}

module.exports = { withPage };
