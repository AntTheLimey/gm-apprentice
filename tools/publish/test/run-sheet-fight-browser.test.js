'use strict';
// The GM page's fight view (plan 5b Task 10) in a real browser, against the real server in this process, on
// a copy of the players' fixture (Task 3): Session 03, beat 1 "Ashfall Reckoning" holds two PCs' worth of
// foes (the Glacier Wyrm with Cold Breath and lair actions, a Rime Imp, two Ice Mephits, Brother Venn as an
// ally, Masked Gilt, the withheld Hidden Abbot, a Frost Wolf with lair actions). The test clicks and types
// through the page's own controls (`page.key` for Enter and Tab) and reads `?probe=1`'s
// `body.dataset.probe`, which carries `fight` and `layout`. Skipped without Chrome, except on CI.
// RS_SHOTS=<dir> keeps screenshots of the fight at both sizes, paused and after End fight.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession } = require('../lib/run-sheet/sessions');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const WEB = path.join(__dirname, '..', 'lib', 'run-sheet', 'web');
const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const SESSION = 'Session 03 - Next';
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
const PARTY = ['Characters/PCs/Ada Moss.md', 'Characters/PCs/Ben Hart.md'];
const ADA = PARTY[0];
const BEN = PARTY[1];
const WYRM = 'Creatures/Glacier Wyrm.md';
const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';
const SHOTS = process.env.RS_SHOTS || '';
// Windows CI checks fixtures out with CRLF line ends: read and write them through these.
const lf = (s) => s.replace(/\r\n/g, '\n');

it('gm-fight.js parses, holds no dice, and gm.html loads it after gm.js', () => {
  const source = fs.readFileSync(path.join(WEB, 'gm-fight.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'gm-fight.js' }));
  assert.doesNotMatch(source, /Math\.random|getRandomValues|randomInt/);
  const html = fs.readFileSync(path.join(WEB, 'gm.html'), 'utf8');
  const gm = html.indexOf('src="/web/gm.js"');
  const fight = html.indexOf('src="/web/gm-fight.js"');
  assert.ok(gm > 0 && fight > gm, 'gm-fight.js comes after gm.js');
});

const made = [];
const servers = [];
after(async () => {
  for (const s of servers) { try { await s.close(); } catch { /* closed already */ } }
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

async function start({ edit } = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-fight-'));
  made.push(vault);
  fs.cpSync(FIXTURE, vault, { recursive: true });
  if (edit) edit(vault);
  const picked = pickSession(listSessions(vault), SESSION, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 20, log: () => {} } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  const base = `http://127.0.0.1:${port}`;
  const model = (await (await fetch(`${base}/api/model`)).json()).model;
  return { ...t, vault, base, model };
}
const getState = async (run) => (await (await fetch(`${run.base}/api/state`)).json()).state;

// The page's own controls, as the GM uses them.
const q = (sel) => JSON.stringify(sel);
const click = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('nothing matches ' + ${q(sel)}); e.click(); return true; })()`);
// Focus a box and put words in it, as typing does (an input event, no change yet).
const fill = (page, sel, text) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('nothing matches ' + ${q(sel)}); e.focus(); e.value = ${q(text)};
  e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const choose = (page, sel, value) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); e.value = ${q(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const probe = (page) => page.evaluate(PROBE);
const until = (page, test, ms) => page.waitFor(`(() => { const p = ${PROBE}; return p && (${test}) && p; })()`, ms);
const settled = (page) => until(page, 'p.saved === "Saved" && p.pending === 0');
const rowOf = (p, note, copy) => p.fight.rows.find((r) => r.note === note && (!copy || r.copy === copy));
const focused = (page) => page.evaluate('(() => { const a = document.activeElement; return a ? (a.dataset.fini || (a.dataset.fhp ? `fhp:${a.dataset.fhp}` : "") || a.id || a.tagName) : null; })()');
async function shot(page, name) {
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot(path.join(SHOTS, `${name}.png`)); }
}

// Both PCs to beat 1, then Fight on it: the order is up, nothing rolled.
async function fightOn(page, run) {
  await page.goto(`${run.base}/?probe=1`);
  await settled(page);
  const b = run.model.beats[0];
  await click(page, `[id="beat:${b.key}"] [data-all]`);
  await settled(page);
  await click(page, `[id="beat:${b.key}"] [data-fight]`);
  const p = await until(page, 'p.fight && p.fight.rows.length > 0');
  return { b, p };
}
// Type each PC's called-out roll with Enter.
async function typeInit(page, p, values) {
  for (const [note, v] of Object.entries(values)) {
    await fill(page, `[data-fini="${rowOf(p, note).id}"]`, String(v));
    await page.key('Enter');
  }
  return settled(page);
}
// The PCs typed, the foes rolled, Start: round 1 with the order sorted.
async function started(page, run) {
  const { b, p } = await fightOn(page, run);
  await typeInit(page, p, { [ADA]: 15, [BEN]: 12 });
  await click(page, '#fRoll');
  await until(page, 'p.fight.rows.filter((r) => r.in && (r.kind === "foe" || r.kind === "ally")).every((r) => r.ini !== null)');
  await click(page, '#fNext');
  return { b, p: await until(page, 'p.fight.round === 1 && p.saved === "Saved" && p.pending === 0') };
}
const inView = (y, h) => typeof y === 'number' && y >= 0 && y < h;

describe('the GM page runs a fight', { skip: browserSkip() }, () => {
  it('1449x762: the whole order and the acting panel without scrolling', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p: first } = await fightOn(page, run);
      assert.ok(first.fight.rows.length >= 9, `${first.fight.rows.length} rows`);
      await typeInit(page, first, { [ADA]: 15, [BEN]: 12 });
      await click(page, '#fRoll');
      await until(page, 'p.fight.rows.filter((r) => r.in && r.kind !== "pc").every((r) => r.ini !== null)');
      await click(page, '#fNext');
      const p = await until(page, 'p.fight.round === 1');
      assert.strictEqual(await page.evaluate('window.scrollY'), 0, 'no scrolling needed');
      assert.ok(p.layout.orderBottom <= 762, `the order ends at ${p.layout.orderBottom}`);
      assert.ok(p.layout.actingTop <= 762 - 150, `the acting panel starts at ${p.layout.actingTop}`);
      assert.strictEqual(p.layout.wide, false, 'nothing wider than the window');
      assert.ok(p.fight.actingName, 'someone is acting');
      await shot(page, 'fight-1449');
    });
  });

  it('1920x1080: the acting panel has its own column', async () => {
    const run = await start();
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await started(page, run);
      const p = await probe(page);
      assert.ok(p.layout.actingLeft >= p.layout.orderRight, `acting at ${p.layout.actingLeft}, order ends at ${p.layout.orderRight}`);
      assert.ok(inView(p.layout.cutTop, 1080), 'the beat cut is in view beside them');
      assert.strictEqual(p.layout.wide, false);
      await shot(page, 'fight-1920');
    });
  });

  it('rows are one line', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await started(page, run);
      const p = await probe(page);
      const plain = p.layout.rows.filter((r) => !r.statuses);
      assert.ok(plain.length >= 9, `${plain.length} rows with no statuses`);
      for (const r of plain) assert.ok(r.h <= 40, `${r.name} is ${r.h} px high`);
    });
  });

  it('typed initiative keeps focus; Tab goes to the next box; nothing re-sorts', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await fightOn(page, run);
      const order = p.fight.rows.map((r) => r.id);
      const boxes = await page.evaluate('Array.from(document.querySelectorAll("[data-fini]"), (e) => e.dataset.fini)');
      const ada = rowOf(p, ADA).id;
      await fill(page, `[data-fini="${ada}"]`, '3');
      await page.key('Enter');
      let now = await until(page, `p.fight.rows.find((r) => r.id === ${q(ada)}).ini === 3`);
      assert.strictEqual(await focused(page), ada, 'Enter keeps focus in the box');
      await page.key('Tab');
      const nextBox = boxes[boxes.indexOf(ada) + 1];
      assert.strictEqual(await focused(page), nextBox, 'Tab goes to the next initiative box');
      await fill(page, `[data-fini="${nextBox}"]`, '25');
      await page.key('Tab', { shift: true });
      assert.strictEqual(await focused(page), ada, 'Shift+Tab goes back');
      now = await until(page, `p.fight.rows.find((r) => r.id === ${q(nextBox)}).ini === 25`);
      assert.deepStrictEqual(now.fight.rows.map((r) => r.id), order, 'nothing re-sorts until Sort or Start');
      // past the last box, and before the first, Tab leaves the boxes for the page's other controls
      const last = boxes.at(-1);
      await fill(page, `[data-fini="${last}"]`, '4');
      await page.key('Tab');
      assert.ok(!boxes.includes(await focused(page)), 'Tab past the last box leaves the boxes');
      await until(page, `p.fight.rows.find((r) => r.id === ${q(last)}).ini === 4`);
      await page.evaluate(`document.querySelector('[data-fini="${boxes[0]}"]').focus()`);
      await page.key('Tab', { shift: true });
      assert.ok(!boxes.includes(await focused(page)), 'Shift+Tab before the first leaves them too');
      await click(page, '#fSort');
      now = await until(page, `p.fight.rows[0].id === ${q(nextBox)}`);
      assert.deepStrictEqual(now.errors, []);
    });
  });

  it('Start asks once about PCs with no initiative', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await fightOn(page, run);
      await typeInit(page, p, { [ADA]: 14 });
      await click(page, '#fNext');
      let now = await until(page, 'p.fight.ask');
      assert.strictEqual(now.fight.round, 0, 'not started yet');
      const text = await page.evaluate('document.querySelector(".fask").textContent');
      assert.match(text, /No initiative yet for Ben Hart\. Start anyway\?/);
      assert.doesNotMatch(text, /Ada/);
      await click(page, '#fStartAnyway');
      now = await until(page, 'p.fight.round === 1 && !p.fight.ask');
      assert.ok(now.fight.turn);
      // a second fight asks again; within one fight, the second Start goes ahead
      await click(page, '#fEnd');
      await click(page, '#fEnd');
      await until(page, '!p.fight');
      await click(page, `[id="beat:${run.model.beats[0].key}"] [data-fight]`);
      await until(page, 'p.fight && p.fight.round === 0');
      await click(page, '#fNext');
      await until(page, 'p.fight.ask');
      await click(page, '#fNext');
      await until(page, 'p.fight.round === 1');
    });
  });

  it('Roll fills foes\' and allies\' boxes through the server, never PCs\'', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run);
      await click(page, '#fRoll');
      const p = await until(page, 'p.fight.rows.filter((r) => r.in && r.kind !== "pc" && r.kind !== "lair").every((r) => r.ini !== null) && p.pending === 0');
      for (const r of p.fight.rows) {
        if (r.kind === 'pc') assert.strictEqual(r.ini, null, `${r.name}: the sheet never rolls for a PC`);
        else if (r.kind === 'lair') assert.strictEqual(r.ini, 20);
        else if (r.in) assert.ok(r.ini - r.mod >= 1 && r.ini - r.mod <= 20, `${r.name}: ${r.ini} with ${r.mod}`);
      }
      assert.ok(p.requests['POST /api/roll'] >= 1, 'the dice are the server\'s');
      const st = await getState(run);
      assert.deepStrictEqual(st.fight.rows.map((r) => r.ini), p.fight.rows.map((r) => r.ini), 'the server holds the same numbers');
    });
  });

  it('two groups, one order', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const [b1, hub] = run.model.beats;
      await click(page, `[id="beat:${b1.key}"] [data-move="${ADA}"]`);
      await settled(page);
      await click(page, `[id="beat:${hub.key}"] [data-move="${BEN}"]`);
      await settled(page);
      await click(page, `[id="beat:${b1.key}"] [data-fight]`);
      let p = await until(page, 'p.fight');
      assert.strictEqual(rowOf(p, ADA).in, true);
      assert.strictEqual(rowOf(p, BEN).in, false, 'a PC elsewhere is listed unticked');
      assert.strictEqual(p.fight.groups.length, 1);
      await click(page, '[data-faddgroup]');
      p = await until(page, 'p.fight.groups.length === 2');
      assert.strictEqual(rowOf(p, BEN).in, true, 'the group joins');
      const view = await until(page, 'p.view && p.view.panels.length === 2 && p.view.panels.every((x) => x.order)');
      const names = view.view.panels.map((x) => x.order.rows.map((r) => r.name).join(','));
      assert.strictEqual(names[0], names[1], 'both panels show the one order');
      assert.doesNotMatch(await page.evaluate('document.querySelector(".fadd").textContent'), /Ben/, 'no group left to add');
      // anyone by name, with a count; a named NPC already in is refused
      await fill(page, '#fAddName', 'Ice Drake');
      await fill(page, '#fAddCount', '2');
      await click(page, '#fAddGo');
      p = await until(page, 'p.fight.rows.filter((r) => r.note === "Creatures/Ice Drake.md").length === 2');
      assert.deepStrictEqual(p.fight.rows.filter((r) => r.note === 'Creatures/Ice Drake.md').map((r) => r.name), ['Ice Drake 1', 'Ice Drake 2']);
      await fill(page, '#fAddName', 'Brother Venn');
      await page.key('Enter');
      p = await until(page, 'p.notes.includes("Brother Venn is already in this fight.")');
      assert.strictEqual(p.fight.rows.filter((r) => r.name.startsWith('Brother Venn')).length, 1);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('reload mid-fight: the same turn, round, HP and paused state', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { b, p: was } = await started(page, run);
      const wyrm = rowOf(was, WYRM);
      await fill(page, `[data-fhp="${wyrm.id}"]`, '-40');
      await page.key('Enter');
      await until(page, `p.fight.rows.find((r) => r.id === ${q(wyrm.id)}).hp === ${wyrm.hp - 40}`);
      assert.strictEqual(await focused(page), `fhp:${wyrm.id}`, 'Enter keeps focus in the HP box');
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${wyrm.id}"]').value`), '', 'the box empties');
      await click(page, '#fNext');
      await until(page, `p.fight.turn !== ${q(was.fight.turn)}`);
      // J jots to the fight's beat during a fight
      await page.evaluate('document.activeElement.blur()');
      await page.key('j');
      assert.strictEqual(await focused(page), 'hjot');
      await fill(page, '#hjot', 'The bell rings.');
      await page.key('Enter');
      await click(page, '#fPause');
      const before = await until(page, 'p.fight.paused && p.pending === 0 && p.saved === "Saved"');
      const st = await getState(run);
      assert.ok(st.jots.some((j) => j.beat === b.key && j.text === 'The bell rings.'), 'the jot is the fight beat\'s');
      await shot(page, 'paused-1449');
      // a mark on the old document, so the wait below can only pass in the reloaded one
      await page.evaluate('window.__beforeReload = true');
      await page.reload();
      const p = await until(page, '!window.__beforeReload && p.fight && p.saved === "Saved"');
      assert.strictEqual(p.fight.turn, before.fight.turn);
      assert.strictEqual(p.fight.round, before.fight.round);
      assert.strictEqual(p.fight.paused, true);
      assert.strictEqual(rowOf(p, WYRM).hp, wyrm.hp - 40);
      assert.deepStrictEqual(p.fight.rows.map((r) => r.ini), before.fight.rows.map((r) => r.ini));
      assert.ok(await page.evaluate('Boolean(document.querySelector("#fResume"))'), 'Resume is there');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('two tabs mid-fight: each hit lands once', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await started(page, run);
      const wyrm = rowOf(p, WYRM);
      const tab = await page.newTab(`${run.base}/?probe=1`);
      await until(tab, 'p.fight && p.saved === "Saved"');
      // the other tab hits first; this page's hit, built before it saw that one, still lands once
      await fill(tab, `[data-fhp="${wyrm.id}"]`, '-5');
      await fill(page, `[data-fhp="${wyrm.id}"]`, '-7');
      await tab.key('Enter');
      await page.key('Enter');
      const want = wyrm.hp - 12;
      for (const pg of [page, tab]) await until(pg, `p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(wyrm.id)}).hp === ${want}`);
      const st = await getState(run);
      assert.strictEqual(st.fight.rows.find((r) => r.id === wyrm.id).hp, want, 'each hit once on the server');
      assert.deepStrictEqual((await probe(tab)).errors, []);
    });
  });

  it('area damage with the breath spent', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await fightOn(page, run);
      const wyrm = rowOf(p, WYRM);
      // the wyrm first: 30 beats everyone's roll; the PCs typed
      await typeInit(page, p, { [WYRM]: 130, [ADA]: 15, [BEN]: 12 });
      await click(page, '#fRoll');
      await until(page, 'p.fight.rows.filter((r) => r.in && r.kind !== "pc").every((r) => r.ini !== null) && p.pending === 0');
      await click(page, '#fNext');
      let now = await until(page, `p.fight.turn === ${q(wyrm.id)}`);
      await click(page, '#fArea');
      await click(page, `[data-fsel="${rowOf(now, ADA).id}"]`);
      await click(page, `[data-fsel="${rowOf(now, BEN).id}"]`);
      await click(page, `[data-fahalf="${rowOf(now, BEN).id}"]`);
      assert.match(await page.evaluate('document.querySelector(".areabar").textContent'), /2 ticked/);
      assert.strictEqual(await page.evaluate('document.querySelector("[data-fspend]").checked'), true, 'the breath is offered, ticked');
      await fill(page, '#fAreaDmg', '10');
      await click(page, '#fAreaGo');
      now = await until(page, `p.fight.rows.find((r) => r.note === ${q(ADA)}).hp === 12 && !p.fight.area`);
      assert.strictEqual(rowOf(now, BEN).hp, 15, 'half on a save, rounded down');
      assert.strictEqual(rowOf(now, WYRM).recharge[0].ready, false, 'Cold Breath spent');
      await settled(page);
      const st = await getState(run);
      assert.ok(st.events.some((e) => e.text === 'Cold Breath: 10 damage to Ada Moss 10, Ben Hart 5 (half).'), 'one Log line names each hit');
      // round 2, the wyrm's turn again: the page asks the server for a recharge roll
      for (let i = 0; i < 30; i++) {
        const cur = await probe(page);
        if (cur.fight.round === 2 && cur.fight.turn === wyrm.id) break;
        await click(page, '#fNext');
        await until(page, `p.fight.turn !== ${q(cur.fight.turn)}`);
      }
      now = await until(page, `(() => { const r = p.fight.rows.find((x) => x.id === ${q(wyrm.id)}); return p.fight.round === 2 && r.recharge[0].rolled && r.recharge[0].rolled.round === 2; })()`);
      assert.ok(now.requests['POST /api/roll'] >= 2);
      assert.deepStrictEqual(now.errors, []);
    });
  });

  it('a lone foe keeping the turn into a new round still rolls its spent recharge', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await started(page, run);
      const wyrm = rowOf(p, WYRM);
      // another window leaves the wyrm alone in the fight, its breath spent
      const { stateId, state } = await (await fetch(`${run.base}/api/state`)).json();
      const actions = state.fight.rows.filter((r) => r.id !== wyrm.id).map((r, i) => ({ id: `o-${i}`, type: 'fightTick', fight: state.fight.id, row: r.id, in: false }));
      actions.push({ id: 'o-breath', type: 'recharge', fight: state.fight.id, row: wyrm.id, name: wyrm.recharge[0].name, ready: false });
      const res = await fetch(`${run.base}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stateId, base: 0, clientId: 'other-tab', actions }) });
      assert.strictEqual(res.status, 200);
      await until(page, `p.fight.rows.filter((r) => r.in).length === 1 && p.pending === 0`);
      let now = await probe(page);
      if (now.fight.turn !== wyrm.id) {
        await click(page, '#fNext');
        now = await until(page, `p.fight.turn === ${q(wyrm.id)} && p.pending === 0`);
      }
      const round = now.fight.round;
      await settled(page);
      const rolls = (await probe(page)).requests['POST /api/roll'] || 0;
      await click(page, '#fNext');
      now = await until(page, `p.fight.round === ${round + 1} && p.fight.turn === ${q(wyrm.id)} && p.fight.rows.find((x) => x.id === ${q(wyrm.id)}).recharge[0].rolled && p.fight.rows.find((x) => x.id === ${q(wyrm.id)}).recharge[0].rolled.round === ${round + 1}`);
      assert.ok(now.requests['POST /api/roll'] > rolls, 'a recharge roll was asked for');
      assert.deepStrictEqual(now.errors, []);
    });
  });

  it('Start and Resume scroll the right column to the beat; Pause opens the beat under an order strip', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { b, p } = await fightOn(page, run);
      await typeInit(page, p, { [ADA]: 15, [BEN]: 12 });
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await click(page, '#fNext');
      let now = await until(page, 'p.fight.round === 1');
      assert.ok(inView(now.layout.cutTop, 762), `Start: the cut at ${now.layout.cutTop}`);
      await click(page, '#fPause');
      now = await until(page, 'p.fight.paused');
      const strip = await page.evaluate('(() => { const s = document.querySelector(".pstrip"); return s && { top: s.getBoundingClientRect().top, text: s.textContent }; })()');
      assert.ok(strip && inView(strip.top, 762), 'the order strip is at the top');
      assert.match(strip.text, /Glacier Wyrm/);
      const beatTop = await page.evaluate(`document.querySelector('[id="beat:${b.key}"]').getBoundingClientRect().top`);
      assert.ok(inView(beatTop, 762), `Pause opens the beat (at ${beatTop})`);
      assert.ok(await page.evaluate('Boolean(document.querySelector("#side #pv"))'), 'the players\' preview is back');
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await click(page, '#fResume');
      now = await until(page, '!p.fight.paused');
      assert.ok(inView(now.layout.cutTop, 762), `Resume: the cut at ${now.layout.cutTop}`);
      assert.deepStrictEqual(now.errors, []);
    });
  });

  it('a fight whose beat left the Plan still runs', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await started(page, run);
      const plan = path.join(run.vault, PLAN);
      fs.writeFileSync(plan, lf(fs.readFileSync(plan, 'utf8')).replace('### Scene 1: Ashfall Reckoning', '### Scene 1: Copperwick Quarrel'));
      await fetch(`${run.base}/api/model`);
      await page.evaluate('window.__beforeReload = true');
      await page.reload();
      const now = await until(page, '!window.__beforeReload && p.fight && p.saved === "Saved" && p.layout');
      assert.deepStrictEqual(now.fight.rows.map((r) => r.id), p.fight.rows.map((r) => r.id), 'the order stays');
      assert.strictEqual(now.fight.turn, p.fight.turn);
      assert.ok(now.fight.actingName, 'the acting panel stays');
      assert.match(await page.evaluate('document.querySelector("#fightCut").textContent'), /This fight's beat is no longer in the Plan/);
      await click(page, '#fNext');
      await until(page, `p.fight.turn !== ${q(p.fight.turn)}`);
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  it('End fight takes two clicks and opens the after-the-fight box', async () => {
    const run = await start();
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      const { p } = await started(page, run);
      const ada = rowOf(p, ADA).id;
      const ben = rowOf(p, BEN).id;
      await choose(page, `[data-fstatus="${ada}"]`, 'Prone');
      await choose(page, `[data-fstatus="${ada}"]`, 'Concentrating');
      await choose(page, `[data-fstatus="${ben}"]`, 'Exhaustion 2');
      // a typed status: other… opens a box
      await choose(page, `[data-fstatus="${ben}"]`, 'other');
      await page.waitFor(`document.querySelector('[data-fother="${ben}"]')`);
      await fill(page, `[data-fother="${ben}"]`, 'Hexed');
      await page.key('Enter');
      let now = await until(page, `p.fight.rows.find((r) => r.id === ${q(ben)}).conds.includes('Hexed') && p.fight.rows.find((r) => r.id === ${q(ada)}).conc`);
      assert.deepStrictEqual(rowOf(now, ADA).conds, ['Prone']);
      assert.strictEqual(rowOf(now, BEN).exhaustion, 2);
      // Stunned ends Ada's concentration (SRD 5.2.1)
      await choose(page, `[data-fstatus="${ada}"]`, 'Stunned');
      now = await until(page, `!p.fight.rows.find((r) => r.id === ${q(ada)}).conc`);
      // a chip's click removes it
      await click(page, `[data-fun="${ada}|Stunned"]`);
      await until(page, `!p.fight.rows.find((r) => r.id === ${q(ada)}).conds.includes('Stunned')`);
      await choose(page, `[data-fstatus="${ada}"]`, 'Concentrating');
      await until(page, `p.fight.rows.find((r) => r.id === ${q(ada)}).conc`);
      await click(page, '#fEnd');
      now = await probe(page);
      assert.ok(now.fight, 'one click only arms it');
      await click(page, '#fEnd');
      now = await until(page, '!p.fight && p.after');
      const box = await page.evaluate('document.querySelector("#afterFight").textContent');
      for (const w of ['Ada Moss', 'Prone', 'Concentrating', 'Ben Hart', 'Exhaustion 2', 'Hexed']) assert.ok(box.includes(w), `${w} in: ${box}`);
      assert.ok(inView(now.layout.afterTop, 1080), 'the box is in view');
      await shot(page, 'after-1920');
      await click(page, `[data-fafter="${ada}|Prone"]`);
      now = await until(page, `p.after && !p.after.rows.find((r) => r.id === ${q(ada)}).statuses.includes('Prone')`);
      await click(page, '#fAfterAll');
      now = await until(page, '!p.after && p.pending === 0');
      assert.ok(await page.evaluate('!document.querySelector("#afterFight")'));
      const st = await getState(run);
      assert.strictEqual(st.fight, null);
      assert.strictEqual(st.fights.length, 1, 'the fight is kept');
      assert.deepStrictEqual(now.errors, []);
    });
  });

  it('a system with no fight rows yet has no Fight button; no script errors', async () => {
    const run = await start({ edit: (v) => {
      const f = path.join(v, '_meta', 'vault-config.yaml');
      fs.writeFileSync(f, lf(fs.readFileSync(f, 'utf8')).replace('system: dnd-5e-2024', 'system: coc-7e'));
    } });
    assert.strictEqual(run.model.system, 'coc-7e');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      await click(page, `[id="beat:${run.model.beats[0].key}"] [data-all]`);
      const p = await settled(page);
      assert.strictEqual(await page.evaluate('document.querySelectorAll("[data-fight]").length'), 0, 'absent, not disabled');
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

describe('the fight takes the PR review\'s and the proof\'s fixes', { skip: browserSkip() }, () => {
  const PLAN_FILE = (v) => path.join(v, ...PLAN.split('/'));
  const GILT = 'Characters/NPCs/Masked Gilt.md';
  const WOLF = 'Creatures/Frost Wolf.md';
  // the Plan's Frost Wolf "arrives in round three": a cue line names it too, as Snowbound's Plans do
  const withCue = (v) => {
    const f = PLAN_FILE(v);
    fs.writeFileSync(f, lf(fs.readFileSync(f, 'utf8')).replace('- **[[Frost Wolf]]:** arrives in round three\n',
      '- **[[Frost Wolf]]:** arrives in round three\n- **Arriving, start of round 3:** [[Frost Wolf]] from the ridge\n'));
  };

  it('proof M1: a cue\'s people join benched, and the cue adds them', async () => {
    const run = await start({ edit: withCue });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await fightOn(page, run);
      assert.strictEqual(rowOf(p, WOLF).in, false, 'benched');
      assert.ok(!p.view || !JSON.stringify(p.view).includes('Stranger 5'), 'no extra unseen row');
      const btn = '#fightCut [data-faddcast]';
      assert.match(await page.evaluate(`document.querySelector(${q(btn)}).textContent`), /Add Frost Wolf to the fight/);
      await click(page, btn);
      const now = await until(page, `p.fight.rows.find((r) => r.note === ${q(WOLF)}).in`);
      assert.strictEqual(now.fight.rows.filter((r) => r.note === WOLF).length, 1, 'ticked in, not a copy');
      assert.strictEqual(await page.evaluate(`document.querySelectorAll(${q(btn)}).length`), 0, 'no button once in');
      assert.deepStrictEqual(now.errors, []);
    });
  });

  it('proof M2: Fight where no PC stands: every PC\'s group is in, the panel shows the order, Add offers none of them', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const [b1, hub] = run.model.beats;
      await click(page, `[id="beat:${hub.key}"] [data-all]`);
      await settled(page);
      await click(page, `[id="beat:${b1.key}"] [data-fight]`);
      const p = await until(page, 'p.fight && p.view && p.view.panels.length && p.view.panels[0].order');
      assert.ok(rowOf(p, ADA).in && rowOf(p, BEN).in);
      assert.strictEqual(await page.evaluate('document.querySelectorAll("[data-faddgroup]").length'), 0, 'no group left to add');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('proof Low: the Add box is empty after an Enter add', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run);
      await fill(page, '#fAddName', 'Ice Drake');
      await page.key('Enter');
      await until(page, 'p.fight.rows.some((r) => r.note === "Creatures/Ice Drake.md")');
      assert.strictEqual(await page.evaluate('document.querySelector("#fAddName").value'), '');
    });
  });

  it('proof Low: the cut\'s Who\'s here shows the unmasked name and play-as', async () => {
    const run = await start({ edit: (v) => {
      const f = path.join(v, ...GILT.split('/'));
      fs.writeFileSync(f, lf(fs.readFileSync(f, 'utf8')).replace('GMNOTE-Masked Gilt\n', 'GMNOTE-Masked Gilt\n\n### Playing Them\n\n**Speech:** loud, self-important.\n\n**Unmasked:** quiet and exact.\n'));
    } });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run);
      const cut = () => page.evaluate('document.querySelector("#fightCut .cwho").textContent');
      assert.match(await cut(), /Masked Gilt loud, self-important/);
      await click(page, `[data-unmask="${GILT}"]`);
      await settled(page);
      const text = await cut();
      assert.match(text, /Lucan Truename quiet and exact/);
      assert.doesNotMatch(text, /Masked Gilt|self-important/);
    });
  });

  it('a redraw from another window keeps a half-typed initiative and its focus', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const { p } = await fightOn(page, run);
      const ada = rowOf(p, ADA).id;
      await fill(page, `[data-fini="${ada}"]`, '17');
      const { stateId, state } = await (await fetch(`${run.base}/api/state`)).json();
      const res = await fetch(`${run.base}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId, base: 0, clientId: 'other-tab', actions: [{ id: 'o-1', type: 'setInit', fight: state.fight.id, row: rowOf(p, BEN).id, ini: 9 }] }) });
      assert.strictEqual(res.status, 200);
      await until(page, `p.fight.rows.find((r) => r.id === ${q(rowOf(p, BEN).id)}).ini === 9`);
      assert.strictEqual(await focused(page), ada, 'focus kept');
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fini="${ada}"]').value`), '17', 'the typed number kept');
      await page.key('Enter');
      await until(page, `p.fight.rows.find((r) => r.id === ${q(ada)}).ini === 17 && p.pending === 0`);
    });
  });

  it('a half-typed number kept through a redraw is saved when the box is left', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      const { p } = await fightOn(page, run);
      const ada = rowOf(p, ADA).id;
      const other = async (ini, n) => {
        const { stateId, state } = await (await fetch(`${run.base}/api/state`)).json();
        const res = await fetch(`${run.base}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stateId, base: 0, clientId: 'other-tab', actions: [{ id: `o-${n}`, type: 'setInit', fight: state.fight.id, row: rowOf(p, BEN).id, ini }] }) });
        assert.strictEqual(res.status, 200);
        await until(page, `p.fight.rows.find((r) => r.id === ${q(rowOf(p, BEN).id)}).ini === ${ini}`);
      };
      await fill(page, `[data-fini="${ada}"]`, '17');
      await other(9, 1);
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fini="${ada}"]').value`), '17');
      await page.evaluate('document.activeElement.blur()');
      await until(page, `p.fight.rows.find((r) => r.id === ${q(ada)}).ini === 17 && p.pending === 0`);
      // the same for a max: nothing is sent while it is half typed
      const wolf = rowOf(p, WYRM).id;
      await fill(page, `[data-fmax="${wolf}"]`, '4');
      await other(8, 2);
      assert.notStrictEqual((await probe(page)).fight.rows.find((r) => r.id === wolf).max, 4, 'a redraw sends no half-typed max');
      await fill(page, `[data-fmax="${wolf}"]`, '45');
      await page.evaluate('document.activeElement.blur()');
      const now = await until(page, `p.fight.rows.find((r) => r.id === ${q(wolf)}).max === 45 && p.pending === 0`);
      assert.deepStrictEqual(now.errors, []);
    });
  });

  for (const [w, h] of [[1449, 762], [1920, 1080]]) {
    it(`proof Low: the busiest row stays one line at ${w}`, async () => {
      const run = await start();
      await withPage({ width: w, height: h }, async (page) => {
        const { p } = await started(page, run);
        const wyrm = rowOf(p, WYRM);
        await fill(page, `[data-fhp="${wyrm.id}"]`, `-${Math.ceil(wyrm.max / 2) + 1}`);
        await page.key('Enter');
        await settled(page);
        await choose(page, `[data-fstatus="${wyrm.id}"]`, 'Frightened');
        const now = await until(page, `p.fight.rows.find((r) => r.id === ${q(wyrm.id)}).conds.includes('Frightened') && p.pending === 0`);
        await shot(page, `busiest-${w}`);
        const row = now.layout.rows.find((r) => r.id === wyrm.id);
        assert.ok(row.h <= 40, `${row.name} is ${row.h} px high`);
        assert.strictEqual(row.over, false, 'nothing runs past the row');
        assert.strictEqual(row.nameCut, false, 'the name is whole');
        assert.strictEqual(now.layout.wide, false);
      });
    });
  }
});
