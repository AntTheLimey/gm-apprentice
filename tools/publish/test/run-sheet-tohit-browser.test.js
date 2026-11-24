'use strict';
// The GURPS to-hit calculator on the GM page (step 6b Task 24) in a real browser, against the real server in this
// process, on temp copies of test/fixtures/run-sheet-gurps. Real input only: held clicks, key presses, inserted text
// and page.choose for the calculator's selects (helpers/cdp.js); another window's actions go through the server as
// the fight tests send them. Every expected roll is the calculator's own pure half (js/gurps-tohit.js make) over the
// data block the server gives. Skipped without Chrome, except on CI. RS_SHOTS=<dir> keeps screenshots.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession } = require('../lib/run-sheet/sessions');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');
const { copyFixture, removeFixture } = require('./helpers/systems-fixture');
const { sane } = require('./helpers/fight-layout');
const { buildPc } = require('./helpers/pc-vault');
const { make } = require('../js/gurps-tohit');

const SHOTS = process.env.RS_SHOTS || '';
async function shot(page, name) {
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot(path.join(SHOTS, `${name}.png`)); }
}
const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';
const SIZES = [[1449, 762], [1280, 762], [1100, 762]];
const PARTY = ['Characters/PCs/Corin Ash.md', 'Characters/PCs/Lysa Venn.md', 'Characters/PCs/Orrin Tate.md', 'Characters/PCs/Sela Drake.md'];
const SELA = 'Characters/PCs/Sela Drake.md';
const ENCUMBRANCE = 'Uses the level written on the sheet: it does not count encumbrance.';

const made = [];
const servers = [];
after(async () => {
  for (const t of servers) { try { await t.close(); } catch { /* closed already */ } }
  for (const d of made) removeFixture(d);
});

async function start() {
  const vault = copyFixture('run-sheet-gurps');
  made.push(vault);
  const picked = pickSession(listSessions(vault), 'Session 01 - Crates', vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 20, log: () => {}, randomInt: () => 4 } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  const base = `http://127.0.0.1:${port}`;
  const model = (await (await fetch(`${base}/api/model`)).json()).model;
  return { ...t, vault, base, model };
}

const until = (page, test, ms) => page.waitFor(`(() => { const p = ${PROBE}; return p && (${test}) && p; })()`, ms);
const settled = (page) => until(page, 'p.saved === "Saved" && p.pending === 0');
const q = (v) => JSON.stringify(v);
async function tap(page, sel) {
  const r = await page.click(sel);
  assert.ok(r.inView && r.hit, `click ${sel}: ${JSON.stringify(r)}`);
  return r;
}
async function typeInto(page, sel, text, { enter = true, settle = true } = {}) {
  await tap(page, sel);
  await page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 2000);
  await page.type(String(text));
  if (enter) await page.key('Enter');
  return settle ? settled(page) : until(page, 'true');
}
const named = (p, name) => p.fight.rows.find((r) => r.name === name);
const text = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null; })()`);
const valueOf = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.value : null; })()`);
const box = (p, name, key) => `#acting [data-fs-${key}="${named(p, name).id}"]`;
async function peek(page, p, name) {
  await tap(page, `[data-fpeek="${named(p, name).id}"]`);
  return until(page, `p.fight.actingName === ${q(name)}`);
}
let otherN = 0;
async function fromOther(run, actions) {
  const { stateId } = await (await fetch(`${run.base}/api/state`)).json();
  const res = await fetch(`${run.base}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stateId, base: 0, clientId: 'other-tab', actions: actions.map((a) => ({ id: `o-${++otherN}`, ...a })) }) });
  assert.strictEqual(res.status, 200);
}

// The page with the sheet up and no fight: the PCs section's bar holds the To-hit button.
async function sheetUp(page, run) {
  await page.goto(`${run.base}/?probe=1`);
  return settled(page);
}
// The dialog open, its calculator drawn (a typed skill with no level draws none: `drawn: false`).
const dialogUp = (page, { drawn = true } = {}) => until(page, `p.tohit && p.tohit.open && ${drawn ? 'p.tohit.roll !== null' : 'true'}`);
const rollIs = (page, n) => until(page, `p.tohit && p.tohit.open && p.tohit.roll === ${q(String(n))}`);
// A typed skill: "a typed skill" chosen in Start from, then the level typed (inserted, as a hand types it).
async function typedSkill(page, level) {
  await page.choose('#thFrom', 'a');
  await page.waitFor('!document.querySelector("#thTyped").hidden', 3000);
  await tap(page, '#thLevel');
  await page.waitFor('document.activeElement === document.querySelector("#thLevel")', 2000);
  await page.type(String(level));
  return rollIs(page, level);
}
// The data block the server gives, and the calculator's pure half over its rules.
async function pcData(run, note) { return (await (await fetch(`${run.base}/api/tohit?pc=${encodeURIComponent(note)}`)).json()).data; }
async function typedData(run, level, type = 'melee') {
  const res = await fetch(`${run.base}/api/tohit/typed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, type, name: '' }) });
  return (await res.json()).data;
}
const pure = (data, over = {}) => { const C = make(data.rules); return C.effective(data, { ...C.defaultState(data), ...over }).roll; };

// Two Bouncers added with the Add box's count, Bouncer 1 fastest (Speed 9 typed), every PC in; the fight started.
async function bouncers(page, run) {
  await page.goto(`${run.base}/?probe=1`);
  await settled(page);
  const b = run.model.beats[1];
  await tap(page, `[id="beat:${b.key}"] [data-all]`);
  await settled(page);
  await tap(page, `[id="beat:${b.key}"] [data-fight]`);
  let p = await until(page, 'p.fight && p.fight.rows.length > 0 && p.saved === "Saved" && p.pending === 0');
  await tap(page, '#fAddCount');
  await page.type('2');
  await tap(page, '#fAddName');
  await page.type('Bouncer');
  await page.waitFor('document.querySelector("[data-faddnew]")');
  await tap(page, '[data-faddnew]');
  p = await until(page, 'p.fight.rows.some((r) => r.name === "Bouncer 2") && p.saved === "Saved" && p.pending === 0');
  p = await peek(page, p, 'Bouncer 1');
  p = await typeInto(page, box(p, 'Bouncer 1', 'speed'), '9');
  await tap(page, '#fNext');
  if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
  p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
  assert.strictEqual(p.fight.turn, named(p, 'Bouncer 1').id);
  return p;
}

describe('the GURPS to-hit calculator on the GM page, by real input', { skip: browserSkip() }, () => {
  it("open the dialog, pick an unencumbered PC's weapon: the result equals make(rules).effective for that weapon and the default state", async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await sheetUp(page, run);
      assert.strictEqual(await page.evaluate('document.querySelector("#pcsToHit").title'), "The GURPS to-hit calculator, as the player site's sheets have it");
      await tap(page, '#pcsToHit');
      let p = await dialogUp(page);
      // Start from: each PC with an attack on the sheet, then a typed skill
      assert.deepStrictEqual(await page.evaluate('Array.from(document.querySelectorAll("#thFrom option"), (o) => o.textContent)'), ['Corin Ash', 'Sela Drake', 'a typed skill']);
      assert.strictEqual(p.tohit.from, 'Characters/PCs/Corin Ash.md');
      await page.choose('#thFrom', 'Sela');
      p = await until(page, `p.tohit.from === ${q(SELA)} && p.tohit.roll !== null && /Broadsword/.test(document.querySelector("#th-weapon").textContent)`);
      // the letters pick the option (a space in them would open the list): Shield bash is the one starting "Shi"
      await page.choose('#th-weapon', 'Shi');
      const data = await pcData(run, SELA);
      const bash = data.weapons.find((w) => w.name === 'Shield bash');
      const want = pure(data, { weapon: bash.id });
      p = await rollIs(page, want);
      assert.strictEqual(want, 12);
      assert.strictEqual(await valueOf(page, '#th-weapon'), bash.id);
      assert.strictEqual(await text(page, '#th-wline'), '1d cr');
      // each PC's setup is the calculator's own memory, under the GM page's key (Corin's was drawn first)
      const keys = await page.evaluate('Object.keys(localStorage).filter((k) => k.startsWith("tohit-calc:")).sort()');
      assert.deepStrictEqual(keys, ['tohit-calc:gm-table:the-salt-quay:corin-ash', 'tohit-calc:gm-table:the-salt-quay:sela-drake']);
      const saved = await page.evaluate('JSON.parse(localStorage.getItem("tohit-calc:gm-table:the-salt-quay:sela-drake")).state.weapon');
      assert.strictEqual(saved, bash.id);
      await shot(page, 'tohit-pc');
    });
  });

  it('a typed skill 12, melee, All-Out Attack (Determined): the result is 16, the pure half\'s for the same inputs', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await sheetUp(page, run);
      await tap(page, '#pcsToHit');
      await dialogUp(page);
      await typedSkill(page, 12);
      assert.strictEqual(await valueOf(page, '#thType'), 'melee');
      assert.strictEqual(await text(page, '#th-weapon option'), 'Typed skill (12)');
      // "All" picks the first of the All-Out Attacks, All-Out Attack (Determined)
      assert.match(await page.choose('#th-man', 'All'), /^All-Out Attack \(Determined\)/);
      const want = pure(await typedData(run, 12), { man: 'aod' });
      assert.strictEqual(want, 16);
      await rollIs(page, want);
      // a level the builder would read as another number is refused in place
      await tap(page, '#thLevel');
      await page.type('.5');
      await page.waitFor('document.querySelector("#thErr").textContent === "A whole number from 1 to 99"', 3000);
      assert.strictEqual(await page.evaluate('document.querySelector("#thBox").children.length'), 0);
      await shot(page, 'tohit-typed');
    });
  });

  it('with Bouncer 1 acting on All-Out Attack, Shock −2 and Prone, the dialog opens with those set and the result equals the pure half\'s for them', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run);
      const b1 = named(p, 'Bouncer 1').id;
      await tap(page, `li[data-frow="${b1}"] [data-fmanrow="${b1}"]`);
      await tap(page, `#acting [data-fman="${b1}|all-out attack"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).manoeuvre === "all-out attack" && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `#acting [data-fshock="${b1}"]`);
      await tap(page, `#acting [data-fshockset="${b1}|2"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).shock === 2 && p.saved === "Saved" && p.pending === 0`);
      await fromOther(run, [{ type: 'status', fight: p.fight.id, row: b1, add: 'Prone' }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).conds.includes("Prone") && p.saved === "Saved" && p.pending === 0`);
      // the toolbar's To-hit opens on the acting foe: a typed skill
      await tap(page, '#fToHit');
      p = await dialogUp(page, { drawn: false });
      assert.strictEqual(p.tohit.from, 'typed');
      assert.strictEqual(p.tohit.row, b1);
      await tap(page, '#thLevel');
      await page.type('12');
      const data = await typedData(run, 12);
      const want = pure(data, { man: 'aod', shock: -2, posture: data.rules.posture.prone });
      p = await rollIs(page, want);
      assert.deepStrictEqual(await page.evaluate('["#th-man", "#th-shock", "#th-posture"].map((s) => document.querySelector(s).value)'), ['aod', '-2', String(data.rules.posture.prone)]);
      // nothing went back to the row
      const row = (await (await fetch(`${run.base}/api/state`)).json()).state.fight.rows.find((r) => r.id === b1);
      assert.deepStrictEqual([row.manoeuvre, row.shock, row.conds], ['all-out attack', 2, ['Prone']]);
      await shot(page, 'tohit-bouncer');
    });
  });

  it('a second Bouncer opens on 12 and melee without retyping; a PC acting opens on its own weapons', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run);
      await tap(page, '#fToHit');
      await dialogUp(page, { drawn: false });
      await tap(page, '#thLevel');
      await page.type('12');
      await rollIs(page, 12);
      await page.key('Escape');
      p = await until(page, '!p.tohit');
      p = await peek(page, p, 'Bouncer 2');
      await tap(page, '#fToHit');
      p = await rollIs(page, 12);
      assert.strictEqual(p.tohit.row, named(p, 'Bouncer 2').id);
      assert.deepStrictEqual([await valueOf(page, '#thLevel'), await valueOf(page, '#thType')], ['12', 'melee']);
      await page.key('Escape');
      p = await until(page, '!p.tohit');
      // Sela's panel: its own To-hit, and the toolbar's, open on her weapons
      p = await peek(page, p, 'Sela Drake');
      for (const btn of ['#acToHit', '#fToHit']) {
        await tap(page, btn);
        p = await dialogUp(page);
        assert.strictEqual(p.tohit.from, SELA, btn);
        assert.strictEqual(await valueOf(page, '#thFrom'), SELA);
        assert.strictEqual(p.tohit.roll, String(pure(await pcData(run, SELA))));
        await page.key('Escape');
        p = await until(page, '!p.tohit');
      }
      sane(p, 'after the dialog');
    });
  });

  // Task 36 (Ant, 2026-11-24: "main combat skill is 12 ... and roll on that"): a foe's Skill, typed in its panel, is what
  // the dialog opens on; a level typed in the dialog becomes the row's Skill only when it had none
  it('a level typed for a foe with no Skill becomes its Skill; one with a Skill opens on it, and a level typed then leaves it', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run);
      const b1 = named(p, 'Bouncer 1').id;
      await tap(page, '#fToHit');
      await dialogUp(page, { drawn: false });
      await tap(page, '#thLevel');
      // fix round: written once, on commit (Enter, leaving the box, or closing), never a Skill 1 on the way to 13
      await page.type('1');
      await rollIs(page, 1);
      await page.type('3');
      await rollIs(page, 13);
      p = await settled(page);
      const serverSkill = async () => (await (await fetch(`${run.base}/api/state`)).json()).state.fight.rows.find((r) => r.id === b1).skill;
      assert.strictEqual(named(p, 'Bouncer 1').skill, null, 'nothing written while typing');
      assert.strictEqual(await serverSkill(), null);
      await page.key('Escape');
      p = await until(page, `!p.tohit && p.fight.rows.find((r) => r.id === ${q(b1)}).skill === 13 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await serverSkill(), 13, 'written on close');
      // the panel's Skill, typed: the dialog opens on it, over what was typed for the row before
      p = await peek(page, p, 'Bouncer 1');
      p = await typeInto(page, box(p, 'Bouncer 1', 'skill'), '15');
      assert.strictEqual(named(p, 'Bouncer 1').skill, 15);
      await tap(page, '#fToHit');
      p = await rollIs(page, 15);
      assert.strictEqual(await valueOf(page, '#thLevel'), '15');
      // a level typed now is the calculator's only: the row keeps 15
      await tap(page, '#thLevel');
      await page.key('Backspace');
      await page.key('Backspace');
      await page.type('9');
      await rollIs(page, 9);
      await page.key('Escape');
      p = await until(page, '!p.tohit && p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(named(p, 'Bouncer 1').skill, 15);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // fix round: Enter in the level box writes it too, once
  it('Enter in the level box writes a foe\'s Skill when it had none; one more keystroke writes nothing until the next commit', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run);
      const b1 = named(p, 'Bouncer 1').id;
      await tap(page, '#fToHit');
      await dialogUp(page, { drawn: false });
      await tap(page, '#thLevel');
      await page.type('12');
      await rollIs(page, 12);
      await page.key('Enter');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).skill === 12 && p.saved === "Saved" && p.pending === 0`);
      assert.ok(p.tohit && p.tohit.open, 'Enter leaves the dialog open');
      await page.key('Backspace');
      await page.type('4');
      await rollIs(page, 14);
      p = await settled(page);
      assert.strictEqual(named(p, 'Bouncer 1').skill, 12, 'not yet');
      await page.key('Enter');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).skill === 14 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('a typed skill opens with no choice left from before a reload (no key written)', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await bouncers(page, run);
      await tap(page, '#fToHit');
      await dialogUp(page, { drawn: false });
      await tap(page, '#thLevel');
      await page.type('12');
      await rollIs(page, 12);
      await page.choose('#th-man', 'All');
      await rollIs(page, 16);
      await page.key('Escape');
      await until(page, '!p.tohit');
      assert.deepStrictEqual(await page.evaluate('Object.keys(localStorage).filter((k) => k.startsWith("tohit-calc:"))'), []);
      // the new page, not the old one still answering while the reload starts
      await page.evaluate('window.__before = true');
      await page.reload();
      await page.waitFor('!window.__before && document.querySelector("#fToHit")', 15000);
      await settled(page);
      await tap(page, '#fToHit');
      // the level comes back for the row (the tab's memory for the night); the calculator's choices do not
      await rollIs(page, 12);
      assert.strictEqual(await valueOf(page, '#th-man'), 'attack');
      assert.deepStrictEqual(await page.evaluate('Object.keys(localStorage).filter((k) => k.startsWith("tohit-calc:"))'), []);
      // nothing of it in the run sheet's state or the Table Log
      const state = JSON.stringify((await (await fetch(`${run.base}/api/state`)).json()).state);
      const log = (await (await fetch(`${run.base}/api/record`)).json()).text;
      for (const word of ['Typed skill', 'tohit', 'To-hit']) {
        assert.ok(!state.includes(word), `state: ${word}`);
        assert.ok(!log.includes(word), `log: ${word}`);
      }
    });
  });

  // Sela's turn, by Next from Bouncer 1's, with no click on any name: the panel shows a foe (the last or next foe to act).
  async function selasTurn(page, p) {
    const sela = named(p, 'Sela Drake').id;
    for (let i = 0; i < 12 && p.fight.turn !== sela; i++) {
      const was = p.fight.turn;
      await tap(page, '#fNext');
      p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
    }
    assert.strictEqual(p.fight.turn, sela);
    return p;
  }

  it("on a PC's own turn, with nothing picked, the toolbar's To-hit opens on that PC's weapons", async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await selasTurn(page, await bouncers(page, run));
      assert.notStrictEqual(p.fight.actingName, 'Sela Drake', 'the panel shows a foe on a PC\'s turn');
      await tap(page, '#fToHit');
      p = await dialogUp(page);
      assert.strictEqual(p.tohit.from, SELA);
      assert.strictEqual(p.tohit.row, named(p, 'Sela Drake').id);
      assert.strictEqual(await valueOf(page, '#thFrom'), SELA);
      assert.strictEqual(p.tohit.roll, String(pure(await pcData(run, SELA))));
    });
  });

  it("a PC's shock and manoeuvre are read from the row at every open: what an earlier open left in the calculator's memory never stays", async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await selasTurn(page, await bouncers(page, run));
      const sela = named(p, 'Sela Drake').id;
      const data = await pcData(run, SELA);
      const reopen = async (want, fields) => {
        await tap(page, '#fToHit');
        await rollIs(page, want);
        assert.deepStrictEqual(await page.evaluate('["#th-man", "#th-shock"].map((s) => document.querySelector(s).value)'), fields);
        await page.key('Escape');
        return until(page, '!p.tohit');
      };
      p = await peek(page, p, 'Sela Drake');
      // Shock 2: the calculator opens on −2
      await tap(page, `#acting [data-fshock="${sela}"]`);
      await tap(page, `#acting [data-fshockset="${sela}|2"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(sela)}).shock === 2 && p.saved === "Saved" && p.pending === 0`);
      p = await reopen(pure(data, { shock: -2 }), ['attack', '-2']);
      // the shock cleared on the row: the next open reads 0, and the roll is back up
      await tap(page, `#acting [data-fshock="${sela}"]`);
      await tap(page, `#acting [data-fshockset="${sela}|0"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(sela)}).shock === 0 && p.saved === "Saved" && p.pending === 0`);
      p = await reopen(pure(data), ['attack', '0']);
      // All-Out Attack, then Attack
      await tap(page, `#acting [data-fman="${sela}|all-out attack"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(sela)}).manoeuvre === "all-out attack" && p.saved === "Saved" && p.pending === 0`);
      p = await reopen(pure(data, { man: 'aod' }), ['aod', '0']);
      await tap(page, `#acting [data-fman="${sela}|attack"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(sela)}).manoeuvre === "attack" && p.saved === "Saved" && p.pending === 0`);
      await reopen(pure(data), ['attack', '0']);
    });
  });

  it('the dialog opens at once, saying it is loading, before the list of PCs comes back', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await sheetUp(page, run);
      // what the dialog held at the moment it opened
      await page.evaluate(`(() => { const d = document.querySelector('#tohitDlg');
        new MutationObserver(() => { if (d.open && window.__atOpen === undefined) window.__atOpen = d.textContent; }).observe(d, { attributes: true, attributeFilter: ['open'] }); })()`);
      await tap(page, '#pcsToHit');
      await dialogUp(page);
      assert.match(await page.evaluate('window.__atOpen'), /Loading…/);
      assert.ok(!/Loading…/.test(await text(page, '#tohitDlg')), 'the line goes once it is filled');
    });
  });

  it('the dialog is 560 px and in the narrow layout: the 3-to-18 strip\'s cells show their numbers whole; the encumbrance line is on screen', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await sheetUp(page, run);
      await tap(page, '#pcsToHit');
      const p = await dialogUp(page);
      assert.strictEqual(p.tohit.narrow, true);
      const got = await page.evaluate(`(() => {
        const d = document.querySelector('#tohitDlg').getBoundingClientRect();
        const cells = Array.from(document.querySelectorAll('#thBox .th-strip .th-cell'), (c) => ({ t: c.textContent, whole: c.scrollWidth <= c.clientWidth, w: c.clientWidth }));
        const enc = document.querySelector('.thd-enc'); const e = enc.getBoundingClientRect();
        return { width: Math.round(d.width), body: getComputedStyle(document.querySelector('#thBox .th-body')).display, cells,
          enc: enc.textContent, encIn: e.top >= d.top && e.bottom <= Math.min(d.bottom, innerHeight) && e.left >= 0 && e.right <= innerWidth && e.height > 0 };
      })()`);
      assert.strictEqual(got.width, 560);
      assert.strictEqual(got.body, 'flex', 'the one-column layout');
      assert.deepStrictEqual(got.cells.map((c) => c.t), Array.from({ length: 16 }, (_, i) => String(i + 3)));
      assert.deepStrictEqual(got.cells.filter((c) => !c.whole), [], 'every cell shows its number whole');
      assert.strictEqual(got.enc, ENCUMBRANCE);
      assert.ok(got.encIn, 'the encumbrance line is on screen');
      await shot(page, 'tohit-narrow');
    });
  });

  it('Tab walks the dialog\'s boxes in order and never leaves it until Close; Esc closes it and focus goes back to the button', async () => {
    const run = await start();
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await sheetUp(page, run);
      await tap(page, '#pcsToHit');
      await dialogUp(page);
      // the boxes in the dialog, as a hand meets them: drawn (not in a closed group or a hidden part), enabled, in the page's order
      const list = await page.evaluate(`(() => { window.__thList = Array.from(document.querySelectorAll('#tohitDlg button, #tohitDlg select, #tohitDlg input, #tohitDlg summary'))
        .filter((e) => !e.disabled && e.checkVisibility() && !e.closest('[hidden]')); return window.__thList.length; })()`);
      assert.ok(list > 10, `${list} boxes`);
      const at = () => page.evaluate('window.__thList.indexOf(document.activeElement)');
      assert.strictEqual(await at(), 0, 'Start from has focus on opening');
      const seen = [];
      for (let i = 0; i < list + 1; i++) { await page.key('Tab'); seen.push(await at()); }
      assert.deepStrictEqual(seen, [...Array.from({ length: list - 1 }, (_, i) => i + 1), 0, 1]);
      await page.key('Tab', { shift: true });
      await page.key('Tab', { shift: true });
      assert.strictEqual(await at(), list - 1, 'Shift-Tab wraps backwards');
      await page.key('Escape');
      await until(page, '!p.tohit');
      assert.strictEqual(await page.evaluate('document.querySelector("#tohitDlg").open'), false);
      await page.waitFor('document.activeElement === document.querySelector("#pcsToHit")', 3000);
      // Close does the same
      await tap(page, '#pcsToHit');
      await dialogUp(page);
      await tap(page, '#thClose');
      await until(page, '!p.tohit');
      await page.waitFor('document.activeElement === document.querySelector("#pcsToHit")', 3000);
      // a click in the dialog's own margin keeps it open; a click on the backdrop outside it closes it
      await tap(page, '#pcsToHit');
      await dialogUp(page);
      const enc = await page.box('.thd-enc');
      await page.clickAt(enc.left - 6, enc.top + enc.height / 2);
      await page.sleep(200);
      assert.strictEqual(await page.evaluate('document.querySelector("#tohitDlg").open'), true, 'a click in its margin');
      const dlg = await page.box('#tohitDlg');
      await page.clickAt(Math.max(4, dlg.left / 2), dlg.top + 40);
      await until(page, '!p.tohit');
      await page.waitFor('document.activeElement === document.querySelector("#pcsToHit")', 3000);
    });
  });

  for (const [width, height] of SIZES) {
    it(`at ${width} nothing is clipped and the page has no sideways scroll, in a fight and out of one`, async () => {
      const run = await start();
      await withPage({ width, height }, async (page) => {
        const check = async (where) => {
          const got = await page.evaluate(`(() => {
            const d = document.querySelector('#tohitDlg').getBoundingClientRect(); const b = document.querySelector('#thBox');
            const out = Array.from(b.querySelectorAll('select, input, button, .th-cell, .th-v')).filter((e) => e.getClientRects().length)
              .filter((e) => { const r = e.getBoundingClientRect(); return r.left < d.left - 0.5 || r.right > d.right + 0.5; }).map((e) => e.id || e.className);
            return { d: { left: d.left, right: d.right, top: d.top, bottom: d.bottom }, w: innerWidth, h: innerHeight,
              wide: document.documentElement.scrollWidth > innerWidth, boxWide: b.scrollWidth > b.clientWidth + 1, out };
          })()`);
          assert.ok(got.d.left >= 0 && got.d.right <= got.w && got.d.top >= 0 && got.d.bottom <= got.h, `${where}: the dialog is on screen ${JSON.stringify(got.d)}`);
          assert.strictEqual(got.wide, false, `${where}: the page scrolls sideways`);
          assert.strictEqual(got.boxWide, false, `${where}: the calculator scrolls sideways`);
          assert.deepStrictEqual(got.out, [], `${where}: clipped`);
        };
        await sheetUp(page, run);
        await tap(page, '#pcsToHit');
        await dialogUp(page);
        await check(`${width} sheet`);
        await page.key('Escape');
        await until(page, '!p.tohit');
        let p = await bouncers(page, run);
        sane(p, `${width} the fight with its To-hit button`);
        const tb = await page.evaluate('(() => { const r = document.querySelector("#fToHit").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height > 0; })()');
        assert.ok(tb, `${width}: the toolbar's To-hit is on screen`);
        await tap(page, '#fToHit');
        await dialogUp(page, { drawn: false });
        await tap(page, '#thLevel');
        await page.type('12');
        p = await rollIs(page, 12);
        await check(`${width} fight`);
        await shot(page, `tohit-${width}`);
      });
    });
  }

  it("the players' screen's stream holds nothing of it", async () => {
    const run = await start();
    const ctl = new AbortController();
    let heard = '';
    const res = await fetch(`${run.base}/api/players/events`, { signal: ctl.signal });
    const reader = res.body.getReader();
    const listening = (async () => {
      const dec = new TextDecoder();
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; heard += dec.decode(value); } } catch { /* aborted */ }
    })();
    try {
      await withPage({ width: 1449, height: 762 }, async (page) => {
        await bouncers(page, run);
        await tap(page, '#fToHit');
        await dialogUp(page, { drawn: false });
        await tap(page, '#thLevel');
        await page.type('12');
        await rollIs(page, 12);
        await page.choose('#th-man', 'All');
        await rollIs(page, 16);
        await page.key('Escape');
        let p = await until(page, '!p.tohit');
        p = await peek(page, p, 'Sela Drake');
        await tap(page, '#acToHit');
        await dialogUp(page);
        await page.key('Escape');
        await until(page, '!p.tohit');
      });
      const view = JSON.stringify(await (await fetch(`${run.base}/api/players/view`)).json());
      assert.match(heard, /event: view/, 'the players\' stream was open and sent its view');
      for (const word of ['Typed skill', 'tohit', 'To-hit', 'Broadsword', 'All-Out Attack', 'th-']) {
        assert.ok(!heard.includes(word), `the stream: ${word}`);
        assert.ok(!view.includes(word), `the view: ${word}`);
      }
    } finally {
      ctl.abort();
      await listening;
    }
  });

  it("the site's sheet still draws the calculator two-column at 1449", async () => {
    const ronnie = matter(fs.readFileSync(path.join(__dirname, 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8')).content;
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    let built;
    try { built = buildPc('gurps-4e', ronnie); } finally { console.log = log; console.warn = warn; }
    try {
      await withPage({ width: 1449, height: 762 }, async (page) => {
        await page.goto(`file://${path.join(built.out, 'characters', 'pcs', 'test-hero.html').replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`);
        await page.waitFor('document.querySelector("#th-roll") && document.querySelector("#th-roll").textContent !== ""', 10000);
        await tap(page, 'button.pc-tab[data-tab="combat"]');
        await page.waitFor('document.querySelector("#tohit-calc").getBoundingClientRect().height > 0', 3000);
        const got = await page.evaluate(`(() => { const b = document.querySelector('#tohit-calc');
          const c = b.querySelector('.th-ctrls').getBoundingClientRect(); const o = b.querySelector('.th-out').getBoundingClientRect();
          return { cls: b.className, cols: getComputedStyle(b.querySelector('.th-body')).gridTemplateColumns.split(' ').length, side: o.left >= c.right, top: Math.abs(o.top - c.top) < 2 }; })()`);
        assert.deepStrictEqual(got, { cls: 'wide cat-table tohit', cols: 2, side: true, top: true });
      });
    } finally {
      fs.rmSync(built.root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
