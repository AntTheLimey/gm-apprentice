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
      assert.match(await page.evaluate('document.querySelector("[data-fsame]").textContent'), /^Same for all 3$/);
      await tap(page, '[data-fsame]');
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.filter((r) => /^Bouncer/.test(r.name) && r.max === 30).length === 3');
      assert.deepStrictEqual(['Bouncer 2', 'Bouncer 3'].map((n) => named(p, n).hp), [30, 30]);
      assert.strictEqual(await page.evaluate('document.querySelectorAll("[data-fsame]").length'), 0, 'nothing left to copy to');
      assert.deepStrictEqual(p.errors, []);
    });
  });
});
