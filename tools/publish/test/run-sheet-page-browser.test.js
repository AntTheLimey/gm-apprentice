'use strict';
// The run sheet's GM page (plan Task 9) in a real browser, against the real server on a fixture
// copy: every beat renders with no script errors, no 5b button is on the page, a point marked and a
// jot written survive a reload, a page for another session and a stale page each reload on 409 and
// say so, and an old-shape Plan renders prep only. The browser is driven over the DevTools pipe
// (helpers/cdp.js): the page holds an event stream open, which stops `--dump-dom`'s virtual clock.
// Skipped without Chrome, except on CI (browserSkip). `gm.js parses` runs everywhere.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession } = require('../lib/run-sheet/sessions');
const RS = require('../lib/run-sheet/web/state');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const WEB = path.join(__dirname, '..', 'lib', 'run-sheet', 'web');
const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const BENCHMARK = path.join(__dirname, '..', '..', '..', 'tests', 'benchmark-campaign');
const PARTY = ['Characters/PCs/Ada Moss.md', 'Characters/PCs/Ben Hart.md'];
const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';

it('gm.js parses', () => {
  const source = fs.readFileSync(path.join(WEB, 'gm.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'gm.js' }));
});

it('gm.html loads state.js before gm.js, and both from the server', () => {
  const html = fs.readFileSync(path.join(WEB, 'gm.html'), 'utf8');
  const state = html.indexOf('src="/web/state.js"');
  const gm = html.indexOf('src="/web/gm.js"');
  assert.ok(state > 0 && gm > state, 'state.js comes first');
  assert.match(html, /href="\/web\/gm\.css"/);
});

it('note text drops HTML comments, and an arrival cue renders its links', () => {
  const { toHtml, present } = require('../lib/run-sheet/present');
  const index = { resolve: (n) => (n === 'Garrick Fell' ? 'Characters/NPCs/Garrick Fell.md' : null), picture: () => null };
  assert.strictEqual(toHtml('Before\n\n<!-- gm-only -->\n\nInside\n\n<!-- /gm-only -->', index), '<p>Before</p>\n<p>Inside</p>\n');
  const m = present({ beats: [{ arrivals: [{ when: 'Arriving', text: '[[Garrick Fell]] from the road', people: [] }] }] }, { index });
  assert.strictEqual(m.beats[0].arrivals[0].textHtml, '<a class="lk" data-note="Characters/NPCs/Garrick Fell.md">Garrick Fell</a> from the road');
  assert.strictEqual(m.beats[0].arrivals[0].text, '[[Garrick Fell]] from the road', 'the words stay');
});

const made = [];
const servers = [];
after(async () => {
  for (const s of servers) await s.close();
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

async function start(src, asked, party = PARTY, deps = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-'));
  made.push(vault);
  fs.cpSync(src, vault, { recursive: true });
  const picked = pickSession(listSessions(vault), asked, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party, deps: { delayMs: 50, log: () => {}, ...deps } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  return { ...t, vault, port, base: `http://127.0.0.1:${port}/` };
}

async function api(run, method, url, body) {
  const res = await fetch(`${run.base.slice(0, -1)}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// The page's own controls, clicked and typed into as the GM would.
const click = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('nothing matches ${sel}'); e.click(); return true; })()`);
const typeEnter = (page, sel, text) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(text)};
  e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
const probe = (page) => page.evaluate(PROBE);
// Settled means drawn as well as saved: the probe can say Saved before the first draw has put any beat on the page.
const settled = (page) => page.waitFor(`(() => { const p = ${PROBE}; return p && p.beats > 0 && p.saved === 'Saved' && p.pending === 0 && p; })()`);

describe('the GM page in a browser', { skip: browserSkip() }, () => {
  let run;
  before(async () => { run = await start(FIXTURE, 'Session 02 - The Test'); });

  it('renders every beat with no script errors, and no 5b buttons', async () => {
    const model = (await api(run, 'GET', '/api/model')).model;
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      const p = await settled(page);
      assert.strictEqual(p.beats, model.beats.length, 'every planned beat and contingency');
      assert.strictEqual(p.rail, model.beats.length);
      assert.deepStrictEqual(p.errors, []);
      assert.strictEqual(p.saved, 'Saved');
      const buttons = await page.evaluate('Array.from(document.querySelectorAll("button"), (b) => b.textContent.trim())');
      for (const word of ['Show', 'Fight', 'Place on panel', 'Roll']) {
        assert.ok(!buttons.some((t) => t === word || t.startsWith(`${word} `)), `no ${word} button`);
      }
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'nothing wider than the window');
      // J outside a text box goes to the header jot; Esc closes the drawer.
      await page.evaluate('document.body.focus(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }))');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'hjot');
      await click(page, 'a[data-note]');
      await page.waitFor('document.querySelector("#drawer.open h2")');
      await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      assert.strictEqual(await page.evaluate('document.getElementById("drawer").classList.contains("open")'), false);
      // the rail's beat links take the keyboard, and the header jot names the beat jumped to
      assert.strictEqual(await page.evaluate('Array.from(document.querySelectorAll("#rail a[data-go]")).every((a) => a.tabIndex === 0)'), true);
      const last = model.beats.filter((b) => !b.contingency).pop();
      await page.evaluate(`(() => { const a = document.querySelector('#rail a[data-go="beat:${last.key}"]'); a.focus(); a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      assert.strictEqual(await page.evaluate('document.getElementById("hjot").placeholder'), `Jot (J) → ${last.title}`);
    });
  });

  it('an HP typed on the end panel survives a redraw before the GM leaves the box', async () => {
    const own = await start(FIXTURE, 'Session 02 - The Test');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${own.base}?probe=1`);
      await settled(page);
      // typed, not yet left: no change event yet
      await page.evaluate('(() => { const e = document.querySelector("#sheet input[data-vhp]"); e.focus(); e.value = "3"; })()');
      // another window saves: the page redraws under the box
      const { state, rev } = await api(own, 'GET', '/api/state');
      await api(own, 'PUT', '/api/state', { stateId: own.stateId, base: rev, state: RS.reduce(state, { type: 'jot', id: 'other-1', text: 'elsewhere', beat: null }, new Date().toISOString()), clientId: 'other' });
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.rev > ${rev} && p; })()`);
      await page.evaluate('document.activeElement.blur()');
      await settled(page);
    });
    const { state } = await api(own, 'GET', '/api/state');
    const hp = Object.values(state.end.vitals).map((v) => v.hp);
    assert.ok(hp.includes(3), JSON.stringify(state.end.vitals));
  });

  it('a jot the server answered but had not yet written is sent again after the server dies', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-'));
    made.push(vault);
    fs.cpSync(FIXTURE, vault, { recursive: true });
    const picked = pickSession(listSessions(vault), 'Session 02 - The Test', vault);
    // The first server never gets its write to disk: once "killed", every write it tries fails.
    let dead = false;
    const deadFs = new Proxy(fs, { get: (t, k) => (dead && /^(write|rename|mkdir|copyFile|rm)/.test(String(k)) ? () => { throw Object.assign(new Error('killed'), { code: 'EIO' }); } : t[k]) });
    const a = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 60000, fs: deadFs, log: () => {} } });
    const port = await listenLocal(a.server, 0);
    const base = `http://127.0.0.1:${port}/`;
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${base}?probe=1`);
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.beats && p; })()`);
      await typeEnter(page, '#sheet input[data-jot]', 'Said before the crash');
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.pending === 0 && p.rev > 0 && p; })()`);
      // the kill: no flush, the connections cut
      dead = true;
      a.server.closeAllConnections();
      await new Promise((r) => { a.server.close(r); });
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Not connected' && p; })()`);
      const b = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 50, log: () => {} } });
      servers.push(b);
      await listenLocal(b.server, port);
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && p; })()`);
    });
    const st = JSON.parse(fs.readFileSync(path.join(vault, '_meta', 'table', `${a.stateId}.json`), 'utf8'));
    assert.deepStrictEqual(st.jots.map((j) => j.text), ['Said before the crash']);
  });

  it('a point marked and a jot written are kept after a reload', async () => {
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await click(page, '#sheet .ptb[data-pt]');
      await typeEnter(page, '#sheet input[data-jot]', 'Ash lowers the rope');
      await settled(page);
      // a mark on the old document, so the wait below can only pass in the reloaded one
      await page.evaluate('window.__beforeReload = true');
      await page.reload();
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return !window.__beforeReload && p && p.jots.length && p.marked === 1 && p; })()`);
      assert.strictEqual(p.marked, 1);
      assert.deepStrictEqual(p.jots, ['Ash lowers the rope']);
      assert.deepStrictEqual(p.errors, []);
    });
    await run.store.flushNow();
    const st = JSON.parse(fs.readFileSync(path.join(run.vault, '_meta', 'table', `${run.stateId}.json`), 'utf8'));
    assert.strictEqual(Object.values(st.points).filter((x) => x.mark === 'landed').length, 1);
    assert.deepStrictEqual(st.jots.map((j) => j.text), ['Ash lowers the rope']);
  });

  it('a page for another session reloads on 409 and says so', async () => {
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1&stateId=x`);
      await settled(page);
      await click(page, '#sheet .ptb[data-pt]');
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p; })()`);
      assert.deepStrictEqual(p.notes, ['This page was showing Session 2; it now shows Session 2.']);
      assert.strictEqual(p.stateId, run.stateId);
      assert.strictEqual(p.pending, 0, 'the other session\'s action is dropped');
    });
  });

  it('a stale page reloads on 409 and re-applies what it was sending', async () => {
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      const p0 = await settled(page);
      // Another window writes first. It carries this page's clientId, so the page takes no notice of
      // the broadcast and its next PUT is built on the old rev.
      const { state, rev } = await api(run, 'GET', '/api/state');
      const other = RS.reduce(state, { type: 'jot', id: 'other-1', text: 'From the other window', beat: null }, new Date().toISOString());
      const put = await api(run, 'PUT', '/api/state', { stateId: run.stateId, base: rev, state: other, clientId: p0.clientId });
      assert.strictEqual(put.rev, rev + 1);
      await click(page, '#handover .ptb[data-hand]');
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p.saved === 'Saved' && p.pending === 0 && p; })()`);
      assert.deepStrictEqual(p.notes, ['Another window changed the sheet; reloaded.']);
      assert.deepStrictEqual(p.errors, []);
    });
    const { state } = await api(run, 'GET', '/api/state');
    assert.ok(state.jots.some((j) => j.text === 'From the other window'), 'the other window\'s jot is kept');
    assert.strictEqual(Object.keys(state.handouts).length, 1, 'the page\'s own action was re-applied');
  });

  it('a page left open while the server is switched to another session names the new one (proof defect 1)', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-'));
    made.push(vault);
    fs.cpSync(FIXTURE, vault, { recursive: true });
    const serve = async (asked, port) => {
      const picked = pickSession(listSessions(vault), asked, vault);
      const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 50, log: () => {} } });
      const bound = await listenLocal(t.server, port);
      servers.push(t);
      return { ...t, port: bound, base: `http://127.0.0.1:${bound}/` };
    };
    const s2 = await serve('Session 02 - The Test', 0);
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${s2.base}?probe=1`);
      await settled(page);
      await s2.close();
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Not connected' && p; })()`);
      const s3 = await serve('Session 03 - Next', s2.port);
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p; })()`);
      assert.deepStrictEqual(p.notes, ['This page was showing Session 2; it now shows Session 3.']);
      assert.strictEqual(p.stateId, s3.stateId);
    });
  });

  it('closing the tab while clicks are unsent asks first (PR review L5)', async () => {
    const gone = await start(FIXTURE, 'Session 02 - The Test');
    const asks = 'window.dispatchEvent(Object.assign(new Event("beforeunload", { cancelable: true }))) === false';
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${gone.base}?probe=1`);
      await settled(page);
      assert.strictEqual(await page.evaluate(asks), false, 'nothing unsent: no question');
      await gone.close();
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Not connected' && p; })()`);
      await click(page, '#sheet .ptb[data-pt]');
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.pending > 0 && p; })()`);
      assert.strictEqual(await page.evaluate(asks), true, 'a click not yet sent: the browser asks');
    });
  });

  it('a Table Log changed by hand is kept aside, and the page says where', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-'));
    made.push(vault);
    fs.cpSync(FIXTURE, vault, { recursive: true });
    const log = path.join(vault, 'Chapters', 'Chapter 1', 'Sessions', 'Session 02', 'Session 02 - The Test - Table Log.md');
    fs.appendFileSync(log, '\n- 20:00 A line the GM wrote by hand\n');
    const kept = await start(vault, 'Session 02 - The Test');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${kept.base}?probe=1`);
      await settled(page);
      await click(page, '#sheet .ptb[data-pt]');
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p; })()`);
      assert.match(p.notes[0], /^The Table Log was changed outside the sheet; the earlier text is kept at _meta\/table\/chapter-1--session-02-the-test\.table-log-.*\.txt\.$/);
      const rel = p.notes[0].replace(/^.* kept at (.*)\.$/, '$1');
      assert.match(fs.readFileSync(path.join(kept.vault, ...rel.split('/')), 'utf8'), /A line the GM wrote by hand/);
    });
  });

  it('a page loaded while the record or the state is failing says so, and clears when it recovers', async () => {
    let logStuck = true;
    let stateStuck = false;
    const busy = (msg) => { const e = new Error(msg); e.code = 'EBUSY'; return e; };
    const flaky = {
      ...fs,
      renameSync: (x, y) => {
        if (logStuck && y.endsWith('Table Log.md')) throw busy('EBUSY: resource busy or locked');
        if (stateStuck && y.endsWith('.json')) throw busy('EBUSY: the state is held');
        return fs.renameSync(x, y);
      },
    };
    const sick = await start(FIXTURE, 'Session 02 - The Test', PARTY, { fs: flaky, recordRetryMs: [100], retryMs: [100] });
    const { model } = await api(sick, 'GET', '/api/model');
    const { state, rev } = await api(sick, 'GET', '/api/state');
    const b = model.beats[0];
    const marked = RS.reduce(state, { type: 'mark', id: 'x-1', point: b.points[0].key, mark: 'landed', beat: b.key, beatTitle: b.title, text: b.points[0].text }, new Date().toISOString());
    await api(sick, 'PUT', '/api/state', { stateId: sick.stateId, base: rev, state: marked });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      // Loaded after the one broadcast: the status comes with the model and the event stream's hello.
      for (let i = 0; i < 100 && !(await api(sick, 'GET', '/api/model')).notices.some((n) => n.kind === 'record-failing'); i++) await new Promise((r) => { setTimeout(r, 20); });
      await page.goto(`${sick.base}?probe=1`);
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p; })()`);
      assert.deepStrictEqual(p.notes, ['The Table Log could not be written: EBUSY: resource busy or locked. The sheet keeps the state and tries again.']);
      logStuck = false;
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length === 0 && p; })()`);
      stateStuck = true;
      const now = await api(sick, 'GET', '/api/state');
      await api(sick, 'PUT', '/api/state', { stateId: sick.stateId, base: now.rev, state: RS.reduce(now.state, { type: 'jot', id: 'x-2', text: 'held', beat: null }, new Date().toISOString()) });
      for (let i = 0; i < 100 && !(await api(sick, 'GET', '/api/model')).notices.some((n) => n.kind === 'save-failing'); i++) await new Promise((r) => { setTimeout(r, 20); });
      await page.reload();
      const q = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Not saving' && p; })()`);
      assert.deepStrictEqual(q.errors, []);
      stateStuck = false;
      await settled(page);
    });
  });

  it('the old-shape Plan renders prep only', async () => {
    const old = await start(BENCHMARK, 'Session 03 - The Inner Sanctum', []);
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${old.base}?probe=1`);
      // No beats here, so wait for the prep to be drawn instead of settled()'s first beat.
      await page.waitFor('document.querySelectorAll("#prep h3").length > 0');
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && p; })()`);
      assert.strictEqual(p.beats, 0);
      assert.deepStrictEqual(p.errors, []);
      assert.ok(await page.evaluate('document.querySelectorAll("#prep h3").length > 0'), 'the prep is on the page');
    });
  });
});
