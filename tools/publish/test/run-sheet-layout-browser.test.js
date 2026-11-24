'use strict';
// The real-input helpers of test/helpers/cdp.js (click held, drag, wheel, type, box) in a real browser,
// against a small data: page. Later layout tests lean on these: a synthetic event has passed a test
// while a real hand failed. Skipped without Chrome, except on CI.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession } = require('../lib/run-sheet/sessions');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');
const { findChrome } = require('../lib/chrome');
const { sane } = require('./helpers/fight-layout');

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<button id="b" style="position:absolute;left:40px;top:40px;width:120px;height:40px">go</button>
<div id="pad" style="position:absolute;left:300px;top:40px;width:100px;height:100px;background:#ccc"></div>
<div id="box" style="position:absolute;left:40px;top:200px;width:200px;height:100px;overflow:auto"><div style="height:1000px">tall</div></div>
<div id="rail" style="position:absolute;left:500px;top:20px;width:28px;height:300px;background:#888"></div>
<div id="cover" style="display:none;position:absolute;left:40px;top:40px;width:120px;height:40px;opacity:0"></div>
<button id="far" style="position:absolute;left:40px;top:1500px;width:100px;height:30px">far</button>
<input id="t" style="position:absolute;left:300px;top:200px">
<script>
  window.log = []; window.hits = { rail: [], cover: 0, far: 0 };
  document.getElementById('rail').addEventListener('click', (e) => window.hits.rail.push(e.offsetY));
  document.getElementById('cover').addEventListener('click', () => window.hits.cover++);
  document.getElementById('far').addEventListener('click', () => window.hits.far++);
  const b = document.getElementById('b');
  for (const t of ['mousedown', 'mouseup', 'click']) b.addEventListener(t, (e) => window.log.push({ t, at: performance.now(), buttons: e.buttons }));
  const pad = document.getElementById('pad');
  let from = null;
  pad.addEventListener('mousedown', (e) => { from = { x: e.clientX, y: e.clientY, l: pad.offsetLeft, t: pad.offsetTop }; });
  window.addEventListener('mousemove', (e) => { if (from && e.buttons === 1) { pad.style.left = from.l + e.clientX - from.x + 'px'; pad.style.top = from.t + e.clientY - from.y + 'px'; } });
  window.addEventListener('mouseup', () => { from = null; });
</script>`;
const URL_ = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`;

describe('real-input page helpers', { skip: browserSkip() }, () => {
  it('a held click presses, waits, releases and clicks the centre of a button', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("b")');
      await page.click('#b');
      const log = await page.evaluate('window.log');
      assert.deepStrictEqual(log.map((e) => e.t), ['mousedown', 'mouseup', 'click']);
      assert.ok(log[1].at - log[0].at >= 85, `press held ${log[1].at - log[0].at} ms`);
      assert.strictEqual(log[0].buttons, 1);
      assert.strictEqual(log[1].buttons, 0);
    });
  });

  it('box says where an element is', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("b")');
      const r = await page.box('#b');
      assert.deepStrictEqual([r.x, r.y, r.width, r.height], [40, 40, 120, 40]);
      assert.deepStrictEqual([r.left, r.top, r.right, r.bottom], [40, 40, 160, 80]);
    });
  });

  it('a wheel turn returns once its scroll has landed, however late (#852)', async () => {
    // A page whose wheel scroll lands 150 ms late, as a slow machine's does: the box measured after the turn
    // must already be where the click will find it.
    const late = `<!doctype html><body style="margin:0"><div style="height:3000px"></div><script>
      addEventListener('wheel', (e) => { e.preventDefault(); const dy = e.deltaY; setTimeout(() => scrollBy(0, dy), 150); }, { passive: false });
      </script></body>`;
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(late)}`);
      await page.waitFor('document.body');
      await page.wheel(300, 200, 300);
      assert.strictEqual(await page.evaluate('scrollY'), 300);
      const t0 = Date.now();
      await page.wheel(300, 200, 0); // scrolls nothing: back after the wait for a scroll that never starts
      assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
    });
  });

  it('a Chrome that never answers its setup is stopped and launched once more (#852)', { skip: process.platform === 'win32' && 'a shell stand-in' }, async () => {
    // The macOS runner's "Runtime.enable: no answer in 30 s": a stand-in that says nothing on its first launch and
    // starts the real Chrome on its second.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-silent-'));
    try {
      const mark = path.join(dir, 'launched');
      const stand = path.join(dir, 'chrome.sh');
      fs.writeFileSync(stand, `#!/bin/sh\nif [ ! -f '${mark}' ]; then : > '${mark}'; exec sleep 60; fi\nexec '${findChrome()}' "$@"\n`, { mode: 0o755 });
      const got = await withPage({ width: 600, height: 400, chrome: stand, stepMs: 3000 }, async (page) => {
        await page.goto(URL_);
        return page.waitFor('document.getElementById("b") && "opened"');
      });
      assert.strictEqual(got, 'opened');
      assert.ok(fs.existsSync(mark), 'the silent first launch happened');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a drag moves a test element by the distance dragged', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("pad")');
      await page.drag(350, 90, 450, 140);
      const r = await page.box('#pad');
      assert.deepStrictEqual([r.left, r.top], [400, 90]);
    });
  });

  it('a wheel over a box scrolls it', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("box")');
      await page.wheel(100, 250, 120);
      await page.waitFor('document.getElementById("box").scrollTop >= 100');
    });
  });

  it('type puts text into the focused box', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("t")');
      await page.click('#t');
      await page.type('Gilt – ünï');
      assert.strictEqual(await page.evaluate('document.getElementById("t").value'), 'Gilt – ünï');
    });
  });

  it('a click lands anywhere along a thin tall element', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("rail")');
      const top = await page.click('#rail', { offsetX: 14, offsetY: 4 });
      const bottom = await page.click('#rail', { offsetX: 14, offsetY: 295 });
      assert.ok(top.hit && bottom.hit);
      assert.deepStrictEqual(await page.evaluate('window.hits.rail'), [4, 295]);
    });
  });

  it('a click on an element below the fold scrolls it in and lands', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("far")');
      const r = await page.click('#far');
      assert.ok(r.inView && r.hit);
      assert.strictEqual(await page.evaluate('window.hits.far'), 1);
      assert.ok(await page.evaluate('scrollY') > 0);
    });
  });

  it('choose picks options of a plain select by typing, then by arrow, and the page hears each change', async () => {
    const page_ = `<!doctype html><meta charset="utf-8"><body style="margin:0"><select id="m" style="position:absolute;left:40px;top:40px">
      <option value="strike">Strike</option><option value="sweep">Sweep</option><option value="sweep2">Sweep (Double)</option>
      <option value="shove">Shove</option><option value="tuck">Tuck in</option></select>
      <script>window.heard = []; document.getElementById('m').addEventListener('change', (e) => window.heard.push(e.target.value));</script>`;
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(page_)}`);
      await page.waitFor('document.getElementById("m")');
      assert.strictEqual(await page.choose('#m', 'Sweep (D'), 'Sweep (Double)');
      assert.strictEqual(await page.choose('#m', 'Sho'), 'Shove');
      assert.strictEqual(await page.choose('#m', 'Tuck i'), 'Tuck in');
      assert.strictEqual(await page.choose('#m', 'Str'), 'Strike');
      assert.strictEqual(await page.evaluate('document.getElementById("m").value'), 'strike');
      // typing passes through the options on the way ("Sweep" is heard before "Sweep (Double)"): the last four are the choices
      assert.deepStrictEqual((await page.evaluate('window.heard')).slice(-4), ['sweep2', 'shove', 'tuck', 'strike']);
      await assert.rejects(() => page.choose('#m', 'Nothing like it'), /no option starting/);
    });
  });

  it('a click on a covered point reports hit false and the cover gets the click', async () => {
    await withPage({ width: 600, height: 400 }, async (page) => {
      await page.goto(URL_);
      await page.waitFor('document.getElementById("b")');
      await page.evaluate('document.getElementById("cover").style.display = "block"');
      const r = await page.click('#b');
      assert.strictEqual(r.hit, false);
      assert.deepStrictEqual(await page.evaluate('window.hits.cover'), 1);
      assert.strictEqual((await page.evaluate('window.log')).length, 0);
    });
  });
});


// ---- the run sheet's fight, driven by real input only (Input.dispatchMouseEvent, Input.dispatchKeyEvent,
// Input.insertText): never dispatchEvent, never .click().
const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const SESSION = 'Session 03 - Next';
const PARTY = ['Characters/PCs/Ada Moss.md', 'Characters/PCs/Ben Hart.md'];
const [ADA, BEN] = PARTY;
const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';
const made = [];
const servers = [];
after(async () => {
  for (const t of servers) { try { await t.close(); } catch { /* closed already */ } }
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

async function start() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-layout-'));
  made.push(vault);
  fs.cpSync(FIXTURE, vault, { recursive: true });
  const picked = pickSession(listSessions(vault), SESSION, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 20, log: () => {} } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  const base = `http://127.0.0.1:${port}`;
  const model = (await (await fetch(`${base}/api/model`)).json()).model;
  return { ...t, vault, base, model };
}
const until = (page, test, ms) => page.waitFor(`(() => { const p = ${PROBE}; return p && (${test}) && p; })()`, ms);
const settled = (page) => until(page, 'p.saved === "Saved" && p.pending === 0');
const rowOf = (p, note) => p.fight.rows.find((r) => r.note === note);
const named = (p, name) => p.fight.rows.find((r) => r.name === name);
// A real click that must land on the element it names.
async function tap(page, sel, opts) {
  const r = await page.click(sel, opts);
  assert.ok(r.inView && r.hit, `click ${sel}: ${JSON.stringify(r)}`);
  return r;
}
// Both PCs to beat 1, Fight, the PCs' numbers typed, the foes rolled, Start: round 1.
async function startedFight(page, run) {
  await page.goto(`${run.base}/?probe=1`);
  await settled(page);
  const b = run.model.beats[0];
  await tap(page, `[id="beat:${b.key}"] [data-all]`);
  await settled(page);
  await tap(page, `[id="beat:${b.key}"] [data-fight]`);
  let p = await until(page, 'p.fight && p.fight.rows.length > 0');
  for (const [note, v] of [[ADA, '15'], [BEN, '12']]) {
    await tap(page, `[data-fini="${rowOf(p, note).id}"]`);
    await page.type(v);
    await page.key('Enter');
  }
  await settled(page);
  await tap(page, '#fRoll');
  await until(page, 'p.fight.rows.filter((r) => r.in && (r.kind === "foe" || r.kind === "ally")).every((r) => r.ini !== null)');
  await tap(page, '#fNext');
  p = await until(page, 'p.fight.round === 1 && p.saved === "Saved" && p.pending === 0');
  return p;
}
// Type a name in the Add box and take its last item, "+ New".
async function addNew(page, name, count) {
  await tap(page, '#fAddName');
  await page.type(name);
  await page.waitFor('document.querySelector("[data-faddnew]")');
  if (count !== undefined) { await tap(page, '#fAddCount'); await page.type(String(count)); }
  await tap(page, '[data-faddnew]');
}

describe('the fight: adding anyone, by real input', { skip: browserSkip() }, () => {
  it('count box: a real click on 1, type 3, gives 3', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const b = run.model.beats[0];
      await tap(page, `[id="beat:${b.key}"] [data-all]`);
      await settled(page);
      await tap(page, `[id="beat:${b.key}"] [data-fight]`);
      await until(page, 'p.fight && p.fight.rows.length > 0');
      await tap(page, '#fAddName');
      await page.type('Ice Drake');
      await tap(page, '#fAddCount');
      await page.type('3');
      assert.strictEqual(await page.evaluate('document.querySelector("#fAddCount").value'), '3', 'the click selected the 1');
      await page.key('Enter');
      await tap(page, '#fAddName');
      await page.key('Enter');
      const p = await until(page, 'p.fight.rows.filter((r) => r.note === "Creatures/Ice Drake.md").length === 3');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('after Start, three new rows typed 9 Tab 8 Tab 7 each keep their own number', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      await addNew(page, 'Bouncer', 3);
      let p = await until(page, 'p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 3');
      assert.deepStrictEqual(p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).map((r) => r.ini), [null, null, null]);
      await tap(page, `[data-fini="${named(p, 'Bouncer 1').id}"]`);
      await page.type('9');
      await page.key('Tab');
      await page.type('8');
      await page.key('Tab');
      await page.type('7');
      await page.key('Enter');
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.filter((r) => /^Bouncer/.test(r.name) && r.ini !== null).length === 3');
      assert.deepStrictEqual(['Bouncer 1', 'Bouncer 2', 'Bouncer 3'].map((n) => named(p, n).ini), [9, 8, 7]);
      // each at its sorted place among the others, the turn where it was
      const order = p.fight.rows.filter((r) => r.in).map((r) => r.ini);
      assert.ok(order.indexOf(9) < order.indexOf(8) && order.indexOf(8) < order.indexOf(7));
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // final review P-A1 (re-review ruling): the Add list is in flow, never over the order, so a click meant for a row's
  // name with the list OPEN lands on that name. Esc closes it; a press outside closes it once its click has landed.
  for (const w of [1280, 1449]) {
    it(`${w}: with the Add list open no item lies over a row, and a held click on Ben Hart's name picks him, adding nobody`, async () => {
      const run = await start();
      await withPage({ width: w, height: 762 }, async (page) => {
        const was = await startedFight(page, run);
        const count = was.fight.rows.length;
        const ben = was.fight.rows.find((r) => r.note === BEN);
        const listOpen = () => page.evaluate('document.querySelectorAll("#fHits button").length');
        await tap(page, '#fAddName');
        await page.type('a');
        await page.waitFor('document.querySelector("#fHits button")');
        await page.key('Escape');
        assert.strictEqual(await listOpen(), 0, 'Esc: no list');
        assert.deepStrictEqual(await page.evaluate('[document.activeElement.id, document.activeElement.value]'), ['fAddName', 'a'], 'focus and words stay');
        await page.key('Backspace');
        await page.type('a');
        await page.waitFor('document.querySelector("#fHits button")');
        // the list is open: no item's box meets any row's box
        const overlap = await page.evaluate(`(() => {
          const rows = Array.from(document.querySelectorAll('#side ol.to > li'), (e) => e.getBoundingClientRect());
          const items = Array.from(document.querySelectorAll('#fHits button'), (e) => e.getBoundingClientRect());
          const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          return { items: items.length, hits: items.filter((i) => rows.some((r) => meet(i, r))).length }; })()`);
        assert.ok(overlap.items > 0, 'the list is open');
        assert.strictEqual(overlap.hits, 0, `no list item over a row: ${JSON.stringify(overlap)}`);
        assert.ok((await listOpen()) > 0, 'still open before the click');
        // a held click on Ben Hart's name, the list still open: it is his name the pointer meets
        const r = await page.click(`[data-fpeek="${ben.id}"]`, { holdMs: 90 });
        assert.strictEqual(r.hit, true, 'the name itself is under the pointer');
        const p = await until(page, 'p.saved === "Saved" && p.pending === 0');
        assert.strictEqual(p.fight.rows.length, count, 'nobody added');
        assert.deepStrictEqual(await page.evaluate('[document.querySelector("#acting .why").textContent, document.querySelector("#acting h3").textContent]'), ['picked', 'Ben Hart']);
        await page.waitFor('document.querySelectorAll("#fHits button").length === 0');
        assert.strictEqual(await page.evaluate('document.querySelector("#fAddName").value'), 'a', 'the typed words stay');
        assert.deepStrictEqual(p.errors, []);
      });
    });
  }

  it('Undo takes back an untouched add with a real click; a touched add has no Undo', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const was = await startedFight(page, run);
      await addNew(page, 'Bouncer', 13);
      let p = await until(page, 'p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 13');
      await page.waitFor('document.querySelector("[data-fundo]")');
      await tap(page, '[data-fundo]');
      p = await until(page, 'p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 0 && p.saved === "Saved" && p.pending === 0');
      assert.deepStrictEqual(p.fight.rows.map((r) => r.id), was.fight.rows.map((r) => r.id), 'the order is as it was');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("[data-fundo]").length'), 0);
      await addNew(page, 'Guard', 2);
      p = await until(page, 'p.fight.rows.filter((r) => /^Guard/.test(r.name)).length === 2');
      await tap(page, `[data-fini="${named(p, 'Guard 1').id}"]`);
      await page.type('4');
      await page.key('Enter');
      await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.some((r) => r.name === "Guard 1" && r.ini === 4)');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("[data-fundo]").length'), 0, 'typed into: no Undo');
      assert.deepStrictEqual((await until(page, 'true')).errors, []);
    });
  });

  it('Same for all: a real click copies a typed max to the untouched copies and the button goes', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      await addNew(page, 'Bouncer', 3);
      let p = await until(page, 'p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 3');
      const one = named(p, 'Bouncer 1');
      await tap(page, `[data-fmax="${one.id}"]`);
      await page.type('30');
      await page.key('Enter');
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.some((r) => r.name === "Bouncer 1" && r.max === 30)');
      await tap(page, `[data-fpeek="${one.id}"]`);
      await page.waitFor('document.querySelector("[data-fsame]")');
      // step 6b Task 23 changed this on purpose (D3): the number is how many will take something, the two copies
      assert.match(await page.evaluate('document.querySelector("[data-fsame]").textContent'), /^Same for all 2$/);
      await tap(page, '[data-fsame]');
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.filter((r) => /^Bouncer/.test(r.name) && r.max === 30).length === 3');
      assert.deepStrictEqual(['Bouncer 2', 'Bouncer 3'].map((n) => named(p, n).hp), [30, 30]);
      assert.strictEqual(await page.evaluate('document.querySelectorAll("[data-fsame]").length'), 0, 'nothing left to copy to');
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

// ---- the fight's layout (plan 6a Task 10): the four columns, the grip, the folds, the preview, the order's own
// scroll. Real input only; the state a test needs that is not what it tests (statuses on a row, a saved width)
// comes from another window's actions or from the page's own storage, never from a synthetic event.
const WYRM = 'Creatures/Glacier Wyrm.md';
const SIZES = [[1449, 762], [1280, 762], [1100, 762]];
// What every layout test holds (no row clipped, no sideways scroll, the probe's layout fields there): helpers/fight-layout.js.
// Both PCs to beat 1 (or `at`), then Fight on beat `on` (default the first), by real clicks.
async function fightAt(page, run, { at = 0, on = 0 } = {}) {
  await page.goto(`${run.base}/?probe=1`);
  await settled(page);
  await tap(page, `[id="beat:${run.model.beats[at].key}"] [data-all]`);
  await settled(page);
  await tap(page, `[id="beat:${run.model.beats[on].key}"] [data-fight]`);
  return until(page, 'p.fight && p.fight.rows.length > 0 && p.layout && p.layout.railW !== undefined');
}
// Another window's actions, as the server takes them: the page hears them on its stream.
let otherN = 0;
async function fromOther(run, actions) {
  const { stateId } = await (await fetch(`${run.base}/api/state`)).json();
  const res = await fetch(`${run.base}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stateId, base: 0, clientId: 'other-tab', actions: actions.map((a) => ({ id: `o-${++otherN}`, ...a })) }) });
  assert.strictEqual(res.status, 200);
}
// The grip dragged by `dx` with a real pointer (negative: to the left, the pane wider).
async function dragGrip(page, dx) {
  const g = await page.box('#grip');
  const x = g.left + g.width / 2;
  const y = g.top + g.height / 2;
  await page.drag(x, y, x + dx, y, 10);
}
const P = (page) => page.evaluate(PROBE);
const inside = (b, top, bottom) => b.top >= top - 0.5 && b.bottom <= bottom + 0.5;

describe('10a: the right pane holds the fight\'s beat', { skip: browserSkip() }, () => {
  it('the pane holds only the cut, and the links work', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      const beat = run.model.beats[0];
      const only = () => page.evaluate(`({ cut: Boolean(document.querySelector('#sheet #fightCut')), beats: document.querySelectorAll('#sheet .beat').length,
        sections: document.querySelectorAll('#sheet section.s').length, whole: Boolean(document.querySelector('#sheet #paneWhole')),
        pts: document.querySelectorAll('#fightCut ul.pts li').length, who: Boolean(document.querySelector('#fightCut .cwho')),
        ifs: Boolean(document.querySelector('#fightCut table.ifs')), jots: document.querySelectorAll('#fightCut [data-fjot]').length })`);
      let o = await only();
      assert.deepStrictEqual([o.cut, o.beats, o.sections, o.whole], [true, 0, 0, true], `the cut alone: ${JSON.stringify(o)}`);
      assert.ok(o.pts > 0 && o.who && o.ifs && o.jots === 3, `points, who, if-they and the jots: ${JSON.stringify(o)}`);
      sane(await P(page), 'cut');
      // full beat ↓, then Cut it down
      await tap(page, '#fightCut [data-pane="beat"]');
      await page.waitFor(`document.querySelector('#sheet [id="beat:${beat.key}"]')`);
      o = await only();
      assert.deepStrictEqual([o.cut, o.beats, o.sections], [false, 1, 0], 'the whole beat');
      assert.match(await page.evaluate('document.querySelector("#paneCut").textContent'), /^Cut it down$/);
      await tap(page, '#paneCut');
      await page.waitFor('document.querySelector("#sheet #fightCut")');
      // Whole run sheet, then Back to the fight's beat
      await tap(page, '#paneWhole');
      await page.waitFor('document.querySelector("#sheet section#people")');
      assert.match(await page.evaluate('document.querySelector("#paneCut").textContent'), /^Back to the fight's beat$/);
      assert.ok((await only()).beats >= 3, 'every beat');
      await page.wheel(1200, 500, 900);
      await until(page, 'p.layout.paneTop > 300');
      await tap(page, '#paneCut');
      let p = await until(page, 'p.layout.paneTop === 0');
      assert.ok((await only()).cut, 'back to the cut, at the pane\'s top');
      // a rail link to anything else opens the whole sheet at it
      await tap(page, '#rail a[data-go="people"]');
      await page.waitFor('document.querySelector("#sheet section#people")');
      const pane = await page.box('#sheet');
      const people = await page.box('#people');
      assert.ok(people.top >= pane.top && people.top < 762 - 40, `People in the pane at ${people.top}`);
      assert.strictEqual(await page.evaluate('scrollY'), 0, 'the page itself does not scroll');
      sane(await P(page), 'whole');
      await tap(page, '#paneCut');
      // a contingency with people: "+ If: …" on the Add line brings them in
      const ifBeat = run.model.beats.find((b) => b.contingency);
      await page.waitFor(`document.querySelector('.fadd [data-faddbeat="${ifBeat.key}"]')`);
      assert.match(await page.evaluate(`document.querySelector('.fadd [data-faddbeat="${ifBeat.key}"]').textContent`), /^\+ If: Tallow Alarm$/);
      const imps = p.fight.rows.filter((r) => r.note === 'Creatures/Rime Imp.md').length;
      await tap(page, `.fadd [data-faddbeat="${ifBeat.key}"]`);
      p = await until(page, `p.fight.rows.filter((r) => r.note === 'Creatures/Rime Imp.md').length === ${imps + 1} && p.pending === 0`);
      assert.strictEqual(await page.evaluate(`document.querySelectorAll('.fadd [data-faddbeat="${ifBeat.key}"]').length`), 0, 'its people are in: no button');
      // paused: the whole sheet comes back with the strip; Resume brings the cut, at the pane's top
      await tap(page, '#fPause');
      await page.waitFor('document.querySelector("#fightStrip") && document.querySelector("#sheet section#handover")');
      await tap(page, '#fResume');
      p = await until(page, '!p.fight.paused && p.layout.paneTop === 0');
      assert.ok((await only()).cut);
      sane(p, 'resumed');
    });
  });

  it('Fight from a beat far down the sheet opens the pane at its top', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      await tap(page, `[id="beat:${run.model.beats[0].key}"] [data-all]`);
      await settled(page);
      const last = run.model.beats[run.model.beats.length - 1];
      const sel = `[id="beat:${last.key}"] [data-fight]`;
      // a real wheel down the run sheet until the last beat's Fight is in view
      for (let i = 0; i < 30; i++) {
        const b = await page.box(sel);
        if (b.top > 80 && b.bottom < 700) break;
        await page.wheel(700, 400, 300);
        await page.sleep(60);
      }
      assert.ok(await page.evaluate('scrollY') > 300, 'the sheet was scrolled down');
      const r = await page.clickAt(...await page.box(sel).then((b) => [b.left + b.width / 2, b.top + b.height / 2]));
      void r;
      const p = await until(page, 'p.fight && p.layout.paneTop === 0');
      const h2 = await page.box('#fightCut h2');
      const pane = await page.box('#sheet');
      assert.ok(h2.top >= pane.top && h2.bottom <= 762, `the cut's heading at ${h2.top}-${h2.bottom}, the pane from ${pane.top}`);
      assert.strictEqual(await page.evaluate('scrollY'), 0);
      sane(p, 'fight from below');
    });
  });
});

describe('10b: the grip and the widths', { skip: browserSkip() }, () => {
  for (const [w, h] of SIZES.slice(0, 2)) {
    it(`the grip drags 60 px each way at ${w}`, async () => {
      const run = await start();
      await withPage({ width: w, height: h }, async (page) => {
        let p = await fightAt(page, run);
        sane(p, 'opened');
        // 1449: the rail open; 1280: the boss row needs 748 px, so the page folds the rail to fit (review F2)
        assert.strictEqual(p.layout.railFolded, w < 1449, `rail folded at ${w}: ${p.layout.railFolded}`);
        assert.strictEqual(p.layout.auto.rail, w < 1449);
        assert.ok(p.layout.grip.shown, 'the grip is there');
        const d0 = p.layout.sheetW;
        assert.strictEqual(d0, Math.min(600, p.layout.room.max - 80), 'the default width');
        // narrower stops at the pane's 320 px least: where fonts run wider than a Mac's (CI's Linux), the order's
        // least width grows and the default sits under 380
        await dragGrip(page, -60);
        p = await until(page, `p.layout.sheetW !== ${d0}`);
        assert.strictEqual(p.layout.sheetW, d0 + 60, 'dragged left: the pane 60 px wider');
        sane(p, 'wider');
        await dragGrip(page, 120);
        p = await until(page, `p.layout.sheetW === ${Math.max(p.layout.room.min, d0 - 60)}`);
        sane(p, 'narrower');
        assert.strictEqual(p.layout.saved.rw, Math.max(p.layout.room.min, d0 - 60), 'the width is kept');
      });
    });
  }

  it('stops at each limit, tinted while there, and the title gives the range', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      const { min, max } = p.layout.room;
      assert.deepStrictEqual([min, max], [320, 1449 - 220 - 12 - p.layout.orderMin]);
      assert.match(await page.evaluate('document.querySelector("#grip").title'), new RegExp(`${min}-${max} px`));
      const g = await page.box('#grip');
      const x = g.left + 6;
      const y = g.top + 200;
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y, { buttons: 1 });
      for (const to of [x - 200, x - 500, x - 800]) await page.mouse('mouseMoved', to, y, { buttons: 1 });
      assert.ok(await page.evaluate('document.querySelector("#grip").classList.contains("limit")'), 'tinted at the limit');
      await page.mouse('mouseReleased', x - 800, y);
      p = await until(page, `p.layout.sheetW === ${max}`);
      sane(p, 'at max');
      await dragGrip(page, 900);
      p = await until(page, `p.layout.sheetW === ${min}`);
      sane(p, 'at min');
      assert.ok(!await page.evaluate('document.querySelector("#grip").classList.contains("limit")'), 'the tint goes on release');
    });
  });

  it('double-click resets', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      const d0 = p.layout.sheetW;
      await dragGrip(page, -50);
      p = await until(page, `p.layout.sheetW === ${d0 + 50}`);
      const g = await page.box('#grip');
      const x = g.left + 6;
      const y = g.top + 300;
      await page.mouse('mouseMoved', x, y);
      for (const n of [1, 2]) {
        await page.mouse('mousePressed', x, y, { buttons: 1, clickCount: n });
        await page.mouse('mouseReleased', x, y, { clickCount: n });
      }
      p = await until(page, `p.layout.sheetW === ${d0} && p.layout.saved.rw === null`);
      sane(p, 'reset');
    });
  });

  it('a window resize clamps the width again', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await dragGrip(page, -400);
      p = await until(page, `p.layout.sheetW === ${p.layout.room.max}`);
      await page.resize(1340, 762);
      p = await until(page, 'p.layout.room && p.layout.room.max === 1340 - 220 - 12 - p.layout.orderMin');
      assert.strictEqual(p.layout.sheetW, p.layout.room.max);
      sane(p, 'after the resize');
    });
  });

  it('a boss row is never clipped: the Glacier Wyrm with three statuses, at every width and state', async () => {
    for (const [w, h] of SIZES) {
      const run = await start();
      await withPage({ width: w, height: h }, async (page) => {
        let p = await startedFight(page, run);
        const wyrm = p.fight.rows.find((r) => r.note === WYRM);
        const f = p.fight.id;
        await fromOther(run, ['Frightened', 'Prone', 'Poisoned'].map((add) => ({ type: 'status', fight: f, row: wyrm.id, add })));
        p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 3`);
        const check = async (state) => {
          const now = await P(page);
          sane(now, `${w} ${state}`);
          const row = now.layout.rows.find((r) => r.id === wyrm.id);
          assert.ok(!row.over && !row.nameCut && row.h <= 40, `${w} ${state}: ${JSON.stringify(row)}`);
          return now;
        };
        p = await check('default');
        if (p.layout.grip.shown) {
          await dragGrip(page, -900);
          await check('pane at its max');
          await dragGrip(page, 900);
          await check('pane at its min');
        }
        if (!p.layout.folded) {
          await tap(page, '#paneFold');
          await until(page, 'p.layout.folded');
          await check('pane folded');
          await tap(page, '#paneOpen');
          await until(page, '!p.layout.folded');
        } else {
          await tap(page, '#paneOpen');
          await until(page, '!p.layout.folded');
          await check('pane opened by hand');
        }
        p = await P(page);
        if (p.layout.railFolded) {
          // opened by hand: it opens where the order keeps its room, and stays a strip where it cannot
          const room = p.layout.orderMin + 220 + 40 <= w;
          await tap(page, '#railOpen');
          if (room) await until(page, '!p.layout.railFolded');
          else { await page.sleep(200); assert.ok((await P(page)).layout.railFolded, `${w}: no room to open the rail`); }
          await check('rail opened by hand');
        } else {
          await tap(page, '#railFold');
          await until(page, 'p.layout.railFolded');
          await check('rail folded');
        }
      });
    }
  });

  it('a saved width too wide is clamped on load', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      await page.evaluate('localStorage.setItem("rs:layout", JSON.stringify({ rw: 5000 }))');
      const p = await fightAt(page, run);
      assert.strictEqual(p.layout.sheetW, p.layout.room.max, `${p.layout.sheetW} against ${p.layout.room.max}`);
      sane(p, 'clamped');
    });
  });

  it('with rail and pane folded at 1449 the acting panel sits beside the order and ends inside the window', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      assert.strictEqual(p.layout.beside, false, 'stacked while the middle is narrow');
      await tap(page, '#railFold');
      await until(page, 'p.layout.railFolded');
      await tap(page, '#paneFold');
      p = await until(page, 'p.layout.folded && p.layout.beside');
      assert.ok(p.layout.actingLeft > p.layout.orderRight - 1, `acting at ${p.layout.actingLeft}, order ends ${p.layout.orderRight}`);
      const act = await page.box('#acting');
      assert.ok(act.bottom <= 762, `the acting panel ends at ${act.bottom}`);
      assert.ok(p.layout.orderRight - (await page.box('#fOrder')).left <= 870, 'the order is capped near 860');
      sane(p, 'both folded');
    });
  });
});

// final review P4.6: the switch to the panel beside the order is the order's least width plus the panel's 420 px
describe('the acting panel beside the order', { skip: browserSkip() }, () => {
  it('at 1449 with only the pane folded (preview hidden), the panel is beside the order', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      assert.strictEqual(p.layout.railW, 220, 'the rail stays open');
      await tap(page, '#paneFold');
      p = await until(page, 'p.layout.folded');
      if (p.layout.pvOpen) { await tap(page, '#pvToggle'); p = await until(page, '!p.layout.pvOpen'); }
      p = await until(page, 'p.layout.folded && !p.layout.pvOpen');
      assert.strictEqual(p.layout.railW, 220);
      // the rule, not a width: beside once the middle holds the order's least and the panel's 420. With a Mac's
      // fonts that is so at 1449; where fonts run wider (CI's Linux) the order's least grows and the panel goes under
      const room = p.layout.sideW >= p.layout.orderMin + 420;
      assert.strictEqual(p.layout.beside, room, `the middle ${p.layout.sideW}, the order's ${p.layout.orderMin} and the panel's 420`);
      const act = await page.box('#acting');
      if (room) {
        assert.ok(p.layout.actingLeft >= p.layout.orderRight - 1, 'beside, not under');
        assert.ok(act.width >= 420 - 1, `the panel is ${act.width} px wide`);
      } else assert.ok(act.top >= (await page.box('#fOrder')).bottom - 1, 'under the order');
      sane(p, 'pane folded at 1449');
    });
  });
});

describe('10c: the folds', { skip: browserSkip() }, () => {
  it('the rail strip opens from a click anywhere along its height', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      assert.strictEqual(p.layout.railW, 220);
      for (const y of [4, 'bottom']) {
        await tap(page, '#railFold');
        p = await until(page, 'p.layout.railW === 28');
        const r = await page.box('#railOpen');
        assert.ok(r.top <= 60 && r.bottom >= 755, `the strip runs the full height: ${r.top}-${r.bottom}`);
        await tap(page, '#railOpen', { offsetX: 14, offsetY: y === 'bottom' ? r.height - 6 : y });
        p = await until(page, 'p.layout.railW === 220');
        sane(p, `opened at ${y}`);
      }
    });
  });

  it('folding the rail gives its room', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      const max = p.layout.room.max;
      await tap(page, '#railFold');
      p = await until(page, 'p.layout.railFolded');
      assert.strictEqual(p.layout.room.max, max + 192);
      assert.strictEqual(await page.evaluate('window.RunSheetPage.rightRoom().max'), max + 192);
      sane(p, 'rail folded');
    });
  });

  it('opening the rail clamps a saved width with no sideways scroll', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await tap(page, '#railFold');
      p = await until(page, 'p.layout.railFolded');
      await dragGrip(page, -600);
      p = await until(page, `p.layout.sheetW === ${p.layout.room.max}`);
      await tap(page, '#railOpen');
      p = await until(page, '!p.layout.railFolded');
      assert.strictEqual(p.layout.sheetW, p.layout.room.max, 'clamped to the room the open rail leaves');
      sane(p, 'rail opened');
    });
  });

  it('folding the rail with the pane at its maximum keeps the pane\'s width', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      await dragGrip(page, -600);
      p = await until(page, `p.layout.sheetW === ${p.layout.room.max}`);
      const w = p.layout.sheetW;
      await tap(page, '#railFold');
      p = await until(page, 'p.layout.railFolded');
      assert.strictEqual(p.layout.sheetW, w);
      // no row went out of view: the current one is in the order's box
      const inBox = await page.evaluate(`(() => { const o = document.querySelector('#side ol.to').getBoundingClientRect(); const c = document.querySelector('#side ol.to li.cur').getBoundingClientRect(); return c.top >= o.top && c.bottom <= o.bottom; })()`);
      assert.ok(inBox);
      sane(p, 'rail folded at max');
    });
  });

  it('at 1100 the page opens with the rail folded and the grip moves 60 px each way', async () => {
    // A small fight (the Tallow Alarm's Rime Imp and the party): its widest row is a plain foe's (review F2: the
    // boss fight's 748 px row does not fit beside a 320 px pane at 1100 even with the rail folded; see below).
    const run = await start();
    await withPage({ width: 1100, height: 762 }, async (page) => {
      let p = await fightAt(page, run, { on: run.model.beats.findIndex((b) => b.contingency) });
      assert.ok(p.layout.orderMin < 640, `order minimum ${p.layout.orderMin}`);
      assert.deepStrictEqual([p.layout.railFolded, p.layout.auto.rail, p.layout.saved.railFoldedFight, p.layout.folded], [true, true, false, false]);
      assert.ok(p.layout.grip.shown);
      const d0 = p.layout.sheetW;
      await dragGrip(page, -60);
      p = await until(page, `p.layout.sheetW === ${d0 + 60}`);
      sane(p, '1100 wider');
      await dragGrip(page, 120);
      p = await until(page, `p.layout.sheetW === ${Math.max(p.layout.room.min, d0 - 60)}`);
      sane(p, '1100 narrower');
    });
    // the boss fight at 1100: the rail and then the pane fold; the pane opened by hand holds until a resize
    const boss = await start();
    await withPage({ width: 1100, height: 762 }, async (page) => {
      let p = await fightAt(page, boss);
      assert.deepStrictEqual([p.layout.railFolded, p.layout.folded, p.layout.auto.pane, p.layout.grip.shown], [true, true, true, false]);
      sane(p, '1100 boss');
      await tap(page, '#paneOpen');
      p = await until(page, '!p.layout.folded');
      assert.strictEqual(p.layout.saved.folded, false, 'an auto-fold is never kept');
      sane(p, '1100 boss, pane opened');
      await page.resize(1101, 762);
      p = await until(page, 'p.layout.folded');
      sane(p, 'after a resize the page folds again');
    });
  });

  it('an auto-fold is undone when room returns', async () => {
    const run = await start();
    await withPage({ width: 1280, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      assert.ok(p.layout.railFolded && p.layout.auto.rail);
      await page.resize(1449, 762);
      p = await until(page, '!p.layout.railFolded');
      sane(p, 'room again');
      await page.resize(1280, 762);
      p = await until(page, 'p.layout.railFolded');
      // a GM click opens it: the pane narrows or folds, nothing scrolls sideways
      await tap(page, '#railOpen');
      p = await until(page, '!p.layout.railFolded');
      assert.ok(p.layout.folded, 'the pane folds to give the room');
      sane(p, 'rail opened at 1280');
    });
  });

  it('at 1000 the page is one column, as today', async () => {
    const run = await start();
    await withPage({ width: 1000, height: 762 }, async (page) => {
      const p = await fightAt(page, run);
      const side = await page.box('#side');
      const sheet = await page.box('#sheet');
      assert.strictEqual(Math.round(side.left), Math.round(sheet.left), 'one column');
      assert.ok(sheet.top >= side.bottom - 1, 'the beat under the order');
      assert.strictEqual(p.layout.railW, 0);
      assert.strictEqual(p.layout.grip.shown, false);
      assert.strictEqual(p.layout.folded, false);
      assert.strictEqual(p.layout.wide, false);
      assert.strictEqual(await page.evaluate('getComputedStyle(document.querySelector("#paneFold")).display'), 'none', 'no Fold where nothing folds');
      // a jump to what the cut does not hold opens the whole sheet, and the page scrolls to it
      await tap(page, '#endBtn');
      await page.waitFor('document.querySelector("#sheet section#end")');
      const end = await page.box('#end');
      assert.ok(end.top >= 0 && end.top < 762, `End of the night at ${end.top}`);
      assert.deepStrictEqual((await P(page)).errors, []);
    });
  });

  it('the rail\'s two flags: folded in a fight, open again after End fight', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await tap(page, '#railFold');
      p = await until(page, 'p.layout.railFolded');
      assert.deepStrictEqual([p.layout.saved.railFoldedFight, p.layout.saved.railFolded], [true, false]);
      await tap(page, '#fEnd');
      await tap(page, '#fEnd');
      p = await until(page, '!p.fight && p.layout.railW === 220');
      const rail = await page.evaluate('({ faces: document.querySelectorAll("#rail .fc .face").length, off: document.querySelectorAll("#rail [data-off]").length })');
      assert.ok(rail.faces >= 2 && rail.off >= 2, `faces and Off-screen buttons back: ${JSON.stringify(rail)}`);
      // folded out of a fight, it stays folded there only
      await tap(page, '#railFold');
      p = await until(page, 'p.layout.railW === 28');
      await page.evaluate('window.__before = true');
      await page.reload();
      p = await until(page, '!window.__before && p.layout && p.layout.railW === 28 && p.saved === "Saved"');
      await tap(page, '#railOpen');
      p = await until(page, 'p.layout.railW === 220');
      await tap(page, `[id="beat:${run.model.beats[0].key}"] [data-fight]`);
      p = await until(page, 'p.fight && p.layout.railW === 28');
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

describe('a press held while the last click is still being handled (#852)', { skip: browserSkip() }, () => {
  // The macOS runner's lost clicks: a click whose handler runs long (a big redraw on a slow machine) leaves the
  // next press waiting; the browser takes that press before the timer the last release set, and the timer ended
  // the new press's hold, so a redraw mid-press (the server's answer to an earlier action) replaced the button and
  // no click fired. Here a click handler is made to run 300 ms, and the next press is sent while it runs.
  it('the next press keeps its hold, and its click lands through a redraw', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      await page.evaluate(`window.addEventListener('click', (e) => { if (e.target.id === 'ttl') { const end = performance.now() + 300; while (performance.now() < end); } })`);
      const ttl = await page.box('#ttl');
      const fold = await page.box('#railFold');
      const [x, y] = [fold.left + fold.width / 2, fold.top + fold.height / 2];
      assert.strictEqual((await until(page, 'true')).layout.railFolded, false);
      await page.mouse('mouseMoved', ttl.left + 5, ttl.top + 5);
      await page.mouse('mousePressed', ttl.left + 5, ttl.top + 5, { buttons: 1 });
      // the release and the next press go together, so the press waits behind the busy click
      await Promise.all([page.mouse('mouseReleased', ttl.left + 5, ttl.top + 5), page.mouse('mouseMoved', x, y), page.mouse('mousePressed', x, y, { buttons: 1 })]);
      await page.sleep(30);
      await page.evaluate('window.RunSheetPage.render()'); // a redraw mid-press, as the server's answer gives
      await page.sleep(60);
      await page.mouse('mouseReleased', x, y);
      const p = await until(page, 'p.layout.railFolded', 3000);
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

describe('10d: the players\' preview', { skip: browserSkip() }, () => {
  const inView = (p, top) => {
    assert.ok(p.layout.pvOpen, 'open');
    assert.ok(p.layout.pvTop >= top, `its top ${p.layout.pvTop} at or below ${top}`);
    assert.ok(p.layout.pvBottom <= 762, `its bottom ${p.layout.pvBottom} inside the window`);
  };

  it('starts folded, out of a fight and in one', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      let p = await settled(page);
      assert.strictEqual(p.layout.pvOpen, false);
      assert.strictEqual(await page.evaluate('document.querySelector("#side").firstElementChild.id'), 'pvbox', 'it tops the side column');
      assert.strictEqual(await page.evaluate('document.querySelector("#pvToggle").textContent'), 'Show ▸');
      await tap(page, '#pvToggle');
      p = await until(page, 'p.layout.pvOpen');
      inView(p, (await page.box('#side')).top);
      assert.strictEqual(await page.evaluate('document.querySelector("#pvToggle").textContent'), 'Hide ▾');
      await tap(page, '#pvToggle');
      p = await until(page, '!p.layout.pvOpen');
      p = await fightAt(page, run);
      assert.strictEqual(p.layout.pvOpen, false);
      assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#pvbox"))'), false, 'in a fight, folded is nowhere');
      assert.ok(await page.evaluate('Boolean(document.querySelector("#fPvShow"))'), 'the toolbar offers it');
      sane(p, 'fight, folded');
    });
  });

  it('opens fully in view in both pane states, from the toolbar', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await tap(page, '#fPvShow');
      p = await until(page, 'p.layout.pvOpen');
      inView(p, p.layout.paneBox.top);
      assert.strictEqual(p.layout.pvIn, 'sheet');
      assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#fPvShow"))'), false, 'open: no toolbar button');
      assert.ok(p.layout.pvBottom - p.layout.pvTop <= 0.4 * (p.layout.paneBox.bottom - p.layout.paneBox.top) + 1, 'at most 40% of the pane');
      sane(p, 'preview in the pane');
      await tap(page, '#paneFold');
      p = await until(page, 'p.layout.folded && p.layout.pvOpen');
      assert.strictEqual(p.layout.pvIn, 'pvcol');
      inView(p, (await page.box('#side')).top);
      const col = await page.box('#side .pvcol');
      const order = await page.box('#fOrder');
      assert.ok(col.left >= order.right - 1, 'a column beside the order');
      sane(p, 'preview beside the order');
    });
  });

  it('opens in view after the pane was wheel-scrolled 500 px', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await tap(page, '#paneWhole');
      await page.waitFor('document.querySelector("#sheet section#people")');
      const pane = await page.box('#sheet');
      await page.wheel(pane.left + 100, 400, 500);
      p = await until(page, 'p.layout.paneTop >= 450');
      await tap(page, '#fPvShow');
      p = await until(page, 'p.layout.pvOpen && p.layout.paneTop === 0');
      inView(p, p.layout.paneBox.top);
      sane(p, 'after the wheel');
    });
  });

  it('hidden takes no room', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      const c0 = p.layout.cutTop;
      await tap(page, '#fPvShow');
      p = await until(page, 'p.layout.pvOpen');
      assert.ok(p.layout.cutTop > c0 + 100, `the cut moved down to ${p.layout.cutTop}`);
      await tap(page, '#pvToggle');
      p = await until(page, '!p.layout.pvOpen');
      assert.strictEqual(p.layout.cutTop, c0, 'the cut is back where it was');
      assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#sheet #pvbox"))'), false);
      sane(p, 'hidden');
    });
  });

  for (const w of [1280, 1100]) {
    it(`with the preview open the cut's first point is in view at ${w}`, async () => {
      const run = await start();
      await withPage({ width: w, height: 762 }, async (page) => {
        let p = await fightAt(page, run);
        // at 1100 the boss fight folds the pane (review F2): the GM opens it
        if (p.layout.folded) { await tap(page, '#paneOpen'); p = await until(page, '!p.layout.folded'); }
        await tap(page, '#fPvShow');
        p = await until(page, 'p.layout.pvOpen');
        inView(p, p.layout.paneBox.top);
        const pt = await page.box('#fightCut ul.pts li');
        assert.ok(pt.top >= p.layout.pvBottom && pt.bottom <= 762, `the first point at ${pt.top}-${pt.bottom}`);
        sane(p, `${w} preview open`);
      });
    });
  }

  it('survives a reload', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await tap(page, '#fPvShow');
      await until(page, 'p.layout.pvOpen');
      await page.evaluate('window.__before = true');
      await page.reload();
      p = await until(page, '!window.__before && p.fight && p.layout && p.layout.pvOpen');
      inView(p, p.layout.paneBox.top);
      sane(p, 'reloaded');
    });
  });
});

describe('10e: the order\'s own scroll', { skip: browserSkip() }, () => {
  it('big fight: Next keeps the turn in the order\'s box, never the page, and the toolbar stays put', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      await addNew(page, 'Bouncer', 8);
      let p = await until(page, 'p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 8 && p.pending === 0');
      assert.ok(p.fight.rows.length >= 14, `${p.fight.rows.length} rows`);
      const look = () => page.evaluate(`(() => {
        const ol = document.querySelector('#side ol.to'); const o = ol.getBoundingClientRect();
        const cur = ol.querySelector('li.cur'); let nx = cur && cur.nextElementSibling; while (nx && nx.classList.contains('bench')) nx = nx.nextElementSibling;
        const r = (e) => e && e.getBoundingClientRect(); const c = r(cur); const n = r(nx);
        const b = document.querySelector('#fNext').getBoundingClientRect(); const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { box: [o.top, o.bottom], scrolls: ol.scrollHeight > ol.clientHeight, cur: c && [c.top, c.bottom], next: n && [n.top, n.bottom],
          y: scrollY, nextTop: at === document.querySelector('#fNext') || document.querySelector('#fNext').contains(at), nextIn: b.top >= 0 && b.bottom <= innerHeight,
          act: document.querySelector('#acting').getBoundingClientRect().height };
      })()`);
      let l = await look();
      assert.ok(l.scrolls, 'the order scrolls in its own box');
      for (let i = 1; i <= 10; i++) {
        assert.ok(l.nextTop && l.nextIn, `before Next ${i}: #fNext in view and on top`);
        const turn = p.fight.turn;
        await tap(page, '#fNext');
        p = await until(page, `p.fight.turn !== ${JSON.stringify(turn)} && p.pending === 0`);
        await page.sleep(50);
        l = await look();
        const inBox = (x) => x[0] >= l.box[0] - 0.5 && x[1] <= l.box[1] + 0.5;
        assert.ok(inBox(l.cur), `Next ${i}: the current row ${l.cur} in the box ${l.box}`);
        if (l.next) assert.ok(inBox(l.next), `Next ${i}: the next row ${l.next} in the box ${l.box}`);
        assert.strictEqual(l.y, 0, `Next ${i}: the page did not scroll`);
        assert.ok(l.nextTop && l.nextIn, `Next ${i}: #fNext in view and on top`);
        assert.ok(l.act >= 150, `Next ${i}: the acting panel ${l.act} px`);
      }
      sane(await P(page), 'big fight');
    });
  });
});

// ---- Task 10, fix round 1 (the reviewer's real-input walk): statuses never widen the order (I1), an auto-fold
// holds until a window resize (I2), a pane opened by hand keeps its width (M3), the open preview stays under the
// pane's bar (M4), the preview above the order leaves the rows in view (M5), one move per drag step (M6).
const rowsInBox = (page) => page.evaluate(`(() => { const o = document.querySelector('#side ol.to').getBoundingClientRect();
  const li = Array.from(document.querySelectorAll('#side ol.to > li[data-frow]'), (l) => l.getBoundingClientRect());
  return { all: li.length, seen: li.filter((r) => r.top >= o.top - 0.5 && r.bottom <= o.bottom + 0.5).length }; })()`);

describe('10, fix round 1', { skip: browserSkip() }, () => {
  // changed on purpose by the final review (for the GM's eye): statuses that do not fit go on the row's second line
  // by name, where "+N" stood
  it('I1: statuses never widen the order: at 1449 the grip stays and moves 60 px each way, the second line names the rest', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      const before = { om: p.layout.orderMin, sheetW: p.layout.sheetW };
      const wyrm = p.fight.rows.find((r) => r.note === WYRM);
      await fromOther(run, ['Frightened', 'Prone', 'Poisoned'].map((add) => ({ type: 'status', fight: p.fight.id, row: wyrm.id, add })));
      p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 3`);
      assert.deepStrictEqual({ om: p.layout.orderMin, sheetW: p.layout.sheetW }, before, 'the order minimum and the pane did not move');
      assert.ok(p.layout.grip.shown && !p.layout.railFolded, 'the grip stays, the rail stays open');
      sane(p, 'three statuses');
      const line = await page.evaluate(`(() => { const l = document.querySelector('[data-row2="${wyrm.id}"]'); return l ? l.textContent : ''; })()`);
      for (const x of ['Frightened', 'Prone', 'Poisoned']) assert.ok(line.includes(x), `${x} on the second line: ${line}`);
      await tap(page, `[data-fpeek="${wyrm.id}"]`);
      p = await until(page, 'p.fight.actingName === "Glacier Wyrm"');
      assert.deepStrictEqual(p.fight.actingStatuses, ['Frightened', 'Prone', 'Poisoned'], 'the acting panel lists them all');
      const d0 = p.layout.sheetW;
      await dragGrip(page, -60);
      p = await until(page, `p.layout.sheetW === ${d0 + 60}`);
      sane(p, 'wider');
      await dragGrip(page, 120);
      p = await until(page, `p.layout.sheetW === ${Math.max(p.layout.room.min, d0 - 60)}`);
      sane(p, 'narrower');
      // a status taken off in the acting panel goes from the row too
      await tap(page, '#acting .nums .st');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 2`);
      sane(p, 'one removed');
    });
  });

  // final review, for the GM's eye (Part 5 C1): a boss with four statuses reads them all, on its own second line
  for (const [w, h] of [[1449, 762], [1280, 762]]) {
    it(`${w}: four statuses on the Wyrm are all named on its second line; the grip holds, no row clipped`, async () => {
      const run = await start();
      await withPage({ width: w, height: h }, async (page) => {
        let p = await startedFight(page, run);
        const om = p.layout.orderMin;
        const grip = p.layout.grip.shown;
        const wyrm = p.fight.rows.find((r) => r.note === WYRM);
        const four = ['Frightened', 'Prone', 'Poisoned', 'Restrained'];
        await fromOther(run, four.map((add) => ({ type: 'status', fight: p.fight.id, row: wyrm.id, add })));
        p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 4`);
        p = await until(page, `(p.layout.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}) || {}).line2`);
        const row = p.layout.rows.find((r) => r.id === wyrm.id);
        for (const x of four) assert.ok(row.line2.includes(x), `${x} on the second line: ${row.line2}`);
        // every name is on screen, not clipped: each chip inside the order's box
        const shown = await page.evaluate(`(() => { const o = document.querySelector('#side ol.to').getBoundingClientRect();
          return Array.from(document.querySelectorAll('[data-row2="${wyrm.id}"] .chip'), (c) => { const r = c.getBoundingClientRect();
            return r.width > 0 && r.left >= o.left - 0.5 && r.right <= o.right + 0.5; }); })()`);
        assert.strictEqual(shown.filter(Boolean).length, 4, `four chips seen: ${shown}`);
        assert.strictEqual(p.layout.orderMin, om, 'the order\'s least width did not move');
        assert.strictEqual(p.layout.grip.shown, grip, 'the grip as it was');
        if (w === 1449) assert.strictEqual(p.layout.grip.shown, true, 'the grip shown at 1449');
        // other rows stay one line
        const tall = p.layout.rows.filter((r) => r.id !== wyrm.id && r.line2);
        assert.deepStrictEqual(tall.map((r) => r.name), [], 'no other row has a second line');
        sane(p, `${w}, four statuses`);
        // a click on a chip there takes the status off
        await tap(page, `[data-row2="${wyrm.id}"] .chip[data-fun]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 3`);
        sane(p, `${w}, one taken off`);
      });
    });
  }

  it('I2: at 1280, Fold on the pane keeps the auto-folded rail folded; the preview sits beside the order, every row in view', async () => {
    const run = await start();
    await withPage({ width: 1280, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      assert.ok(p.layout.railFolded && p.layout.auto.rail);
      await tap(page, '#fPvShow');
      await until(page, 'p.layout.pvOpen');
      await tap(page, '#paneFold');
      p = await until(page, 'p.layout.folded && p.layout.pvOpen');
      assert.strictEqual(p.layout.railFolded, true, 'the rail stays folded');
      assert.strictEqual(p.layout.pvIn, 'pvcol');
      const col = await page.box('#side .pvcol');
      const order = await page.box('#fOrder');
      assert.ok(col.left >= order.right - 1, 'beside the order');
      const rows = await rowsInBox(page);
      assert.strictEqual(rows.seen, rows.all, `every row in view: ${JSON.stringify(rows)}`);
      sane(p, '1280 pane folded with the preview');
    });
  });

  it('M3: at 1100 a pane opened by hand keeps its width as statuses come on', async () => {
    const run = await start();
    await withPage({ width: 1100, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      assert.ok(p.layout.folded && p.layout.auto.pane);
      await tap(page, '#paneOpen');
      p = await until(page, '!p.layout.folded');
      const w = p.layout.sheetW;
      assert.ok(w >= 260, `the pane ${w} px`);
      const wyrm = p.fight.rows.find((r) => r.note === WYRM);
      await fromOther(run, ['Frightened', 'Prone', 'Poisoned', 'Restrained'].map((add) => ({ type: 'status', fight: p.fight.id, row: wyrm.id, add })));
      p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 4`);
      assert.strictEqual(p.layout.sheetW, w, 'the same width');
      assert.strictEqual(p.layout.folded, false);
      sane(p, '1100 statuses');
    });
  });

  it('M4: the open preview stays under the pane\'s bar while the pane scrolls, and Hide works', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      await tap(page, '#fPvShow');
      await until(page, 'p.layout.pvOpen');
      await tap(page, '#paneWhole');
      await page.waitFor('document.querySelector("#sheet section#people")');
      const pane = await page.box('#sheet');
      await page.wheel(pane.left + 150, 600, 400);
      p = await until(page, 'p.layout.paneTop >= 350');
      const hide = await page.box('#pvToggle');
      assert.ok(hide.top >= pane.top && hide.bottom <= 762, `Hide at ${hide.top}`);
      await tap(page, '#pvToggle');
      p = await until(page, '!p.layout.pvOpen');
      sane(p, 'hidden after the scroll');
    });
  });

  it('M5: at 1280 the preview above the order leaves at least 8 rows in view', async () => {
    const run = await start();
    await withPage({ width: 1280, height: 762 }, async (page) => {
      let p = await startedFight(page, run);
      await tap(page, '#paneFold');
      await until(page, 'p.layout.folded');
      await tap(page, '#railOpen');
      p = await until(page, '!p.layout.railFolded');
      await tap(page, '#fPvShow');
      p = await until(page, 'p.layout.pvOpen && p.layout.pvIn === "pvcol"');
      const col = await page.box('#side .pvcol');
      const order = await page.box('#fOrder');
      assert.ok(col.bottom <= order.top + 1, 'the preview is above the order here');
      const rows = await rowsInBox(page);
      assert.ok(rows.seen >= 8, `rows in view: ${JSON.stringify(rows)}`);
      sane(p, '1280 preview above the order');
    });
  });

  it('M6: one layout pass per drag step, not two', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightAt(page, run);
      const n0 = p.layout.gripMoves;
      await dragGrip(page, -40);
      p = await until(page, `p.layout.gripMoves > ${n0}`);
      assert.ok(p.layout.gripMoves - n0 <= 10, `${p.layout.gripMoves - n0} passes for 10 steps`);
    });
  });
});

// ---- stat boxes keep the mouse and the keyboard (plan 6a Task 11; review F1, F4, F5, F6). Real input only.
// A headless page has no window focus, so leaving a box fires no blur or change: `focusEvents` makes it
// behave as the GM's window does.
const sel = (attr, id) => `[${attr}="${id}"]`;
const active = (page) => page.evaluate('(() => { const a = document.activeElement; if (!a || a === document.body) return "body"; const d = a.dataset; return d.fini ? `fini:${d.fini}` : d.fmax ? `fmax:${d.fmax}` : d.fac ? `fac:${d.fac}` : d.fhp ? `fhp:${d.fhp}` : a.id || a.tagName; })()');
const selected = (page) => page.evaluate('(() => { const a = document.activeElement; return a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd, a.value.length] : null; })()');
// Counts every moment, between the page's tasks, that focus sits on nothing.
const watchBody = (page) => page.evaluate('window.__body = 0; clearInterval(window.__bodyT); window.__bodyT = setInterval(() => { if (!document.activeElement || document.activeElement === document.body) window.__body++; }, 1); true');
const bodyHits = (page) => page.evaluate('window.__body');
// The fight set up, ready to Start: the PCs' numbers typed, the foes rolled.
async function readyFight(page, run) {
  await page.focusEvents();
  await page.goto(`${run.base}/?probe=1`);
  await settled(page);
  const b = run.model.beats[0];
  await tap(page, `[id="beat:${b.key}"] [data-all]`);
  await settled(page);
  await tap(page, `[id="beat:${b.key}"] [data-fight]`);
  let p = await until(page, 'p.fight && p.fight.rows.length > 0');
  for (const [note, v] of [[ADA, '15'], [BEN, '12']]) {
    await tap(page, sel('data-fini', rowOf(p, note).id));
    await page.type(v);
    await page.key('Enter');
  }
  await settled(page);
  await tap(page, '#fRoll');
  return until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.filter((r) => r.in && (r.kind === "foe" || r.kind === "ally")).every((r) => r.ini !== null)');
}
const foes = (p) => p.fight.rows.filter((r) => r.kind === 'foe' && r.in && Number.isFinite(r.hp));

describe('stat boxes keep the mouse and the keyboard', { skip: browserSkip() }, () => {
  // held as a quick hand does, and long (fix round 1, I1: the hold lasts until the release, however long)
  for (const holdMs of [90, 500, 1500]) {
    it(`an edited box then a click on Start held ${holdMs} ms: the max is saved and the fight starts`, async () => {
      const run = await start();
      await withPage({ width: 1449, height: 762 }, async (page) => {
        const p0 = await readyFight(page, run);
        const foe = foes(p0)[0];
        await tap(page, sel('data-fmax', foe.id));
        await page.type('77');
        await tap(page, '#fNext', { holdMs });
        const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(foe.id)}).max === 77`);
        assert.strictEqual(p.fight.started, true, 'the click on Start was not eaten');
        assert.deepStrictEqual(p.errors, []);
      });
    });
  }

  it('an edited box then a click into another box: both saved, focus never on the page', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const b = run.model.beats[0];
      await tap(page, `[id="beat:${b.key}"] [data-all]`);
      await settled(page);
      await tap(page, `[id="beat:${b.key}"] [data-fight]`);
      let p = await until(page, 'p.fight && p.fight.rows.length > 0 && p.saved === "Saved" && p.pending === 0');
      const ada = rowOf(p, ADA).id;
      const ben = rowOf(p, BEN).id;
      await tap(page, sel('data-fini', ada));
      await watchBody(page);
      await page.type('15');
      await tap(page, sel('data-fini', ben));
      assert.strictEqual(await active(page), `fini:${ben}`, 'the click put focus in Ben\'s box');
      await page.type('12');
      await page.key('Tab');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(ada)}).ini === 15 && p.fight.rows.find((r) => r.id === ${JSON.stringify(ben)}).ini === 12`);
      await page.sleep(100);
      assert.notStrictEqual(await active(page), 'body');
      assert.strictEqual(await bodyHits(page), 0, 'focus never sat on the page');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('an edited box then a damage entry: the AC is saved and the HP goes down 4', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      await tap(page, sel('data-fac', one.id));
      await page.type('19');
      await tap(page, sel('data-fhp', two.id));
      assert.strictEqual(await active(page), `fhp:${two.id}`);
      await page.type('-4');
      await page.key('Enter');
      const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(one.id)}).ac === 19 && p.fight.rows.find((r) => r.id === ${JSON.stringify(two.id)}).hp === ${two.hp - 4}`);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('a redraw during a press does not eat the click', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await readyFight(page, run);
      const r = await page.box('#fNext');
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y, { buttons: 1 });
      await page.evaluate('RunSheetPage.render(); true');
      await page.sleep(90);
      await page.mouse('mouseReleased', x, y);
      const p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(p.fight.round, 1);
    });
  });

  it('max HP and AC pair on the row: three blank Bouncers take 11 Tab 13 six times over', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await startedFight(page, run);
      await addNew(page, 'Bouncer', 3);
      let p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 3');
      const ids = ['Bouncer 1', 'Bouncer 2', 'Bouncer 3'].map((n) => named(p, n).id);
      await tap(page, sel('data-fmax', ids[0]));
      await watchBody(page);
      const want = [];
      for (const id of ids) want.push(`fmax:${id}`, `fac:${id}`);
      for (let i = 0; i < 6; i++) {
        assert.strictEqual(await active(page), want[i], `step ${i}: focus in ${want[i]}`);
        await page.type(i % 2 ? '13' : '11');
        await page.key(i === 5 ? 'Enter' : 'Tab');
      }
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && ${JSON.stringify(ids)}.every((id) => { const r = p.fight.rows.find((x) => x.id === id); return r.max === 11 && r.hp === 11 && r.ac === 13; })`);
      await page.sleep(100);
      assert.strictEqual(await bodyHits(page), 0, 'focus never sat on the page');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('Shift-Tab goes back along the pairs with the number selected', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      // two foes next to each other in the order
      const order = Array.from(await page.evaluate('Array.from(document.querySelectorAll("[data-fmax]"), (b) => b.dataset.fmax)'));
      const i = order.indexOf(two.id);
      const prev = order[i - 1];
      assert.ok(prev, 'a row before the second foe');
      await tap(page, sel('data-fmax', two.id));
      await page.key('Tab', { shift: true });
      assert.strictEqual(await active(page), `fac:${prev}`, 'Shift-Tab from max goes to the row above\'s AC');
      let s = await selected(page);
      assert.ok(s[2] > 0 && s[0] === 0 && s[1] === s[2], `the AC is selected: ${s}`);
      await page.key('Tab', { shift: true });
      assert.strictEqual(await active(page), `fmax:${prev}`, 'Shift-Tab from AC goes to the same row\'s max');
      s = await selected(page);
      assert.ok(s[2] > 0 && s[0] === 0 && s[1] === s[2], `the max is selected: ${s}`);
      await page.type('9');
      await page.key('Enter');
      const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(prev)}).max === 9`);
      assert.ok(one, 'two foes');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('a bad number: marked and kept, the state unchanged, and the next click and entry land', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      await tap(page, sel('data-fmax', one.id));
      await page.type('40x');
      await tap(page, sel('data-fhp', two.id));
      assert.strictEqual(await active(page), `fhp:${two.id}`, 'the click put focus in the damage box');
      await page.type('-3');
      await page.key('Enter');
      const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(two.id)}).hp === ${two.hp - 3}`);
      assert.strictEqual(await active(page), `fhp:${two.id}`, 'focus stays in the damage box');
      assert.strictEqual(p.fight.rows.find((r) => r.id === one.id).max, one.max, 'the state\'s max is unchanged');
      // the words are on the row's second line (final review P4.2)
      const bad = await page.evaluate(`(() => { const b = document.querySelector('${sel('data-fmax', one.id)}'); const m = document.querySelector('[data-row2="${one.id}"] .badnum'); return { v: b.value, inv: b.getAttribute('aria-invalid'), msg: m && m.textContent }; })()`);
      assert.deepStrictEqual(bad, { v: '40x', inv: 'true', msg: 'Not a number: kept as typed' });
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // final review P4.2: the words are seen at every width, a narrow row's too, on the row's second line
  it('1100: a bad number\'s words are on screen beside its row, in every layout state', async () => {
    const run = await start();
    await withPage({ width: 1100, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const wyrm = p0.fight.rows.find((r) => r.note === WYRM);
      const seen = () => page.evaluate(`(() => { const m = document.querySelector('[data-row2="${wyrm.id}"] .badnum'); if (!m) return null;
        const r = m.getBoundingClientRect(); const o = document.querySelector('#side ol.to').getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: m.textContent, inside: r.width > 0 && r.left >= o.left - 0.5 && r.right <= o.right + 0.5, top: Boolean(top) && m.contains(top) }; })()`);
      await tap(page, sel('data-fmax', wyrm.id));
      await page.type('40x');
      await page.key('Enter');
      const want = { text: 'Not a number: kept as typed', inside: true, top: true };
      assert.deepStrictEqual(await seen(), want, 'both folded (the page\'s own folds at 1100)');
      // the pane opened by hand: the narrowest order
      await tap(page, '#paneOpen');
      let p = await until(page, '!p.layout.folded');
      assert.deepStrictEqual(await seen(), want, 'pane open');
      // three statuses too: the second line holds both
      await fromOther(run, ['Frightened', 'Prone', 'Poisoned'].map((add) => ({ type: 'status', fight: p.fight.id, row: wyrm.id, add })));
      p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).conds.length === 3`);
      assert.deepStrictEqual(await seen(), want, 'with statuses');
      sane(p, '1100, a bad number');
      // a number puts it right: the words go
      await tap(page, sel('data-fmax', wyrm.id));
      await page.type('40');
      await page.key('Enter');
      await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(wyrm.id)}).max === 40`);
      assert.strictEqual(await seen(), null);
    });
  });

  // final review P4.1: damage typed and left is not applied, and is marked "Enter applies" until it is
  it('damage typed then Tab or a click away is marked, kept through a redraw, and cleared by Enter or emptying', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      const mark = (id) => page.evaluate(`(() => { const b = document.querySelector('[data-fhp="${id}"]');
        const m = document.querySelector('[data-row2="${id}"] .pendnum'); return { v: b.value, pending: b.classList.contains('pending'), msg: m && m.textContent }; })()`);
      await tap(page, sel('data-fhp', one.id));
      await page.type('-6');
      await page.key('Tab');
      await tap(page, sel('data-fhp', two.id));
      await page.type('-7');
      await tap(page, sel('data-fmax', one.id));
      let p = await until(page, 'p.saved === "Saved" && p.pending === 0');
      assert.deepStrictEqual([p.fight.rows.find((r) => r.id === one.id).hp, p.fight.rows.find((r) => r.id === two.id).hp], [one.hp, two.hp], 'nothing applied');
      assert.deepStrictEqual(await mark(one.id), { v: '-6', pending: true, msg: 'Enter applies' });
      assert.deepStrictEqual(await mark(two.id), { v: '-7', pending: true, msg: 'Enter applies' });
      // a redraw (another window) keeps both
      await fromOther(run, [{ type: 'setAc', fight: p0.fight.id, row: two.id, ac: 17 }]);
      await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(two.id)}).ac === 17`);
      assert.deepStrictEqual(await mark(one.id), { v: '-6', pending: true, msg: 'Enter applies' });
      // Enter applies it, and the mark goes
      await tap(page, sel('data-fhp', one.id));
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(one.id)}).hp === ${one.hp - 6}`);
      assert.deepStrictEqual(await mark(one.id), { v: '', pending: false, msg: null });
      // emptying the other clears its mark, and applies nothing
      await tap(page, sel('data-fhp', two.id));
      await page.key('Backspace');
      await page.key('Backspace');
      await page.key('Backspace');
      assert.deepStrictEqual(await mark(two.id), { v: '', pending: false, msg: null });
      p = await until(page, 'p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(p.fight.rows.find((r) => r.id === two.id).hp, two.hp);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // final review O4 and O7: the acting panel's words for a blank row, and Same for all's title
  it('a row typed in the fight says to type its numbers here; Same for all says whom it copies to', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      await addNew(page, 'Bouncer', 2);
      let p = await until(page, 'p.fight.rows.filter((r) => /^Bouncer/.test(r.name)).length === 2');
      const one = named(p, 'Bouncer 1');
      await tap(page, `[data-fpeek="${one.id}"]`);
      await page.waitFor('document.querySelector("#acting h3") && document.querySelector("#acting h3").textContent === "Bouncer 1"');
      assert.strictEqual(await page.evaluate('document.querySelector("#acting .warn").textContent'), 'Bouncer 1: no numbers yet: type them here');
      await tap(page, sel('data-fmax', one.id));
      await page.type('12');
      await page.key('Enter');
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.some((r) => r.name === "Bouncer 1" && r.max === 12)');
      // still picked: its panel now offers Same for all
      await page.waitFor('document.querySelector("[data-fsame]")');
      assert.strictEqual(await page.evaluate('document.querySelector("[data-fsame]").title'), 'Copy these numbers (and the HP they give) to the others of this group nobody has typed into, hurt or given a status');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // Task 13 proof N1: a typed number, then a press on another row's "+ status": the redraw the commit makes keeps the
  // select focused
  for (const holdMs of [90, 600]) {
    it(`a max typed, then a ${holdMs} ms press on another row's "+ status": the select keeps focus and the number is saved`, async () => {
      const run = await start();
      await withPage({ width: 1449, height: 762 }, async (page) => {
        await page.focusEvents();
        const p0 = await startedFight(page, run);
        const [one, two] = foes(p0);
        await tap(page, sel('data-fmax', one.id));
        await page.type('9');
        await tap(page, sel('data-fstatus', two.id), { holdMs });
        const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(one.id)}).max === 9`);
        await page.sleep(100);
        assert.strictEqual(await page.evaluate('document.activeElement.dataset.fstatus || document.activeElement.tagName'), two.id, 'the status select has focus');
        assert.deepStrictEqual(p.errors, []);
      });
    });
  }

  // final review P-A4: Esc takes back an edit
  it('a real Esc in a stat box puts its saved number back, sends nothing and keeps focus', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      await tap(page, sel('data-fmax', one.id));
      await page.type('9');
      await page.key('Escape');
      assert.deepStrictEqual(await page.evaluate(`[document.activeElement.dataset.fmax, document.activeElement.value, document.activeElement.selectionStart, document.activeElement.selectionEnd]`),
        [one.id, String(one.max), 0, String(one.max).length], 'the saved number, selected, focus kept');
      await tap(page, sel('data-fhp', two.id));
      let p = await until(page, 'p.saved === "Saved" && p.pending === 0');
      await page.sleep(150);
      p = await until(page, 'p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(p.fight.rows.find((r) => r.id === one.id).max, one.max, 'nothing sent');
      // a bad number too: Esc takes back the words and the mark
      await tap(page, sel('data-fac', one.id));
      await page.type('1x');
      await page.key('Tab');
      await tap(page, sel('data-fac', one.id));
      await page.key('Escape');
      assert.deepStrictEqual(await page.evaluate(`(() => { const b = document.querySelector('${sel('data-fac', one.id)}'); return [b.value, b.getAttribute('aria-invalid'), Boolean(document.querySelector('[data-row2="${one.id}"] .badnum'))]; })()`),
        [String(one.ac), null, false]);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // The 9 Tab 8 Tab 7 flake: a redraw (here another window's) that removes a box holding a typed number
  // fires its change in the middle of setting innerHTML; a commit from there redrew inside the redraw, threw,
  // and left focus on nothing, so the next Tab went to Roll.
  it('a redraw while a number is typed keeps it, sends nothing and throws nothing', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      for (const [k, typed] of [['data-fmax', '45'], ['data-fini', '3']]) {
        await tap(page, sel(k, one.id));
        await page.evaluate('document.activeElement.select(); true'); // this test is not about the click's select
        await page.type(typed);
        const ini = 30 + typed.length;
        await fromOther(run, [{ type: 'setInit', fight: p0.fight.id, row: two.id, ini }]);
        const p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(two.id)}).ini === ${ini}`);
        assert.deepStrictEqual(p.errors, [], `${k}: no script errors`);
        assert.strictEqual(await active(page), `${k.slice(5)}:${one.id}`, `${k}: focus kept`);
        assert.strictEqual(await page.evaluate(`document.querySelector('${sel(k, one.id)}').value`), typed, `${k}: the words kept`);
        const r = p.fight.rows.find((x) => x.id === one.id);
        assert.strictEqual(k === 'data-fmax' ? r.max : r.ini, k === 'data-fmax' ? one.max : one.ini, `${k}: nothing sent`);
        await page.key('Enter');
        await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(one.id)}).${k === 'data-fmax' ? 'max' : 'ini'} === ${Number(typed)}`);
      }
    });
  });

  // fix round 1, M1: a box another window's redraw removes for good still sends its number
  it('a max typed in a row another window unticks is saved, and focus is not on the page', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const foe = foes(p0)[0];
      await tap(page, sel('data-fmax', foe.id));
      await page.type('14');
      await fromOther(run, [{ type: 'fightTick', fight: p0.fight.id, row: foe.id, in: false }]);
      const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(foe.id)}).in === false && p.fight.rows.find((r) => r.id === ${JSON.stringify(foe.id)}).max === 14`);
      await page.sleep(100);
      assert.notStrictEqual(await active(page), 'body', 'focus went somewhere sensible');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // fix round 1, M2: a marked box gives way to a newer number
  it('a bad number\'s words give way to a newer number from another window', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one, two] = foes(p0);
      await tap(page, sel('data-fmax', one.id));
      await page.type('40x');
      await tap(page, sel('data-fhp', two.id));
      const look = () => page.evaluate(`(() => { const b = document.querySelector('${sel('data-fmax', one.id)}'); return { v: b.value, inv: b.getAttribute('aria-invalid'), msg: Boolean(document.querySelector('[data-row2="${one.id}"] .badnum')) }; })()`);
      // an unrelated redraw keeps the mark
      await fromOther(run, [{ type: 'setAc', fight: p0.fight.id, row: two.id, ac: 17 }]);
      await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(two.id)}).ac === 17`);
      assert.deepStrictEqual(await look(), { v: '40x', inv: 'true', msg: true });
      await fromOther(run, [{ type: 'setMax', fight: p0.fight.id, row: one.id, max: 50 }]);
      const p = await until(page, `p.fight.rows.find((r) => r.id === ${JSON.stringify(one.id)}).max === 50`);
      assert.deepStrictEqual(await look(), { v: '50', inv: null, msg: false });
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // fix round 1, M3: an end-panel box a redraw lands on sends its number once
  it('a vitals box holding a typed HP sends one endSet when another window redraws and it is left', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      // counts what the page sends (a wrapper round fetch: no event is made up)
      await page.evaluate(`(() => { window.__sent = []; const f = window.fetch; window.fetch = function (u, o) { try { if (String(u).includes('/api/actions')) for (const a of JSON.parse(o.body).actions) window.__sent.push(a); } catch (e) {} return f.apply(this, arguments); }; return true; })()`);
      const id = await page.evaluate('document.querySelector("#sheet [data-vhp]").dataset.vhp');
      const box = `#sheet [data-vhp="${id}"]`;
      await tap(page, box);
      await page.evaluate('document.activeElement.select(); true');
      await page.type('9');
      await fromOther(run, [{ type: 'mark', beat: run.model.beats[0].key, done: true }]);
      await page.sleep(600); // the other window's change reaches this page and redraws it
      await page.key('Tab');
      await settled(page);
      await page.sleep(300);
      const ends = await page.evaluate('window.__sent.filter((a) => a.type === "endSet").map((a) => JSON.stringify(a.vitals))');
      assert.deepStrictEqual(ends, [JSON.stringify({ [id]: { hp: 9 } })], 'exactly one endSet');
    });
  });

  // fix round 1, M4: a click into the box that already has focus selects it too
  it('a click into the focused max box selects it: 20 Enter, click, 21 gives 21', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const foe = foes(p0)[0];
      const box = sel('data-fmax', foe.id);
      await tap(page, box);
      await page.type('20');
      await page.key('Enter');
      await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(foe.id)}).max === 20`);
      assert.strictEqual(await active(page), `fmax:${foe.id}`, 'still in the box');
      await tap(page, box, { offsetX: 12 });
      // as a hand types only after the click: the page's re-select (a timer after the release) has run first (#852)
      await page.waitFor(`(() => { const e = document.querySelector('${box}'); return e.selectionStart === 0 && e.selectionEnd === e.value.length; })()`);
      await page.type('21');
      assert.strictEqual(await page.evaluate(`document.querySelector('${box}').value`), '21');
      await page.key('Enter');
      await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(foe.id)}).max === 21`);
    });
  });

  it('every number box selects on a real click: one digit typed is that digit', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const foe = foes(p0)[0];
      for (const [box, digit] of [[sel('data-fini', foe.id), '7'], [sel('data-fmax', foe.id), '8'], [sel('data-fac', foe.id), '6']]) {
        await tap(page, '#fAddName');
        const before = await page.evaluate(`document.querySelector('${box}').value`);
        assert.ok(before.length > 0, `${box} holds a number`);
        // the click lands inside the number, as a hand would, not at its start
        const b = await page.box(box);
        await tap(page, box, { offsetX: Math.min(b.width - 4, 14) });
        await page.type(digit);
        assert.strictEqual(await page.evaluate(`document.querySelector('${box}').value`), digit, `${box}: a click selects ${before}`);
        await page.key('Enter');
        await settled(page);
      }
      await tap(page, '#fAddName');
      await page.type('Ice Drake');
      await tap(page, '#fAddCount');
      await page.type('3');
      assert.strictEqual(await page.evaluate('document.querySelector("#fAddCount").value'), '3');
      assert.deepStrictEqual((await P(page)).errors, []);
    });
  });
});

// PRENTICE's PR review 2 (D1-D3 and a note), by real input
describe('Esc and J, from the review of the fixes', { skip: browserSkip() }, () => {
  it('D1: after Esc, a click back into the box selects it, so 41 replaces the number', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one] = foes(p0);
      const box = sel('data-fmax', one.id);
      await tap(page, box);
      await page.type('9');
      await page.key('Escape');
      await tap(page, box);
      // real key presses, as a GM's hands type
      await page.key('4');
      await page.key('1');
      await page.key('Enter');
      const p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(one.id)}).max !== ${one.max}`);
      assert.strictEqual(p.fight.rows.find((r) => r.id === one.id).max, 41);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('D2: J on a status list goes to the jot box, and a letter there picks no status', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one] = foes(p0);
      await tap(page, sel('data-fstatus', one.id));
      await page.key('Escape');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.fstatus || ""'), one.id, 'the list has focus');
      await page.key('p');
      await page.sleep(200);
      let p = await P(page);
      assert.deepStrictEqual(p.fight.rows.find((r) => r.id === one.id).conds, [], 'p picked nothing');
      await page.key('j');
      await page.waitFor('document.activeElement && document.activeElement.id === "hjot"');
      p = await P(page);
      assert.deepStrictEqual(p.fight.rows.find((r) => r.id === one.id).conds, [], 'no status added');
      assert.strictEqual(await page.evaluate('document.querySelector("#hjot").value'), '', 'the J is not typed into it');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('D3: Esc empties damage typed and left, and clears its mark', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const p0 = await startedFight(page, run);
      const [one] = foes(p0);
      const box = sel('data-fhp', one.id);
      await tap(page, box);
      await page.type('-4');
      await page.waitFor(`document.querySelector('${box}').classList.contains('pending')`);
      await page.key('Escape');
      assert.deepStrictEqual(await page.evaluate(`(() => { const b = document.querySelector('${box}'); return [b.value, b.classList.contains('pending'), document.activeElement === b]; })()`), ['', false, true]);
      const p = await settled(page);
      assert.strictEqual(p.fight.rows.find((r) => r.id === one.id).hp, one.hp, 'no damage applied');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('the Add box opens its list again on a click back in, as the Move box does', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      await tap(page, '#fAddName');
      await page.type('Ben');
      await page.waitFor('document.querySelector("#fHits button")');
      await page.key('Escape');
      await page.waitFor('!document.querySelector("#fHits button")');
      await tap(page, '#fRoll');
      await tap(page, '#fAddName');
      await page.waitFor('document.querySelector("#fHits button")');
      assert.strictEqual(await page.evaluate('document.querySelector("#fAddName").value'), 'Ben', 'the words stay');
    });
  });
});

// ---- step 6b Task 23 for D&D: Tab past the end (D2), rows held while typed (D3c), Same for all field by field (D3).
// CoC's and GURPS's are in run-sheet-fight-systems-browser.test.js.
describe('D&D: Tab, held rows and Same for all (step 6b Task 23), by real input', { skip: browserSkip() }, () => {
  const where = (page) => page.evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
    const x = Array.from(a.attributes).find((n) => n.name.startsWith('data-f')); return x ? x.name + '=' + x.value : (a.id ? '#' + a.id : a.tagName); })()`);
  const picked = (page) => page.evaluate('(() => { const a = document.activeElement; return a && typeof a.selectionStart === "number" ? [a.value, a.selectionStart, a.selectionEnd] : null; })()');
  const pcFigures = (p) => p.fight.rows.filter((r) => r.kind === 'pc').map((r) => [r.name, r.ini, r.hp, r.max, r.ac]);
  async function setUp(page, run) {
    await page.goto(`${run.base}/?probe=1`);
    await settled(page);
    const b = run.model.beats[0];
    await tap(page, `[id="beat:${b.key}"] [data-all]`);
    await settled(page);
    await tap(page, `[id="beat:${b.key}"] [data-fight]`);
    return until(page, 'p.fight && p.fight.rows.length > 0 && p.saved === "Saved" && p.pending === 0');
  }
  const bouncers = async (page, n) => {
    await addNew(page, 'Bouncer', n);
    return until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.filter((r) => /^Bouncer /.test(r.name)).length === ${n}`);
  };
  async function typeIn(page, s, v, key = 'Enter') {
    await tap(page, s);
    await page.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(s)})`, 2000);
    await page.type(String(v));
    await page.key(key);
    return settled(page);
  }

  it('Add Bouncer ×3, then 10 Tab 9 Tab 8 Tab before Start: focus on Start, no PC figure changed, never a seen button', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await setUp(page, run);
      let p = await bouncers(page, 3);
      const pcs = pcFigures(p);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      await tap(page, sel('data-fini', b[0]));
      const went = [];
      for (const v of ['10', '9', '8']) { await page.type(v); await page.key('Tab'); went.push(await where(page)); }
      assert.deepStrictEqual(went, [`data-fini=${b[1]}`, `data-fini=${b[2]}`, '#fNext']);
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(b[2])}).ini === 8`);
      assert.deepStrictEqual(b.map((id) => p.fight.rows.find((r) => r.id === id).ini), [10, 9, 8]);
      assert.deepStrictEqual(pcFigures(p), pcs);
      assert.strictEqual(p.fight.started, false);
    });
  });

  it('the same after Start: focus stays on the last box with its number selected; Enter commits it and ends no turn', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      let p = await bouncers(page, 3);
      const turn = [p.fight.turn, p.fight.round];
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      await tap(page, sel('data-fini', b[0]));
      const went = [];
      for (const v of ['10', '9', '8']) { await page.type(v); await page.key('Tab'); went.push(await where(page)); }
      assert.deepStrictEqual(went, [`data-fini=${b[1]}`, `data-fini=${b[2]}`, `data-fini=${b[2]}`]);
      assert.deepStrictEqual(await picked(page), ['8', 0, 1]);
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(b[2])}).ini === 8 && p.fight.rows.every((r) => !r.held)`);
      assert.deepStrictEqual([p.fight.turn, p.fight.round], turn, 'no turn ended');
      assert.strictEqual(await where(page), `data-fini=${b[2]}`);
    });
  });

  it('with the source blank Same for all is disabled and "Type a number first" is on screen beside it; the copies\' typed initiatives are kept', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      let p = await bouncers(page, 3);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      p = await typeIn(page, sel('data-fini', b[1]), 9);
      p = await typeIn(page, sel('data-fini', b[2]), 8);
      await tap(page, `[data-fpeek="${b[0]}"]`);
      await until(page, 'p.fight.actingName === "Bouncer 1"');
      assert.strictEqual(await page.evaluate(`document.querySelector('#acting [data-fsame="${b[0]}"]').disabled`), true);
      assert.match(await page.evaluate('document.querySelector("#acting .samebox").innerText'), /Same for all\s*Type a number first/);
      p = await settled(page);
      assert.deepStrictEqual([named(p, 'Bouncer 2').ini, named(p, 'Bouncer 3').ini], [9, 8]);
    });
  });

  // D3 and review Part 2: once the copies had a typed initiative, Same for all was not offered at all (initiative first is
  // the natural order at a table); now it is, counts them, and copies the rest
  it('copies with typed initiatives: Same for all is offered, counts them, and each takes the source\'s max HP and AC', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await startedFight(page, run);
      let p = await bouncers(page, 3);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      p = await typeIn(page, sel('data-fini', b[1]), 9);
      p = await typeIn(page, sel('data-fini', b[2]), 8);
      p = await typeIn(page, sel('data-fmax', b[0]), 22, 'Tab');
      assert.strictEqual(await where(page), `data-fac=${b[0]}`);
      await page.type('13');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(b[0])}).ac === 13`);
      await tap(page, `[data-fpeek="${b[0]}"]`);
      await until(page, 'p.fight.actingName === "Bouncer 1"');
      assert.strictEqual(await page.evaluate(`document.querySelector('#acting [data-fsame="${b[0]}"]').textContent`), 'Same for all 2');
      await tap(page, `#acting [data-fsame="${b[0]}"]`);
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${JSON.stringify(b[2])}).max === 22`);
      assert.deepStrictEqual(['Bouncer 2', 'Bouncer 3'].map((n) => [named(p, n).ini, named(p, n).max, named(p, n).hp, named(p, n).ac]), [[9, 22, 22, 13], [8, 22, 22, 13]]);
      assert.strictEqual(await page.evaluate('document.querySelectorAll("#acting [data-fsame]").length'), 0, 'nothing left to copy');
    });
  });

  it('a held number is placed before Start sorts (Start pressed straight from the column)', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await setUp(page, run);
      await addNew(page, 'Bouncer');
      let p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.some((r) => r.name === "Bouncer")');
      await tap(page, sel('data-fini', named(p, 'Bouncer').id));
      await page.type('30');
      await tap(page, '#fNext');
      await page.waitFor('document.querySelector("#fStartAnyway") || JSON.parse(document.body.dataset.probe).fight.started');
      if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
      p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(named(p, 'Bouncer').ini, 30);
      const n = p.fight.rows.filter((r) => r.in && r.ini !== null).map((r) => r.ini);
      assert.ok(n.every((v, i) => i === 0 || n[i - 1] >= v), `sorted: ${n}`);
      assert.strictEqual(p.fight.rows.filter((r) => r.in && r.kind !== 'lair')[0].name, 'Bouncer');
    });
  });

  // Task 23: the page's scroll-padding-top keeps a box or link reached by Tab below the sticky bar
  it('1100: Shift-Tab onto a link under the sticky bar brings it below the bar', async () => {
    const run = await start();
    await withPage({ width: 1100, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      // a beat's Bring box and the control Tab reaches just before it, a little above it (read only: nothing is set)
      const ALL = `Array.from(document.querySelectorAll('#sheet a[tabindex="0"], #sheet button, #sheet input, #sheet select, #sheet summary')).filter((e) => e.offsetParent && !e.disabled)`;
      const pair = await page.evaluate(`(() => { const all = ${ALL};
        for (let i = 1; i < all.length; i++) {
          const b = all[i]; const a = all[i - 1];
          if (!b.matches('input[data-bring]')) continue;
          const gap = b.getBoundingClientRect().top - a.getBoundingClientRect().top;
          if (gap > 40 && gap < 300) return { i: i - 1, bring: b.dataset.bring };
        }
        return null; })()`);
      assert.ok(pair, 'a Bring box with a control above it');
      const jot = `#sheet input[data-bring="${pair.bring}"]`;
      const boxA = () => page.evaluate(`(() => { const r = (${ALL})[${pair.i}].getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
      const bar = await page.evaluate('document.querySelector(".top").getBoundingClientRect().bottom');
      // the wheel puts the control above the box under the bar, the box in view
      const a0 = await boxA();
      await page.wheel(500, 400, Math.round(a0.top - bar / 2));
      const a1 = await boxA();
      assert.ok(a1.top < bar, `the control is under the bar before: ${a1.top} < ${bar}`);
      await tap(page, jot);
      await page.key('Tab', { shift: true });
      assert.ok(await page.evaluate(`document.activeElement === (${ALL})[${pair.i}]`), 'Shift-Tab reached it');
      const a2 = await boxA();
      assert.ok(a2.top >= bar && a2.bottom <= 762, `below the bar: ${JSON.stringify(a2)} bar ${bar}`);
    });
  });
});
