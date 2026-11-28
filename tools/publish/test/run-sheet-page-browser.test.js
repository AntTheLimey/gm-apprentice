'use strict';
// The run sheet's GM page (plan Task 9) in a real browser, against the real server on a fixture
// copy: every beat renders with no script errors and a Fight button (5b), a point marked and a
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

  it('renders every beat with no script errors, Fight on each (D&D) and no Roll before a fight', async () => {
    const model = (await api(run, 'GET', '/api/model')).model;
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      const p = await settled(page);
      assert.strictEqual(p.beats, model.beats.length, 'every planned beat and contingency');
      assert.strictEqual(p.rail, model.beats.length);
      assert.deepStrictEqual(p.errors, []);
      assert.strictEqual(p.saved, 'Saved');
      const buttons = await page.evaluate('Array.from(document.querySelectorAll("button"), (b) => b.textContent.trim())');
      assert.ok(!buttons.some((t) => t === 'Roll' || t.startsWith('Roll ')), 'no Roll button before a fight');
      assert.strictEqual(buttons.filter((t) => t === 'Fight').length, model.beats.length, 'Fight on every beat (5b, decision 19)');
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

  it('a jot half typed survives the Table Log being filed (#855)', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-'));
    made.push(vault);
    fs.cpSync(FIXTURE, vault, { recursive: true });
    const picked = pickSession(listSessions(vault), 'Session 03 - Next', vault);
    assert.ok(picked.session, picked.error);
    // Stands in for `gma vault-write <vault> table-log-new`: the empty skeleton beside the index, and the link.
    const stem = path.basename(picked.session.index, '.md');
    const runFileLog = () => {
      const idx = path.join(vault, picked.session.index);
      fs.writeFileSync(path.join(vault, path.dirname(picked.session.index), `${stem} - Table Log.md`),
        `---\ntype: session-table-log\nsession: "[[${stem}]]"\n---\n\n# ${stem} - Table Log\n\n## Log\n`);
      fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/^type: session$/m, `type: session\ndocuments:\n  table_log: "[[${stem} - Table Log]]"`));
      return { ok: true };
    };
    const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, fileLog: ['gma'], deps: { delayMs: 50, log: () => {}, runFileLog } });
    const port = await listenLocal(t.server, 0);
    servers.push(t);
    const own = { ...t, port, base: `http://127.0.0.1:${port}/` };
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${own.base}?probe=1`);
      await settled(page);
      assert.strictEqual(await page.evaluate('!!document.querySelector("#sheet .nolog")'), true, 'no Table Log yet');
      await page.click('#sheet input[data-jot]');
      await page.type('Half a thought');
      // another window's jot is the first thing at the table: the server files the log and says so
      const { state, rev } = await api(own, 'GET', '/api/state');
      await api(own, 'PUT', '/api/state', { stateId: own.stateId, base: rev, state: RS.reduce(state, { type: 'jot', id: 'other-1', text: 'The party camps.', beat: null }, new Date().toISOString()), clientId: 'other' });
      await page.waitFor('!document.querySelector("#sheet .nolog")');
      const got = await page.evaluate('(() => { const a = document.activeElement; return { value: document.querySelector("#sheet input[data-jot]").value, typing: !!(a && a.matches && a.matches("#sheet input[data-jot]")) }; })()');
      assert.deepStrictEqual(got, { value: 'Half a thought', typing: true });
    });
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

  it('another window\'s write is kept, and the page takes it from the answer', async () => {
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      const p0 = await settled(page);
      // Another window writes first. It carries this page's clientId, so the page takes no notice of
      // the broadcast; its next write is an action, which lands on the newer state, and the answer
      // brings the other window's jot back with it.
      const { state, rev } = await api(run, 'GET', '/api/state');
      const other = RS.reduce(state, { type: 'jot', id: 'other-1', text: 'From the other window', beat: null }, new Date().toISOString());
      const put = await api(run, 'PUT', '/api/state', { stateId: run.stateId, base: rev, state: other, clientId: p0.clientId });
      assert.strictEqual(put.rev, rev + 1);
      await click(page, '#handover .ptb[data-hand]');
      await settled(page);
      assert.ok(await page.evaluate('window.RunSheetPage.state().jots.some((j) => j.text === "From the other window")'), 'the page holds the other window\'s jot');
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
    const { state } = await api(run, 'GET', '/api/state');
    assert.ok(state.jots.some((j) => j.text === 'From the other window'), 'the other window\'s jot is kept');
    assert.strictEqual(Object.keys(state.handouts).length, 1, 'the page\'s own action landed');
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

  it('a PC\'s Thread shows its bold and its link\'s name, not the markup (Task 34)', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-thread-'));
    made.push(src);
    fs.cpSync(FIXTURE, src, { recursive: true });
    const ben = path.join(src, 'Characters/PCs/Ben Hart.md');
    // raw HTML in a Thread stays text (Task 34 fix round): no element made, no script run
    fs.writeFileSync(ben, fs.readFileSync(ben, 'utf8').replace(/\*\*Open threads:\*\* —/, '**Open threads:** the debt on **the salt barge** owed to [[Ada Moss]] <script>window.__threadRan = 1</script><b>loud</b>'));
    const own = await start(src, 'Session 02 - The Test');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${own.base}?probe=1`);
      await settled(page);
      const cell = await page.evaluate(`(() => { const td = Array.from(document.querySelectorAll('td')).find((t) => /Thread:/.test(t.textContent) && /salt barge/.test(t.textContent));
        return td ? { text: td.textContent.replace(/\\s+/g, ' ').trim(), bold: Array.from(td.querySelectorAll('strong, b'), (b) => b.textContent), link: Array.from(td.querySelectorAll('a[data-note]'), (a) => a.textContent) } : null; })()`);
      assert.ok(cell, 'the PCs table has the thread');
      assert.match(cell.text, /Thread: the debt on the salt barge owed to Ada Moss <script>window.__threadRan = 1<\/script><b>loud<\/b>$/);
      assert.strictEqual(await page.evaluate(`Array.from(document.querySelectorAll('td')).some((t) => t.querySelector('script'))`), false);
      assert.strictEqual(await page.evaluate('window.__threadRan === undefined'), true);
      assert.deepStrictEqual(cell.bold, ['the salt barge'], 'the raw <b> made no bold');
      assert.deepStrictEqual(cell.link, ['Ada Moss']);
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

// ------------------------------------------------------------------ 5b Task 9: Show and the players' screen
// On the players' fixture (Task 3), Session 03: beat 1 is "Ashfall Reckoning" at The Gate, beat 2 a hub.
const PL_FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const PL_SESSION = 'Session 03 - Next';
const SHOTS = process.env.RS_SHOTS || '';
const { renderPlayers } = require('../lib/run-sheet/web/players/render');

async function startPlayers(deps = {}, { vault: given, port = 0 } = {}) {
  let vault = given;
  if (!vault) {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-pl-'));
    made.push(vault);
    fs.cpSync(PL_FIXTURE, vault, { recursive: true });
  }
  const picked = pickSession(listSessions(vault), PL_SESSION, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 50, log: () => {}, ...deps } });
  const got = await listenLocal(t.server, port);
  servers.push(t);
  return { ...t, vault, port: got, base: `http://127.0.0.1:${got}/` };
}
const beatSel = (key) => `[id="beat:${key}"]`;
const buttonsIn = (page, sel) => page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${sel} button`)}), (b) => b.textContent.trim())`);
const viewOf = (page, test) => page.waitFor(`(() => { const p = ${PROBE}; const v = p && p.view; return v && (${test}) && p; })()`);
async function shot(page, name) {
  if (SHOTS) await page.screenshot(path.join(SHOTS, `${name}.png`));
}
// Every PC to the first beat, and the page settled.
async function everyoneAt(page, model) {
  const b = model.beats[0];
  await click(page, `${beatSel(b.key)} [data-all]`);
  await settled(page);
  return b;
}

describe('the GM page shows things on the players\' screen', { skip: browserSkip() }, () => {
  it('Show, Place on panel and Players\' screen are on a beat with PCs', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      const b = await everyoneAt(page, model);
      const here = await buttonsIn(page, `${beatSel(b.key)} .bbtns`);
      assert.ok(here.includes('Show'), `Show on the beat: ${here}`);
      assert.ok(here.some((t) => t.startsWith('Place on panel')), 'Place on panel on the beat');
      // Place on panel is there on a beat with no PCs too, keyed by position (Review L3)
      const hub = model.beats[1];
      assert.ok((await buttonsIn(page, beatSel(hub.key))).filter((t) => t.startsWith('Place on panel')).length >= 2, 'one per hub spot');
      const header = await buttonsIn(page, '#top');
      assert.ok(header.includes('Players\' screen'), 'the header opens the players\' window');
      await page.evaluate('window.open = (u, n) => { window.__opened = [u, n]; return null; }');
      await click(page, '#playersBtn');
      assert.deepStrictEqual(await page.evaluate('window.__opened'), ['/players', 'run-sheet-players']);
      // Show puts the beat's people and place on its group's panel; a withheld note goes up under its word
      await click(page, `${beatSel(b.key)} .bbtns [data-showbeat]`);
      let p = await viewOf(page, 'v.panels.length === 1 && v.panels[0].people.length > 0');
      const names = p.view.panels[0].people.map((x) => x.name);
      assert.ok(names.includes('Glacier Wyrm') && names.includes('Brother Venn'), names.join(', '));
      assert.ok(!names.includes('Hidden Abbot'), 'a withheld name never goes up');
      assert.strictEqual(p.view.panels[0].caption, 'The Gate');
      await shot(page, 'show-beat-1449');
      // Place on panel off: the caption goes, and the state keeps it by position
      await click(page, `${beatSel(b.key)} .bbtns [data-placeoff]`);
      await settled(page);
      // the beat Show set the place as the backdrop; Place on panel turns off only the group's own place
      const st = (await api(run, 'GET', '/api/state')).state;
      assert.strictEqual(st.panels[b.key].placeOff, true);
      // Who's here: Remove takes two clicks
      const venn = 'Characters/NPCs/Brother Venn.md';
      await click(page, `${beatSel(b.key)} [data-unshow="${venn}"]`);
      p = await probe(page);
      assert.ok(p.view.panels[0].people.some((x) => x.name === 'Brother Venn'), 'one click only arms it');
      await click(page, `${beatSel(b.key)} [data-unshow="${venn}"]`);
      p = await viewOf(page, '!v.panels[0].people.some((x) => x.name === "Brother Venn")');
      // and Show puts one person back
      await click(page, `${beatSel(b.key)} [data-show="${venn}"]`);
      await viewOf(page, 'v.panels[0].people.some((x) => x.name === "Brother Venn")');
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  it('Show from the drawer puts a person on the focused group\'s panel', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      const b = await everyoneAt(page, model);
      // A person from outside this beat: the cast search's note, opened in the drawer by a link
      await page.evaluate('document.getElementById("sheet").insertAdjacentHTML("beforeend", \'<a id="t-sister" data-note="Characters/NPCs/Sister Fen.md">x</a>\')');
      await click(page, '#t-sister');
      await page.waitFor('document.querySelector("#drawer.open [data-dshow]")');
      await shot(page, 'drawer-show-1920');
      await click(page, '#drawer [data-dshow]');
      const p = await viewOf(page, 'v.panels.length === 1 && v.panels[0].people.some((x) => x.name === "Sister Fen")');
      assert.deepStrictEqual(p.errors, []);
      const st = (await api(run, 'GET', '/api/state')).state;
      assert.deepStrictEqual(st.panels[b.key].people, ['Characters/NPCs/Sister Fen.md']);
    });
  });

  it('a GM map has no Show', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await everyoneAt(page, model);
      const maps = await page.evaluate('Array.from(document.querySelectorAll("#handover [data-mapshow]"), (b) => b.dataset.mapshow)');
      assert.deepStrictEqual(maps, ['Documents/Map of the Gate.md'], 'only the map the player site publishes');
      await page.evaluate('document.getElementById("sheet").insertAdjacentHTML("beforeend", \'<a id="t-gm" data-note="Documents/Map of the Gate (GM).md">x</a><a id="t-pl" data-note="Documents/Map of the Gate.md">y</a>\')');
      await click(page, '#t-gm');
      await page.waitFor('document.querySelector("#drawer.open h2")');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("#drawer [data-dshow]").length'), 0, 'the GM map has no Show in the drawer');
      await click(page, '#t-pl');
      await page.waitFor('document.querySelector("#drawer.open [data-dshow]")');
      await click(page, '#handover [data-mapshow]');
      const p = await viewOf(page, 'v.panels.length === 1 && v.panels[0].caption === "Map of the Gate"');
      assert.ok(p.view.panels[0].backdrop, 'the map is behind the panel');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('the preview matches the players\' view', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      const b = await everyoneAt(page, model);
      await click(page, `${beatSel(b.key)} .bbtns [data-showbeat]`);
      await viewOf(page, 'v.panels.length === 1 && v.panels[0].people.length > 2');
      // plan 6a Task 10: the preview starts folded; Show ▸ opens it
      await click(page, '#pvToggle');
      await page.waitFor('document.querySelector("#pv") && document.querySelector("#pv").shadowRoot && document.querySelector("#pv").shadowRoot.querySelector(".mon .panel .ppl .tile")');
      const view = await api(run, 'GET', '/api/players/view');
      const drawn = await page.evaluate(`(() => { const m = document.querySelector("#pv").shadowRoot.querySelector(".mon").cloneNode(true);
        m.querySelectorAll(".x").forEach((x) => x.remove()); return m.outerHTML; })()`);
      assert.strictEqual(drawn, renderPlayers(view), 'the preview draws the same view with the same code');
      const box = await page.evaluate('(() => { const r = document.querySelector("#pv").getBoundingClientRect(); return { w: r.width, right: r.right }; })()');
      assert.ok(box.right <= 1449, `the preview fits the window (${JSON.stringify(box)})`);
      await shot(page, 'preview-1449');
      // each person on a panel has a ✕ in the preview: two clicks take them off
      const n = view.panels[0].people.length;
      assert.strictEqual(await page.evaluate('document.querySelector("#pv").shadowRoot.querySelectorAll(".panel .x").length'), n);
      const x = 'document.querySelector("#pv").shadowRoot.querySelector(".panel .x").click()';
      await page.evaluate(x);
      assert.strictEqual((await probe(page)).view.panels[0].people.length, n, 'one click only arms it');
      await page.evaluate(x);
      await viewOf(page, `v.panels[0].people.length === ${n - 1}`);
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  it('the page writes actions, never a whole state', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      const b = await everyoneAt(page, model);
      await click(page, `${beatSel(b.key)} .ptb[data-pt]`);
      await typeEnter(page, `${beatSel(b.key)} input[data-jot]`, 'The horn sounds');
      await click(page, `${beatSel(b.key)} .bbtns [data-showbeat]`);
      const p = await settled(page);
      assert.strictEqual(p.requests['PUT /api/state'] || 0, 0, 'no whole-state PUT');
      assert.ok(p.requests['POST /api/actions'] >= 1, JSON.stringify(p.requests));
      assert.strictEqual(p.answered, 0, 'every answered action is covered by a saved');
      const st = (await api(run, 'GET', '/api/state')).state;
      assert.deepStrictEqual(st.jots.map((j) => j.text), ['The horn sounds']);
    });
  });

  it('a rejected action drains the queue', async () => {
    const reduce = (s, a, at) => { if (a && a.type === 'showBeat') throw new Error('a bad show'); return RS.reduce(s, a, at); };
    const run = await startPlayers({ reduce });
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      const b = await everyoneAt(page, model);
      await click(page, `${beatSel(b.key)} .bbtns [data-showbeat]`);
      let p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p; })()`);
      assert.deepStrictEqual(p.notes, ['One change could not be applied: showBeat.']);
      await click(page, `${beatSel(b.key)} .ptb[data-pt]`);
      p = await settled(page);
      assert.strictEqual(p.marked, 1);
      const st = (await api(run, 'GET', '/api/state')).state;
      assert.strictEqual(Object.values(st.points).filter((x) => x.mark === 'landed').length, 1, 'a later mark saves');
      assert.deepStrictEqual(st.panels, {}, 'the rejected action is not in the page\'s state either');
      assert.deepStrictEqual(await page.evaluate('window.RunSheetPage.state().panels'), {});
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // The page's POST reaches the server, but its answer is held until `release()`: another window's write
  // lands while it is on its way (proof M3), or the answer is a 400 (Review L6).
  const HOLD = `(() => { if (window.__held) return true; window.__held = true; const real = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url) === '/api/actions' && window.__refuse) { window.__refuse -= 1; window.__refused = (window.__refused || 0) + 1;
        return new Response(JSON.stringify({ error: 'the state could not be read' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      const res = await real(url, opts);
      if (String(url) === '/api/actions' && window.__hold) { window.__hold = false; await new Promise((r) => { window.__release = r; }); }
      return res; };
    return true; })()`;

  it('another window\'s write while this page\'s is on its way: the page takes the newer state (proof M3)', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    const b = model.beats[0];
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await page.evaluate(HOLD);
      await page.evaluate('window.__hold = true');
      await typeEnter(page, `${beatSel(b.key)} input[data-jot]`, 'From this page');
      await page.waitFor('typeof window.__release === "function"');
      // the server has this page's jot; another window writes after it
      const { stateId } = await api(run, 'GET', '/api/state');
      const other = await api(run, 'POST', '/api/actions', { stateId, base: 0, clientId: 'other-tab', actions: [{ type: 'jot', id: 'other-1', text: 'From the other window', beat: b.key }] });
      assert.deepStrictEqual(other.rejected, []);
      // the page has heard the other write before its own answer comes
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.heardRev >= ${other.rev}; })()`);
      await page.evaluate('window.__release()');
      const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.pending === 0 && p.jots.length === 2 && p.saved === 'Saved' && p; })()`, 8000);
      assert.deepStrictEqual(p.jots.slice().sort(), ['From the other window', 'From this page']);
      assert.strictEqual(p.rev, other.rev, 'the page holds the newest rev');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('a batch the server cannot take at all is dropped and named, never sent again (Review L6)', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    const b = model.beats[0];
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await page.evaluate(HOLD);
      await page.evaluate('window.__refuse = 1');
      await typeEnter(page, `${beatSel(b.key)} input[data-jot]`, 'Never lands');
      // its effect on the page goes too, once the server's state is back
      let p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.notes.length && p.pending === 0 && p.jots.length === 0 && p; })()`);
      assert.deepStrictEqual(p.notes, ['One change could not be applied: the state could not be read.']);
      await page.sleep(2500);
      assert.strictEqual(await page.evaluate('window.__refused'), 1, 'not sent again');
      await typeEnter(page, `${beatSel(b.key)} input[data-jot]`, 'Lands');
      p = await settled(page);
      assert.deepStrictEqual(p.jots, ['Lands']);
      assert.deepStrictEqual((await api(run, 'GET', '/api/state')).state.jots.map((j) => j.text), ['Lands']);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('a restart re-sends what was answered but not saved; each lands once', async () => {
    // The first server writes nothing once it is "killed": its fs drops every write.
    const box = { dead: false };
    const deadFs = new Proxy(fs, { get: (o, k) => (['writeFileSync', 'renameSync', 'rmSync', 'mkdirSync', 'appendFileSync', 'fsyncSync', 'openSync', 'closeSync', 'writeSync'].includes(k)
      ? (...a) => (box.dead ? undefined : o[k](...a)) : o[k]) });
    const first = await startPlayers({ delayMs: 600000, fs: deadFs });
    const { model } = await api(first, 'GET', '/api/model');
    const b = model.beats[0];
    let second = null;
    try {
      await withPage({ width: 1449, height: 762 }, async (page) => {
        await page.goto(`${first.base}?probe=1`);
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p; })()`);
        await typeEnter(page, `${beatSel(b.key)} input[data-jot]`, 'Saved before the crash');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.pending === 0 && p.answered === 1 && p; })()`);
        await first.store.flushNow(); // on disk; its `saved` covers it
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.answered === 0 && p.saved === 'Saved' && p; })()`);
        await typeEnter(page, `${beatSel(b.key)} input[data-jot]`, 'Answered, never saved');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.pending === 0 && p.answered === 1 && p; })()`);
        // the kill: nothing more reaches the disk, every connection drops
        box.dead = true;
        first.server.closeAllConnections();
        await new Promise((r) => { first.server.close(() => r()); });
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Not connected' && p; })()`);
        second = await startPlayers({}, { vault: first.vault, port: first.port });
        assert.notStrictEqual(second.serverId, first.serverId);
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && p.jots.length === 2 && p; })()`, 20000);
        // a `saved` covering it may have gone out before the event stream was back: the next one clears it
        await click(page, `${beatSel(b.key)} .ptb[data-pt]`);
        const p = await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && p.answered === 0 && p.marked === 1 && p; })()`);
        assert.deepStrictEqual(p.jots, ['Saved before the crash', 'Answered, never saved']);
        assert.deepStrictEqual(p.errors, []);
      });
      const st = second.store.get().state;
      assert.deepStrictEqual(st.jots.map((j) => j.text), ['Saved before the crash', 'Answered, never saved'], 'each lands once');
    } finally {
      try { await first.close(); } catch { /* killed */ }
    }
  });

  it('no script errors', async () => {
    const run = await startPlayers();
    const { model } = await api(run, 'GET', '/api/model');
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      const b = await everyoneAt(page, model);
      // every Show control once
      await click(page, `${beatSel(b.key)} [data-show]`);
      await click(page, `${beatSel(b.key)} .bbtns [data-showbeat]`);
      await click(page, `${beatSel(b.key)} .bbtns [data-placeoff]`);
      await click(page, `${beatSel(model.beats[1].key)} [data-placeoff]`);
      await click(page, '#handover [data-mapshow]');
      await click(page, 'a[data-note="Locations/The Gate.md"]');
      await page.waitFor('document.querySelector("#drawer.open [data-dshow]")');
      await click(page, '#drawer [data-dshow]');
      const p = await settled(page);
      await shot(page, 'walk-1920');
      assert.deepStrictEqual(p.errors, []);
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'nothing wider than the window');
    });
  });
});

// plan 6a Task 7: Move them and Fight here, by real input only (page.click, page.type, page.key). Changed on
// purpose by Task 7 fix round 1 / review I1: a place the Plan has a beat or hub spot for is that beat (The Chapel
// Yard is Dawn's spot, The Gate its beats); only a place with no Plan beat gets a place beat of its own.
describe('Move them and Fight here in a browser', { skip: browserSkip() }, () => {
  const YARD = 'Locations/The Chapel Yard.md';
  const NORTH = 'Locations/North/index.md';
  const ADA = PARTY[0];
  const beat = (key) => `[id="beat:${key}"]`;
  const stateOf = async (run) => (await api(run, 'GET', '/api/state')).state;

  it('the party moves to a Plan place, a place of its own, a typed one by its explicit choice, back, and fights at a place', async () => {
    const run = await start(FIXTURE, 'Session 02 - The Test');
    const { model } = await api(run, 'GET', '/api/model');
    const [gate, , hub, gate2] = model.beats;
    const yardSpot = hub.spots.find((x) => x.note === YARD).key;
    await withPage({ width: 1449, height: 900 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      assert.strictEqual(await page.evaluate('document.querySelector("#handover .where-party")'), null);
      await page.click(`${beat(gate.key)} [data-all]`);
      await settled(page);
      await page.waitFor('document.querySelector("#handover .where-party input[data-moveg]")');
      // review M1 (two notes both called "index" carry their folders) is checked in the Move list's own test below
      assert.match(await page.evaluate('document.querySelector("#handover .where-party li").textContent'), /Ada, Ben at The Gate/);
      // "chapel yard" is The Chapel Yard: the Plan's hub spot, not a place beat
      await page.click('#handover input[data-moveg]');
      await page.type('chapel yard');
      await page.waitFor('document.querySelector("#handover [data-movepick]")');
      assert.strictEqual(await page.evaluate('document.querySelector("#handover [data-mhits] button").textContent'), 'The Chapel Yard');
      assert.match(await page.evaluate('document.querySelector("#handover [data-mhits] button:last-child").textContent'), /^\+ New place: chapel yard$/);
      await page.key('Enter');
      await settled(page);
      let s = await stateOf(run);
      assert.deepStrictEqual(s.positions[ADA], { beat: hub.key, spot: yardSpot });
      assert.ok(!s.improvised.length, 'no place beat');
      assert.ok(s.events.some((e) => e.text === `Ada, Ben move to The Chapel Yard (the Plan's beat: ${hub.title} · The Chapel Yard).`));
      // "north": a place no Plan beat has, so it gets its own place beat
      await page.waitFor(`document.querySelector('${beat(hub.key)} input[data-moveg]')`);
      await page.click(`${beat(hub.key)} input[data-moveg]`);
      await page.type('north');
      await page.waitFor(`document.querySelector('${beat(hub.key)} [data-movepick]')`);
      await page.key('Enter');
      await settled(page);
      s = await stateOf(run);
      const northKey = model.placeKeys[NORTH];
      assert.strictEqual(s.positions[ADA].beat, northKey);
      await page.waitFor(`document.querySelector('${beat(northKey)}')`);
      // a name no place has: the explicit choice makes the new place. Changed on purpose (Task 9, audit S6): Enter here
      // used to make nothing (final review P-S10); now Enter makes it too, and the S6 test below pins that
      await page.click(`${beat(northKey)} input[data-moveg]`);
      await page.type('Rusty Anchor');
      await page.waitFor(`document.querySelector('${beat(northKey)} [data-movenew]')`);
      await page.click(`${beat(northKey)} [data-movenew]`);
      await settled(page);
      s = await stateOf(run);
      const typed = s.improvised.find((i) => i.newPlace);
      assert.strictEqual(typed && typed.title, 'Rusty Anchor');
      assert.strictEqual(s.positions[ADA].beat, typed.key);
      const view = await api(run, 'GET', '/api/players/view');
      assert.strictEqual(view.panels[0].caption, 'Rusty Anchor');
      // "gate": the Plan's Gate beat not yet visited (Scene 4)
      await page.click(`${beat(typed.key)} input[data-moveg]`);
      await page.type('gate');
      await page.waitFor(`document.querySelector('${beat(typed.key)} [data-movepick]')`);
      await page.key('Enter');
      await settled(page);
      s = await stateOf(run);
      assert.strictEqual(s.positions[ADA].beat, gate2.key);
      await page.click(`${beat(typed.key)} [data-unplace]`);
      await page.click(`${beat(typed.key)} [data-unplace]`);
      await settled(page);
      s = await stateOf(run);
      assert.ok(!s.improvised.some((i) => i.newPlace), 'taken back');
      // Fight here on The Chapel Yard's tile: the fight is on the Plan's hub beat, with its planned foes
      await page.click(`#places [data-fplace="${YARD}"]`);
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p; })()`);
      s = await stateOf(run);
      assert.strictEqual(s.fight.beat, hub.key);
      assert.ok(!s.improvised.some((i) => i.place === YARD), 'no place beat');
      assert.ok(!s.events.some((e) => e.text === 'Improvised beat.'), 'no Improvised beat line');
      assert.strictEqual(s.positions[ADA].beat, gate2.key, 'Fight here moves nobody');
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  // final review P-A1 and P-A2, by real input: one list (the page's own, no datalist), closed by Esc and by a press
  // outside, the typed words kept
  it('the Move list is the page\'s own, and Esc or a press outside closes it', async () => {
    const run = await start(FIXTURE, 'Session 02 - The Test');
    const { model } = await api(run, 'GET', '/api/model');
    const [gate] = model.beats;
    await withPage({ width: 1449, height: 900 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await page.click(`${beat(gate.key)} [data-all]`);
      await settled(page);
      await page.waitFor('document.querySelector("#handover .where-party input[data-moveg]")');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("input[data-moveg][list], datalist").length'), 0, 'no list attribute, no datalist');
      // review M1: two notes both called "index" carry their folders
      await page.click('#handover input[data-moveg]');
      await page.type('orth');
      await page.waitFor('document.querySelector("#handover [data-movepick]")');
      const options = await page.evaluate('Array.from(document.querySelectorAll("#handover [data-movepick]"), (o) => o.textContent)');
      // changed on purpose (final review follow-up): a folder note goes by its folder, so the two no longer clash
      assert.ok(options.includes('North') && !options.some((o) => /index/.test(o)), options.join(', '));
      await page.key('Escape');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("#handover [data-mhits] button").length'), 0, 'Esc: no list');
      assert.deepStrictEqual(await page.evaluate('[document.activeElement.matches("#handover input[data-moveg]"), document.activeElement.value]'), [true, 'orth'], 'focus and words stay');
      // the list opens again on typing; a press on the jot box below closes it, and lands there
      await page.type('x');
      await page.waitFor('document.querySelector("#handover [data-mhits] button")');
      const r = await page.click('#hjot');
      assert.strictEqual(r.hit, true, 'nothing covers the jot box');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("#handover [data-mhits] button").length'), 0, 'a press outside: no list');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'hjot', 'the press did what it says');
      assert.strictEqual(await page.evaluate('document.querySelector("#handover input[data-moveg]").value'), 'orthx', 'the words stay');
      // re-review (minor 1): pressing back into the box, words still in it, opens its list again
      await page.click('#handover input[data-moveg]');
      await page.waitFor('document.querySelectorAll("#handover [data-mhits] button").length > 0');
      assert.ok((await page.evaluate('Array.from(document.querySelectorAll("#handover [data-mhits] button"), (b) => b.textContent)')).length > 0, 'the list is back');
      const s = (await api(run, 'GET', '/api/state')).state;
      assert.strictEqual(s.positions[ADA].beat, gate.key, 'nobody moved');
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  // final review P4.5: after Move them the sheet shows where they went
  it('Move them brings the beat they went to into view', async () => {
    const run = await start(FIXTURE, 'Session 02 - The Test');
    const { model } = await api(run, 'GET', '/api/model');
    const [gate, , , gate2] = model.beats;
    await withPage({ width: 1449, height: 700 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await page.click(`${beat(gate.key)} [data-all]`);
      await settled(page);
      const inView = (key) => page.evaluate(`(() => { const e = document.getElementById(${JSON.stringify(`beat:${key}`)}); if (!e) return null;
        const h = e.querySelector('h2, h3') || e; const r = h.getBoundingClientRect(); const top = document.querySelector('.top').getBoundingClientRect().bottom;
        return r.top >= top - 1 && r.bottom <= innerHeight; })()`);
      const moveTo = async (from, text, pick) => {
        await page.click(`${beat(from)} input[data-moveg]`);
        await page.type(text);
        await page.waitFor(`document.querySelector('${beat(from)} ${pick}')`);
        if (pick === '[data-movenew]') await page.click(`${beat(from)} [data-movenew]`); else await page.key('Enter');
        await settled(page);
      };
      await moveTo(gate.key, 'gate', '[data-movepick]');
      assert.strictEqual((await stateOf(run)).positions[ADA].beat, gate2.key);
      await page.waitFor(`document.getElementById(${JSON.stringify(`beat:${gate2.key}`)})`);
      assert.strictEqual(await inView(gate2.key), true, 'the Plan beat they went to is in view');
      await moveTo(gate2.key, 'Rusty Anchor', '[data-movenew]');
      const typed = (await stateOf(run)).improvised.find((i) => i.newPlace);
      await page.waitFor(`document.getElementById(${JSON.stringify(`beat:${typed.key}`)})`);
      assert.strictEqual(await inView(typed.key), true, 'the new place is in view');
      // and back up to The Gate's first beat, far above
      await moveTo(typed.key, 'gate', '[data-movepick]');
      const at = (await stateOf(run)).positions[ADA].beat;
      assert.strictEqual(await inView(at), true, `the beat ${at} is in view`);
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  // final review O2 and P4.7, by real input: Fight here on a Plan place takes the beat where the focused group
  // stands; with nobody there it ticks nobody, the fight reads as the place, and the group is offered on Add
  it('Fight here takes the beat the party stands at; with nobody there it ticks nobody and offers them on Add', async () => {
    const GATE_NOTE = 'Locations/The Gate.md';
    const run = await start(FIXTURE, 'Session 02 - The Test');
    const { model } = await api(run, 'GET', '/api/model');
    const [gate, , , gate2] = model.beats;
    assert.strictEqual(gate.key, 'b-d5e382792a');
    await withPage({ width: 1449, height: 900 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await page.click(`${beat(gate.key)} [data-all]`);
      await settled(page);
      // Ada and Ben at The Gate: Fight here on it is that beat (not the unvisited Scene 4), with its own foes
      await page.click(`#places [data-fplace="${GATE_NOTE}"]`);
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p; })()`);
      let s = await stateOf(run);
      assert.strictEqual(s.fight.beat, gate.key);
      const names = s.fight.rows.filter((r) => r.kind !== 'pc' && r.kind !== 'lair').map((r) => r.name);
      assert.deepStrictEqual(names.sort(), ['Brother Ash', 'Frost Wolf', 'Frost Wolf', 'Frost Wolf', 'Lucan Grey']);
      assert.deepStrictEqual(s.fight.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [true, true], 'both stand there');
      await page.click('#fEnd');
      await page.click('#fEnd');
      await page.waitFor(`(() => { const p = ${PROBE}; return p && !p.fight && p; })()`);
      await settled(page);
      // the party moves to North, a place of its own; Fight here on The Gate: nobody stands there
      await page.click(`${beat(gate.key)} input[data-moveg]`);
      await page.type('north');
      await page.waitFor(`document.querySelector('${beat(gate.key)} [data-movepick]')`);
      await page.key('Enter');
      await settled(page);
      const northKey = model.placeKeys['Locations/North/index.md'];
      s = await stateOf(run);
      assert.strictEqual(s.positions[ADA].beat, northKey);
      await page.waitFor(`document.getElementById(${JSON.stringify(`beat:${northKey}`)})`);
      const head = await page.evaluate(`(() => { const e = document.getElementById(${JSON.stringify(`beat:${northKey}`)}); const h = e.querySelector('h2, h3, h4'); return h ? h.textContent : ''; })()`);
      assert.match(head, /North/, `the beat's title: ${head}`);
      assert.doesNotMatch(head, /\bindex\b/);
      await page.click(`#places [data-fplace="${GATE_NOTE}"]`);
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p; })()`);
      s = await stateOf(run);
      assert.strictEqual(s.fight.beat, gate2.key, 'nobody stands at The Gate: the first unvisited beat there');
      assert.deepStrictEqual(s.fight.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [false, false], 'nobody is ticked');
      assert.deepStrictEqual(s.fight.groups, [gate2.key]);
      await page.waitFor('document.querySelector("#side .fin")');
      const fin = await page.evaluate('document.querySelector("#side .fin").textContent');
      assert.match(fin, /The Gate/, 'the fight reads as the place');
      assert.doesNotMatch(fin, /Ada|North/, 'not as the focused group\'s own place');
      // North's note is North/index.md with no name: its beat and the Add line say North, never "index"
      assert.strictEqual(s.improvised.find((i) => i.key === northKey).title, 'North');
      const adds = await page.evaluate('Array.from(document.querySelectorAll("#side [data-faddgroup]"), (b) => b.textContent)');
      assert.deepStrictEqual(adds, ['+ Ada, Ben at North'], 'the focused group is on the Add line');
      // PRENTICE's PR review 2: once the group joins, the place's empty "—" chip goes
      const hitAdd = await page.click('#side [data-faddgroup]');
      assert.ok(hitAdd.inView && hitAdd.hit, `the group button takes the click: ${JSON.stringify(hitAdd)}`);
      await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p.fight.rows.filter((r) => r.kind === 'pc' && r.in).length === 2 && p; })()`)
        .catch(async (e) => {
          const now = await probe(page);
          throw new Error(`${e.message}\nPC rows: ${JSON.stringify(now.fight && now.fight.rows.filter((r) => r.kind === 'pc').map((r) => [r.name, r.in]))}; errors: ${JSON.stringify(now.errors)}; add line: ${await page.evaluate('(document.querySelector("#side .fadd") || {}).textContent || ""')}`);
        });
      await page.waitFor('document.querySelector("#side .fin") && /Ada/.test(document.querySelector("#side .fin").textContent)');
      const joined = await page.evaluate('Array.from(document.querySelectorAll("#side .fin .gchip"), (c) => c.textContent)');
      assert.ok(joined.length > 0 && joined.every((c) => !c.startsWith('—')), `no empty chip: ${joined.join(' | ')}`);
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  // PRENTICE's PR review 2: the Move list opens upward when it would run past the window's bottom
  it('a Move box near the window\'s bottom opens its list upward, inside the window', async () => {
    const run = await start(FIXTURE, 'Session 02 - The Test');
    const { model } = await api(run, 'GET', '/api/model');
    const [gate] = model.beats;
    await withPage({ width: 1449, height: 900 }, async (page) => {
      await page.goto(`${run.base}?probe=1`);
      await settled(page);
      await page.click(`${beat(gate.key)} [data-all]`);
      await settled(page);
      const input = '#handover input[data-moveg]';
      await page.waitFor(`document.querySelector('${input}')`);
      const b = await page.box(input);
      await page.resize(1449, Math.ceil(b.bottom + 30));
      await page.waitFor(`document.querySelector('${input}').getBoundingClientRect().bottom <= innerHeight`);
      await page.click(input);
      await page.type('orth');
      await page.waitFor('document.querySelector("#handover [data-mhits] button")');
      const out = await page.evaluate(`(() => { const h = document.querySelector('#handover [data-mhits]'); const r = h.getBoundingClientRect(); return { up: h.classList.contains('up'), top: r.top, bottom: r.bottom, height: innerHeight }; })()`);
      assert.ok(out.up && out.top >= 0 && out.bottom <= out.height, JSON.stringify(out));
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });
});

// Task 9: the frustration audit's items on the Plan sheet (docs/superpowers/plans/2026-11-22-run-sheet-no-plan-ux-audit.md),
// each named by its number, by real input only (held clicks, key events, insertText), at 1449, 1280 and 1100 wide, 762 high.
describe('the audit\'s frustrations on the Plan sheet (Task 9)', { skip: browserSkip() }, () => {
  const WIDTHS = [1449, 1280, 1100];
  const PLAN = path.join('Chapters', 'Chapter 1', 'Sessions', 'Session 02', 'Session 02 - The Test - Plan.md');
  // the fixture with `edit(vault)` applied to a copy first
  async function startApp(edit) {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-page-src-'));
    made.push(src);
    fs.cpSync(FIXTURE, src, { recursive: true });
    if (edit) edit(src);
    return start(src, 'Session 02 - The Test');
  }
  const tap = async (page, sel) => {
    const r = await page.click(sel);
    assert.ok(r.inView && r.hit, `click ${sel}: ${JSON.stringify(r)}`);
    return r;
  };

  for (const width of WIDTHS) {
    // S5: a Scene cell that is a link (Dead Air's shape) read "Page Two ([[The Loop]])"
    it(`S5: Hand over shows plain names, never [[ (${width})`, async () => {
      const run = await startApp((vault) => {
        const f = path.join(vault, PLAN);
        const t = fs.readFileSync(f, 'utf8');
        const row = "| [[Ash's Note]] | Scene 1 | to build | What Ash passes down the wall |";
        assert.ok(t.includes(row));
        fs.writeFileSync(f, t.replace(row, "| [[Ash's Note]] | [[The Gate]] | to build | What Ash passes down the wall |\n| Dock ledger | [[Nowhere Hall]] | to build | names the night crew |"));
      });
      await withPage({ width, height: 762 }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        const text = await page.evaluate('document.getElementById("handover").innerText');
        assert.ok(!text.includes('[['), `no link marks: ${text}`);
        assert.match(text, /Ash's Note \(The Gate\)/);
        assert.match(text, /Dock ledger \(Nowhere Hall\)/);
        // the scene's place opens in the drawer, as the handout's own name does
        await tap(page, '#handover a[data-note="Locations/The Gate.md"]');
        await page.waitFor('document.querySelector("#drawer.open h2") && document.querySelector("#drawer h2").textContent === "The Gate"');
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S7: the box cycled landed, missed, overtaken, clear: three more clicks to undo a mistake, and only the 30 px box
    // took the click
    it(`S7: a point marked by mistake goes back with one click, and its words take the click (${width})`, async () => {
      const run = await startApp();
      const { model } = await api(run, 'GET', '/api/model');
      const b = model.beats.find((x) => (x.points || []).length);
      const pt = b.points[0];
      const li = `${beatSel(b.key)} ul.pts li:first-child`;
      const mark = async () => { await settled(page0); const s = (await api(run, 'GET', '/api/state')).state; return (s.points[pt.key] || {}).mark || ''; };
      let page0;
      await withPage({ width, height: 762 }, async (page) => {
        page0 = page;
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await tap(page, `${li} .ptb[data-pt]`);
        assert.strictEqual(await mark(), 'landed');
        await tap(page, `${li} .ptb[data-pt]`);
        assert.strictEqual(await mark(), '', 'a second click on the same mark clears it');
        // the words take the click as well as the box
        await tap(page, `${li} .pt-t`);
        assert.strictEqual(await mark(), 'landed', 'a click on the words marks it');
        await tap(page, `${li} .pt-t`);
        assert.strictEqual(await mark(), '', 'and a second one clears it');
        // missed and overtaken have their own buttons; one click on the box, or on the same button, clears either
        await tap(page, `${li} [data-ptalt="missed"]`);
        assert.strictEqual(await mark(), 'missed');
        assert.strictEqual(await page.evaluate(`document.querySelector('${li} .ptb[data-pt]').textContent`), '✗');
        await tap(page, `${li} .ptb[data-pt]`);
        assert.strictEqual(await mark(), '', 'one click on the box clears a missed mark');
        await tap(page, `${li} [data-ptalt="overtaken"]`);
        assert.strictEqual(await mark(), 'overtaken');
        await tap(page, `${li} [data-ptalt="missed"]`);
        assert.strictEqual(await mark(), 'missed', 'the other button changes it');
        await tap(page, `${li} [data-ptalt="missed"]`);
        assert.strictEqual(await mark(), '', 'the same button again clears it');
        // CodeRabbit #895: Enter on a button keeps the focus on that button of that point through the redraw
        for (const m of ['overtaken', 'missed']) {
          await page.evaluate(`document.querySelector('${li} [data-ptalt="${m}"]').focus()`);
          await page.key('Enter');
          assert.strictEqual(await mark(), m);
          await page.waitFor(`(() => { const a = document.activeElement; return Boolean(a) && a.dataset.ptalt === '${m}' && a.dataset.ptkey === ${JSON.stringify(pt.key)}; })()`, 2000);
        }
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S8: the drawer stayed open over the players' column and the sheet's right edge until Esc or Close
    it(`S8: a click on the sheet outside the drawer closes it (${width})`, async () => {
      const run = await startApp();
      await withPage({ width, height: 762 }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        const open = () => page.evaluate('document.getElementById("drawer").classList.contains("open")');
        await tap(page, '#brief a.lk[data-note]');
        await page.waitFor('document.querySelector("#drawer.open h2")');
        // the drawer slides in (0.18 s): a hand waits for it to stop
        await page.waitFor('Math.round(document.getElementById("drawer").getBoundingClientRect().right) === innerWidth');
        await page.sleep(250);
        // a click inside the drawer keeps it
        await tap(page, '#drawer h2');
        assert.strictEqual(await open(), true, 'a click inside keeps it open');
        // another note's link opens that note
        const r = await page.click('#handover a.lk[data-note]', { offsetX: 4 });
        assert.ok(r.inView && r.hit, JSON.stringify(r));
        await page.waitFor('document.querySelector("#drawer.open h2") && document.querySelector("#drawer h2").textContent === "Ash\'s Note"');
        // a click on the sheet, left of the drawer
        const h = await page.click('#pcs h2', { offsetX: 6 });
        assert.ok(h.inView && h.hit, `the heading is clear of the drawer: ${JSON.stringify(h)}`);
        await page.waitFor('!document.getElementById("drawer").classList.contains("open")', 2000);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S8, fix round 1: a held press on a button outside the open drawer closes it, and the button still acts
    it(`S8: with the drawer open, Show and Fight here outside it close it and act (${width})`, async () => {
      const run = await startApp();
      const { model } = await api(run, 'GET', '/api/model');
      const gate = model.beats[0];
      await withPage({ width, height: 762 }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await tap(page, `${beatSel(gate.key)} [data-all]`);
        await settled(page);
        const openDrawer = async () => {
          await tap(page, '#brief a.lk[data-note]');
          await page.waitFor('document.querySelector("#drawer.open h2")');
          await page.waitFor('Math.round(document.getElementById("drawer").getBoundingClientRect().right) === innerWidth');
          await page.sleep(250);
        };
        const closed = () => page.waitFor('!document.getElementById("drawer").classList.contains("open")', 2000);
        await openDrawer();
        await tap(page, `${beatSel(gate.key)} .bbtns [data-showbeat]`);
        await closed();
        await settled(page);
        const s = (await api(run, 'GET', '/api/state')).state;
        assert.ok(Object.values(s.panels || {}).some((x) => (x.people || []).length), `Show acted: ${JSON.stringify(s.panels)}`);
        await openDrawer();
        // a Fight here clear of the drawer: the first place tile's (a beat's own sits under the drawer at 1100)
        await tap(page, '#places .place [data-fplace]');
        await closed();
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p; })()`);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S6: Enter on a typed new place did nothing (only a click on "+ New place" made it), and an empty box said nothing
    it(`S6: Enter in Move them makes a typed new place; with nothing typed it says why beside the box (${width})`, async () => {
      const run = await startApp();
      const { model } = await api(run, 'GET', '/api/model');
      const gate = model.beats[0];
      await withPage({ width, height: 762 }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await tap(page, `${beatSel(gate.key)} [data-all]`);
        await settled(page);
        const box = `${beatSel(gate.key)} input[data-moveg]`;
        await tap(page, box);
        await page.key('Enter');
        const say = `${beatSel(gate.key)} .movebox [data-movesay]`;
        await page.waitFor(`(document.querySelector('${say}') || {}).textContent === 'Type a place, or pick one from the list'`, 2000);
        const r = await page.evaluate(`(() => { const e = document.querySelector('${say}').getBoundingClientRect(); const b = document.querySelector('${box}').getBoundingClientRect();
          return { inView: e.top >= 0 && e.bottom <= innerHeight && e.left >= 0 && e.right <= innerWidth && e.width > 0, near: Math.abs(e.top - b.bottom) < 40 }; })()`);
        assert.deepStrictEqual(r, { inView: true, near: true }, `the words are beside the box, in view: ${await page.evaluate(`JSON.stringify(document.querySelector('${say}').getBoundingClientRect())`)}`);
        let s = (await api(run, 'GET', '/api/state')).state;
        assert.ok(Object.values(s.positions).every((x) => x.beat === gate.key), 'nobody moved');
        // typing takes the words away; Enter on a name no place has makes it
        await page.type('Rusty Anchor');
        assert.strictEqual(await page.evaluate(`document.querySelector('${say}').textContent`), '');
        await page.key('Enter');
        await settled(page);
        s = (await api(run, 'GET', '/api/state')).state;
        const typed = s.improvised.find((i) => i.newPlace);
        assert.strictEqual(typed && typed.title, 'Rusty Anchor');
        assert.ok(Object.values(s.positions).every((x) => x.beat === typed.key), 'both PCs went there');
        // fix round 1: "North Gate" shares only its last word with The Gate: Enter makes the typed place, never The Gate
        const nbox = `${beatSel(typed.key)} input[data-moveg]`;
        await page.waitFor(`document.querySelector('${nbox}')`);
        await tap(page, nbox);
        await page.type('North Gate');
        await page.waitFor(`document.querySelector('${beatSel(typed.key)} [data-movepick]')`);
        await page.key('Enter');
        await settled(page);
        s = (await api(run, 'GET', '/api/state')).state;
        const ng = s.improvised.find((i) => i.newPlace && i.title === 'North Gate');
        assert.ok(ng, `North Gate made: ${JSON.stringify(s.improvised.map((i) => i.title))}`);
        assert.ok(Object.values(s.positions).every((x) => x.beat === ng.key), 'both PCs went to North Gate');
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S4: J, a line, Enter: stored at the end of the beat, 1,100 to 1,640 px below the window, and nothing said it took
    // fix round 1 ruling: a jot never scrolls the page; the Noted line names where the jot went
    it(`S4: a jot says "Noted under" its beat beside its box for 3 s, and never scrolls the page (${width})`, async () => {
      const run = await startApp();
      const { model } = await api(run, 'GET', '/api/model');
      const gate = model.beats[0];
      const B = beatSel(gate.key);
      const NOTED = `Noted under ${gate.title}`;
      await withPage({ width, height: 762 }, async (page) => {
        const inWindow = (sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
          return r.width > 0 && r.top >= 0 && Math.round(r.bottom) <= innerHeight && r.left >= 0 && Math.round(r.right) <= innerWidth; })()`);
        // what the GM reads stays put: the beat's heading on screen (scrollY itself may change, as the browser keeps the
        // view steady when a line above goes, e.g. the "No Table Log" box once the first action files it)
        const y = () => page.evaluate(`Math.round(document.querySelector('${B} h3').getBoundingClientRect().top)`);
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await tap(page, `${B} [data-all]`);
        await settled(page);
        // the beat's heading on screen, its jots below the window
        const top = await page.evaluate(`document.querySelector('${B} h3').getBoundingClientRect().top`);
        await page.wheel(600, 400, Math.round(top - 250));
        await page.key('j');
        await page.waitFor('document.activeElement.id === "hjot"', 2000);
        // J leaves the page where the GM is reading (it jumped to the top)
        const y0 = await y();
        assert.ok(await page.evaluate('scrollY') > 0, 'scrolled down to the beat');
        await page.type('the bell rang twice');
        await page.key('Enter');
        await settled(page);
        await page.waitFor(`(document.getElementById('hnoted') || {}).textContent === ${JSON.stringify(NOTED)}`, 1000);
        assert.strictEqual(await inWindow('#hnoted'), true, 'the header\'s Noted is in view');
        assert.strictEqual(await y(), y0, 'the page did not move');
        await page.waitFor(`(document.getElementById('hnoted') || {}).textContent === ''`, 4000);
        // the beat's own box, mid-window: Noted beside it, and the page stays
        const box = await page.box(`${B} input[data-jot]`);
        await page.wheel(600, 400, Math.round(box.top - 400));
        const y1 = await y();
        await tap(page, `${B} input[data-jot]`);
        await page.type('Ash lowers the rope');
        await page.key('Enter');
        await settled(page);
        await page.waitFor(`(document.querySelector('${B} .jot [data-noted]') || {}).textContent === ${JSON.stringify(NOTED)}`, 1000);
        assert.strictEqual(await inWindow(`${B} .jot [data-noted]`), true, 'Noted beside the beat\'s box');
        assert.strictEqual(await y(), y1, 'the page did not move');
        const s = (await api(run, 'GET', '/api/state')).state;
        assert.deepStrictEqual(s.jots.map((j) => j.text), ['the bell rang twice', 'Ash lowers the rope']);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S3: no find box anywhere outside a fight; People in Plan order, 2,640 px tall at 1100
    it(`S3: one find box over people and places, near matches, Enter and the arrows; People A to Z; no datalist (${width})`, async () => {
      const run = await startApp();
      await withPage({ width, height: 762 }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.strictEqual(await page.evaluate('document.querySelectorAll("datalist, input[list]").length'), 0, 'no datalist in the page');
        const names = await page.evaluate('Array.from(document.querySelectorAll("#people tbody tr td:first-child a[data-note]"), (a) => a.textContent.trim())');
        assert.ok(names.length >= 3, names.join(", "));
        assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'People A to Z');
        // keyboard-reachable: from the rail's heading, Tab passes its fold and lands in the box
        await page.click('#rail .rhd', { offsetX: 6 });
        await page.key('Tab');
        await page.key('Tab');
        assert.strictEqual(await page.evaluate('document.activeElement.id'), 'find', 'Tab reaches the find box');
        const box = await page.evaluate('(() => { const r = document.getElementById("find").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.width > 0; })()');
        assert.strictEqual(box, true, 'the box is on the first screen');
        const hits = () => page.evaluate('Array.from(document.querySelectorAll("#findHits [data-findhit]"), (b) => [b.querySelector(".n").textContent, b.querySelector(".k").textContent, b.classList.contains("sel")])');
        // case and accents never matter; a word's start finds it; people and places together, by kind
        await page.type('GÁTE');
        await page.waitFor('document.querySelectorAll("#findHits [data-findhit]").length > 0');
        assert.deepStrictEqual(await hits(), [['The Gate', 'place', true], ['The Gate House', 'place', false]]);
        // the arrows move through the hits; Enter opens the one picked in the drawer
        await page.key('ArrowDown');
        assert.deepStrictEqual((await hits()).map((h) => h[2]), [false, true]);
        await page.key('Enter');
        await page.waitFor('document.querySelector("#drawer.open h2") && document.querySelector("#drawer h2").textContent === "The Gate House"');
        await page.key('Escape');
        await page.waitFor('!document.getElementById("drawer").classList.contains("open")');
        // Enter takes the first hit; a person and a creature carry their kind
        await page.click('#find');
        await page.type('fro');
        await page.waitFor('document.querySelector("#findHits [data-findhit]") && /Frost/.test(document.querySelector("#findHits [data-findhit]").textContent)');
        assert.deepStrictEqual((await hits())[0].slice(0, 2), ['Frost Wolf', 'creature']);
        await page.key('Enter');
        await page.waitFor('document.querySelector("#drawer.open h2") && document.querySelector("#drawer h2").textContent === "Frost Wolf"');
        await page.key('Escape');
        await page.click('#find');
        await page.type('ash');
        await page.waitFor('document.querySelector("#findHits [data-findhit]")');
        assert.deepStrictEqual((await hits()).map((h) => h.slice(0, 2)), [['Brother Ash', 'person']]);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });
  }
});
