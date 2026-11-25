'use strict';
// The fight view for CoC and GURPS (step 6b Task 7) in a real browser, against the real server in this process, on
// temp copies of the Task 0 fixtures (test/fixtures/run-sheet-coc, run-sheet-gurps). Real input only: held clicks,
// key presses and inserted text (helpers/cdp.js); the test reads `?probe=1`'s `body.dataset.probe` and the DOM, and
// never sets a value or fires an event itself. Skipped without Chrome, except on CI. RS_SHOTS=<dir> keeps screenshots.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession } = require('../lib/run-sheet/sessions');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');
const { copyFixture, removeFixture } = require('./helpers/systems-fixture');
const { blankRow } = require('../lib/run-sheet/web/fight-math');
const { sane, where, picked, landing } = require('./helpers/fight-layout');

const SHOTS = process.env.RS_SHOTS || '';
async function shot(page, name) {
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot(path.join(SHOTS, `${name}.png`)); }
}
const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';
const SIZES = [[1449, 762], [1280, 762], [1100, 762]];
const VAULTS = {
  coc: {
    fixture: 'run-sheet-coc', session: 'Session 01 - Fog Bound',
    party: ['Characters/PCs/Iris Calder.md', 'Characters/PCs/Jonas Finch.md', 'Characters/PCs/Mabel Quill.md'],
  },
  gurps: {
    fixture: 'run-sheet-gurps', session: 'Session 01 - Crates',
    party: ['Characters/PCs/Corin Ash.md', 'Characters/PCs/Lysa Venn.md', 'Characters/PCs/Orrin Tate.md', 'Characters/PCs/Sela Drake.md'],
  },
};

const made = [];
const servers = [];
after(async () => {
  for (const t of servers) { try { await t.close(); } catch { /* closed already */ } }
  for (const d of made) removeFixture(d);
});

async function start(which, more, edit) {
  const v = VAULTS[which];
  const vault = copyFixture(v.fixture);
  made.push(vault);
  if (edit) edit(vault);
  const picked = pickSession(listSessions(vault), v.session, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: v.party, deps: { delayMs: 20, log: () => {}, ...(more || {}) } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  const base = `http://127.0.0.1:${port}`;
  const model = (await (await fetch(`${base}/api/model`)).json()).model;
  return { ...t, vault, base, model };
}

const until = (page, test, ms) => page.waitFor(`(() => { const p = ${PROBE}; return p && (${test}) && p; })()`, ms);
const settled = (page) => until(page, 'p.saved === "Saved" && p.pending === 0');
const q = (v) => JSON.stringify(v);
// A real click that must land on the element it names.
async function tap(page, sel) {
  const r = await page.click(sel);
  assert.ok(r.inView && r.hit, `click ${sel}: ${JSON.stringify(r)}`);
  return r;
}
// A box clicked (which selects what it holds), the text typed, Enter. The text waits until the box has focus, and the
// test fails saying where focus is when the click did not give it (Task 13 fix round: a flake where Enter came
// without the typed text).
// `enter: false` leaves the text unsent; `settle: false` skips the wait for a save (a refused entry saves nothing).
async function typeInto(page, sel, text, { enter = true, settle = true } = {}) {
  await tap(page, sel);
  try {
    await page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 2000);
  } catch (e) {
    const at = await page.evaluate(`(() => { const a = document.activeElement; return a ? a.outerHTML.slice(0, 160) : 'nothing'; })()`);
    throw new Error(`typeInto ${sel}: the click left focus on ${at}, not the box`);
  }
  await page.type(String(text));
  if (enter) await page.key('Enter');
  return settle ? settled(page) : until(page, 'true');
}
const named = (p, name) => p.fight.rows.find((r) => r.name === name);
const order = (p) => p.fight.rows.filter((r) => r.in).map((r) => r.name);
const text = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null; })()`);
const texts = (page, sel) => page.evaluate(`Array.from(document.querySelectorAll(${q(sel)}), (e) => e.textContent)`);
const attrOf = (page, sel, a) => page.evaluate(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.getAttribute(${q(a)}) : null; })()`);

// Every PC to beat `at`, then Fight on it, by real clicks: the order as the Fight press leaves it.
async function fightOn(page, run, at) {
  await page.goto(`${run.base}/?probe=1`);
  await settled(page);
  const b = run.model.beats[at];
  await tap(page, `[id="beat:${b.key}"] [data-all]`);
  await settled(page);
  await tap(page, `[id="beat:${b.key}"] [data-fight]`);
  return until(page, 'p.fight && p.fight.rows.length > 0 && p.saved === "Saved" && p.pending === 0 && p.layout && p.layout.railW !== undefined');
}
// The row's panel, by a click on its name.
async function peek(page, p, name) {
  await tap(page, `[data-fpeek="${named(p, name).id}"]`);
  return until(page, `p.fight.actingName === ${q(name)}`);
}
// "+ New" in the Add box: a row with no note.
async function addNew(page, name) {
  await tap(page, '#fAddName');
  await page.type(name);
  await page.waitFor('document.querySelector("[data-faddnew]")');
  await tap(page, '[data-faddnew]');
  return until(page, `p.fight.rows.some((r) => r.name === ${q(name)}) && p.saved === "Saved" && p.pending === 0`);
}
// Another window's actions, as the server takes them: the page hears them on its stream.
let otherN = 0;
async function fromOther(run, actions) {
  const { stateId } = await (await fetch(`${run.base}/api/state`)).json();
  const res = await fetch(`${run.base}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stateId, base: 0, clientId: 'other-tab', actions: actions.map((a) => ({ id: `o-${++otherN}`, ...a })) }) });
  assert.strictEqual(res.status, 200);
}
// A panel box of the row the panel shows: `data-fs-<key>`.
const box = (p, name, key) => `#acting [data-fs-${key}="${named(p, name).id}"]`;

describe('CoC and GURPS fights on the GM page, by real input', { skip: browserSkip() }, () => {
  it('CoC: pressing Fight shows the order already sorted by DEX, a tie by the higher combat skill, PCs first only last', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      // sorted at Fight, no Sort press: DEX high to low, the rows with no DEX last
      assert.strictEqual(p.fight.started, false);
      assert.deepStrictEqual(order(p), ['Nurse Orla Penn', 'Iris Calder', 'Warden Hale', 'Brine Walker 1', 'Brine Walker 2', 'Tobias Reed', 'Jonas Finch', 'Mabel Quill']);
      // the Brine Walkers' DEX 48 (their figures made the fixture's own in the PRENTICE review)
      assert.deepStrictEqual(p.fight.rows.filter((r) => r.in).map((r) => r.ini), [60, 55, 50, 48, 48, 45, null, null]);
      // nothing of D&D's on the row: no Roll, no AC, no ½, no Res
      assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#fRoll, [data-fac], [data-fhalf], [data-fres]"))'), false);
      // the walkers' DEX typed up to Hale's 50 in their panels, for a three-way tie
      for (const name of ['Brine Walker 1', 'Brine Walker 2']) {
        p = await peek(page, p, name);
        p = await typeInto(page, box(p, name, 'dex'), 50);
      }
      // the DEX tie goes by the higher combat skill once each row has one (typed in its panel), then Sort
      for (const [name, v] of [['Warden Hale', 45], ['Brine Walker 1', 60], ['Brine Walker 2', 55]]) {
        p = await peek(page, p, name);
        p = await typeInto(page, box(p, name, 'fighting'), v);
        assert.strictEqual(named(p, name).fighting, v);
      }
      await tap(page, '#fSort');
      p = await settled(page);
      assert.deepStrictEqual(order(p).slice(2, 5), ['Brine Walker 1', 'Brine Walker 2', 'Warden Hale']);
      // Jonas's DEX typed in his panel puts him in the tie at once; with no combat skill of his, the group goes PCs first
      p = await peek(page, p, 'Jonas Finch');
      p = await typeInto(page, box(p, 'Jonas Finch', 'dex'), 50);
      assert.deepStrictEqual(order(p).slice(2, 6), ['Jonas Finch', 'Brine Walker 1', 'Brine Walker 2', 'Warden Hale']);
      // given one equal to Hale's, he sorts by it, and PCs first decides only his tie with Hale
      p = await typeInto(page, box(p, 'Jonas Finch', 'fighting'), 45);
      await tap(page, '#fSort');
      p = await settled(page);
      assert.deepStrictEqual(order(p).slice(2, 6), ['Brine Walker 1', 'Brine Walker 2', 'Jonas Finch', 'Warden Hale']);
      sane(p, 'CoC order');
    });
  });

  it('a blank row given only HP drops its tag and its panel warning (CoC typed, GURPS worked out from ST)', async () => {
    for (const [which, at, key, v, hp] of [['coc', 0, null, 11, 11], ['gurps', 1, 'st', 12, 12]]) {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        let p = await fightOn(page, run, at);
        p = await addNew(page, 'Bouncer');
        const id = named(p, 'Bouncer').id;
        const tag = `li[data-frow="${id}"] .tag`;
        assert.strictEqual(await text(page, tag), 'no numbers', which);
        p = await peek(page, p, 'Bouncer');
        assert.strictEqual(await text(page, '#acting .warn'), 'Bouncer: no numbers yet: type them here', which);
        if (key) p = await typeInto(page, box(p, 'Bouncer', key), v);
        else p = await typeInto(page, `[data-fmax="${id}"]`, v);
        assert.deepStrictEqual([named(p, 'Bouncer').hp, named(p, 'Bouncer').max], [hp, hp], which);
        assert.strictEqual(await text(page, tag), null, `${which}: no tag`);
        assert.strictEqual(await text(page, '#acting .warn'), null, `${which}: no panel warning`);
        if (key) {
          // a worked-out figure says what it came from, on the row and in the panel
          assert.strictEqual(await attrOf(page, `li[data-frow="${id}"] .hpv`, 'title'), 'Max HP 12 (from ST)');
          assert.ok((await texts(page, '#acting .nums > span')).includes('HP 12/12 (from ST)'));
        }
      });
    }
  });

  // D3d (coordinator's ruling, fix round 1): a noted row with no block is complete once it has HP; D&D keeps its line
  it('a noted row with no stat block, given HP, raises no panel warning (CoC Pell Ashby, GURPS Ned Pike)', async () => {
    for (const [which, at, name] of [['coc', 0, 'Pell Ashby'], ['gurps', 1, 'Ned Pike']]) {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        let p = await fightOn(page, run, at);
        await tap(page, '#fAddName');
        await page.type(name);
        await page.waitFor('document.querySelector("[data-faddpick]")');
        await tap(page, '[data-faddpick]');
        p = await until(page, `p.fight.rows.some((r) => r.name === ${q(name)} && r.note) && p.saved === "Saved" && p.pending === 0`);
        const id = named(p, name).id;
        p = await peek(page, p, name);
        assert.ok(await text(page, '#acting .warn'), `${which}: a warning while it has no numbers`);
        assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#acting .stats"))'), false, `${which}: no block`);
        p = await typeInto(page, `[data-fmax="${id}"]`, 10);
        assert.deepStrictEqual([named(p, name).hp, named(p, name).max], [10, 10], which);
        assert.strictEqual(await text(page, '#acting .warn'), null, `${which}: no panel warning once it has HP`);
        assert.strictEqual(await text(page, `li[data-frow="${id}"] .tag`), null, `${which}: no tag`);
      });
    }
  });

  it('CoC: gun toggle re-places the row', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      const id = named(p, 'Tobias Reed').id;
      const gun = `[data-fgun="${id}"]`;
      assert.strictEqual(await attrOf(page, gun, 'title'), 'Firearm ready: +50 to DEX for the order');
      assert.strictEqual(order(p)[5], 'Tobias Reed');
      await tap(page, gun);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(id)}).gun === true && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual([order(p)[0], named(p, 'Tobias Reed').ini], ['Tobias Reed', 95]);
      assert.strictEqual(await attrOf(page, gun, 'aria-pressed'), 'true');
      await tap(page, gun);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(id)}).gun === false && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual([order(p)[5], named(p, 'Tobias Reed').ini], ['Tobias Reed', 45]);
    });
  });

  it('CoC: −8 into a 16 HP row stops at 8 and nothing is Out; HP never goes below 0; m-2 takes MP', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      p = await addNew(page, 'Cultist');
      const id = named(p, 'Cultist').id;
      p = await typeInto(page, `[data-fmax="${id}"]`, 16);
      const entry = `[data-fhp="${id}"]`;
      // Task 38 changed this on purpose: the placeholder is short (the row fits one line); the whole hint is the box's
      // title and its description, so hovering or a screen reader still finds m-2 and s-5
      assert.strictEqual(await attrOf(page, entry, 'placeholder'), '-7 / +3\u2026');
      assert.strictEqual(await attrOf(page, entry, 'title'), 'Damage -7, healing +3, MP m-2, SAN s-5');
      assert.strictEqual(await attrOf(page, entry, 'aria-description'), 'Damage -7, healing +3, MP m-2, SAN s-5');
      p = await typeInto(page, entry, '-8');
      // Task 18 changed this on purpose: 8 on 16 HP is a Major Wound, so its box is ticked (shown as its status) and a
      // card offers the CON roll; -20 is over max HP, so a card offers Out, and nothing is Out until the GM taps it
      assert.deepStrictEqual([named(p, 'Cultist').hp, named(p, 'Cultist').out, named(p, 'Cultist').conds], [8, false, ['Major wound']]);
      p = await typeInto(page, entry, '-20');
      assert.deepStrictEqual([named(p, 'Cultist').hp, named(p, 'Cultist').out, named(p, 'Cultist').conds], [0, false, ['Major wound']]);
      assert.ok(p.fight.rows.every((r) => !r.out), 'nobody is Out');
      // the pools' letters: Hale's MP 12 less 2, shown on his row
      const hale = named(p, 'Warden Hale').id;
      p = await typeInto(page, `[data-fhp="${hale}"]`, 'm-2');
      assert.strictEqual(named(p, 'Warden Hale').mp, 10);
      // Task 38 fix round changed this on purpose (Ant's pick): Hale has no spells, so no MP on his row, and SAN shows on
      // PCs' and allies' rows only; both stay in his panel
      assert.strictEqual(await text(page, `li[data-frow="${hale}"] .pools`), null);
    });
  });

  // Task 38 fix round (Ant's pick, 2026-11-24): on a CoC row SAN shows for PCs and allies only, MP only for a character
  // with spells, whatever its side; the panel keeps both for everyone. Real input, at the three widths.
  for (const [w, h] of SIZES) {
    it(`CoC at ${w}: MP on a caster's row only, SAN on a PC's or an ally's only; the panel keeps both`, async () => {
      const run = await start('coc', {}, (vault) => {
        const add = (rel, from, to) => { const f = path.join(vault, rel); const t = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, t.replace(from, to)); };
        add('Characters/NPCs/Warden Hale.md', '**Combat**', '**Spells:** Contact Deep One\n\n**Combat**');
        add('Characters/PCs/Iris Calder.md', '## Skills', '## Arcane Tomes & Spells\n\n- Spells: Shrivelling\n\n## Skills');
      });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await fightOn(page, run, 0);
        const pools = (name) => text(page, `li[data-frow="${named(p, name).id}"] .pools`);
        // a foe with spells: MP, no SAN; a foe without: neither
        assert.strictEqual(named(p, 'Warden Hale').side, 'foe');
        assert.strictEqual(await pools('Warden Hale'), 'MP 12');
        assert.strictEqual(await pools('Brine Walker 1'), null);
        // a PC with spells: both; a PC without: SAN only
        assert.strictEqual(await pools('Iris Calder'), 'MP 13 · SAN 62');
        assert.strictEqual(await pools('Jonas Finch'), 'SAN 60');
        sane(p, `${w} the pools`);
        // made an ally by a tap on its panel: SAN shows (no spells: still no MP)
        p = await peek(page, p, 'Tobias Reed');
        const reed = named(p, 'Tobias Reed').id;
        assert.strictEqual(await pools('Tobias Reed'), null);
        await tap(page, `#acting [data-fside="ally"][data-fsiderow="${reed}"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(reed)}).side === "ally" && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(await pools('Tobias Reed'), 'SAN 45');
        // the panel keeps MP and SAN for a foe with neither on its row
        p = await peek(page, p, 'Brine Walker 1');
        assert.ok(await page.evaluate('Boolean(document.querySelector("#acting [data-fs-mp]")) && Boolean(document.querySelector("#acting [data-fs-san]"))'), 'MP and SAN in the panel');
      });
    });
  }

  it('GURPS: Fight sorts by Speed, 5.25 shown as 5.25', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      assert.strictEqual(p.fight.started, false);
      // Speed high to low; a tie by DX where the whole tie has it, PCs first only after that
      assert.deepStrictEqual(order(p), ['Rafe Kell', 'Tam Osier', 'Orrin Tate', 'Sela Drake', 'Mara Quint', 'Corin Ash', 'Lysa Venn']);
      const corin = named(p, 'Corin Ash').id;
      assert.strictEqual(await attrOf(page, `[data-fini="${corin}"]`, 'value'), '5.25');
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fini="${corin}"]').value`), '5.25');
      // Rafe's Speed is worked out: its tag is in the box's title
      assert.strictEqual(await attrOf(page, `[data-fini="${named(p, 'Rafe Kell').id}"]`, 'title'), 'Basic Speed 5.75 (from DX and HT)');
      // a Speed typed with two places is taken and placed; three places are not a number here
      const lysa = named(p, 'Lysa Venn').id;
      p = await typeInto(page, `[data-fini="${lysa}"]`, '6.25');
      assert.deepStrictEqual([order(p)[0], named(p, 'Lysa Venn').ini], ['Lysa Venn', 6.25]);
      // the 6.25 entry is placed and saved (Lysa first, the server's echo in) before the next one is typed
      await until(page, `p.fight.rows.filter((r) => r.in)[0].name === 'Lysa Venn' && p.saved === "Saved" && p.pending === 0`);
      await typeInto(page, `[data-fini="${lysa}"]`, '6.255', { settle: false });
      // the row's second line is written into the page when the box is marked; the probe is not rewritten for that, so the
      // wait reads the page itself (a probe wait here timed out with the line on screen and aria-invalid set)
      await page.waitFor(`(() => { const e = document.querySelector('li[data-row2=${q(lysa)}]'); return Boolean(e) && e.textContent.includes('Not a number'); })()`);
      p = await until(page, 'true');
      assert.strictEqual(named(p, 'Lysa Venn').ini, 6.25);
      // FP now/[max] on the row, the entry box GURPS's
      assert.strictEqual(await attrOf(page, `[data-fhp="${corin}"]`, 'placeholder'), '-7 / +3 / f-2');
      // GURPS's box is as before Task 38 (CoC's short placeholder and hint only): its title the placeholder, no description
      assert.deepStrictEqual([await attrOf(page, `[data-fhp="${corin}"]`, 'title'), await attrOf(page, `[data-fhp="${corin}"]`, 'aria-description')], ['-7 / +3 / f-2', null]);
      assert.match(await text(page, `li[data-frow="${corin}"] .fpv`), /^FP 11\//);
      assert.strictEqual(await attrOf(page, `[data-ffpmax="${corin}"]`, 'value'), '11');
    });
  });

  it('GURPS: Kev to −65 shows the Reeling and 0-or-less chips on the row (no −N×HP chip), and the whole track with −5×HP passed in the panel', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      p = await addNew(page, 'Kev');
      p = await peek(page, p, 'Kev');
      p = await typeInto(page, box(p, 'Kev', 'st'), 12);
      p = await typeInto(page, box(p, 'Kev', 'ht'), 11);
      const id = named(p, 'Kev').id;
      // FP worked out from HT, said in the FP read-out's title
      assert.deepStrictEqual([named(p, 'Kev').fp, named(p, 'Kev').fpMax], [11, 11]);
      assert.strictEqual(await attrOf(page, `li[data-frow="${id}"] .fpv`, 'title'), 'Max FP 11 (from HT)');
      // words in a panel box are refused: the box is marked, the row says so, DX stays blank
      await typeInto(page, box(p, 'Kev', 'dx'), 'twelve', { settle: false });
      const line2 = `li[data-row2="${id}"] .badnum[title="DX"]`;
      await page.waitFor(`document.querySelector(${q(line2)})`);
      assert.strictEqual(await text(page, line2), 'Not a number: kept as typed');
      assert.strictEqual(await attrOf(page, box(p, 'Kev', 'dx'), 'aria-invalid'), 'true');
      p = await settled(page);
      assert.strictEqual(named(p, 'Kev').dx, null);
      await page.key('Escape');
      await page.waitFor(`!document.querySelector(${q(line2)})`);
      p = await typeInto(page, `[data-fhp="${id}"]`, '-77');
      assert.deepStrictEqual([named(p, 'Kev').hp, named(p, 'Kev').max, named(p, 'Kev').out], [-65, 12, false]);
      assert.deepStrictEqual(named(p, 'Kev').marks, ['Reeling', '0 or less']);
      // the row's chips, shown or moved to its second line: the two marks, no minus-HP line. Task 13 changed this on
      // purpose: the hit's shock and its card (−5×HP: dead) are on the row's strip too
      const chips = await texts(page, `li[data-frow="${id}"] .chips > .chip`);
      assert.deepStrictEqual(chips, ['Reeling', '0 or less', 'Shock \u22124', 'card waiting']);
      assert.strictEqual(await page.evaluate(`document.querySelector('li[data-frow="${id}"]').textContent.includes('×HP')`), false);
      // the panel (still Kev's) and its track: every mark, all passed, −5×HP the deepest
      assert.strictEqual(p.fight.actingName, 'Kev');
      assert.deepStrictEqual(await texts(page, '#acting .mtrack li'), ['Reeling', '0 or less', '−1×HP', '−2×HP', '−3×HP', '−4×HP', '−5×HP']);
      assert.deepStrictEqual(await texts(page, '#acting .mtrack li.lit'), ['Reeling', '0 or less', '−1×HP', '−2×HP', '−3×HP', '−4×HP', '−5×HP']);
      assert.deepStrictEqual(await texts(page, '#acting .mtrack li.deep'), ['−5×HP']);
      await shot(page, 'gurps-kev');
    });
  });

  // Task 36 changed GURPS's on purpose: the quick figures first (Ant, 2026-11-24: "the NPC speed is 5.0, main combat
  // skill is 12, his dodge is 8 and parry is 9, his HP is 10")
  for (const [which, at, name, want] of [
    ['gurps', 1, 'Mara Quint', ['Speed', 'Skill', 'Dodge', 'Parry', 'Block', 'HP', 'ST', 'HT', 'DX', 'DR']],
    // Task 36 changed this on purpose: the quick figures first, as GURPS's (Ant, 2026-11-24: "the NPC speed is 5.0, main
    // combat skill is 12, his dodge is 8 and parry is 9, his HP is 10"): DEX, Fighting, Dodge and HP, then the rest
    ['coc', 0, 'Warden Hale', ['DEX', 'Fighting', 'Dodge', 'HP', 'Firearms', 'MP', 'SAN', 'DB', 'Armour', 'Build', 'Attacks']],
  ]) {
    it(`${which === 'gurps' ? 'GURPS' : 'CoC'}: the panel's boxes are ${want.join(', ')}, in that order, and Tab walks them`, async () => {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        let p = await fightOn(page, run, at);
        p = await peek(page, p, name);
        assert.deepStrictEqual(await texts(page, '#acting .pb .lab'), want);
        const keys = await page.evaluate('Array.from(document.querySelectorAll("#acting .pbox"), (b) => Array.from(b.attributes).find((a) => a.name.startsWith("data-fs-")).name)');
        await tap(page, `#acting [${keys[0]}]`);
        const walked = [];
        for (let i = 0; i < keys.length; i++) {
          walked.push(await page.evaluate('(() => { const a = document.activeElement; const x = a && Array.from(a.attributes).find((n) => n.name.startsWith("data-fs-")); return x ? x.name : null; })()'));
          await page.key('Tab');
          await settled(page);
        }
        assert.deepStrictEqual(walked, keys);
      });
    });
  }

  for (const [which, at] of [['coc', 0], ['gurps', 1]]) {
    it(`${which === 'gurps' ? 'GURPS' : 'CoC'}: no row is clipped and the page never scrolls sideways at 1449, 1280 and 1100`, async () => {
      for (const [width, height] of SIZES) {
        const run = await start(which);
        await withPage({ width, height }, async (page) => {
          let p = await fightOn(page, run, at);
          const first = p.fight.rows[0];
          const sel = `[data-fstatus="${first.id}"]`;
          // the status list is the system's (rules.statuses), with no Exhaustion or Concentrating
          const opts = await page.evaluate(`Array.from(document.querySelector(${q(sel)}).querySelectorAll('option'), (o) => o.textContent)`);
          assert.deepStrictEqual(opts, ['+ status', ...run.model.rules.statuses, 'other…'], `${which} ${width}`);
          assert.ok(!opts.some((o) => /Exhaustion|Concentrating/.test(o)), `${which}: no D&D statuses`);
          // the system's first status on the first row, and (GURPS) a hit that lights Reeling and 0 or less; from
          // another window, as the 6a layout tests do: a closed status list takes no real key input on macOS headless
          // (letters are blocked on it by design, and ArrowDown opens the native menu), see the fix-round report
          const status = run.model.rules.statuses[0];
          await fromOther(run, [{ type: 'status', fight: p.fight.id, row: first.id, add: status },
            ...(which === 'gurps' ? [{ type: 'hp', fight: p.fight.id, row: first.id, entry: '-30' }] : [])]);
          p = await until(page, `p.fight.rows[0].conds.includes(${q(status)}) && p.saved === "Saved" && p.pending === 0`);
          if (which === 'gurps') assert.deepStrictEqual(p.fight.rows[0].marks, ['Reeling', '0 or less']);
          const chips = await texts(page, `li[data-frow="${first.id}"] .chips > .chip, li[data-row2="${first.id}"] .chip`);
          assert.ok(chips.some((c) => c.startsWith(status)), `${which} ${width}: the ${status} chip (${chips})`);
          assert.ok(p.layout.rows.length >= 7, `${which} ${width}: ${p.layout.rows.length} rows drawn`);
          sane(p, `${which} ${width}`);
          await shot(page, `${which}-${width}`);
          if (width === 1449) for (const r of p.layout.rows) assert.ok(r.h <= 40, `${which} 1449: ${r.name} is one line (${r.h} px)`);
        });
      }
    });
  }

  // Task 10: the Tower Stair holds a caster NPC with a reserve (Ilse), a reserve with no caster (Bram), Magery 0 (Dova),
  // a caster PC with a reserve and spells (Lysa) and a PC whose Spells table is empty (Orrin)
  it('GURPS: a caster\'s row shows ✦FP and +4 on one line at 1449, 1280 and 1100', async () => {
    for (const [width, height] of SIZES) {
      const run = await start('gurps');
      await withPage({ width, height }, async (page) => {
        const p = await fightOn(page, run, 2);
        const fpv = (name) => text(page, `li[data-frow="${named(p, name).id}"] .fpv`);
        const ph = (name) => attrOf(page, `[data-fhp="${named(p, name).id}"]`, 'placeholder');
        assert.strictEqual(await fpv('Ilse Verrin'), '\u2726FP 10/ +4', `${width}`);
        assert.strictEqual(await ph('Ilse Verrin'), '\u2726 f-3');
        assert.strictEqual(await fpv('Lysa Venn'), '\u2726FP 10/ +6');
        // the max FP box holds the figure: the readout's text alone leaves it out
        const maxBox = (name) => page.evaluate(`document.querySelector('[data-ffpmax="${named(p, name).id}"]').value`);
        assert.strictEqual(await maxBox('Ilse Verrin'), '10');
        assert.strictEqual(await maxBox('Lysa Venn'), '10');
        assert.strictEqual(await maxBox('Bram Holt'), '11');
        assert.strictEqual(await ph('Lysa Venn'), '\u2726 f-3');
        assert.strictEqual(await fpv('Bram Holt'), 'FP 11/ +4', 'a reserve with no Magery: no ✦');
        const ilseRow = `li[data-frow="${named(p, 'Ilse Verrin').id}"]`;
        assert.strictEqual(await attrOf(page, `${ilseRow} .fpv`, 'title'), 'A caster: f-3 pays a spell from FP');
        assert.strictEqual(await attrOf(page, `${ilseRow} .fpv .er`, 'title'), 'Energy Reserve 4/4: e-3 spends it');
        assert.strictEqual(await ph('Bram Holt'), '-7 / +3 / f-2');
        for (const n of ['Dova Lang', 'Orrin Tate']) {
          assert.strictEqual(await fpv(n), `FP ${named(p, n).fpMax}/`, n);
          assert.strictEqual(await ph(n), '-7 / +3 / f-2', n);
        }
        // the readout and its +4 share one line, inside a row of one line
        const id = named(p, 'Ilse Verrin').id;
        const box = await page.evaluate(`(() => { const s = document.querySelector('li[data-frow="${id}"] .fpv'); const e = s.querySelector('.er'); const a = s.getBoundingClientRect(); const b = e.getBoundingClientRect(); return { h: a.height, dTop: Math.abs(b.top - a.top), dBottom: Math.abs(b.bottom - a.bottom) }; })()`);
        assert.ok(box.h <= 24 && box.dTop <= 6 && box.dBottom <= 6, `${width}: ${JSON.stringify(box)}`);
        const row = p.layout.rows.find((r) => r.id === id);
        assert.ok(row && row.h <= 40, `${width}: Ilse's row is one line (${row && row.h} px)`);
        sane(p, `gurps magic ${width}`);
        await shot(page, `gurps-magic-${width}`);
      });
    }
  });

  it('GURPS: e-3 spends the reserve and f-3 FP, typed; e-3 on a row with no reserve is refused on its second line', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      const ilse = named(p, 'Ilse Verrin').id;
      p = await typeInto(page, `[data-fhp="${ilse}"]`, 'e-3');
      assert.deepStrictEqual([named(p, 'Ilse Verrin').er, named(p, 'Ilse Verrin').fp], [1, 10]);
      assert.strictEqual(await text(page, `li[data-frow="${ilse}"] .fpv`), '\u2726FP 10/ +1');
      p = await typeInto(page, `[data-fhp="${ilse}"]`, 'f-3');
      assert.deepStrictEqual([named(p, 'Ilse Verrin').er, named(p, 'Ilse Verrin').fp], [1, 7]);
      p = await peek(page, p, 'Ilse Verrin');
      const reads = await texts(page, '#acting .nums > span');
      assert.ok(reads.includes('FP 7/10') && reads.includes('Energy Reserve 1/4'), reads.join(' | '));
      // the NPC's spells, as its block writes them
      assert.match(await text(page, '#acting .stats'), /Light-15; Create Fire-15; Sense Foes-15/);
      // Dova has no reserve: e-3 is refused, the words stay in the box with the reason, nothing changes
      const dova = named(p, 'Dova Lang').id;
      const before = named(p, 'Dova Lang');
      // the chip and the refusal agree on who has a reserve (Task 23b B4): Ilse shows one, Dova none
      assert.ok(await page.evaluate(`Boolean(document.querySelector('li[data-frow="${ilse}"] .fpv .er'))`), 'Ilse shows her reserve');
      assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('li[data-frow="${dova}"] .fpv .er'))`), false, 'Dova shows none');
      await typeInto(page, `[data-fhp="${dova}"]`, 'e-3');
      const why = `li[data-row2="${dova}"] .refnum`;
      await page.waitFor(`document.querySelector(${q(why)})`);
      assert.strictEqual(await text(page, why), 'No Energy Reserve: f-N pays from FP');
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${dova}"]').value`), 'e-3');
      p = await settled(page);
      assert.deepStrictEqual([named(p, 'Dova Lang').fp, named(p, 'Dova Lang').er, named(p, 'Dova Lang').hp], [before.fp, before.er, before.hp]);
      assert.ok(!(await texts(page, `li[data-row2="${dova}"] .pendnum`)).length, 'not "Enter applies"');
      // a redraw keeps the refusal, the GM's own f-3 replaces it
      await fromOther(run, [{ type: 'hp', fight: p.fight.id, row: ilse, entry: '-1' }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(ilse)}).hp === 8 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await text(page, why), 'No Energy Reserve: f-N pays from FP');
      // Esc empties the box (and its reason); the GM types f-3 instead
      await tap(page, `[data-fhp="${dova}"]`);
      await page.key('Escape');
      await page.waitFor(`!document.querySelector(${q(why)})`);
      await page.type('f-3');
      await page.key('Enter');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(dova)}).fp === ${before.fp - 3} && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await text(page, why), null);
    });
  });

  it('GURPS: the PC\'s spells fold opens with a held click and stays open through a redraw', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      p = await peek(page, p, 'Orrin Tate');
      assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#acting details.spells"))'), false, 'an empty Spells table: no fold');
      p = await peek(page, p, 'Lysa Venn');
      const fold = '#acting details[data-fspells]';
      assert.strictEqual(await text(page, `${fold} > summary`), "Spells (from Lysa's sheet)");
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(fold)}).open`), false);
      await tap(page, `${fold} > summary`);
      await page.waitFor(`document.querySelector(${q(fold)}).open`);
      const cells = await texts(page, `${fold} td`);
      assert.ok(cells.includes('Create Fire') && cells.includes('Light'), cells.join(' | '));
      // another window's action redraws the panel: the fold stays open
      await fromOther(run, [{ type: 'hp', fight: p.fight.id, row: named(p, 'Lysa Venn').id, entry: 'e-2' }]);
      p = await until(page, `p.fight.rows.find((r) => r.name === 'Lysa Venn').er === 4 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(fold)}).open`), true);
      const reads = await texts(page, '#acting .nums > span');
      assert.ok(reads.includes('Energy Reserve 4/6'), reads.join(' | '));
      await tap(page, `${fold} > summary`);
      await page.waitFor(`!document.querySelector(${q(fold)}).open`);
    });
  });

  // Task 34 (finding 10): opening the fold brings its spells into view, both edges where the panel holds it all, at every
  // width; a fold taller than the panel shows from its top
  for (const [width, height] of SIZES) {
    for (const [extra, fits] of [[3, true], [12, false]]) {
      it(`GURPS at ${width}: opening Lysa's spells fold (${extra + 2} spells) scrolls it into view, ${fits ? 'top and bottom' : 'from its top'}`, async () => {
        const run = await start('gurps', null, (vault) => {
          const f = path.join(vault, 'Characters/PCs/Lysa Venn.md');
          const more = Array.from({ length: extra }, (_, i) => `| Practice Charm ${i + 1} | Meta | 12 | 1 | — | |`).join('\n');
          fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/(\| Create Fire \| Fire \| 13 \| 1 \| 1 \| \|)/, `$1\n${more}`));
        });
        await withPage({ width, height }, async (page) => {
          let p = await fightOn(page, run, 2);
          p = await peek(page, p, 'Lysa Venn');
          const fold = '#acting details[data-fspells]';
          const box = () => page.evaluate(`(() => { const d = document.querySelector(${q(fold)}).getBoundingClientRect(); const a = document.querySelector('#acting').getBoundingClientRect();
            const bar = document.querySelector('.top').getBoundingClientRect().bottom; return { top: d.top, bottom: d.bottom, h: innerHeight, bar, aTop: a.top, aBottom: a.bottom }; })()`);
          const shut = await box();
          await tap(page, `${fold} > summary`);
          await page.waitFor(`document.querySelector(${q(fold)}).open`);
          await page.sleep(400);
          const e = await box();
          const top = Math.max(e.bar, e.aTop) - 1;
          const bottom = Math.min(e.h, e.aBottom) + 1;
          if (fits) {
            assert.ok(shut.top + (e.bottom - e.top) > bottom, `${width}: the fold would open below the panel's edge ${JSON.stringify(shut)}`);
            assert.ok(e.top >= top && e.bottom <= bottom, `${width}: the fold in view ${JSON.stringify(e)}`);
          } else assert.ok(e.top >= top && e.top <= top + 40, `${width}: the fold from its top ${JSON.stringify(e)}`);
          assert.ok((await texts(page, `${fold} td`)).includes(`Practice Charm ${extra}`));
          await shot(page, `gurps-spells-fold-${extra}-${width}`);
          p = await settled(page);
          sane(p, `spells ${width}`);
        });
      });
    }
  }

  it('GURPS: f-3 on a row added mid-fight with no FP is refused on its second line, then taken once HT is typed', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      p = await addNew(page, 'Hob');
      const id = named(p, 'Hob').id;
      // HP only, so the entry box shows and FP stays blank
      p = await typeInto(page, `[data-fmax="${id}"]`, 10);
      assert.deepStrictEqual([named(p, 'Hob').hp, named(p, 'Hob').fp], [10, null]);
      await typeInto(page, `[data-fhp="${id}"]`, 'f-3');
      const why = `li[data-row2="${id}"] .refnum`;
      await page.waitFor(`document.querySelector(${q(why)})`);
      assert.strictEqual(await text(page, why), 'No FP on this row: type its max FP or HT');
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${id}"]').value`), 'f-3');
      p = await settled(page);
      assert.deepStrictEqual([named(p, 'Hob').hp, named(p, 'Hob').fp], [10, null]);
      // e-3 on the same row gives the reserve's reason instead
      await page.key('Escape');
      await page.type('e-3');
      await page.key('Enter');
      await page.waitFor(`(document.querySelector(${q(why)}) || {}).textContent === 'No Energy Reserve: f-N pays from FP'`);
      // HT typed works FP out; the GM's f-3 then pays
      await page.key('Escape');
      p = await peek(page, p, 'Hob');
      p = await typeInto(page, box(p, 'Hob', 'ht'), 11);
      assert.strictEqual(named(p, 'Hob').fp, 11);
      p = await typeInto(page, `[data-fhp="${id}"]`, 'f-3');
      assert.strictEqual(named(p, 'Hob').fp, 8);
      assert.strictEqual(await text(page, why), null);
    });
  });
  // Task 12: a hit typed as damage, type and place; Vex Harrow (Tower Stair) has DR 1 and 13 HP
  for (const [width] of SIZES) {
    it(`GURPS: 9 imp vitals Enter on a DR 1 foe takes 24 and shows the working at ${width}, a pending entry beside it`, async () => {
      const run = await start('gurps');
      await withPage({ width, height: 762 }, async (page) => {
        let p = await fightOn(page, run, 2);
        const vex = named(p, 'Vex Harrow').id;
        p = await typeInto(page, `[data-fhp="${vex}"]`, '9 imp vitals');
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === -11`);
        const line = `li[data-row2="${vex}"] .hitline`;
        await page.waitFor(`document.querySelector(${q(line)})`);
        assert.strictEqual(await text(page, line), '9 imp − DR 1 = 8 × 3 = 24');
        assert.strictEqual(await attrOf(page, line, 'title'), '9 imp − DR 1 = 8 × 3 = 24');
        assert.deepStrictEqual(named(p, 'Vex Harrow').hit, { line: '9 imp − DR 1 = 8 × 3 = 24', injury: 24, location: 'vitals', side: null, type: 'imp' });
        // one line, inside the row's width
        const box = await page.evaluate(`(() => { const e = document.querySelector(${q(line)}); const r = e.getBoundingClientRect(); const li = e.closest('li').getBoundingClientRect(); return { h: r.height, right: r.right, liRight: li.right }; })()`);
        assert.ok(box.h <= 20 && box.right <= box.liRight + 1, JSON.stringify(box));
        // an entry typed after the hit, not applied: "Enter applies" shares the line with the working
        const h2 = () => page.evaluate(`document.querySelector('li[data-row2="${vex}"]').getBoundingClientRect().height`);
        const before = await h2();
        await typeInto(page, `[data-fhp="${vex}"]`, '-2', { enter: false, settle: false });
        await page.waitFor(`document.querySelector('li[data-row2="${vex}"] .pendnum')`);
        assert.strictEqual(await h2(), before, `${width}: the second line stays one line`);
        assert.strictEqual(await text(page, line), '9 imp \u2212 DR 1 = 8 \u00d7 3 = 24');
        p = await settled(page);
        sane(p, `hit ${width}`);
        await shot(page, `gurps-hit-${width}`);
      });
    });
  }

  // Task 11b: a die with no count is one die; the page sends it to the server, which rolls it
  it('GURPS: d6+2 cr torso Enter reaches the server and shows its working line', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      const vex = named(p, 'Vex Harrow').id;
      const was = named(p, 'Vex Harrow').hp;
      p = await typeInto(page, `[data-fhp="${vex}"]`, 'd6+2 cr torso');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp < ${was}`);
      const line = `li[data-row2="${vex}"] .hitline`;
      await page.waitFor(`document.querySelector(${q(line)})`);
      const said = await text(page, line);
      // d6+2 is 3 to 8; DR 1 takes one off, a crushing torso hit counts once
      assert.match(said, /^d6\+2 = [3-8] cr \u2212 DR 1 = [2-7]$/, said);
      const lost = was - named(p, 'Vex Harrow').hp;
      assert.ok(lost >= 2 && lost <= 7, `lost ${lost}`);
    });
  });

  // Task 25: the location chips became one list, Torso at the top and picked for every new hit
  it('GURPS: the cut chip and the Arm location then 9 Enter is a hit to the arm; the list goes back to Torso; 9 Enter again is raw injury', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      p = await peek(page, p, 'Vex Harrow');
      const vex = named(p, 'Vex Harrow').id;
      const sel = `#acting [data-fhlocsel="${vex}"]`;
      const types = () => texts(page, `#acting [data-fhits="${vex}"] [data-fhtype]`);
      const value = () => page.evaluate(`document.querySelector(${q(sel)}).value`);
      const labels = () => page.evaluate(`Array.from(document.querySelector(${q(sel)}).options).map((o) => o.textContent + (o.disabled ? ' (off)' : ''))`);
      assert.strictEqual((await types())[0], 'cr');
      assert.strictEqual(await value(), 'torso');
      // mildest first; no type yet: names and penalties only
      assert.deepStrictEqual((await labels()).slice(0, 5), ['Torso 0', 'Arm −2', 'Leg −2', 'Groin −3', 'Vitals −3']);
      assert.strictEqual((await labels()).length, 22);
      await tap(page, `[data-fhtype="${vex}|cut"]`);
      // the cut chip relabels the list at once: each place's multiplier for cut, the places cut cannot hit turned off
      const cut = await labels();
      assert.ok(cut.includes('Neck −5 · ×2'), cut.join(' | '));
      assert.ok(cut.includes('Vitals −3 · not for cut (off)'), cut.join(' | '));
      assert.ok(cut.includes('Eye −9 · not for cut (off)'), cut.join(' | '));
      await page.choose(sel, 'Arm −2');
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${vex}"]').value`), ' cut arm');
      assert.deepStrictEqual(await texts(page, `#acting [data-fhits="${vex}"] [aria-pressed="true"]`), ['cut']);
      // as a GM does it: click the box, type the damage, Enter
      await tap(page, `[data-fhp="${vex}"]`);
      await page.type('9');
      await page.key('Enter');
      // 9 cut arm on Vex (13 HP, DR 1): 7, crippled (arm)
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === 6 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual([named(p, 'Vex Harrow').hit.location, named(p, 'Vex Harrow').hit.type, named(p, 'Vex Harrow').crippled], ['arm', 'cut', ['arm']]);
      // the next hit starts on Torso, never on the place last used; the type chips keep the last used first
      assert.strictEqual(await value(), 'torso');
      assert.deepStrictEqual(await texts(page, `#acting [data-fhits="${vex}"] [aria-pressed="true"]`), []);
      assert.strictEqual((await types())[0], 'cut');
      assert.ok((await texts(page, '#acting .nums .mk')).includes('crippled (arm)'));
      // a bare 9 is raw injury, never the last hit's type or place
      p = await typeInto(page, `[data-fhp="${vex}"]`, '9');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === -3`);
      assert.strictEqual(named(p, 'Vex Harrow').hit, null);
      assert.strictEqual(await text(page, `li[data-row2="${vex}"] .hitline`), null);
    });
  });

  it('GURPS: a click into a box holding healing or a pool entry leaves its words and the caret where the click put it', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      const vex = named(p, 'Vex Harrow').id;
      const bx = `[data-fhp="${vex}"]`;
      const caret = () => page.evaluate(`(() => { const b = document.querySelector('${bx}'); return [b.value, b.selectionStart, b.selectionEnd]; })()`);
      for (const words of ['+8', 'f-3']) {
        await typeInto(page, bx, words, { enter: false, settle: false });
        // away, then back by a click: a short entry in the box, so the click lands after it
        await tap(page, '#fAddName');
        await tap(page, bx);
        assert.deepStrictEqual(await caret(), [words, words.length, words.length], words);
        await page.key('Escape');
      }
    });
  });

  it('GURPS: typed words set the location list; a type that cannot hit the place is refused with its reason', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      p = await peek(page, p, 'Vex Harrow');
      const vex = named(p, 'Vex Harrow').id;
      const sel = `#acting [data-fhlocsel="${vex}"]`;
      const value = () => page.evaluate(`document.querySelector(${q(sel)}).value`);
      await typeInto(page, `[data-fhp="${vex}"]`, '2d imp v', { enter: false, settle: false });
      await page.waitFor(`document.querySelector(${q(sel)}).value === 'vitals'`);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(sel)}).selectedOptions[0].textContent`), 'Vitals −3 · ×3');
      await page.key('Escape');
      await page.waitFor(`document.querySelector(${q(sel)}).value === 'torso'`);
      await typeInto(page, `[data-fhp="${vex}"]`, '9 cr eye');
      const why = `li[data-row2="${vex}"] .refnum`;
      await page.waitFor(`document.querySelector(${q(why)})`);
      assert.strictEqual(await text(page, why), 'cr cannot target the eye');
      assert.strictEqual(await value(), 'eye');
      p = await settled(page);
      assert.strictEqual(named(p, 'Vex Harrow').hp, 13);
    });
  });

  it('GURPS: a jaw hit, a neck vein and a hand joint each give their injury, picked by keyboard and mouse', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      p = await peek(page, p, 'Vex Harrow');
      const vex = named(p, 'Vex Harrow').id;
      const sel = `#acting [data-fhlocsel="${vex}"]`;
      const value = () => page.evaluate(`document.querySelector(${q(sel)}).value`);
      // as a GM does it: click the box, type the damage, Enter
      const hitWith = async (entry) => {
        await tap(page, `[data-fhp="${vex}"]`);
        await page.type(entry);
        await page.key('Enter');
      };
      // keyboard: Tab from the last type chip to the list, then the arrows (Torso, Arm, Leg), where a closed list takes
      // them (Windows and Linux; a Mac's opens instead), and the letters everywhere
      await tap(page, `[data-fhtype="${vex}|cr"]`);
      await tap(page, sel);
      await page.key('Escape');
      await page.key('Tab', { shift: true });
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.fhtype || ""'), `${vex}|fat`);
      await page.key('Tab');
      assert.strictEqual(await page.evaluate(`document.activeElement === document.querySelector(${q(sel)})`), true);
      if (process.platform !== 'darwin') {
        await page.key('ArrowDown');
        await page.key('ArrowDown');
        await page.waitFor(`document.querySelector(${q(sel)}).value === 'leg'`);
        assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${vex}"]').value`), ' cr leg');
        await page.key('ArrowUp');
        await page.waitFor(`document.querySelector(${q(sel)}).value === 'arm'`);
      }
      await page.sleep(1100);
      for (const ch of 'Leg') await page.key(ch);
      await page.waitFor(`document.querySelector(${q(sel)}).value === 'leg'`);
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${vex}"]').value`), ' cr leg');
      assert.strictEqual(await page.evaluate(`document.activeElement === document.querySelector(${q(sel)})`), true, 'focus stays on the list');
      // the browser's type-to-select keeps letters for a second: the next pick starts afresh, from the box
      await page.sleep(1100);
      await tap(page, `[data-fhp="${vex}"]`);
      // the mouse: the jaw, crushing (13 HP, DR 1)
      await page.choose(sel, 'Jaw');
      await hitWith('3');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === 11 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(named(p, 'Vex Harrow').hit.line, '3 cr − DR 1 = 2');
      assert.strictEqual(named(p, 'Vex Harrow').hit.location, 'jaw');
      assert.strictEqual(await value(), 'torso');
      // a neck vein, cutting
      await tap(page, `[data-fhtype="${vex}|cut"]`);
      await page.choose(sel, 'Neck vein');
      await hitWith('3');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === 6 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(named(p, 'Vex Harrow').hit.line, '3 cut − DR 1 = 2 × 2.5 = 5');
      // a hand joint, crushing: the place picked, the damage typed, then back on the list, Enter there applies the box
      await tap(page, `[data-fhtype="${vex}|cr"]`);
      await page.choose(sel, 'Hand joint');
      await tap(page, `[data-fhp="${vex}"]`);
      await page.type('9');
      await tap(page, sel);
      await page.key('Escape');
      assert.strictEqual(await page.evaluate(`document.activeElement === document.querySelector(${q(sel)})`), true);
      await page.key('Enter');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === 2 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(named(p, 'Vex Harrow').hit.line, '9 cr − DR 1 = 8, capped at 4 (hand joint)');
      assert.deepStrictEqual(named(p, 'Vex Harrow').crippled, ['hand joint']);
      assert.strictEqual(await value(), 'torso');
    });
  });

  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: the location list fits the panel with no clipping, its widest label whole`, async () => {
      const run = await start('gurps');
      await withPage({ width, height }, async (page) => {
        let p = await fightOn(page, run, 2);
        p = await peek(page, p, 'Vex Harrow');
        const vex = named(p, 'Vex Harrow').id;
        await tap(page, `[data-fhtype="${vex}|cut"]`);
        const sel = `#acting [data-fhlocsel="${vex}"]`;
        await page.choose(sel, 'Neck vein');
        // the narrow box keeps its words whole in its title, kept current as they change
        assert.strictEqual(await attrOf(page, `[data-fhp="${vex}"]`, 'title'), 'cut neck vein');
        await tap(page, `[data-fhp="${vex}"]`);
        await page.type('9');
        await page.waitFor(`document.querySelector('[data-fhp="${vex}"]').title === '9 cut neck vein'`);
        const box = await page.evaluate(`(() => { const s = document.querySelector(${q(sel)}); const r = s.getBoundingClientRect(); const a = document.querySelector('#acting').getBoundingClientRect();
          const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(s).font;
          return { left: r.left, right: r.right, aLeft: a.left, aRight: a.right, text: c.measureText(s.selectedOptions[0].textContent).width, inner: s.clientWidth }; })()`);
        assert.ok(box.left >= box.aLeft - 1 && box.right <= box.aRight + 1, `${width}: ${JSON.stringify(box)}`);
        // the chosen label fits inside the select (less its arrow)
        assert.ok(box.text <= box.inner - 16, `${width}: ${JSON.stringify(box)}`);
        sane(await settled(page), `location list ${width}`);
        await shot(page, `gurps-location-${width}`);
      });
    });
  }

  it('GURPS: a hit with no type is refused on the row\'s second line, the words kept; face open beside DR', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      const vex = named(p, 'Vex Harrow').id;
      await typeInto(page, `[data-fhp="${vex}"]`, '9 vitals');
      const why = `li[data-row2="${vex}"] .refnum`;
      await page.waitFor(`document.querySelector(${q(why)})`);
      assert.strictEqual(await text(page, why), run.model.rules.words.entryInvalid);
      assert.strictEqual(await page.evaluate(`document.querySelector('[data-fhp="${vex}"]').value`), '9 vitals');
      p = await settled(page);
      assert.strictEqual(named(p, 'Vex Harrow').hp, 13);
      // the face toggle sits beside the panel's DR box (a foe has one DR)
      p = await peek(page, p, 'Vex Harrow');
      const face = `#acting [data-fface="${vex}"]`;
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(face)}).previousElementSibling.querySelector('[data-fs-dr]') !== null`), true);
      await tap(page, face);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).faceOpen === true && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await attrOf(page, face, 'aria-pressed'), 'true');
      // Esc empties the refused box; 5 cr to the open face takes no DR
      await tap(page, `[data-fhp="${vex}"]`);
      await page.key('Escape');
      await page.waitFor(`!document.querySelector(${q(why)})`);
      await page.type('5 cr face');
      await page.key('Enter');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).hp === 8`);
      assert.strictEqual(named(p, 'Vex Harrow').hit.line, '5 cr \u2212 DR 0 (face open) = 5');
    });
  });
  // Task 13: the dice always land 4 (a fixed source handed to the server), so every 3d6 is 12
  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: with Bouncer 1 acting, 9 imp vitals on Bouncer 2 puts one card at the top of the panel, its death check rolled first and its knockdown second, then applied`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        let p = await fightOn(page, run, 1);
        await tap(page, '#fAddCount');
        await page.type('2');
        await tap(page, '#fAddName');
        await page.type('Bouncer');
        await page.waitFor('document.querySelector("[data-faddnew]")');
        await tap(page, '[data-faddnew]');
        p = await until(page, 'p.fight.rows.some((r) => r.name === "Bouncer 2") && p.saved === "Saved" && p.pending === 0');
        // Bouncer 1 is fastest; Bouncer 2 has HT 10, 11 HP (from ST) and DR 1
        p = await peek(page, p, 'Bouncer 1');
        p = await typeInto(page, box(p, 'Bouncer 1', 'speed'), '9');
        p = await peek(page, p, 'Bouncer 2');
        p = await typeInto(page, box(p, 'Bouncer 2', 'st'), 11);
        p = await typeInto(page, box(p, 'Bouncer 2', 'ht'), 10);
        p = await typeInto(page, box(p, 'Bouncer 2', 'dr'), 1);
        await tap(page, '#fNext');
        if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
        p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
        const b1 = named(p, 'Bouncer 1').id;
        const b2 = named(p, 'Bouncer 2').id;
        assert.equal(p.fight.turn, b1);
        assert.strictEqual(p.fight.actingName, 'Bouncer 1');
        assert.deepStrictEqual([named(p, 'Bouncer 2').hp, named(p, 'Bouncer 2').ht, named(p, 'Bouncer 2').dr], [11, 10, 1]);
        // 9 imp vitals: 8 x 3 = 24, to -13
        p = await typeInto(page, `[data-fhp="${b2}"]`, '9 imp vitals');
        const card = `#acting .fcard[data-fcrow="${b2}"]`;
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).hp === -13 && document.querySelector(${q(card)})`);
        // no click on its name: the panel is still Bouncer 1's, the card at its top naming Bouncer 2
        assert.strictEqual(p.fight.actingName, 'Bouncer 1');
        assert.strictEqual(await page.evaluate('document.querySelector("#acting").firstElementChild.className'), 'fcards');
        assert.strictEqual(await text(page, `${card} .fch .nm`), 'Bouncer 2');
        assert.deepStrictEqual(await texts(page, `${card} .clines .lt`), ['Death check (−1×HP): HT 10', 'Knockdown: HT 10 −5 = 5']);
        assert.ok((await texts(page, `li[data-frow="${b2}"] .chips > .chip, li[data-row2="${b2}"] .chip`)).includes('card waiting'));
        assert.strictEqual(named(p, 'Bouncer 2').shock, 4);
        // the card's top and bottom edges are in view, in the window and in the panel's own scroll box
        const edges = await page.evaluate(`(() => { const c = document.querySelector(${q(card)}).getBoundingClientRect(); const a = document.querySelector('#acting').getBoundingClientRect();
          return { top: c.top, bottom: c.bottom, h: innerHeight, aTop: a.top, aBottom: a.bottom }; })()`);
        assert.ok(edges.top >= 0 && edges.bottom <= edges.h && edges.top >= edges.aTop - 1 && edges.bottom <= edges.aBottom + 1, `${width}: ${JSON.stringify(edges)}`);
        sane(p, `card ${width}`);
        await shot(page, `gurps-card-${width}`);
        // the first held click on Roll rolls the death check: 12 against 10, Mortal wound offered
        const rollBtn = `${card} button.roll`;
        await tap(page, rollBtn);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(await texts(page, `${card} .clines li:nth-child(1) .offer`), ['Mortal wound']);
        // focus stays on the card: its Roll, for the next line
        await page.waitFor(`document.activeElement === document.querySelector(${q(rollBtn)})`, 3000);
        // the second the knockdown: 12 against 5, Unconscious offered
        await page.waitFor(`document.querySelector(${q(rollBtn)}) && !document.querySelector(${q(rollBtn)}).disabled`);
        await tap(page, rollBtn);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[1].result && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(await texts(page, `${card} .clines li:nth-child(2) .offer`), ['Unconscious']);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector(${q(rollBtn)}))`), false, 'nothing left to roll');
        assert.deepStrictEqual(named(p, 'Bouncer 2').conds, [], 'nothing applied until the tap');
        // Apply: Unconscious, then the Mortal wound still offered; the card goes
        await tap(page, `${card} .clines li:nth-child(2) .offer`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).conds.includes("Unconscious") && p.saved === "Saved" && p.pending === 0`);
        await tap(page, `${card} .clines li:nth-child(1) .offer`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards.length === 0 && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(named(p, 'Bouncer 2').conds, ['Unconscious', 'Mortal wound']);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector(${q(card)}))`), false);
        // Task 23: the card settled and went; focus is on the row's entry box, never the page
        await page.waitFor(`document.activeElement === document.querySelector('[data-fhp=${q(b2)}]')`, 3000);
        const log = (await (await fetch(`${run.base}/api/state`)).json()).state.events.filter((e) => e.fight).map((e) => e.text);
        assert.deepStrictEqual(log.slice(-4), [
          'Bouncer 2: death check (−1×HP), HT 10, rolled 12, failed by 2.',
          'Bouncer 2: knockdown, HT 10 −5 = 5, rolled 12, failed by 7.',
          'Bouncer 2: knockdown: Unconscious.',
          'Bouncer 2: death check (−1×HP): Mortal wound.',
        ]);
        sane(p, `after ${width}`);
      });
    });
  }

  it('GURPS: the panel\'s shock chip, tapped, sets Shock −2', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 2);
      p = await peek(page, p, 'Vex Harrow');
      const vex = named(p, 'Vex Harrow').id;
      assert.strictEqual(await text(page, `#acting [data-fshock="${vex}"]`), 'Shock');
      await tap(page, `#acting [data-fshock="${vex}"]`);
      await tap(page, `#acting [data-fshockset="${vex}|2"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(vex)}).shock === 2 && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await text(page, `#acting [data-fshock="${vex}"]`), 'Shock −2');
      assert.ok((await texts(page, `li[data-frow="${vex}"] .chips > .chip, li[data-row2="${vex}"] .chip`)).includes('Shock −2'));
    });
  });

  // Task 14: two Bouncers added with the Add box's count, their numbers typed in the panel; Bouncer 1 is fastest.
  // `more` types further boxes on Bouncer 2 ([key, value] pairs). The dice always land 4, so every 3d6 is 12.
  // `opened` true: the fight is open already (Fight pressed), so the page is not loaded again
  async function bouncers(page, run, more, opened = false) {
    let p = opened ? await settled(page) : await fightOn(page, run, 1);
    await tap(page, '#fAddCount');
    await page.type('2');
    await tap(page, '#fAddName');
    await page.type('Bouncer');
    await page.waitFor('document.querySelector("[data-faddnew]")');
    await tap(page, '[data-faddnew]');
    p = await until(page, 'p.fight.rows.some((r) => r.name === "Bouncer 2") && p.saved === "Saved" && p.pending === 0');
    p = await peek(page, p, 'Bouncer 1');
    p = await typeInto(page, box(p, 'Bouncer 1', 'speed'), '9');
    p = await peek(page, p, 'Bouncer 2');
    for (const [key, value] of more) p = await typeInto(page, box(p, 'Bouncer 2', key), value);
    await tap(page, '#fNext');
    if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
    return until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
  }
  const focusIs = (page, sel) => page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 3000);

  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: with Bouncer 1 acting, a held click on Bouncer 2's Parry readout rolls it and logs, with no click on its name; the next Parry reads 5`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
        const b1 = named(p, 'Bouncer 1').id;
        const b2 = named(p, 'Bouncer 2').id;
        assert.equal(p.fight.turn, b1);
        assert.strictEqual(p.fight.actingName, 'Bouncer 1');
        // Bouncer 2's row: its Dodge from Speed 5, its typed Parry and Block, each a button
        const defs = `li[data-frow="${b2}"] .defs .def`;
        assert.deepStrictEqual(await texts(page, defs), ['Dodge 8', 'Parry 9', 'Block 8']);
        assert.strictEqual(await attrOf(page, `[data-fdef="${b2}|dodge"]`, 'title'), 'Dodge 8 (from Speed). Tap: roll it');
        const parry = `[data-fdef="${b2}|parry"]`;
        await tap(page, parry);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).parries === 1 && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(p.fight.actingName, 'Bouncer 1', 'no click on its name: the panel is still Bouncer 1\'s');
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: Parry 9, rolled 12, failed by 3.']);
        // the next Parry reads 5, its cause in the title; focus stays on the button
        await page.waitFor(`document.querySelector(${q(parry)}) && document.querySelector(${q(parry)}).textContent === "Parry 5"`, 3000);
        assert.strictEqual(await attrOf(page, parry, 'title'), 'Parry 9 → 5: parry 2 −4. Tap: roll it');
        await focusIs(page, parry);
        sane(p, `defend ${width}`);
        if (width === 1449) {
          const row = p.layout.rows.find((r) => r.name === 'Bouncer 2');
          assert.ok(row && row.h <= 40, `1449: Bouncer 2 is one line (${row && row.h} px)`);
        }
        await shot(page, `gurps-defend-${width}`);
        // its own turn: the count starts again
        for (let i = 0; i < 12 && p.fight.turn !== b2; i++) {
          const was = p.fight.turn;
          await tap(page, '#fNext');
          p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
        }
        assert.equal(p.fight.turn, b2);
        await page.waitFor(`document.querySelector(${q(parry)}).textContent === "Parry 9"`, 3000);
      });
    });
  }

  // Task 34 (finding 7): the newest card leads the strip, in view at every width; its Roll settles its own lines only
  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: Sela's card then Bouncer 2's: Bouncer 2's, the newest, is first and in view; its Roll leaves Sela's alone`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['ht', 10]]);
        const b2 = named(p, 'Bouncer 2').id;
        const sela = named(p, 'Sela Drake').id;
        assert.ok(order(p).indexOf('Sela Drake') < order(p).indexOf('Bouncer 2'), 'Sela is above Bouncer 2 in the order');
        p = await typeInto(page, `[data-fhp="${sela}"]`, '-8');
        await page.waitFor(`document.querySelector('#acting .fcard[data-fcrow="${sela}"]')`, 3000);
        p = await typeInto(page, `[data-fhp="${b2}"]`, '-7');
        await page.waitFor(`document.querySelector('#acting .fcard[data-fcrow="${b2}"]')`, 3000);
        assert.deepStrictEqual(await page.evaluate(`Array.from(document.querySelectorAll('#acting .fcard'), (c) => c.dataset.fcrow)`), [b2, sela]);
        const card = `#acting .fcard[data-fcrow="${b2}"]`;
        const edges = await page.evaluate(`(() => { const c = document.querySelector(${q(card)}).getBoundingClientRect(); const a = document.querySelector('#acting').getBoundingClientRect();
          const bar = document.querySelector('.top').getBoundingClientRect().bottom; return { top: c.top, bottom: c.bottom, h: innerHeight, bar, aTop: a.top, aBottom: a.bottom }; })()`);
        assert.ok(edges.top >= edges.bar && edges.bottom <= edges.h && edges.top >= edges.aTop - 1 && edges.bottom <= edges.aBottom + 1, `${width}: ${JSON.stringify(edges)}`);
        await shot(page, `gurps-cards-newest-${width}`);
        const selaLines = () => page.evaluate(`Array.from(document.querySelectorAll('#acting .fcard[data-fcrow="${sela}"] .clines li'), (l) => l.className + '|' + l.textContent)`);
        const was = await selaLines();
        await tap(page, `${card} button.roll`);
        await page.waitFor(`document.querySelector(${q(card)} + ' .clines .res') || !document.querySelector(${q(card)})`, 3000);
        p = await settled(page);
        assert.deepStrictEqual(await selaLines(), was, 'Sela\'s card is untouched');
        sane(p, `cards ${width}`);
      });
    });
  }

  // Task 34 (finding 13): the middle/right split holds still as rows gain numbers, buttons and cards
  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: the right pane's left edge stays put from Fight through added rows, typed numbers, Start and a card`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        const edge = async (label) => { const p = await settled(page); return [label, p.layout.paneBox.left, p.layout.folded]; };
        const seen = [];
        let p = await fightOn(page, run, 1);
        seen.push(await edge('fight'));
        p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['dr', 2]], true);
        seen.push(await edge('numbers and Start'));
        const b2 = named(p, 'Bouncer 2').id;
        p = await typeInto(page, `[data-fhp="${b2}"]`, '-7');
        await page.waitFor(`document.querySelector('#acting .fcard[data-fcrow="${b2}"]')`, 3000);
        seen.push(await edge('card'));
        p = await typeInto(page, `[data-fhp="${named(p, 'Sela Drake').id}"]`, 'f-2');
        seen.push(await edge('more numbers'));
        // open or folded, the pane is as it was at Fight: where the order needs the room, it folds then, not mid-fight
        assert.strictEqual(new Set(seen.map((x) => `${x[1]}|${x[2]}`)).size, 1, `${width}: the split moved ${JSON.stringify(seen)}`);
        if (width >= 1280) assert.strictEqual(seen[0][2], false, `${width}: the pane is open`);
        // no foe here had a Block: the first one typed may move it once (the coordinator's ruling), then it holds
        p = await peek(page, p, 'Bouncer 2');
        p = await typeInto(page, box(p, 'Bouncer 2', 'block'), 8);
        const after = [await edge('block')];
        p = await typeInto(page, `[data-fhp="${named(p, 'Sela Drake').id}"]`, 'f-1');
        after.push(await edge('after the block'));
        assert.strictEqual(new Set(after.map((x) => `${x[1]}|${x[2]}`)).size, 1, `${width}: it moved again ${JSON.stringify(after)}`);
        sane(p, `split ${width}`);
      });
    });
  }

  // Task 34 fix round: the CoC twin. The order is measured as if an attacker were acting, so Start and a turn passing
  // from one who can shoot to one who cannot move nothing
  for (const [width, height] of SIZES) {
    it(`CoC at ${width}: the right pane's left edge stays put from Fight through an added row, Start, turns passing and a card`, async () => {
      const run = await start('coc', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        const edge = async (label) => { const p = await settled(page); return [label, p.layout.paneBox.left, p.layout.folded]; };
        const seen = [];
        let p = await fightOn(page, run, 0);
        seen.push(await edge('fight'));
        p = await addNew(page, 'Quill');
        p = await typeInto(page, box(p, 'Quill', 'dex'), 50);
        seen.push(await edge('added'));
        await tap(page, '#fNext');
        if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
        p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
        seen.push(await edge(`start: ${p.fight.actingName}`));
        for (let i = 0; i < 3; i++) {
          const was = p.fight.turn;
          await tap(page, '#fNext');
          p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
          seen.push(await edge(`turn: ${p.fight.actingName}`));
        }
        const bw = named(p, 'Brine Walker 1').id;
        p = await typeInto(page, `[data-fhp="${bw}"]`, '-8');
        await page.waitFor(`document.querySelector('#acting .fcard[data-fcrow="${bw}"]')`, 3000);
        seen.push(await edge('card'));
        assert.strictEqual(new Set(seen.map((x) => `${x[1]}|${x[2]}`)).size, 1, `${width}: the split moved ${JSON.stringify(seen)}`);
        sane(p, `coc split ${width}`);
      });
    });
  }

  // Task 34 (finding 8): a second click on a picked row's name keeps it picked, numbers or none; another name moves it
  it('GURPS: a second click on Bouncer 2\'s name, which has numbers, keeps its panel; a click on Bouncer 1\'s moves it', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const b2 = named(p, 'Bouncer 2').id;
      assert.strictEqual(p.fight.actingName, 'Bouncer 1');
      p = await peek(page, p, 'Bouncer 2');
      await tap(page, `[data-fpeek="${b2}"]`);
      await page.sleep(150);
      p = await settled(page);
      assert.strictEqual(p.fight.actingName, 'Bouncer 2', 'the second click keeps the pick');
      assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('#acting [data-fs-parry="${b2}"]'))`), true);
      p = await peek(page, p, 'Bouncer 1');
      assert.strictEqual(p.fight.actingName, 'Bouncer 1');
    });
  });

  // Task 34 (finding 11): the panel's Dodge read-out is the row's figure, Tired halving it there too
  it('GURPS: a Tired Bouncer 2 reads the same Dodge on its row and in its panel\'s header', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const b2 = named(p, 'Bouncer 2').id;
      p = await typeInto(page, `[data-fhp="${b2}"]`, 'f-8');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).fp === 2 && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector('[data-fdef="${b2}|dodge"]').textContent === "Dodge 4"`, 3000);
      p = await peek(page, p, 'Bouncer 2');
      const dodge = (await texts(page, '#acting .nums > span')).filter((t) => /^Dodge /.test(t));
      assert.deepStrictEqual(dodge, ['Dodge 4 (from Speed)']);
      assert.strictEqual(await text(page, `[data-fdef="${b2}|dodge"]`), 'Dodge 4');
    });
  });

  // Task 30: the last defence roll on the row's second line, information only (nothing waits on it)
  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: a Parry made then failed shows on Bouncer 2's second line, the second replacing the first; one line high; its seen toggle and Next still work; its turn clears it; the players see none of it`, async () => {
      let die = 2;
      const run = await start('gurps', { randomInt: () => die });
      await withPage({ width, height }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
        const b1 = named(p, 'Bouncer 1').id;
        const b2 = named(p, 'Bouncer 2').id;
        assert.equal(p.fight.turn, b1);
        const res = `li[data-row2="${b2}"] .defres`;
        assert.strictEqual(await page.evaluate('document.querySelectorAll("li.row2 .defres").length'), 0, 'no Defend tapped: no result line');
        const parry = `[data-fdef="${b2}|parry"]`;
        const before = await page.evaluate(`document.querySelector(${q(parry)}).getBoundingClientRect().top`);
        // made: 2+2+2 against Parry 9
        await tap(page, parry);
        await page.waitFor(`document.querySelector(${q(res)}) !== null`, 3000);
        assert.strictEqual(await text(page, res), 'Parry 9: rolled 6, made it by 3');
        assert.strictEqual(await attrOf(page, res, 'class'), 'defres made');
        const after = await page.evaluate(`document.querySelector(${q(parry)}).getBoundingClientRect().top`);
        assert.ok(Math.abs(after - before) < 1, `the tapped row stays put (${before} -> ${after})`);
        // one line high, wholly inside the order, under the readout's side
        const box = await page.evaluate(`(() => { const l = document.querySelector('li[data-row2=${q(b2)}]'); const e = document.querySelector(${q(res)}); const o = l.closest('ol.to'); const a = l.getBoundingClientRect(); const b = e.getBoundingClientRect(); const c = o.getBoundingClientRect(); return { h: a.height, left: b.left, right: b.right, oLeft: c.left, oRight: c.right, mid: c.left + c.width / 2, whole: e.scrollWidth <= e.clientWidth + 1 }; })()`);
        assert.ok(box.h <= 22, `${width}: the second line is one line (${box.h} px)`);
        assert.ok(box.left >= box.oLeft && box.right <= box.oRight + 1, `${width}: inside the order ${JSON.stringify(box)}`);
        assert.ok(box.left > box.mid, `${width}: on the readout's side ${JSON.stringify(box)}`);
        assert.ok(box.whole, `${width}: the whole result shows`);
        // failed: 4+4+4 against Parry 5 replaces it
        die = 4;
        await page.waitFor(`document.querySelector(${q(parry)}).textContent === "Parry 5" && !document.querySelector(${q(parry)}).disabled`, 3000);
        await tap(page, parry);
        await page.waitFor(`document.querySelector(${q(res)}) && document.querySelector(${q(res)}).textContent === "Parry 5: rolled 12, failed by 7"`, 3000);
        assert.strictEqual(await attrOf(page, res, 'class'), 'defres failed');
        assert.strictEqual(await page.evaluate(`document.querySelectorAll('li[data-row2=${q(b2)}] .defres').length`), 1);
        // several foes defended: Rafe's Dodge and Mara's Parry too, each one line; Bouncer 2, last, and its line in view
        for (const [who, k] of [['Rafe Kell', 'dodge'], ['Mara Quint', 'parry']]) {
          const id = named(p, who).id;
          await tap(page, `[data-fdef="${id}|${k}"]`);
          await page.waitFor(`document.querySelector('li[data-row2=${q(id)}] .defres') !== null`, 3000);
        }
        p = await settled(page);
        const seen = await page.evaluate(`(() => {
          const lines = Array.from(document.querySelectorAll('li.row2'), (l) => l.getBoundingClientRect().height);
          const ol = document.querySelector('#side ol.to');
          let sc = ol.parentElement;
          while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
          const v = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
          const inView = (e) => { const r = e.getBoundingClientRect(); return r.top >= Math.max(v.top, 0) - 1 && r.bottom <= Math.min(v.bottom, innerHeight) + 1; };
          return { lines, results: document.querySelectorAll('li.row2 .defres').length, row: inView(document.querySelector('li[data-frow=${q(b2)}]')), line: inView(document.querySelector(${q(res)})) };
        })()`);
        assert.strictEqual(seen.results, 3, `${width}: three results`);
        for (const h of seen.lines) assert.ok(h <= 22, `${width}: every second line is one line (${seen.lines})`);
        assert.ok(seen.row && seen.line, `${width}: Bouncer 2 and its result in view (${JSON.stringify(seen)})`);
        sane(p, `defence result ${width}`);
        await shot(page, `gurps-defend-result-${width}`);
        // the players' view holds none of it
        const pv = JSON.stringify(await (await fetch(`${run.base}/api/players/view`)).json());
        assert.ok(!/rolled|made it|failed by/.test(pv), `players' view: ${pv.slice(0, 200)}`);
        // information only: the row's seen toggle still works with it showing
        await tap(page, `[data-fseen="${b2}"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).seen === true && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(await text(page, res), 'Parry 5: rolled 12, failed by 7', 'still there after another control');
        // and Next: on to Bouncer 2's turn, where the line goes
        for (let i = 0; i < 12 && p.fight.turn !== b2; i++) {
          const was = p.fight.turn;
          await tap(page, '#fNext');
          p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
        }
        assert.equal(p.fight.turn, b2);
        await page.waitFor(`document.querySelector(${q(res)}) === null`, 3000);
        assert.strictEqual(await text(page, parry), 'Parry 9');
        // the players' screen itself
        await page.goto(`${run.base}/players?probe=1`);
        await page.waitFor('document.body && document.body.textContent.includes("Bouncer")', 5000).catch(() => {});
        const body = await page.evaluate('document.body.textContent');
        assert.ok(!/rolled|made it|failed by/.test(body), 'players\' screen');
      });
    });
  }

  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: a held click on the acting row's "+ manoeuvre", pick All-Out Attack: the row reads AoA and its Dodge "no defence"`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
        const b1 = named(p, 'Bouncer 1').id;
        const b2 = named(p, 'Bouncer 2').id;
        assert.equal(p.fight.turn, b1);
        const chip = `li[data-frow="${b1}"] [data-fmanrow="${b1}"]`;
        assert.strictEqual(await text(page, chip), '+ manoeuvre');
        assert.strictEqual(await page.evaluate(`document.querySelectorAll('li[data-frow="${b2}"] [data-fmanrow]').length`), 0, 'no empty chip off its turn');
        await tap(page, chip);
        const aoa = `#acting [data-fman="${b1}|all-out attack"]`;
        await tap(page, aoa);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).manoeuvre === "all-out attack" && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(await text(page, chip), 'AoA');
        assert.deepStrictEqual(await texts(page, `li[data-frow="${b1}"] .defs .def`), ['Dodge –']);
        assert.strictEqual(await attrOf(page, aoa, 'aria-pressed'), 'true');
        await focusIs(page, aoa);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 1: All-Out Attack.']);
        sane(p, `manoeuvre ${width}`);
        if (width === 1449) {
          for (const n of ['Bouncer 1', 'Bouncer 2']) {
            const row = p.layout.rows.find((r) => r.name === n);
            assert.ok(row && row.h <= 40, `1449: ${n} is one line (${row && row.h} px)`);
          }
        }
        await shot(page, `gurps-manoeuvre-${width}`);
        // tapped again in the same turn, it is taken back and its log line goes
        await tap(page, aoa);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b1)}).manoeuvre === null && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(await text(page, chip), '+ manoeuvre');
        assert.ok(!(await logOf(run)).includes('Bouncer 1: All-Out Attack.'));
      });
    });
  }

  // Next until the named row acts
  async function actFor(page, p, name) {
    const id = named(p, name).id;
    for (let i = 0; i < 12 && p.fight.turn !== id; i++) {
      const was = p.fight.turn;
      await tap(page, '#fNext');
      p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
    }
    assert.equal(p.fight.turn, id);
    return p;
  }

  // Task 37 changed this on purpose (Ant's no-locked-workflow rule): off its turn the buttons work too
  it('GURPS: off its turn the panel\'s manoeuvre buttons are live; on it All-Out Defence waits for a defence, then Parry reads 11; a PC takes a note', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
      const b2 = named(p, 'Bouncer 2').id;
      p = await peek(page, p, 'Bouncer 2');
      const aodBtn = `#acting [data-fman="${b2}|all-out defence"]`;
      assert.strictEqual(await page.evaluate(`document.querySelectorAll('#acting [data-fman][disabled]').length`), 0);
      assert.strictEqual(await attrOf(page, aodBtn, 'title'), 'All-Out Defence');
      p = await actFor(page, p, 'Bouncer 2');
      await tap(page, aodBtn);
      await page.waitFor(`document.querySelector('#acting [data-fmand="${b2}|parry"]')`, 3000);
      assert.strictEqual(named(await settled(page), 'Bouncer 2').manoeuvre, null, 'nothing is set until a defence is named');
      await tap(page, `#acting [data-fmand="${b2}|parry"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).aodDefence === "parry" && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(await texts(page, `li[data-frow="${b2}"] .defs .def`), ['Dodge 8', 'Parry 11', 'Block 8']);
      assert.strictEqual(await text(page, `li[data-frow="${b2}"] [data-fmanrow]`), 'AoD');
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: All-Out Defence (Parry).']);
      // a PC: the chip is a note, the sheet's figures do not move
      const sela = named(p, 'Sela Drake').id;
      p = await peek(page, p, 'Sela Drake');
      assert.strictEqual(await page.evaluate(`document.querySelectorAll('#acting [data-fman][disabled]').length`), 0);
      p = await actFor(page, p, 'Sela Drake');
      p = await peek(page, p, 'Sela Drake');
      await page.waitFor(`document.querySelector('#acting [data-fman="${sela}|aim"]') && !document.querySelector('#acting [data-fman="${sela}|aim"]').disabled`, 3000);
      await tap(page, `#acting [data-fman="${sela}|aim"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(sela)}).manoeuvre === "aim" && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await text(page, `li[data-frow="${sela}"] [data-fmanrow]`), 'Aim');
      assert.deepStrictEqual(await texts(page, '#acting .pdefs.pc .sheetdef'), ['Dodge 8', 'Parry 10', 'Block 9']);
    });
  });

  // Task 23b B9's, changed on purpose by Task 37 (Ant's no-locked-workflow rule): the turn moved on, the buttons still work
  it('GURPS: once the turn has moved on, the Which defence buttons still work: Dodge picked after Next', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
      const b2 = named(p, 'Bouncer 2').id;
      p = await actFor(page, p, 'Bouncer 2');
      await tap(page, `#acting [data-fman="${b2}|all-out defence"]`);
      await page.waitFor(`document.querySelector('#acting [data-fmand="${b2}|parry"]')`, 3000);
      assert.strictEqual(await page.evaluate(`document.querySelector('#acting [data-fmand="${b2}|parry"]').disabled`), false, 'on its turn they work');
      await tap(page, `#acting [data-fmand="${b2}|parry"]`);
      await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).aodDefence === "parry" && p.saved === "Saved" && p.pending === 0`);
      await tap(page, '#fNext');
      p = await until(page, `p.fight.turn !== ${q(b2)} && p.saved === "Saved" && p.pending === 0`);
      p = await peek(page, p, 'Bouncer 2');
      const which = `#acting [data-fmand="${b2}|dodge"]`;
      await page.waitFor(`document.querySelector(${q(which)})`, 3000);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(which)}).disabled`), false);
      await tap(page, which);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).aodDefence === "dodge" && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: All-Out Defence (Dodge).']);
    });
  });

  it('GURPS: an All-Out Defence asked for and not answered is not asked again when the row\'s panel returns', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
      const b2 = named(p, 'Bouncer 2').id;
      p = await actFor(page, p, 'Bouncer 2');
      await tap(page, `#acting [data-fman="${b2}|all-out defence"]`);
      await page.waitFor(`document.querySelector('#acting [data-fmand="${b2}|dodge"]')`, 3000);
      await tap(page, '#fNext');
      p = await until(page, `p.fight.turn !== ${q(b2)} && p.saved === "Saved" && p.pending === 0`);
      p = await peek(page, p, 'Bouncer 2');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("#acting [data-fmand]").length'), 0);
    });
  });

  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: a foe with Dodge, Parry and Block and a picked chip reads on one line`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
        const b2 = named(p, 'Bouncer 2').id;
        p = await actFor(page, p, 'Bouncer 2');
        await tap(page, `#acting [data-fman="${b2}|move and attack"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).manoeuvre === "move and attack" && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(await texts(page, `li[data-frow="${b2}"] .defs .def`), ['Dodge 8', 'Parry –', 'Block 8']);
        assert.strictEqual(await text(page, `li[data-frow="${b2}"] [data-fmanrow]`), 'M&A');
        sane(p, `three defences and a chip ${width}`);
        if (width === 1449) {
          const row = p.layout.rows.find((r) => r.name === 'Bouncer 2');
          assert.ok(row && row.h <= 40, `1449: Bouncer 2 is one line (${row && row.h} px)`);
        }
        await shot(page, `gurps-manoeuvre-three-${width}`);
      });
    });
  }

  it('GURPS: the panel\'s Retreat on gives Dodge 11; a used Block asks once, then rolls again; Stunned greys Retreat', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9], ['block', 8]]);
      const b2 = named(p, 'Bouncer 2').id;
      p = await peek(page, p, 'Bouncer 2');
      assert.deepStrictEqual(await texts(page, '#acting .pdefs .def'), ['Dodge 8', 'Parry 9', 'Block 8']);
      await tap(page, `#acting [data-fretreat="${b2}"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).retreat && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(await texts(page, '#acting .pdefs .def'), ['Dodge 11', 'Parry 10', 'Block 9']);
      const block = `#acting [data-fpdef="${b2}|block"]`;
      await tap(page, block);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).blocks === 1 && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector(${q(block)}).textContent === "Block used"`, 3000);
      await focusIs(page, block);
      // the second tap asks; nothing is rolled
      await tap(page, block);
      await page.waitFor(`document.querySelector(${q(block)}).textContent === "Block again?"`, 3000);
      await focusIs(page, block);
      assert.strictEqual(named(await settled(page), 'Bouncer 2').blocks, 1);
      // the third rolls it again
      await tap(page, block);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).blocks === 2 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-2), [
        'Bouncer 2: Block 8 → 9 (retreat +1), rolled 12, failed by 3.',
        'Bouncer 2: Block 8 → 9 (retreat +1), again, rolled 12, failed by 3.',
      ]);
      // Stunned, from another window: Dodge 4, Parry 5, Retreat greyed
      await fromOther(run, [{ type: 'status', fight: p.fight.id, row: b2, add: 'Stunned' }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).conds.includes("Stunned") && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector('#acting [data-fretreat="${b2}"]').disabled`, 3000);
      assert.deepStrictEqual((await texts(page, '#acting .pdefs .def')).slice(0, 2), ['Dodge 4', 'Parry 5']);
      assert.strictEqual(await attrOf(page, `#acting [data-fretreat="${b2}"]`, 'title'), 'No retreat: stunned');
    });
  });

  it('GURPS: a PC with several Parry lines shows every one in From the sheet (Task 34)', async () => {
    const run = await start('gurps', null, (vault) => {
      const f = path.join(vault, 'Characters/PCs/Sela Drake.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\| Parry \| 10 \| Broadsword \|/, '| Parry (axe) | 13 | Axe/Mace |\n| Parry (Karate) | 12 | Karate |\n| Parry (Judo) | 12 | Judo |'));
    });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      p = await peek(page, p, 'Sela Drake');
      assert.deepStrictEqual(await texts(page, '#acting .pdefs.pc .sheetdef'), ['Dodge 8', 'Parry: Axe 13, Karate 12, Judo 12', 'Block 9']);
    });
  });

  it('GURPS: a PC shows the sheet\'s defences and has no Defend button', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      const sela = named(p, 'Sela Drake').id;
      p = await peek(page, p, 'Sela Drake');
      assert.deepStrictEqual(await texts(page, '#acting .pdefs.pc .sheetdef'), ['Dodge 8', 'Parry 10', 'Block 9']);
      assert.strictEqual(await page.evaluate('document.querySelectorAll("#acting [data-fpdef], #acting [data-fretreat]").length'), 0);
      assert.strictEqual(await page.evaluate(`document.querySelectorAll('li[data-frow="${sela}"] [data-fdef]').length`), 0);
      // a foe with a block's defences has its buttons: Mara Quint
      assert.ok((await texts(page, `li[data-frow="${named(p, 'Mara Quint').id}"] .defs .def`)).length > 0);
      // a Dodge typed in the fight is no longer the sheet's: it says typed
      p = await typeInto(page, box(p, 'Sela Drake', 'dodge'), 11);
      await page.waitFor('document.querySelectorAll("#acting .pdefs.pc .pcdef").length === 1', 3000);
      assert.deepStrictEqual(await texts(page, '#acting .pdefs.pc .sheetdef'), ['Parry 10', 'Block 9']);
      assert.deepStrictEqual(await texts(page, '#acting .pdefs.pc .pcdef'), ['Dodge 11 (typed)']);
    });
  });

  it('GURPS: a Parry whose figure moves while its roll is out is not logged; a note says "Parry moved to 5: tap again"', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    // the dice answer waits until the test lets it go
    let release;
    const gate = new Promise((ok) => { release = ok; });
    const route = run.routes.find((r) => r.path === '/api/roll');
    const roll = route.handle;
    route.handle = (req, res) => { gate.then(() => roll(req, res)); };
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const b2 = named(p, 'Bouncer 2').id;
      const parry = `[data-fdef="${b2}|parry"]`;
      await tap(page, parry);
      // Stunned from another window while the roll is out: Parry 9 reads 5
      await fromOther(run, [{ type: 'status', fight: p.fight.id, row: b2, add: 'Stunned' }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).conds.includes("Stunned") && p.saved === "Saved" && p.pending === 0`);
      release();
      await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote"), (n) => n.textContent).some((t) => t.includes("Bouncer 2: Parry moved to 5: tap again."))', 3000);
      p = await settled(page);
      assert.strictEqual(named(p, 'Bouncer 2').parries, 0);
      assert.ok(!(await logOf(run)).some((t) => /Parry 9/.test(t)), 'nothing logged');
      await page.waitFor(`document.querySelector(${q(parry)}).textContent === "Parry 5" && !document.querySelector(${q(parry)}).disabled`, 3000);
    });
  });

  it('GURPS: a card whose last roll settles it goes, and focus goes to its row\'s entry box, never the page', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 13], ['dr', 1]]);
      const b2 = named(p, 'Bouncer 2').id;
      // 2 cr face: a card of one line at HT 13, which 12 makes
      p = await typeInto(page, `[data-fhp="${b2}"]`, '2 cr face');
      const card = `#acting .fcard[data-fcrow="${b2}"]`;
      p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `${card} button.roll`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards.length === 0 && p.saved === "Saved" && p.pending === 0`);
      await focusIs(page, `[data-fhp="${b2}"]`);
      assert.notStrictEqual(await page.evaluate('document.activeElement === document.body'), true);
    });
  });

  // Task 37 (Ant's no-locked-workflow rule): a roll made with real dice is typed in the small box beside Roll; an open
  // Dead offer holds up nothing; any unrolled line is skipped; a defence rolled at the table counts. Dice fixed at 4.
  for (const [width, height] of SIZES) {
    it(`GURPS at ${width}: a death check typed 16 offers Dead and the knockdown still rolls; the knockdown skipped, Dead declined, the card goes; a Parry typed 7 counts`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width, height }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
        const b2 = named(p, 'Bouncer 2').id;
        const card = `#acting .fcard[data-fcrow="${b2}"]`;
        p = await typeInto(page, `[data-fhp="${b2}"]`, '9 imp vitals');
        p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
        const box2 = `${card} input.typed`;
        assert.strictEqual(await attrOf(page, box2, 'placeholder'), 'rolled');
        // the death check typed: 16 against 10, failed by 6, Dead offered
        p = await typeInto(page, box2, '16');
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(named(p, 'Bouncer 2').cards[0].lines[0].offers, ['dead']);
        assert.strictEqual(await text(page, `${card} .clines li:nth-child(1) .res`), 'rolled 16 (typed), failed by 6');
        // focus is back in the box for the next line, empty; the knockdown's Roll is live while Dead waits
        await focusIs(page, box2);
        assert.strictEqual(await page.evaluate(`document.querySelector(${q(box2)}).value`), '');
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector(${q(`${card} button.roll:not([disabled])`)}))`), true);
        sane(p, `typed card ${width}`);
        await shot(page, `t37-gurps-card-${width}`);
        // the knockdown skipped: nothing rolled, nothing logged; then Dead declined: the card goes, nothing applied
        await tap(page, `${card} .clines li:nth-child(2) .decline.skip`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[1].declined && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector(${q(`${card} button.roll`)}))`), false);
        await tap(page, `${card} .clines li:nth-child(1) .decline`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards.length === 0 && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual([named(p, 'Bouncer 2').conds, named(p, 'Bouncer 2').out], [[], false]);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: death check (−1×HP), HT 10, rolled 16 (typed), failed by 6.']);
        // a Parry rolled at the table: 7 typed in the row's box, then the Parry tapped
        const dbox = `li[data-frow="${b2}"] .defs input.typed`;
        // PRENTICE review I1 changed this on purpose: the row's box reads as a place to type, as the panel's does
        assert.strictEqual(await attrOf(page, dbox, 'placeholder'), 'rolled');
        await typeInto(page, dbox, '7', { enter: false, settle: false });
        await tap(page, `[data-fdef="${b2}|parry"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).parries === 1 && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: Parry 9, rolled 7 (typed), made it by 2.']);
        await page.waitFor(`document.querySelector('[data-fdef="${b2}|parry"]').textContent === "Parry 5" && document.querySelector(${q(dbox)}).value === ""`, 3000);
        sane(p, `typed defence ${width}`);
        if (width === 1449) {
          const row = p.layout.rows.find((r) => r.name === 'Bouncer 2');
          assert.ok(row && row.h <= 40, `1449: Bouncer 2 is one line with its box (${row && row.h} px)`);
        }
      });
    });
  }

  it('GURPS: a PC\'s card takes a typed roll; a number the dice cannot make is not taken and the page says so; a manoeuvre set off its turn', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const sela = named(p, 'Sela Drake').id;
      const card = `#acting .fcard[data-fcrow="${sela}"]`;
      p = await typeInto(page, `[data-fhp="${sela}"]`, '-8');
      p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
      // 19 cannot be 3d6: refused by the server, the note says so, nothing logged
      const before = (await logOf(run)).length;
      await typeInto(page, `${card} input.typed`, '19', { settle: false });
      await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote")).some((n) => /Not taken: a typed 3d6 roll is a whole number from 3 to 18/.test(n.textContent))', 3000);
      assert.strictEqual((await logOf(run)).length, before);
      await typeInto(page, `${card} input.typed`, '9');
      p = await until(page, `(p.fight.rows.find((r) => r.id === ${q(sela)}).cards.length === 0 || p.fight.rows.find((r) => r.id === ${q(sela)}).cards[0].lines[0].result) && p.saved === "Saved" && p.pending === 0`);
      assert.match((await logOf(run)).slice(-1)[0], /^Sela Drake: .*rolled 9 \(typed\)/);
      // Bouncer 1 acts; Bouncer 2's All-Out Attack, forgotten on its turn, set from its panel now
      const b2 = named(p, 'Bouncer 2').id;
      p = await peek(page, p, 'Bouncer 2');
      await tap(page, `#acting [data-fman="${b2}|all-out attack"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).manoeuvre === "all-out attack" && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: All-Out Attack.']);
    });
  });
});

// CoC melee and damage (Tasks 16 and 17): the fight's log, a row's second line, where focus is, and the Net Loft started
const logOf = async (run) => (await (await fetch(`${run.base}/api/state`)).json()).state.events.filter((e) => e.fight).map((e) => e.text);
const row2 = (page, id) => page.evaluate(`(() => { const l = document.querySelector('li[data-row2=${q(id)}]'); return l ? l.textContent : ''; })()`);
const focusOn = (page) => page.evaluate('(() => { const a = document.activeElement; return a && a !== document.body ? a.outerHTML.slice(0, 120) : "body"; })()');
// the Net Loft (fixture Scene 5): Iris (DEX 55), two Dock Cultists (DEX 50, Fighting 40, Dodge 20, 2 attacks), Jonas, Mabel
async function netLoft(page, run) {
  const at = run.model.beats.findIndex((b) => /Net Loft/.test(b.title));
  let p = await fightOn(page, run, at);
  assert.deepStrictEqual(order(p), ['Iris Calder', 'Dock Cultist 1', 'Dock Cultist 2', 'Jonas Finch', 'Mabel Quill']);
  // Jonas and Mabel have no DEX: Start asks, and Start anyway starts
  await tap(page, '#fNext');
  await page.waitFor('document.querySelector("#fStartAnyway")', 3000);
  await tap(page, '#fStartAnyway');
  p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
  assert.strictEqual(p.fight.rows.find((r) => r.id === p.fight.turn).name, 'Iris Calder');
  return p;
}

describe('CoC melee on the target\'s row (step 6b Task 16), by real input', { skip: browserSkip() }, () => {

  for (const [w, h] of SIZES) {
    it(`${w}: with Iris acting, a held click on Dock Cultist 2's Fight Back, tap Iris's level, and the result line names the winner`, async () => {
      // every d10 a 3: a d100 of 33
      const run = await start('coc', { randomInt: () => 3 });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await netLoft(page, run);
        const c1 = named(p, 'Dock Cultist 1').id;
        const c2 = named(p, 'Dock Cultist 2').id;
        // NPCs show Fight Back as the default; PCs show both; the acting row shows none
        assert.deepStrictEqual(named(p, 'Dock Cultist 2').meleeButtons, [{ text: 'Fight Back', dflt: true }, { text: 'Dodge', dflt: false }]);
        assert.deepStrictEqual(named(p, 'Jonas Finch').meleeButtons, [{ text: 'Dodge', dflt: false }, { text: 'Fight Back', dflt: false }]);
        assert.deepStrictEqual(named(p, 'Iris Calder').meleeButtons, []);
        assert.strictEqual(named(p, 'Dock Cultist 2').meleeDice, '0');
        sane(p, `${w} with the buttons`);
        await shot(page, `t16-${w}-buttons`);

        // the cultist's Fighting 40 is rolled (33, Regular); Iris's level is a tap
        await tap(page, `[data-fmelee="${c2}|fightBack"]`);
        p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
        assert.match(await row2(page, c2), /Iris Calder:CriticalExtremeHardRegularFailFumble· Dock Cultist 2 Fights Back:Regular \(33\)Manoeuvre: compare Builds/);
        // the exchange's line wraps rather than clip: nothing past its right edge, ✕ in view
        assert.strictEqual(await page.evaluate(`(() => { const l = document.querySelector('li[data-row2=${q(c2)}]'); return l.scrollWidth > l.clientWidth + 1; })()`), false, 'line 2 clipped');
        assert.strictEqual(await page.evaluate(`(() => { const b = document.querySelector('[data-fmx=${q(c2)}]').getBoundingClientRect(); const l = document.querySelector('li[data-row2=${q(c2)}]').getBoundingClientRect(); return b.left >= l.left && b.right <= l.right; })()`), true, '✕ in view');
        sane(p, `${w} the exchange open`);
        await shot(page, `t16-${w}-exchange`);
        await tap(page, `[data-fmlvl="${c2}|attack|regular"]`);
        p = await until(page, `p.fight.melee === null && p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDefences === 1 && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder: Regular; Dock Cultist 2 Fights Back: Regular (33): a tie: Iris Calder hits Dock Cultist 2.']);
        // Task 17 changed this on purpose: a hit opens the damage box on the row hit, and focus goes to it
        await page.waitFor(`document.activeElement === document.querySelector('[data-fhp=${q(c2)}]')`, 3000);

        // two attacks: one defence leaves it at 1 of 2, no die yet
        assert.strictEqual(named(p, 'Dock Cultist 2').meleeDice, '0');
        assert.match(await row2(page, c2), /defended 1× of 2/);

        // the stepper adds and takes a die, and clears after the exchange. Task 38 changed this on purpose: the row holds
        // one dice button (± at none); a tap opens the stepper on the row's second line with focus on its +
        assert.deepStrictEqual([await text(page, `li[data-frow="${c2}"] [data-fmdopen]`), await page.evaluate(`Boolean(document.querySelector('li[data-frow="${c2}"] [data-fmdice]'))`)], ['\u00b1', false]);
        await tap(page, `[data-fmdopen="${c2}"]`);
        await page.waitFor(`document.activeElement === document.querySelector('[data-fmdice="${c2}|1"]')`, 3000);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('li[data-row2="${c2}"] [data-fmdice="${c2}|1"]'))`), true, 'the stepper is on line 2');
        await tap(page, `[data-fmdice="${c2}|1"]`);
        await tap(page, `[data-fmdice="${c2}|1"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDice === "+2"`);
        assert.strictEqual(await attrOf(page, `[data-fmdice="${c2}|1"]`, 'disabled'), '', 'no third bonus die');
        await tap(page, `[data-fmdice="${c2}|-1"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDice === "+1"`);
        await tap(page, `[data-fmdice="${c2}|1"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDice === "+2"`);
        await tap(page, `[data-fmelee="${c2}|dodge"]`);
        p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
        await tap(page, `[data-fmlvl="${c2}|attack|hard"]`);
        p = await until(page, `p.fight.melee === null && p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDefences === 2 && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder, +2 bonus dice (set by hand): Hard; Dock Cultist 2 Dodges: Fail (33): Iris Calder hits Dock Cultist 2.']);
        // the stepper's +2 is gone; its two defences spent, the row's own +1 (outnumbered) shows, with its note and switch
        assert.strictEqual(named(p, 'Dock Cultist 2').meleeDice, '+1');
        assert.match(await row2(page, c2), /defended 2× → next attack \+1 bonus die/);
        // one fixed label; pressed means never outnumbered
        assert.deepStrictEqual([await text(page, `[data-fmout="${c2}"]`), await attrOf(page, `[data-fmout="${c2}"]`, 'aria-pressed'), await attrOf(page, `[data-fmout="${c2}"]`, 'title')],
          ['never outnumbered', 'false', 'Tap if this one is never outnumbered']);
        await tap(page, `[data-fmout="${c2}"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).outnumberedOff === true && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(named(p, 'Dock Cultist 2').meleeDice, '0');
        assert.match(await row2(page, c2), /outnumbered off/);
        assert.deepStrictEqual([await text(page, `[data-fmout="${c2}"]`), await attrOf(page, `[data-fmout="${c2}"]`, 'aria-pressed')], ['never outnumbered', 'true']);
        sane(p, `${w} after two exchanges`);

        // a dismissed exchange writes no line and leaves the count
        const before = (await logOf(run)).length;
        await tap(page, `[data-fmelee="${c1}|dodge"]`);
        p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
        await tap(page, `[data-fmx="${c1}"]`);
        p = await until(page, 'p.fight.melee === null');
        p = await settled(page);
        assert.strictEqual((await logOf(run)).length, before);
        assert.strictEqual(named(p, 'Dock Cultist 1').meleeDefences, 0);

        // an Out row shows none
        await tap(page, `[data-fout="${c1}"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c1)}).out && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(named(p, 'Dock Cultist 1').meleeButtons, []);
        // and no Shoot (Task 19)
        assert.strictEqual(named(p, 'Dock Cultist 1').shoot, false);
        assert.strictEqual(named(p, 'Dock Cultist 2').shoot, true);
        sane(p, `${w} the end`);
      });
    });
  }

  it('a cultist attacks a PC: its roll with the dice, the PC\'s Dodge a tap; the round\'s start clears the count', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      await tap(page, '#fNext');
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0`);
      const iris = named(p, 'Iris Calder').id;
      assert.deepStrictEqual(named(p, 'Iris Calder').meleeButtons, [{ text: 'Dodge', dflt: false }, { text: 'Fight Back', dflt: false }]);
      await tap(page, `[data-fmelee="${iris}|dodge"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${iris}|defence|extreme"]`);
      p = await until(page, `p.fight.melee === null && p.fight.rows.find((r) => r.id === ${q(iris)}).meleeDefences === 1 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 1: Regular (33); Iris Calder Dodges: Extreme: Iris Calder dodges.']);
      // no hit, no damage box: focus stays on the response tapped
      assert.strictEqual(p.fight.dmg, null);
      assert.match(await focusOn(page), /data-fmelee/);
      // the next attacker on Iris gets the die: shown on her row before the roll
      await tap(page, '#fNext');
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 2" && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(named(p, 'Iris Calder').meleeDice, '+1');
      // round 2 starts: the count is 0 again
      for (const name of ['Jonas Finch', 'Mabel Quill', 'Iris Calder']) {
        await tap(page, '#fNext');
        p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === ${q(name)} && p.saved === "Saved" && p.pending === 0`);
      }
      assert.strictEqual(p.fight.round, 2);
      assert.strictEqual(named(p, 'Iris Calder').meleeDefences, 0);
      // Iris attacks Dock Cultist 1 (no dice of its own); another window makes it Prone while the exchange is open:
      // the dice stay as opened, and the line does not call them "set by hand"
      const c1 = named(p, 'Dock Cultist 1').id;
      await tap(page, `[data-fmelee="${c1}|fightBack"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await fromOther(run, [{ type: 'status', fight: p.fight.id, row: c1, add: 'Prone' }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c1)}).conds.includes("Prone") && p.fight.melee && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `[data-fmlvl="${c1}|attack|regular"]`);
      p = await until(page, `p.fight.melee === null && p.fight.rows.find((r) => r.id === ${q(c1)}).meleeDefences === 1 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder: Regular; Dock Cultist 1 Fights Back: Regular (33): a tie: Iris Calder hits Dock Cultist 1.']);
    });
  });
});

describe('CoC damage on the hit row (step 6b Task 17), by real input', { skip: browserSkip() }, () => {
  const boxOf = (id) => `[data-fhp="${id}"]`;
  const focused = (page, id) => page.waitFor(`document.activeElement === document.querySelector(${q(boxOf(id))})`, 3000);
  const valueOf = (page, id) => page.evaluate(`document.querySelector(${q(boxOf(id))}).value`);
  // Iris attacks `id`, which Fights Back (rolled 33 against Fighting 40, Regular); Iris's level a tap
  async function exchange(page, id, level) {
    await tap(page, `[data-fmelee="${id}|fightBack"]`);
    await until(page, 'p.fight.melee && !p.fight.melee.rolling');
    await tap(page, `[data-fmlvl="${id}|attack|${level}"]`);
    return until(page, 'p.fight.melee === null && p.fight.dmg && p.saved === "Saved" && p.pending === 0');
  }

  for (const [w, h] of SIZES) {
    it(`${w}: after Dock Cultist 2 wins a Fight Back, its damage box is open on Iris; Enter takes the remembered 1D6+DB; the working line shows`, async () => {
      // every die a 3: a d100 of 33, a 1D6 of 3, a 1D4 of 3
      const run = await start('coc', { randomInt: () => 3 });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await netLoft(page, run);
        const iris = named(p, 'Iris Calder').id;
        const c1 = named(p, 'Dock Cultist 1').id;
        const c2 = named(p, 'Dock Cultist 2').id;
        const hp0 = named(p, 'Iris Calder').hp;

        // Dock Cultist 1 wins: its box opens on Iris, empty (nothing remembered yet), focused, DB full
        p = await exchange(page, c1, 'fail');
        assert.deepStrictEqual([p.fight.dmg.on, p.fight.dmg.by, p.fight.dmg.entry, p.fight.dmg.mode, p.fight.dmg.offer], [iris, c1, '', 'full', false]);
        await focused(page, iris);
        assert.match(await row2(page, iris), /Dock Cultist 1's damage, DB \+1D4:fullhalfnone✕/);
        assert.strictEqual(await attrOf(page, `[data-fdmgdb="${iris}|full"]`, 'aria-pressed'), 'true');
        sane(p, `${w} the box open`);
        await shot(page, `t17-${w}-box`);
        await typeInto(page, boxOf(iris), '1D6+DB');
        p = await until(page, `p.fight.dmg === null && p.fight.rows.find((r) => r.id === ${q(iris)}).hp === ${hp0 - 6} && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder, hit by Dock Cultist 1: 1D6+1D4 = 3+3 = 6.']);
        assert.match(await row2(page, iris), /1D6\+1D4 = 3\+3 = 6/);

        // Dock Cultist 2, its group mate, wins: the box holds 1D6+DB and has focus; Enter alone takes it
        p = await exchange(page, c2, 'fail');
        assert.deepStrictEqual([p.fight.dmg.on, p.fight.dmg.by, p.fight.dmg.entry], [iris, c2, '1D6+DB']);
        await focused(page, iris);
        assert.strictEqual(await valueOf(page, iris), '1D6+DB');
        sane(p, `${w} the remembered entry`);
        await shot(page, `t17-${w}-remembered`);
        await page.key('Enter');
        p = await until(page, `p.fight.dmg === null && p.fight.rows.find((r) => r.id === ${q(iris)}).hp === ${Math.max(0, hp0 - 12)} && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder, hit by Dock Cultist 2: 1D6+1D4 = 3+3 = 6.']);
        assert.match(await focusOn(page), /data-fhp/);

        // Iris hits Dock Cultist 2 at Extreme on her turn: the offer, impaling off; a bare 7 is her total as rolled,
        // its armour 1 off
        p = await exchange(page, c2, 'extreme');
        assert.deepStrictEqual([p.fight.dmg.on, p.fight.dmg.by, p.fight.dmg.offer, p.fight.dmg.impale], [c2, iris, true, false]);
        assert.strictEqual(await attrOf(page, `[data-fdmgimp="${c2}"]`, 'aria-pressed'), 'false');
        assert.match(await row2(page, c2), /Iris Calder's damage, DB none:fullhalfnoneimpalingExtreme: max✕/);
        sane(p, `${w} the Extreme offer`);
        await shot(page, `t17-${w}-extreme`);
        await typeInto(page, boxOf(c2), '7');
        p = await until(page, `p.fight.dmg === null && p.fight.rows.find((r) => r.id === ${q(c2)}).hp === 6 && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 2, hit by Iris Calder: 7 − armour 1 = 6.']);
        assert.match(await row2(page, c2), /7 − armour 1 = 6/);
        sane(p, `${w} the end`);
      });
    });
  }

  it('the Extreme offer is one tap: impaling on, the weapon at its maximum and one more roll; a box left open shuts on the next turn', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      const c1 = named(p, 'Dock Cultist 1').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      p = await exchange(page, c1, 'extreme');
      assert.strictEqual(p.fight.dmg.offer, true);
      await typeInto(page, boxOf(c1), '1D8', { enter: false, settle: false });
      await tap(page, `[data-fdmgimp="${c1}"]`);
      p = await until(page, 'p.fight.dmg && p.fight.dmg.impale === true');
      await focused(page, c1);
      await tap(page, `[data-fdmgx="${c1}"]`);
      p = await until(page, `p.fight.dmg === null && p.fight.rows.find((r) => r.id === ${q(c1)}).hp === 2 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 1, hit by Iris Calder: Extreme, impaling: 1D8 at max = 8, +1D8 = 3: 11 − armour 1 = 10.']);
      assert.match(await focusOn(page), /data-fhp/);

      // Dock Cultist 2 wins on Iris; the box is left; Next: it is shut, and the reducer's record with it
      p = await exchange(page, c2, 'fail');
      assert.strictEqual(p.fight.dmg.on, iris);
      await tap(page, '#fNext');
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(p.fight.dmg, null);
      assert.doesNotMatch(await row2(page, iris), /damage/);
      const st = (await (await fetch(`${run.base}/api/state`)).json()).state;
      assert.strictEqual(st.fight.melee, null);

      // Dock Cultist 1's turn: it wins on Iris; while 5 is typed in her box, another window moves the turn on. The box
      // stays, marked over; Enter says so and applies nothing; Esc clears it
      await tap(page, `[data-fmelee="${iris}|fightBack"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${iris}|defence|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.on === ${q(iris)} && p.saved === "Saved" && p.pending === 0`);
      const hpIris = named(p, 'Iris Calder').hp;
      await typeInto(page, boxOf(iris), '5', { enter: false, settle: false });
      await fromOther(run, [{ type: 'fightNext', fight: p.fight.id, from: p.fight.turn, round: p.fight.round }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 2" && p.saved === "Saved" && p.pending === 0`);
      assert.match(await row2(page, iris), /that exchange is over, not applied: Esc or \u2715 to clear/);
      assert.strictEqual(await valueOf(page, iris), '5');
      await focused(page, iris);
      await page.key('Enter');
      await page.waitFor(`document.querySelector('#hnotes').textContent.includes('5: that exchange is over (the turn moved on), not applied: Esc or \u2715 to clear.')`, 3000);
      p = await settled(page);
      assert.strictEqual(named(p, 'Iris Calder').hp, hpIris);
      assert.strictEqual(await valueOf(page, iris), '5');
      await page.key('Escape');
      p = await until(page, 'p.fight.dmg === null');
      assert.strictEqual(await valueOf(page, iris), '');
      await focused(page, iris);

      // Dock Cultist 2 wins on Iris; 7 is typed, and another window moves the turn on (to Jonas): marked over. A new
      // exchange (Jonas and Dock Cultist 2) replaces it, and a note says the 7 went unapplied
      await tap(page, `[data-fmelee="${iris}|fightBack"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${iris}|defence|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.by === ${q(c2)} && p.saved === "Saved" && p.pending === 0`);
      await typeInto(page, boxOf(iris), '7', { enter: false, settle: false });
      await fromOther(run, [{ type: 'fightNext', fight: p.fight.id, from: p.fight.turn, round: p.fight.round }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Jonas Finch" && p.fight.dmg && p.fight.dmg.on === ${q(iris)} && p.saved === "Saved" && p.pending === 0`);
      assert.match(await row2(page, iris), /that exchange is over/);
      const jonas = named(p, 'Jonas Finch').id;
      await tap(page, `[data-fmelee="${c2}|fightBack"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${c2}|attack|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.on === ${q(jonas)} && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector('#hnotes').textContent.includes('Not sent: 7 (Iris Calder): that exchange is over.')`, 3000);
      assert.doesNotMatch(await row2(page, iris), /exchange is over/);
      assert.strictEqual(named(p, 'Iris Calder').hp, hpIris);

      // Dock Cultist 2's 1D4+DB on Jonas, remembered for its group; it wins again and its box opens holding that entry,
      // untouched; another window moves the turn on: the box shuts quietly and empties, nothing applied
      await typeInto(page, boxOf(jonas), '1D4+DB');
      p = await until(page, 'p.fight.dmg === null && p.saved === "Saved" && p.pending === 0');
      await tap(page, `[data-fmelee="${c2}|fightBack"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${c2}|attack|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.entry === "1D4+DB" && p.saved === "Saved" && p.pending === 0`);
      await focused(page, jonas);
      const hpJonas = named(p, 'Jonas Finch').hp;
      const notes = await text(page, '#hnotes');
      await fromOther(run, [{ type: 'fightNext', fight: p.fight.id, from: p.fight.turn, round: p.fight.round }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Mabel Quill" && p.fight.dmg === null && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector(${q(boxOf(jonas))}).value === ''`, 3000);
      assert.doesNotMatch(await row2(page, jonas), /exchange is over/);
      assert.strictEqual(await text(page, '#hnotes'), notes, 'no note');
      assert.strictEqual(named(p, 'Jonas Finch').hp, hpJonas);
    });
  });

  // Task 23b A1: a box whose exchange is over is judged on whether the GM typed in it, never on focus
  it('a damage box over: typed words keep it open, even unfocused; untouched or edited back it shuts quietly; the tap on its close shuts it', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      const jonas = named(p, 'Jonas Finch').id;
      const away = () => tap(page, '#acting h3');
      const wins = async (target, who, side) => {
        await tap(page, `[data-fmelee="${target}|fightBack"]`);
        await until(page, 'p.fight.melee && !p.fight.melee.rolling');
        await tap(page, `[data-fmlvl="${target}|${side}|fail"]`);
        return until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.on === ${q(who)} && p.saved === "Saved" && p.pending === 0`);
      };
      await tap(page, '#fNext');
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0`);

      // typed, then focus leaves, then the turn moves elsewhere: the box stays, marked over, the words kept; the close shuts it
      p = await wins(iris, iris, 'defence');
      const hpIris = named(p, 'Iris Calder').hp;
      await typeInto(page, boxOf(iris), '5', { enter: false, settle: false });
      await away();
      assert.doesNotMatch(await focusOn(page), /data-fhp/);
      await fromOther(run, [{ type: 'fightNext', fight: p.fight.id, from: p.fight.turn, round: p.fight.round }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 2" && p.saved === "Saved" && p.pending === 0`);
      assert.ok(p.fight.dmg && p.fight.dmg.on === iris, 'the box stays');
      assert.match(await row2(page, iris), /that exchange is over, not applied: Esc or \u2715 to clear/);
      assert.strictEqual(await valueOf(page, iris), '5');
      await tap(page, `[data-fdmgclose="${iris}"]`);
      p = await until(page, 'p.fight.dmg === null');
      assert.strictEqual(await valueOf(page, iris), '');
      assert.doesNotMatch(await row2(page, iris), /exchange is over/);
      assert.strictEqual(named(p, 'Iris Calder').hp, hpIris);

      // typed, focus leaves, a new exchange replaces it: its note carries the words
      p = await wins(iris, iris, 'defence');
      await typeInto(page, boxOf(iris), '7', { enter: false, settle: false });
      await away();
      await fromOther(run, [{ type: 'fightNext', fight: p.fight.id, from: p.fight.turn, round: p.fight.round }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Jonas Finch" && p.fight.dmg && p.fight.dmg.on === ${q(iris)} && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `[data-fmelee="${c2}|fightBack"]`);
      await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${c2}|attack|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.on === ${q(jonas)} && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector('#hnotes').textContent.includes('Not sent: 7')`, 3000);
      assert.doesNotMatch(await row2(page, iris), /exchange is over/);

      // untouched (the remembered entry), one letter typed and taken back, focus away: another window moves the turn, the box
      // shuts, and no note follows
      await typeInto(page, boxOf(jonas), '1D4+DB');
      p = await until(page, 'p.fight.dmg === null && p.saved === "Saved" && p.pending === 0');
      await tap(page, `[data-fmelee="${c2}|fightBack"]`);
      await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${c2}|attack|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.entry === "1D4+DB" && p.saved === "Saved" && p.pending === 0`);
      await tap(page, boxOf(jonas));
      await page.type('9');
      await page.key('Backspace');
      assert.strictEqual(await valueOf(page, jonas), '1D4+DB');
      await away();
      const hpJonas = named(p, 'Jonas Finch').hp;
      const notes = await text(page, '#hnotes');
      await fromOther(run, [{ type: 'fightNext', fight: p.fight.id, from: p.fight.turn, round: p.fight.round }]);
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Mabel Quill" && p.fight.dmg === null && p.saved === "Saved" && p.pending === 0`);
      await page.waitFor(`document.querySelector(${q(boxOf(jonas))}).value === ''`, 3000);
      assert.doesNotMatch(await row2(page, jonas), /exchange is over/);
      assert.strictEqual(await text(page, '#hnotes'), notes, 'no note, and none that says Esc');
      assert.strictEqual(named(p, 'Jonas Finch').hp, hpJonas);
    });
  });
});

describe('CoC cards on the GM page (step 6b Task 18), by real input', { skip: browserSkip() }, () => {
  const boxOf = (id) => `[data-fhp="${id}"]`;
  // Iris attacks `id`, which Fights Back (rolled 33 against Fighting 40, Regular); Iris's level a tap
  async function exchange(page, id, level) {
    await tap(page, `[data-fmelee="${id}|fightBack"]`);
    await until(page, 'p.fight.melee && !p.fight.melee.rolling');
    await tap(page, `[data-fmlvl="${id}|attack|${level}"]`);
    return until(page, 'p.fight.melee === null && p.fight.dmg && p.saved === "Saved" && p.pending === 0');
  }
  // both of the card's edges in the window and in the panel's own scroll box
  async function inView(page, card, label) {
    const e = await page.evaluate(`(() => { const c = document.querySelector(${q(card)}).getBoundingClientRect(); const a = document.querySelector('#acting').getBoundingClientRect();
      return { top: c.top, bottom: c.bottom, left: c.left, right: c.right, h: innerHeight, w: innerWidth, aTop: a.top, aBottom: a.bottom }; })()`);
    assert.ok(e.top >= 0 && e.bottom <= e.h && e.left >= 0 && e.right <= e.w && e.top >= e.aTop - 1 && e.bottom <= e.aBottom + 1, `${label}: ${JSON.stringify(e)}`);
  }

  for (const [w, h] of SIZES) {
    it(`${w}: the Cultist's 1D6+1D4 on Iris is a Major Wound: the card at the top of the panel names Iris and offers Passed and Failed for her player's CON roll, no Roll; a held click on Failed gives Prone and Unconscious`, async () => {
      // every die a 3: a d100 of 33, a 1D6 of 3, a 1D4 of 3
      const run = await start('coc', { randomInt: () => 3 });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await netLoft(page, run);
        const iris = named(p, 'Iris Calder').id;
        const c1 = named(p, 'Dock Cultist 1').id;
        // Dock Cultist 1 wins its Fight Back; its 1D6+1D4 of 6 on Iris's 11 HP is a Major Wound
        p = await exchange(page, c1, 'fail');
        await typeInto(page, boxOf(iris), '1D6+DB');
        const card = `#acting .fcard[data-fcrow="${iris}"]`;
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).hp === 3 && document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
        // the panel is still Iris's turn's; the card is its first child and names her
        assert.strictEqual(await page.evaluate('document.querySelector("#acting").firstElementChild.className'), 'fcards');
        assert.strictEqual(await text(page, `${card} .fch .nm`), 'Iris Calder');
        assert.strictEqual(await text(page, `${card} .fch .what`), '6 damage');
        assert.deepStrictEqual(await texts(page, `${card} .clines .lt`), ['Major wound: CON 60']);
        assert.deepStrictEqual(await texts(page, `${card} .taps button`), ['Passed', 'Failed']);
        assert.strictEqual(await page.evaluate(`document.querySelectorAll(${q(`${card} button.roll`)}).length`), 0, 'a PC\'s card never rolls');
        // the box ticked shows as its status; the strip says a card waits
        const strip = await texts(page, `li[data-frow="${iris}"] .chips > .chip, li[data-row2="${iris}"] .chip`);
        assert.ok(strip.includes('card waiting'), JSON.stringify(strip));
        assert.ok(strip.some((x) => /^Major wound/.test(x)), JSON.stringify(strip));
        await inView(page, card, `${w} the card`);
        sane(p, `${w} the card`);
        await shot(page, `t18-${w}-card`);
        await tap(page, `${card} button.fail`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).conds.includes("Unconscious") && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(named(p, 'Iris Calder').conds, ['Major wound', 'Prone', 'Unconscious']);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector(${q(card)}))`), false, 'the card goes');
        assert.deepStrictEqual((await logOf(run)).slice(-2), ['Iris Calder: Major wound, CON 60, failed.', 'Iris Calder: Major wound: Prone, Unconscious.']);
        // the card settled and went: focus goes to Iris's entry box, never the page
        await page.waitFor(`document.activeElement === document.querySelector(${q(boxOf(iris))})`, 3000);
        sane(p, `${w} after`);
      });
    });
  }

  it('an NPC with no CON: its card asks for CON in a box, Roll waits; CON typed, Roll rolls it', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      p = await addNew(page, 'Cultist');
      const id = named(p, 'Cultist').id;
      p = await typeInto(page, `[data-fmax="${id}"]`, 16);
      p = await typeInto(page, `[data-fhp="${id}"]`, '-8');
      const card = `#acting .fcard[data-fcrow="${id}"]`;
      p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
      // the probe carries no CON: the server's state does
      const conOf = async () => (await (await fetch(`${run.base}/api/state`)).json()).state.fight.rows.find((r) => r.id === id).con;
      assert.strictEqual(await conOf(), null);
      assert.deepStrictEqual(await texts(page, `${card} .clines .lt`), ['Major wound: CON ?']);
      const stat = `${card} [data-fcardstat="${id}|con"]`;
      assert.strictEqual(await text(page, `${card} .cht .lab`), 'CON');
      assert.strictEqual(await attrOf(page, `${card} button.roll`, 'disabled'), '', 'Roll waits for CON');
      assert.strictEqual(await attrOf(page, `${card} button.roll`, 'title'), 'Type CON first');
      await inView(page, card, 'the CON box card');
      p = await typeInto(page, stat, '50');
      await page.waitFor(`document.querySelector(${q(`${card} button.roll`)}) && !document.querySelector(${q(`${card} button.roll`)}).disabled`, 3000);
      assert.strictEqual(await page.evaluate(`Boolean(document.querySelector(${q(stat)}))`), false, 'the box goes once CON is known');
      assert.deepStrictEqual(await texts(page, `${card} .clines .lt`), ['Major wound: CON 50']);
      assert.strictEqual(await conOf(), 50);
      await tap(page, `${card} button.roll`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(id)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Cultist: Major wound, CON 50, rolled 33, Regular.']);
      assert.deepStrictEqual(await texts(page, `${card} .clines .offer`), ['Prone']);
      sane(p, 'the CON box');
    });
  });

  // Task 23b B11: the longest offer's label inside its card, both edges, at every width
  for (const [w, h] of SIZES) {
    it(`${w}: the "Dying, Unconscious, Prone" offer sits inside its card, both edges in the panel and the window`, async () => {
      const run = await start('coc', { randomInt: () => 3 });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await fightOn(page, run, 0);
        p = await addNew(page, 'Cultist');
        const id = named(p, 'Cultist').id;
        p = await typeInto(page, `[data-fmax="${id}"]`, 16);
        p = await typeInto(page, `[data-fhp="${id}"]`, '-16');
        const card = `#acting .fcard[data-fcrow="${id}"]`;
        p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
        const offer = `${card} .clines .offer`;
        assert.ok((await texts(page, offer)).includes('Dying, Unconscious, Prone'), JSON.stringify(await texts(page, offer)));
        const e = await page.evaluate(`(() => { const c = document.querySelector(${q(card)}).getBoundingClientRect(); const a = document.querySelector('#acting').getBoundingClientRect();
          const o = Array.from(document.querySelectorAll(${q(offer)})).find((b) => b.textContent === 'Dying, Unconscious, Prone'); o.scrollIntoView({ block: 'nearest' });
          const r = o.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: innerHeight, w: innerWidth, c: { top: c.top, bottom: c.bottom, left: c.left, right: c.right }, a: { top: a.top, bottom: a.bottom } }; })()`);
        assert.ok(e.left >= e.c.left - 1 && e.right <= e.c.right + 1 && e.top >= e.c.top - 1 && e.bottom <= e.c.bottom + 1 && e.left >= 0 && e.right <= e.w && e.top >= e.a.top - 1 && e.bottom <= e.a.bottom + 1, `${w}: ${JSON.stringify(e)}`);
      });
    });
  }

  // Task 23b B11: the fight ends while the bout's rounds are out: nothing is applied and the page carries on
  it('a fight that ends while the bout is being rolled applies no bout and leaves no error', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    const handlers = run.server.listeners('request');
    let slow = 0;
    run.server.removeAllListeners('request');
    run.server.on('request', (req, res) => {
      const go = () => handlers.forEach((hd) => hd.call(run.server, req, res));
      if (slow && req.url === '/api/roll') setTimeout(go, slow); else go();
    });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      await typeInto(page, boxOf(iris), 's-6');
      const icard = `#acting .fcard[data-fcrow="${iris}"]`;
      p = await until(page, `document.querySelector(${q(icard)}) && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `${icard} button.pass`);
      await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
      slow = 800;
      await tap(page, `${icard} .clines .offer`);
      await fromOther(run, [{ type: 'fightEnd', fight: p.fight.id }]);
      await page.waitFor(`JSON.parse(document.body.dataset.probe).fight === null`, 5000);
      await page.sleep(1200);
      slow = 0;
      p = await settled(page);
      assert.deepStrictEqual(p.errors, []);
      assert.ok(!(await logOf(run)).some((t) => /bout of/.test(t)), 'no bout started');
      assert.match(await text(page, '#hnotes'), /Bout of madness for Iris Calder rolled 3, but that fight has ended: not applied\./);
    });
  });

  it('an NPC\'s card is rolled; a PC\'s SAN loss brings the INT card, and Temporary insanity starts the bout the server rolls, shown on the row', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      // Iris's 7 on Dock Cultist 2 is 6 after its armour: a Major Wound on its 12 HP
      p = await exchange(page, c2, 'regular');
      await typeInto(page, boxOf(c2), '7');
      const card = `#acting .fcard[data-fcrow="${c2}"]`;
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).hp === 6 && document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(await texts(page, `${card} .clines .lt`), ['Major wound: CON 55']);
      assert.strictEqual(await page.evaluate(`document.querySelectorAll(${q(`${card} .taps`)}).length`), 0, 'an NPC has no Passed and Failed');
      await inView(page, card, 'the NPC card');
      await tap(page, `${card} button.roll`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(await texts(page, `${card} .clines .offer`), ['Prone']);
      assert.deepStrictEqual(named(p, 'Dock Cultist 2').conds, ['Major wound'], 'offered, not applied');
      await tap(page, `${card} .clines .offer`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).conds.includes("Prone") && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-2), ['Dock Cultist 2: Major wound, CON 55, rolled 33, Regular.', 'Dock Cultist 2: Major wound: Prone.']);

      // s-6 on Iris: the INT card; Passed offers Temporary insanity; its tap rolls the bout (a 3) and the row shows it
      await typeInto(page, boxOf(iris), 's-6');
      const icard = `#acting .fcard[data-fcrow="${iris}"]`;
      p = await until(page, `document.querySelector(${q(icard)}) && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(await texts(page, `${icard} .clines .lt`), ['SAN loss: INT 75']);
      assert.strictEqual(await text(page, `${icard} .fch .cite`), 'bout tables: KR p157');
      await tap(page, `${icard} button.pass`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `${icard} .clines .offer`);
      p = await until(page, `(p.fight.rows.find((r) => r.id === ${q(iris)}).cards || []).length === 0 && p.saved === "Saved" && p.pending === 0`);
      const st = (await (await fetch(`${run.base}/api/state`)).json()).state;
      assert.deepStrictEqual(st.fight.rows.find((r) => r.id === iris).bout, { left: 3, of: 3, from: 1 });
      assert.deepStrictEqual((await logOf(run)).slice(-2), ['Iris Calder: SAN loss, INT 75, passed.', 'Iris Calder: SAN loss: Temporary insanity, a bout of 3 rounds.']);
      const strip = await texts(page, `li[data-frow="${iris}"] .chips > .chip, li[data-row2="${iris}"] .chip`);
      assert.ok(strip.includes('bout: 3 rounds'), JSON.stringify(strip));
      sane(p, 'the bout');
      // the players' screen gets the status, never the bout or a card
      const pv = JSON.stringify(await (await fetch(`${run.base}/api/players/view`)).json());
      assert.match(pv, /Temporary insanity/);
      assert.doesNotMatch(pv, /"bout"|"cards"|bout: |card waiting/);
    });
  });
});

describe('CoC firearms on the GM page (step 6b Task 19), by real input', { skip: browserSkip() }, () => {
  // the server's d10s in a fixed cycle
  const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
  const re = (t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  for (const [w, h] of SIZES) {
    it(`${w}: Shoot on the Cultist's row, long range, point blank, roll: the level against Hard is shown with both tens dice`, async () => {
      // the d10s 1, 4, 2: tens 10 and 40, units 2: a d100 of 12 with a bonus die
      const run = await start('coc', { randomInt: seq(1, 4, 2) });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await netLoft(page, run);
        // Iris acting (a PC: the player rolls): Shoot on every other live row, none on hers; her aim beside
        assert.deepStrictEqual(p.fight.rows.filter((r) => r.shoot).map((r) => r.name), ['Dock Cultist 1', 'Dock Cultist 2', 'Jonas Finch', 'Mabel Quill']);
        assert.deepStrictEqual([named(p, 'Iris Calder').shoot, named(p, 'Iris Calder').aimButton], [false, true]);
        sane(p, `${w} Shoot on the rows`);
        await shot(page, `t19-${w}-rows`);

        await tap(page, '#fNext');
        p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0');
        assert.deepStrictEqual(named(p, 'Dock Cultist 1').guns, ['Flintlock pistol']);
        assert.deepStrictEqual(p.fight.rows.filter((r) => r.shoot).map((r) => r.name), ['Iris Calder', 'Dock Cultist 2', 'Jonas Finch', 'Mabel Quill']);
        sane(p, `${w} Shoot on the rows, a cultist acting`);
        const c1 = named(p, 'Dock Cultist 1').id;
        const c2 = named(p, 'Dock Cultist 2').id;
        await tap(page, `[data-fshoot="${c2}"]`);
        p = await until(page, `p.fight.shot && p.fight.shot.target === ${q(c2)}`);
        // the flintlock's malfunction number is in its box, from the weapon line
        assert.deepStrictEqual([p.fight.shot.shooter, p.fight.shot.gun, p.fight.shot.mal, p.fight.shot.chips], [c1, 0, '95', []]);
        await tap(page, `[data-fshr="${c2}|long"]`);
        await tap(page, `[data-fshc="${c2}|pointBlank"]`);
        p = await until(page, 'p.fight.shot && p.fight.shot.chips.join() === "long,pointBlank"');
        assert.match(await row2(page, c2), /Dock Cultist 1 shoots, Flintlock pistol, Firearms 30:/);
        assert.match(await row2(page, c2), /Hard, \+1 bonus die/);
        // the strip wraps rather than clip: nothing past its right edge, ✕ in view
        assert.strictEqual(await page.evaluate(`(() => { const l = document.querySelector('li[data-row2=${q(c2)}]'); return l.scrollWidth > l.clientWidth + 1; })()`), false, 'line 2 clipped');
        assert.strictEqual(await page.evaluate(`(() => { const b = document.querySelector('[data-fshx=${q(c2)}]').getBoundingClientRect(); const l = document.querySelector('li[data-row2=${q(c2)}]').getBoundingClientRect(); return b.left >= l.left && b.right <= l.right; })()`), true, '✕ in view');
        // the strip's chips grouped under short headings; Build 1 decides the size: one note, no size chips
        assert.match(await row2(page, c2), /range:regularlongvery longtarget:size \(Build 1\)pronecoverfastshooter:aimedproneloadingpoint blankinto melee2-3 shots/);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('[data-fshc=${q(`${c2}|large`)}]'))`), false);
        const lines = await page.evaluate(`(() => { const x = document.querySelector('li[data-row2=${q(c2)}] .sx'); const tops = []; for (const e of x.querySelectorAll('button, input, .mnote, .mres, .sxh, :scope > span:not(.sxg):not(.mlv)')) { const t = Math.round(e.getBoundingClientRect().top); if (!tops.some((v) => Math.abs(v - t) < 6)) tops.push(t); } return tops.length; })()`);
        // Task 38 changed this on purpose: the order is narrower (893 px on the Hollow Quay fight, the run list open at
        // 1449), so the strip has less room and may take a third line; it still wraps, never clips
        assert.ok(lines <= 3, `${w}: the strip takes ${lines} lines`);
        sane(p, `${w} the strip open`);
        await shot(page, `t19-${w}-strip`);

        await tap(page, `[data-fshroll="${c2}"]`);
        p = await until(page, 'p.fight.shot && p.fight.shot.last && !p.fight.shot.rolling && p.fight.dmg && p.saved === "Saved" && p.pending === 0');
        const want = 'Dock Cultist 1 shoots Dock Cultist 2 (long range, point blank), +1 bonus die: Firearms 30 at Hard (15): rolled 12 (tens 10, 40): Hard: a hit.';
        assert.deepStrictEqual((await logOf(run)).slice(-1), [want]);
        assert.match(await row2(page, c2), re(want));
        // a shot is no melee defence; the flintlock's counter is on the shooter's row; the damage box has its dice, no DB
        assert.strictEqual(named(p, 'Dock Cultist 2').meleeDefences, 0);
        assert.deepStrictEqual(named(p, 'Dock Cultist 1').reload, [{ gun: 0, weapon: 'Flintlock pistol', left: 4, of: 4 }]);
        assert.strictEqual(await text(page, `[data-freload="${c1}|0"]`), 'Flintlock pistol: ready again in 4 rounds');
        assert.strictEqual(await attrOf(page, `[data-freload="${c1}|0"]`, 'title'), 'Tap: ready now');
        assert.deepStrictEqual([p.fight.dmg.on, p.fight.dmg.by, p.fight.dmg.entry, p.fight.dmg.mode], [c2, c1, '1D6+1', 'none']);
        sane(p, `${w} after the shot`);
        await shot(page, `t19-${w}-shot`);
        // the counter, tapped: ready now, logged
        await tap(page, `[data-freload="${c1}|0"]`);
        p = await until(page, `!p.fight.rows.find((r) => r.id === ${q(c1)}).reload && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 1: ready.']);
      });
    });
  }

  it('a dive, a PC\'s shot tapped, the lost attacks on the diver\'s turn, a flintlock that never impales, and the aim', async () => {
    // every d100 a 05
    const run = await start('coc', { randomInt: seq(0, 5) });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      // Iris shoots; the cultist dives: its Dodge 20 rolled, 05, a pass: a penalty die on the shot
      await tap(page, `[data-fshoot="${c2}"]`);
      p = await until(page, 'p.fight.shot');
      await tap(page, `[data-fshdive="${c2}"]`);
      p = await until(page, `p.fight.shot && p.fight.shot.dive && p.fight.rows.find((r) => r.id === ${q(c2)}).lostAttack && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 2 dives for cover: Dodge rolled 5, Hard: a penalty die on the shot; loses its next 2 attacks.']);
      assert.strictEqual(named(p, 'Dock Cultist 2').meleeDefences, 0);
      // Iris's level is a tap: no Roll and no malfunction box for a PC; the dive taken once this turn, even reopened
      assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('[data-fshroll=${q(c2)}]') || document.querySelector('[data-fshmal=${q(c2)}]'))`), false);
      await tap(page, `[data-fshoot="${c2}"]`);
      p = await until(page, '!p.fight.shot');
      await tap(page, `[data-fshoot="${c2}"]`);
      p = await until(page, 'p.fight.shot && p.fight.shot.dive');
      assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('[data-fshdive=${q(c2)}]'))`), false, 'no second dive');
      // a status set in another window while the strip is open turns its Prone chip on
      await fromOther(run, [{ type: 'status', fight: p.fight.id, row: c2, add: 'Prone' }]);
      p = await until(page, 'p.fight.shot && p.fight.shot.chips.includes("proneTarget") && p.saved === "Saved" && p.pending === 0');
      await fromOther(run, [{ type: 'status', fight: p.fight.id, row: c2, remove: 'Prone' }]);
      p = await until(page, 'p.fight.shot && !p.fight.shot.chips.includes("proneTarget") && p.saved === "Saved" && p.pending === 0');
      await tap(page, `[data-fshlvl="${c2}|regular"]`);
      p = await until(page, 'p.fight.shot && p.fight.shot.last && p.saved === "Saved" && p.pending === 0');
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder shoots Dock Cultist 2 (dived for cover), −1 penalty die: Regular needed: Regular: a hit.']);
      assert.strictEqual(p.fight.dmg.on, c2);
      sane(p, 'after the dive and the shot');

      // the aim: declared on her turn, then a move takes it, logged
      await tap(page, `[data-faim="${iris}"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).aiming && p.saved === "Saved" && p.pending === 0`);
      assert.match(await row2(page, iris), /aiming/);
      await tap(page, `[data-faimoff="${iris}"]`);
      p = await until(page, `!p.fight.rows.find((r) => r.id === ${q(iris)}).aiming && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder: moves, the aim is lost.']);

      // Dock Cultist 1 shoots Iris: 05 against the flintlock's 30 is Extreme on its turn, but the flintlock never impales
      await tap(page, '#fNext');
      p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0');
      assert.match(await row2(page, c2), /dived for cover: loses its next 2 attacks/);
      await tap(page, `[data-fshoot="${iris}"]`);
      p = await until(page, 'p.fight.shot');
      await tap(page, `[data-fshroll="${iris}"]`);
      p = await until(page, `p.fight.shot && p.fight.shot.last && p.fight.dmg && p.fight.dmg.on === ${q(iris)} && p.saved === "Saved" && p.pending === 0`);
      assert.match((await logOf(run)).slice(-1)[0], /rolled 5: Extreme: a hit\.$/);
      assert.deepStrictEqual([p.fight.dmg.offer, p.fight.dmg.impale, p.fight.dmg.entry], [true, false, '1D6+1']);
      assert.strictEqual(await attrOf(page, `[data-fdmgimp="${iris}"]`, 'disabled'), '', 'the impaling toggle cannot be turned on');
      assert.strictEqual(await attrOf(page, `[data-fdmgimp="${iris}"]`, 'title'), 'This weapon never impales');
      sane(p, 'the flintlock\'s Extreme');

      // the diver's next turn: its lost attacks shown on it; gone when the turn ends
      await tap(page, '#fNext');
      p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 2" && p.saved === "Saved" && p.pending === 0');
      assert.deepStrictEqual(named(p, 'Dock Cultist 2').lostAttack, { attacks: 2, on: true });
      assert.match(await row2(page, c2), /loses all 2 attacks: dived for cover/);
      sane(p, 'the lost attacks on the diver\'s turn');
      await tap(page, '#fNext');
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Jonas Finch" && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(named(p, 'Dock Cultist 2').lostAttack, null);
    });
  });
});

describe("the end panel's vitals columns per system (step 6b Task 20), by real input", { skip: browserSkip() }, () => {
  const IRIS = 'Characters/PCs/Iris Calder.md';
  const ORRIN = 'Characters/PCs/Orrin Tate.md';
  const saved = async (run) => (await (await fetch(`${run.base}/api/state`)).json()).state.end.vitals;
  const heads = (page) => texts(page, '#sheet table.vt thead th');
  // the vitals table is whole inside the sheet's width, with no sideways scroll of its own or the page's
  const fits = (page) => page.evaluate(`(() => { const s = document.querySelector('#sheet').getBoundingClientRect();
    const tw = document.querySelector('#sheet .vt').closest('.tw'); const w = tw.getBoundingClientRect();
    return w.left >= s.left - 1 && w.right <= s.right + 1 && tw.scrollWidth <= tw.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; })()`);
  // a click at the box's right end puts the caret after its figure; Backspace takes the figure off, then the new one
  // is typed and Tab leaves the box (its change saves it)
  const typeVital = async (page, sel, v) => {
    const r = await page.box(sel);
    const at = await page.click(sel, { offsetX: r.width - 3 });
    assert.ok(at.inView && at.hit, `click ${sel}: ${JSON.stringify(at)}`);
    await page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 2000);
    const n = await page.evaluate(`document.querySelector(${q(sel)}).value.length`);
    for (let i = 0; i < n; i++) await page.key('Backspace');
    assert.strictEqual(await page.evaluate(`document.querySelector(${q(sel)}).value`), '', sel);
    await page.type(String(v));
    await page.key('Tab');
  };

  for (const [w, h] of SIZES) {
    it(`CoC at ${w}: HP, MP, SAN, Luck, then Conditions under them; typed figures saved; an HP over the sheet's max refused, kept and never saved`, async () => {
      const run = await start('coc');
      await withPage({ width: w, height: h }, async (page) => {
        await page.focusEvents();
        await page.goto(`${run.base}/?probe=1`);
        await settled(page);
        assert.deepStrictEqual(await heads(page), ['Who', 'HP', 'MP', 'SAN', 'Luck']);
        // Conditions has a line of its own under each row's figures
        assert.ok(await page.evaluate(`Boolean(document.querySelector('#sheet .vt tr.vc [data-vcond=${q(IRIS)}]'))`));
        assert.ok(await fits(page), `the vitals table fits at ${w}`);
        const mp = `#sheet [data-vkey="${IRIS}|mp"]`;
        await typeVital(page, mp, '10');
        await settled(page);
        await typeVital(page, `#sheet [data-vkey="${IRIS}|san"]`, '48');
        await settled(page);
        await typeVital(page, `#sheet [data-vkey="${IRIS}|luck"]`, '50');
        await settled(page);
        let v = (await saved(run))[IRIS];
        assert.deepStrictEqual([v.mp, v.san, v.luck], [10, 48, 50]);
        // HP and MP show their max beside the box
        assert.match(await page.evaluate(`document.querySelector('#sheet [data-vhp=${q(IRIS)}]').parentElement.textContent`), /\/ 11/);
        assert.match(await page.evaluate(`document.querySelector(${q(mp)}).parentElement.textContent`), /\/ 13/);
        // HP 12 on an 11 sheet: marked, kept as typed, not saved
        const hp = `#sheet [data-vhp="${IRIS}"]`;
        await typeVital(page, hp, '12');
        await page.waitFor(`document.querySelector(${q(hp)}).getAttribute('aria-invalid') === 'true'`, 3000);
        assert.strictEqual(await page.evaluate(`document.querySelector(${q(hp)}).value`), '12');
        assert.strictEqual(await text(page, '#sheet .vt .badnum'), "HP 12: over the sheet's max (11): not saved");
        assert.ok(await fits(page), `the message fits at ${w}`);
        await page.sleep(300);
        v = (await saved(run))[IRIS];
        assert.strictEqual(v.hp, undefined, 'never saved');
        // another window's change redraws the page: the refused figure is still there as typed
        await fromOther(run, [{ type: 'endSet', advancement: 'one line' }]);
        await until(page, 'p.saved === "Saved"');
        await page.sleep(400);
        assert.strictEqual(await page.evaluate(`document.querySelector(${q(hp)}).value`), '12');
        // the saved HP changed by another route (another window sets 8): the refused 12 goes, the box shows what is saved
        await fromOther(run, [{ type: 'endSet', vitals: { [IRIS]: { hp: 8 } } }]);
        await page.waitFor(`document.querySelector(${q(hp)}).value === '8'`, 3000);
        assert.strictEqual(await page.evaluate(`document.querySelector(${q(hp)}).getAttribute('aria-invalid')`), null);
        assert.strictEqual(await text(page, '#sheet .vt .badnum'), null);
        // a figure in range clears the mark and is saved
        await typeVital(page, hp, '9');
        await settled(page);
        assert.strictEqual((await saved(run))[IRIS].hp, 9);
        assert.strictEqual(await page.evaluate(`document.querySelector(${q(hp)}).getAttribute('aria-invalid')`), null);
        assert.ok(await fits(page), `still fits at ${w}`);
      });
    });
  }

  // Task 31 (proof finding 3): a click into a prefilled box selects its number, as the fight's boxes do, so typing 50
  // into Luck 55 gives 50 and not 5550. No Backspace here: the click alone must do it.
  const clickType = async (page, sel, v) => {
    const at = await page.click(sel);
    assert.ok(at.inView && at.hit, `click ${sel}: ${JSON.stringify(at)}`);
    await page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 2000);
    await page.type(String(v));
    await page.key('Tab');
  };

  it('CoC: a click into Luck, SAN and MP selects the number; Luck 100 is refused, kept as typed and never saved; Luck 99 is saved', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const luck = `#sheet [data-vkey="${IRIS}|luck"]`;
      const san = `#sheet [data-vkey="${IRIS}|san"]`;
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(luck)}).value`), '55');
      await clickType(page, luck, '50');
      await settled(page);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(luck)}).value`), '50');
      await clickType(page, san, '48');
      await settled(page);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(san)}).value`), '48');
      let v = (await saved(run))[IRIS];
      assert.deepStrictEqual([v.san, v.luck], [48, 50]);
      // 100: refused as SAN's over-the-max is
      await clickType(page, luck, '100');
      await page.waitFor(`document.querySelector(${q(luck)}).getAttribute('aria-invalid') === 'true'`, 3000);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(luck)}).value`), '100');
      assert.strictEqual(await text(page, '#sheet .vt .badnum'), "Luck 100: over Luck's ceiling (99): not saved");
      await page.sleep(300);
      assert.strictEqual((await saved(run))[IRIS].luck, 50, 'the refused 100 is never saved');
      // 99: accepted, the mark gone
      await clickType(page, luck, '99');
      await settled(page);
      v = (await saved(run))[IRIS];
      assert.strictEqual(v.luck, 99);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(luck)}).getAttribute('aria-invalid')`), null);
    });
  });

  it('CoC: Tab from SAN into Luck selects its number: typing 50 gives 50, not 5550', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const luck = `#sheet [data-vkey="${IRIS}|luck"]`;
      const san = `#sheet [data-vkey="${IRIS}|san"]`;
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(luck)}).value`), '55');
      await tap(page, san);
      await page.waitFor(`document.activeElement === document.querySelector(${q(san)})`, 2000);
      await page.key('Tab');
      await page.waitFor(`document.activeElement === document.querySelector(${q(luck)})`, 2000);
      await page.type('50');
      await page.key('Tab');
      await settled(page);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(luck)}).value`), '50');
      assert.strictEqual((await saved(run))[IRIS].luck, 50);
    });
  });

  it('GURPS: a click into FP selects the number', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const fp = `#sheet [data-vkey="${ORRIN}|fp"]`;
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(fp)}).value`), '11');
      await clickType(page, fp, '7');
      await settled(page);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(fp)}).value`), '7');
      assert.strictEqual((await saved(run))[ORRIN].fp, 7);
    });
  });

  it('GURPS: HP and FP, then Conditions; HP -3 and FP below 0 saved, FP over its max refused', async () => {
    const run = await start('gurps');
    for (const [w, h] of SIZES) {
      await withPage({ width: w, height: h }, async (page) => {
        await page.focusEvents();
        await page.goto(`${run.base}/?probe=1`);
        await settled(page);
        assert.deepStrictEqual(await heads(page), ['Who', 'HP', 'FP'], String(w));
        assert.ok(await fits(page), `the vitals table fits at ${w}`);
      });
    }
    await withPage({ width: 1100, height: 762 }, async (page) => {
      await page.focusEvents();
      await page.goto(`${run.base}/?probe=1`);
      await settled(page);
      const hp = `#sheet [data-vhp="${ORRIN}"]`;
      const fp = `#sheet [data-vkey="${ORRIN}|fp"]`;
      await typeVital(page, hp, '-3');
      await settled(page);
      await typeVital(page, fp, '-2');
      await settled(page);
      let v = (await saved(run))[ORRIN];
      assert.deepStrictEqual([v.hp, v.fp], [-3, -2]);
      await typeVital(page, fp, '12');
      await page.waitFor(`document.querySelector(${q(fp)}).getAttribute('aria-invalid') === 'true'`, 3000);
      await page.sleep(300);
      v = (await saved(run))[ORRIN];
      assert.strictEqual(v.fp, -2, 'the refused 12 is never saved');
    });
  });
});

// The page says nothing in D&D's words (step 6b Task 22). Real input throughout; the probe only reads the DOM.
describe('CoC and GURPS pages speak their own system (step 6b Task 22), by real input', { skip: browserSkip() }, () => {
  const DND = /\bAC\b|initiative modifier|stat-fill|Long rest|milestone|temp HP|death save|Exhaustion|Concentrat|Bloodied/i;
  // what a reader sees and hears: the text, and every title, placeholder and label the markup carries
  const said = (page) => page.evaluate(`(() => {
    const out = [document.body.innerText];
    for (const e of document.querySelectorAll('[title],[placeholder],[aria-label],option,summary')) {
      for (const a of ['title', 'placeholder', 'aria-label']) if (e.getAttribute(a)) out.push(e.getAttribute(a));
      out.push(e.textContent);
    }
    return out.join('\\n');
  })()`);
  const noDnd = async (page, where) => {
    const t = await said(page);
    const m = DND.exec(t);
    assert.ok(!m, `${where}: "${m && m[0]}" in ${m && t.slice(Math.max(0, m.index - 60), m.index + 60)}`);
  };
  for (const [which, at, line, advance] of [
    ['coc', 0, /HP \d+\/\d+ · MP \d+ · SAN \d+ · DEX \d+/, 'One line each, e.g. skill checks to roll'],
    ['gurps', 1, /HP \d+\/\d+ · FP \d+\/\d+ · Speed [\d.]+/, 'One line each, e.g. 3 character points'],
  ]) {
    it(`${which === 'gurps' ? 'GURPS' : 'CoC'}: prep notes, the PCs table, a fight, the panel, the end of the night and the players' screen hold no D&D word`, async () => {
      for (const [width, height] of SIZES) {
        const run = await start(which);
        await withPage({ width, height }, async (page) => {
          await page.goto(`${run.base}/?probe=1`);
          await settled(page);
          await tap(page, '#prep summary');
          await noDnd(page, `${which} ${width} prep notes and the sheet`);
          const pcs = await text(page, '#pcs');
          assert.match(pcs, line, `${which}: the PC line`);
          assert.ok(!/AC |Init /.test(pcs), `${which}: ${pcs}`);
          assert.strictEqual(await attrOf(page, '#advance', 'placeholder'), advance);
          assert.strictEqual(await page.evaluate('document.querySelector("#longRest")'), null, 'no long rest button');
          // each panel the brief names, opened by a real click, then the pattern over the page
          const key = run.model.beats[at].key;
          // as a GM gets to a beat: the rail's link scrolls it, then both edges of its header must be below the sticky bar
          await tap(page, `[data-go="beat:${key}"]`);
          const bh = `[id="beat:${key}"] .bh`;
          const edges = await page.evaluate(`(() => { const r = document.querySelector(${q(bh)}).getBoundingClientRect(); const top = document.querySelector('.top').getBoundingClientRect().bottom; return { top: r.top, bottom: r.bottom, bar: top, h: innerHeight }; })()`);
          assert.ok(edges.top >= edges.bar && edges.bottom <= edges.h, `${which} ${width}: the beat header sits below the sticky bar ${JSON.stringify(edges)}`);
          await tap(page, bh);
          const fold = `[id="beat:${key}"] details[data-fold] > summary`;
          assert.ok(await page.evaluate(`Boolean(document.querySelector(${q(fold)}))`), `${which}: the beat has a fold to open`);
          await tap(page, fold);
          await page.waitFor(`document.querySelector(${q(fold)}).parentElement.open`, 3000);
          await noDnd(page, `${which} ${width} Who's here (the beat's panel)`);
          assert.ok(/Who's here/.test(await text(page, `[id="beat:${key}"]`)), `${which}: the beat shows Who's here`);
          await tap(page, '[data-go="end"]');
          await page.waitFor('document.querySelector("#end") && document.querySelector("#end").getBoundingClientRect().height > 0', 3000);
          await noDnd(page, `${which} ${width} End of the night`);
          assert.ok(/Advancement/.test(await text(page, '#end')), `${which}: the End of the night panel is open`);
          let p = await fightOn(page, run, at);
          sane(p, `${which} ${width} words`);
          const first = p.fight.rows[0];
          await peek(page, p, first.name);
          await noDnd(page, `${which} ${width} the fight and its panel`);
          await page.goto(`${run.base}/players?probe=1`);
          await page.waitFor('document.body.innerText.length > 0', 5000);
          await noDnd(page, `${which} ${width} the players' screen`);
        });
      }
    });
  }
});

// ---- step 6b Task 23: Tab walks (D2), rows that hold still while typed (D3c), reaching a blank row (D3a) and Same for
// all field by field (D3), in CoC and GURPS. D&D's are in run-sheet-layout-browser.test.js.
describe('Tab, held rows and Same for all in CoC and GURPS (step 6b Task 23), by real input', { skip: browserSkip() }, () => {
  const AT = { coc: 0, gurps: 1 };
  const W = (which) => (which === 'gurps' ? 'GURPS' : 'CoC');
  // "+ New" with a count: the count box first, then the name
  async function addMany(page, name, n) {
    await tap(page, '#fAddCount');
    await page.type(String(n));
    await tap(page, '#fAddName');
    await page.type(name);
    await page.waitFor('document.querySelector("[data-faddnew]")');
    await tap(page, '[data-faddnew]');
    return until(page, `p.fight.rows.filter((r) => r.name.startsWith(${q(`${name} `)})).length === ${n} && p.saved === "Saved" && p.pending === 0`);
  }
  async function startNow(page) {
    await tap(page, '#fNext');
    await page.waitFor('document.querySelector("#fStartAnyway") || JSON.parse(document.body.dataset.probe || "null").fight.started');
    if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
    return until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
  }
  const pcFigures = (p) => p.fight.rows.filter((r) => r.kind === 'pc').map((r) => [r.name, r.ini, r.hp, r.max, r.speed, r.dex]);
  const ids = (p) => p.fight.rows.map((r) => r.id);
  const log = async (run) => (await (await fetch(`${run.base}/api/state`)).json()).state.events.filter((e) => e.fight).map((e) => e.text);
  const serverRows = async (run) => (await (await fetch(`${run.base}/api/state`)).json()).state.fight.rows;
  // the in-rows' initiatives from the top, numbers only: high to low
  const sortedDown = (p) => { const n = p.fight.rows.filter((r) => r.in && r.ini !== null).map((r) => r.ini); return n.every((v, i) => i === 0 || n[i - 1] >= v); };
  // a held press on an element (scrolled into view first, as page.click does), with a look at the server mid-press
  async function heldPress(page, sel, during) {
    await page.evaluate(`document.querySelector(${q(sel)}).scrollIntoView({ block: 'nearest', inline: 'nearest' })`);
    const r = await page.box(sel);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    assert.ok(await page.evaluate(`document.elementFromPoint(${x}, ${y}) === document.querySelector(${q(sel)})`), `${sel} is under the pointer`);
    await page.mouse('mouseMoved', x, y);
    await page.mouse('mousePressed', x, y, { buttons: 1 });
    await page.sleep(90);
    await during();
    await page.mouse('mouseReleased', x, y);
  }

  for (const which of ['coc', 'gurps']) {
    it(`${W(which)}: Add Bouncer ×3, then 10 Tab 9 Tab 8 Tab in their initiative boxes before Start: focus on Start, every PC's figure unchanged, no seen button focused`, async () => {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        let p = await fightOn(page, run, AT[which]);
        p = await addMany(page, 'Bouncer', 3);
        const pcs = pcFigures(p);
        const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
        await tap(page, `[data-fini="${b[0]}"]`);
        const went = [];
        for (const v of ['10', '9', '8']) { await page.type(v); await page.key('Tab'); went.push(await where(page)); }
        assert.deepStrictEqual(went, [`data-fini=${b[1]}`, `data-fini=${b[2]}`, '#fNext']);
        p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[2])}).ini === 8`);
        assert.deepStrictEqual(b.map((id) => p.fight.rows.find((r) => r.id === id).ini), [10, 9, 8]);
        assert.deepStrictEqual(pcFigures(p), pcs, 'no PC figure changed');
        assert.strictEqual(p.fight.started, false);
        assert.deepStrictEqual(p.errors, []);
      });
    });

    it(`${W(which)}: the same after Start: focus stays on the last box with its number selected; Enter commits it and ends no turn`, async () => {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        await fightOn(page, run, AT[which]);
        let p = await startNow(page);
        p = await addMany(page, 'Bouncer', 3);
        const turn = [p.fight.turn, p.fight.round];
        const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
        await tap(page, `[data-fini="${b[0]}"]`);
        const went = [];
        for (const v of ['10', '9', '8']) { await page.type(v); await page.key('Tab'); went.push(await where(page)); }
        assert.deepStrictEqual(went, [`data-fini=${b[1]}`, `data-fini=${b[2]}`, `data-fini=${b[2]}`]);
        assert.deepStrictEqual(await picked(page), ['8', 0, 1], 'its number selected');
        await page.key('Enter');
        p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[2])}).ini === 8 && p.fight.rows.every((r) => !r.held)`);
        assert.deepStrictEqual([p.fight.turn, p.fight.round], turn, 'no turn ended');
        assert.deepStrictEqual(b.map((id) => p.fight.rows.find((r) => r.id === id).ini), [10, 9, 8]);
        assert.strictEqual(await where(page), `data-fini=${b[2]}`);
        assert.deepStrictEqual(p.errors, []);
      });
    });

    it(`${W(which)}: with the source blank Same for all is disabled and "Type a number first" is on screen beside it; the copies' typed initiatives are kept`, async () => {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        let p = await fightOn(page, run, AT[which]);
        p = await addMany(page, 'Bouncer', 3);
        const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
        p = await typeInto(page, `[data-fini="${b[1]}"]`, 9);
        p = await typeInto(page, `[data-fini="${b[2]}"]`, 8);
        p = await peek(page, p, 'Bouncer 1');
        assert.strictEqual(await page.evaluate(`document.querySelector('#acting [data-fsame="${b[0]}"]').disabled`), true);
        assert.match(await page.evaluate('document.querySelector("#acting .samebox").innerText'), /Same for all\s*Type a number first/);
        assert.ok((await page.evaluate('document.querySelector("#acting").innerText')).includes('Type a number first'));
        assert.deepStrictEqual([named(p, 'Bouncer 2').ini, named(p, 'Bouncer 3').ini], [9, 8]);
        assert.deepStrictEqual(p.errors, []);
      });
    });

    it(`${W(which)}: a held number is placed before Start sorts (Start pressed straight from the column)`, async () => {
      const run = await start(which);
      await withPage({ width: 1449, height: 762 }, async (page) => {
        await fightOn(page, run, AT[which]);
        let p = await addNew(page, 'Bouncer');
        const id = named(p, 'Bouncer').id;
        await tap(page, `[data-fini="${id}"]`);
        await page.type('7');
        p = await startNow(page);
        assert.strictEqual(named(p, 'Bouncer').ini, 7);
        assert.ok(sortedDown(p), `sorted: ${JSON.stringify(p.fight.rows.filter((r) => r.in).map((r) => [r.name, r.ini]))}`);
        assert.ok(p.fight.rows.every((r) => !r.held));
        assert.deepStrictEqual(p.errors, []);
      });
    });
  }

  it('GURPS: Tab never lands on a PC\'s sheet Speed', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      const p = await fightOn(page, run, 1);
      const column = await page.evaluate('Array.from(document.querySelectorAll("[data-fini]"), (b) => b.dataset.fini)');
      const first = column.find((id) => p.fight.rows.find((r) => r.id === id).kind !== 'pc');
      const sheet = (id) => { const r = p.fight.rows.find((x) => x.id === id); return r.kind === 'pc' && r.ini !== null; };
      const passed = column.slice(column.indexOf(first)).filter(sheet);
      assert.ok(passed.length > 0, 'a PC with a sheet Speed lies on the walk');
      await tap(page, `[data-fini="${first}"]`);
      const went = [];
      for (let i = 0; i < 40; i++) {
        await page.key('Tab');
        const w = await where(page);
        went.push(w);
        if (!w.startsWith('data-fini=')) break;
      }
      assert.strictEqual(went.at(-1), '#fNext', `the walk ends on Start: ${went}`);
      for (const id of passed) assert.ok(!went.includes(`data-fini=${id}`), `passed ${id}`);
      assert.ok(!went.some((w) => w.startsWith('data-fseen')), 'never a seen button');
    });
  });

  it('GURPS: a row\'s own boxes: 12 Tab 10 Tab 11 gives HP max 12, FP max 10, then the next row\'s HP max 11; Shift-Tab walks back', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 2);
      const [b1, b2] = [1, 2].map((i) => named(p, `Bouncer ${i}`).id);
      await tap(page, `[data-fmax="${b1}"]`);
      await page.type('12');
      await page.key('Tab');
      assert.strictEqual(await where(page), `data-ffpmax=${b1}`);
      await page.type('10');
      await page.key('Tab');
      assert.strictEqual(await where(page), `data-fmax=${b2}`);
      await page.type('11');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b2)}).max === 11`);
      assert.deepStrictEqual([named(p, 'Bouncer 1').max, named(p, 'Bouncer 1').fpMax, named(p, 'Bouncer 2').max], [12, 10, 11]);
      // Shift-Tab walks each step back: the next row's HP max to this row's FP max, then its HP max, each selected
      await page.key('Tab', { shift: true });
      assert.strictEqual(await where(page), `data-ffpmax=${b1}`);
      assert.deepStrictEqual(await picked(page), ['10', 0, 2]);
      await page.key('Tab', { shift: true });
      assert.strictEqual(await where(page), `data-fmax=${b1}`);
      assert.deepStrictEqual(await picked(page), ['12', 0, 2]);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('CoC: a row\'s own boxes: 11 Tab 9 fills two rows\' HP max', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 0);
      let p = await addMany(page, 'Bouncer', 2);
      const [b1, b2] = [1, 2].map((i) => named(p, `Bouncer ${i}`).id);
      await tap(page, `[data-fmax="${b1}"]`);
      await page.type('11');
      await page.key('Tab');
      assert.strictEqual(await where(page), `data-fmax=${b2}`);
      await page.type('9');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b2)}).max === 9`);
      assert.deepStrictEqual([named(p, 'Bouncer 1').max, named(p, 'Bouncer 1').hp, named(p, 'Bouncer 2').max], [11, 11, 9]);
    });
  });

  for (const [width, height] of SIZES) {
    // Task 36 changed this on purpose: the cursor starts in Speed, the quick figures first (Ant, 2026-11-24: "the NPC
    // speed is 5.0, main combat skill is 12, his dodge is 8 and parry is 9, his HP is 10")
    it(`GURPS at ${width}: Add Bouncer ×3 puts the cursor in Bouncer 1's Speed box with no click, in view; a click on Bouncer 2's name puts it in Bouncer 2's first empty box; a second click keeps both`, async () => {
      const run = await start('gurps');
      await withPage({ width, height }, async (page) => {
        await fightOn(page, run, 1);
        let p = await addMany(page, 'Bouncer', 3);
        const [b1, b2] = [1, 2].map((i) => named(p, `Bouncer ${i}`).id);
        await page.waitFor(`document.activeElement === document.querySelector('#acting [data-fs-speed="${b1}"]')`, 3000);
        assert.strictEqual(p.fight.actingName, 'Bouncer 1');
        const edges = await page.evaluate(`(() => { const b = document.activeElement.getBoundingClientRect(); const bar = document.querySelector('.top').getBoundingClientRect().bottom;
          const c = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { top: b.top, bottom: b.bottom, bar, h: innerHeight, hit: c === document.activeElement }; })()`);
        assert.ok(edges.top >= edges.bar && edges.bottom <= edges.h && edges.hit, `${width}: the Speed box in view ${JSON.stringify(edges)}`);
        await tap(page, `[data-fpeek="${b2}"]`);
        p = await until(page, 'p.fight.actingName === "Bouncer 2"');
        await page.waitFor(`document.activeElement === document.querySelector('#acting [data-fs-speed="${b2}"]')`, 3000);
        await tap(page, `[data-fpeek="${b2}"]`);
        await page.sleep(150);
        p = await until(page, 'p.fight.actingName === "Bouncer 2"');
        assert.strictEqual(await where(page), `data-fs-speed=${b2}`, 'the second click keeps the pick and the cursor');
        sane(p, `pick ${width}`);
      });
    });
  }

  it('GURPS: 11 Tab 10 Tab 12, Parry, Block and DR, then Same for all: "Same for all 2", reached by Tab from the last box and on to Start; all three HP 11, FP 10, Speed 5.5 and the typed defences; a typed initiative is kept', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 3);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      p = await typeInto(page, `[data-fini="${b[1]}"]`, 10);
      p = await peek(page, p, 'Bouncer 1');
      // Task 36 changed this on purpose: the cursor starts in Speed, the quick figures first (Ant, 2026-11-24: "the NPC
      // speed is 5.0, main combat skill is 12, his dodge is 8 and parry is 9, his HP is 10"): Speed, Skill, Dodge, Parry,
      // Block and HP first, then ST, HT, DX and DR
      await page.waitFor(`document.activeElement === document.querySelector('#acting [data-fs-speed="${b[0]}"]')`, 3000);
      // past Speed, Skill and Dodge; Parry, Block; past HP (worked out); ST, HT, DX, DR: the panel's last box
      for (const v of [null, null, null, '9', '8', null, '11', '10', '12', '2']) {
        if (v !== null) await page.type(v);
        await page.key('Tab');
      }
      const same = `#acting [data-fsame="${b[0]}"]`;
      assert.strictEqual(await where(page), `data-fsame=${b[0]}`, 'Tab from the last box goes to Same for all');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[0])}).dr === 2`);
      assert.strictEqual(await text(page, same), 'Same for all 2');
      await page.key('Tab', { shift: true });
      assert.strictEqual(await where(page), `data-fs-dr=${b[0]}`, 'Shift-Tab goes back to the last box');
      await page.key('Tab');
      assert.strictEqual(await where(page), `data-fsame=${b[0]}`);
      await page.key('Tab');
      assert.strictEqual(await where(page), '#fNext', 'and on to Start before Start');
      await tap(page, same);
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[2])}).hp === 11`);
      for (const id of b) {
        const r = p.fight.rows.find((x) => x.id === id);
        assert.deepStrictEqual([r.hp, r.max, r.fp, r.fpMax, r.speed, r.parry, r.block, r.dr], [11, 11, 10, 10, 5.5, 9, 8, 2], r.name);
      }
      assert.strictEqual(named(p, 'Bouncer 2').ini, 10, 'the typed initiative is kept');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('GURPS: Tab from the panel\'s last box to a Same for all its own commit leaves nothing to copy goes to Start, never the page; the button says why', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 2);
      const [b1] = [1, 2].map((i) => named(p, `Bouncer ${i}`).id);
      p = await peek(page, p, 'Bouncer 1');
      p = await typeInto(page, box(p, 'Bouncer 1', 'st'), 11);
      await tap(page, `#acting [data-fsame="${b1}"]`);
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.name === "Bouncer 2").st === 11');
      p = await typeInto(page, box(p, 'Bouncer 1', 'dr'), 3);
      assert.strictEqual(await text(page, `#acting [data-fsame="${b1}"]`), 'Same for all 1');
      // the DR taken out again: the only thing left to copy goes with the commit Tab makes
      await tap(page, box(p, 'Bouncer 1', 'dr'));
      await page.key('Backspace');
      await page.key('Tab');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b1)}).dr === null`);
      await page.sleep(100);
      assert.strictEqual(await where(page), '#fNext');
      assert.strictEqual(await page.evaluate(`document.querySelector('#acting [data-fsame="${b1}"]').disabled`), true);
      assert.match(await page.evaluate('document.querySelector("#acting .samebox").innerText'), /Same for all\s*No copy can take these/);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // Task 34 (finding 12): focus never drops to the page after Same for all disables itself, or after End fight
  it('GURPS: Same for all that leaves nothing to copy puts focus on Start; End fight puts it on a live control, never the page', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 2);
      const b1 = named(p, 'Bouncer 1').id;
      p = await peek(page, p, 'Bouncer 1');
      p = await typeInto(page, box(p, 'Bouncer 1', 'st'), 11);
      await tap(page, `#acting [data-fsame="${b1}"]`);
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.name === "Bouncer 2").st === 11');
      await page.sleep(100);
      assert.strictEqual(await page.evaluate(`document.querySelector('#acting [data-fsame="${b1}"]').disabled`), true);
      assert.strictEqual(await where(page), '#fNext');
      await tap(page, '#fEnd');
      await tap(page, '#fEnd');
      p = await until(page, '!p.fight && p.saved === "Saved" && p.pending === 0');
      await page.sleep(150);
      const at = await page.evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return null;
        const b = a.getBoundingClientRect(); return { tag: a.tagName, text: a.textContent.trim(), disabled: Boolean(a.disabled), shown: b.width > 0 && b.height > 0 }; })()`);
      assert.ok(at && !at.disabled && at.shown, `after End fight focus is on ${JSON.stringify(at)}`);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // Task 23b A2 changed this on purpose: the column and the panel are one place for holding, so the click into the panel
  // places nothing; Enter in the panel's box (focus leaving both, or Start, would do the same) does
  it('GURPS, before Start: a Speed typed in the column, then a click on a blank row\'s name: the row stays held while the cursor is in that row\'s panel, and is placed on Enter there', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 3);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      const was = ids(p).indexOf(b[2]);
      await tap(page, `[data-fini="${b[2]}"]`);
      await page.type('9');
      await tap(page, `[data-fpeek="${b[0]}"]`);
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[2])}).ini === 9`);
      assert.strictEqual(ids(p).indexOf(b[2]), was, 'held while the cursor is in the panel');
      // Task 36 changed this on purpose: the cursor starts in Speed, the quick figures first (Ant, 2026-11-24: "the NPC
      // speed is 5.0, main combat skill is 12, his dodge is 8 and parry is 9, his HP is 10")
      assert.strictEqual(await where(page), `data-fs-speed=${b[0]}`);
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.every((r) => !r.held)`);
      assert.ok(ids(p).indexOf(b[2]) < was, 'placed on Enter');
      assert.ok(sortedDown(p), `sorted: ${JSON.stringify(p.fight.rows.filter((r) => r.in).map((r) => [r.name, r.ini]))}`);
    });
  });

  // Task 23b A2: the panel and the initiative column are one place for holding
  it('GURPS, before Start: a Speed typed in the panel, then a click into a column initiative box: no row moves and the cursor is in that box; Tab out of the column places the rows', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 3);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      const was = ids(p);
      p = await peek(page, p, 'Bouncer 3');
      await tap(page, `#acting [data-fs-speed="${b[2]}"]`);
      await page.type('9');
      await tap(page, `[data-fini="${b[0]}"]`);
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[2])}).ini === 9`);
      await page.sleep(300);
      p = await until(page, 'true');
      assert.deepStrictEqual(ids(p), was, 'no row moves');
      assert.ok(p.fight.rows.some((r) => r.held), 'still held');
      assert.strictEqual(await where(page), `data-fini=${b[0]}`, 'the cursor is in the clicked box');
      // down the column to the last box, still holding; the next Tab leaves it
      for (const to of [b[1], b[2]]) { await page.key('Tab'); assert.strictEqual(await where(page), `data-fini=${to}`); assert.ok((await until(page, 'true')).fight.rows.some((r) => r.held), 'held in the column'); }
      await page.key('Tab');
      assert.strictEqual(await where(page), '#fNext');
      p = await until(page, 'p.saved === "Saved" && p.pending === 0 && p.fight.rows.every((r) => !r.held)');
      assert.ok(ids(p).indexOf(b[2]) < was.indexOf(b[2]), 'placed once focus left both');
      assert.ok(sortedDown(p), `sorted: ${JSON.stringify(p.fight.rows.filter((r) => r.in).map((r) => [r.name, r.ini]))}`);
    });
  });

  // Task 23 fix round 1: a rail jump lands the beat's top at the sticky bar plus 8 (the page's scroll-padding only)
  for (const [width, height] of SIZES) {
    it(`CoC at ${width}: a rail jump puts the beat's top at the sticky bar plus 8`, async () => {
      const run = await start('coc');
      await withPage({ width, height }, async (page) => {
        await page.goto(`${run.base}/?probe=1`);
        await settled(page);
        const key = run.model.beats[1].key;
        await tap(page, `#rail [data-go="beat:${key}"]`);
        await page.sleep(100);
        const l = await landing(page, `[id="beat:${key}"]`);
        if (l.scrollY < l.maxY - 1) assert.ok(Math.abs(l.top - (l.bar + 8)) <= 3, `${width}: ${JSON.stringify(l)}`);
        else assert.ok(l.top >= l.bar + 5, `${width} at the page's end: ${JSON.stringify(l)}`);
      });
    });
  }

  it('GURPS, before Start: typing Speed down three blank rows: no row moves until Tab leaves the column, then each takes its sorted place', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 3);
      const was = ids(p);
      const b = [1, 2, 3].map((i) => named(p, `Bouncer ${i}`).id);
      await tap(page, `[data-fini="${b[0]}"]`);
      for (const v of ['6', '7']) { await page.type(v); await page.key('Tab'); }
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(b[1])}).ini === 7`);
      assert.deepStrictEqual(ids(p), was, 'nothing moved while typing');
      await page.type('8');
      await page.key('Tab');
      assert.strictEqual(await where(page), '#fNext');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.every((r) => !r.held) && p.fight.rows.find((r) => r.id === ${q(b[2])}).ini === 8`);
      const at = (id) => ids(p).indexOf(id);
      assert.ok(at(b[2]) < at(b[1]) && at(b[1]) < at(b[0]), 'each in its sorted place');
      assert.ok(sortedDown(p), `sorted: ${JSON.stringify(p.fight.rows.filter((r) => r.in).map((r) => [r.name, r.ini]))}`);
    });
  });

  it('GURPS, after Start: a row that had a Speed at Start, given a new one, keeps its place; every other row stays put and the log says the order stays', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await startNow(page);
      const was = ids(p);
      const pc = p.fight.rows.find((r) => r.kind === 'pc' && r.in && r.ini !== null && r.ini < 9);
      p = await typeInto(page, `[data-fini="${pc.id}"]`, 9);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(pc.id)}).ini === 9 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual(ids(p), was);
      assert.match((await log(run)).at(-1), /: Speed 9; the order stays as it started\.$/);
    });
  });

  it('GURPS, after Start: Add Bouncer (blank), type its first Speed, then a held click on another row\'s damage box: only the Bouncer moves, after the release; focus and -4 go to that row', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 1);
      let p = await startNow(page);
      p = await addNew(page, 'Bouncer');
      const id = named(p, 'Bouncer').id;
      const was = ids(p);
      const other = p.fight.rows.find((r) => r.kind !== 'pc' && r.in && r.id !== id && Number.isFinite(r.hp));
      await tap(page, `[data-fini="${id}"]`);
      await page.type('9');
      await heldPress(page, `[data-fhp="${other.id}"]`, async () => {
        // mid-press: the number is in, the row has not moved
        let rows = null;
        for (let i = 0; i < 20; i++) { rows = await serverRows(run); if (rows.find((r) => r.id === id).ini === 9) break; await page.sleep(40); }
        assert.strictEqual(rows.find((r) => r.id === id).ini, 9, 'committed on the press');
        assert.deepStrictEqual(rows.map((r) => r.id), was, 'nothing moves under the pointer');
      });
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.every((r) => !r.held) && p.fight.rows.findIndex((r) => r.id === ${q(id)}) !== ${was.indexOf(id)}`);
      assert.deepStrictEqual(ids(p).filter((x) => x !== id), was.filter((x) => x !== id), 'every other row stays put');
      // at its sorted place among the rows with a number: none above it slower, none below it faster
      const nums = p.fight.rows.filter((r) => r.in && r.ini !== null);
      const k = nums.findIndex((r) => r.id === id);
      assert.ok(nums.slice(0, k).every((r) => r.ini >= 9) && nums.slice(k + 1).every((r) => r.ini <= 9), `placed: ${JSON.stringify(nums.map((r) => [r.name, r.ini]))}`);
      assert.strictEqual(await where(page), `data-fhp=${other.id}`, 'the click\'s focus is in the box aimed at');
      await page.type('-4');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(other.id)}).hp === ${other.hp - 4}`);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('GURPS, after Start: a row blank at Start, its first Speed typed in the last box and Enter, takes its place, the turn kept and focus on the box; a second Speed leaves it where it is', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await addNew(page, 'Bouncer');
      const id = named(p, 'Bouncer').id;
      p = await startNow(page);
      const turn = [p.fight.turn, p.fight.round];
      await tap(page, `[data-fini="${id}"]`);
      await page.type('6');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(id)}).ini === 6 && p.fight.rows.every((r) => !r.held)`);
      assert.deepStrictEqual([p.fight.turn, p.fight.round], turn);
      assert.ok(sortedDown(p), `in its place: ${JSON.stringify(p.fight.rows.filter((r) => r.in).map((r) => [r.name, r.ini]))}`);
      assert.strictEqual(await where(page), `data-fini=${id}`);
      assert.deepStrictEqual(await picked(page), ['6', 0, 1]);
      const placed = ids(p);
      await page.type('4');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(id)}).ini === 4`);
      assert.deepStrictEqual(ids(p), placed, 'a second Speed leaves it where it is');
      assert.match((await log(run)).at(-1), /: Speed 4; the order stays as it started\.$/);
    });
  });

  // Task 23: a roll back from the server takes focus to its card only when focus is on the page or in that card. The
  // test holds the server's answer to /api/roll back (its request handler, wrapped here) so the GM can move on meanwhile.
  it('GURPS: a card\'s roll that comes back after the GM clicked into another box leaves focus in that box', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    const handlers = run.server.listeners('request');
    let slow = 0;
    run.server.removeAllListeners('request');
    run.server.on('request', (req, res) => {
      const go = () => handlers.forEach((h) => h.call(run.server, req, res));
      if (slow && req.url === '/api/roll') setTimeout(go, slow); else go();
    });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 1);
      let p = await addMany(page, 'Bouncer', 2);
      p = await peek(page, p, 'Bouncer 1');
      p = await typeInto(page, box(p, 'Bouncer 1', 'speed'), '9');
      p = await peek(page, p, 'Bouncer 2');
      p = await typeInto(page, box(p, 'Bouncer 2', 'st'), 11);
      p = await typeInto(page, box(p, 'Bouncer 2', 'ht'), 10);
      p = await startNow(page);
      const b2 = named(p, 'Bouncer 2').id;
      p = await typeInto(page, `[data-fhp="${b2}"]`, '9 imp vitals');
      const card = `#acting .fcard[data-fcrow="${b2}"]`;
      await until(page, `document.querySelector(${q(card)} + ' button.roll')`);
      slow = 800;
      await tap(page, `${card} button.roll`);
      // while the dice are out, the GM goes on to the Add box
      await tap(page, '#fAddName');
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`, 5000);
      await page.sleep(150);
      assert.strictEqual(await where(page), '#fAddName', 'focus stays where the GM put it');
      slow = 0;
    });
  });

  // Task 23b B7: dice out at the server while another window ends the fight: said, never applied
  // Task 23b fix round 1, M1: words typed in a damage box when another window ends the fight are said, not lost
  it('CoC: words typed in a damage box when another window ends the fight are said', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      await tap(page, '#fNext');
      p = await until(page, `p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `[data-fmelee="${iris}|fightBack"]`);
      await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmlvl="${iris}|defence|fail"]`);
      p = await until(page, `p.fight.melee === null && p.fight.dmg && p.fight.dmg.on === ${q(iris)} && p.saved === "Saved" && p.pending === 0`);
      await typeInto(page, `[data-fhp="${iris}"]`, '7', { enter: false, settle: false });
      await fromOther(run, [{ type: 'fightEnd', fight: p.fight.id }]);
      await page.waitFor(`document.querySelector('#hnotes').textContent.includes('Not sent: 7 (Iris Calder): that fight has ended.')`, 5000);
    });
  });

  it('GURPS: a hit\'s dice that come back after the fight has ended are said, not applied', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    const handlers = run.server.listeners('request');
    let slow = 0;
    run.server.removeAllListeners('request');
    run.server.on('request', (req, res) => {
      const go = () => handlers.forEach((h) => h.call(run.server, req, res));
      if (slow && req.url === '/api/roll') setTimeout(go, slow); else go();
    });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await startNow(page);
      const foe = p.fight.rows.find((r) => r.kind !== 'pc' && r.in && Number.isFinite(r.hp));
      slow = 800;
      await tap(page, `[data-fhp="${foe.id}"]`);
      await page.type('2d+1 cr torso');
      await page.key('Enter');
      await fromOther(run, [{ type: 'fightEnd', fight: p.fight.id }]);
      await page.waitFor(`document.querySelector('#hnotes').textContent.includes('2d+1 cr torso rolled 9, but that fight has ended: not applied.')`, 5000);
      slow = 0;
      const st = (await (await fetch(`${run.base}/api/state`)).json()).state;
      assert.ok(!st.fight, 'the fight is over');
      assert.ok(!st.events.some((e) => /hit by|2d\+1/.test(e.text) && e.fight), 'nothing applied');
    });
  });

  it('CoC, after Start: a DEX typed, then a held click on another row\'s damage box: the row re-places only after the release, and the click lands on the row aimed at', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await page.focusEvents();
      await fightOn(page, run, 0);
      let p = await startNow(page);
      p = await peek(page, p, 'Warden Hale');
      const hale = named(p, 'Warden Hale').id;
      const was = ids(p);
      const other = p.fight.rows.find((r) => r.kind !== 'pc' && r.in && r.id !== hale && Number.isFinite(r.hp));
      await tap(page, box(p, 'Warden Hale', 'dex'));
      await page.type('90');
      await heldPress(page, `[data-fhp="${other.id}"]`, async () => {
        let rows = null;
        for (let i = 0; i < 20; i++) { rows = await serverRows(run); if (rows.find((r) => r.id === hale).dex === 90) break; await page.sleep(40); }
        assert.strictEqual(rows.find((r) => r.id === hale).dex, 90, 'committed on the press');
        assert.deepStrictEqual(rows.map((r) => r.id), was, 'nothing moves under the pointer');
      });
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.findIndex((r) => r.id === ${q(hale)}) === 0`);
      assert.deepStrictEqual(ids(p).filter((x) => x !== hale), was.filter((x) => x !== hale));
      assert.strictEqual(await where(page), `data-fhp=${other.id}`);
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

describe('CoC rows ticked in or added later are placed by DEX (step 6b Task 33), by real input', { skip: browserSkip() }, () => {
  const names = (p) => p.fight.rows.filter((r) => r.in).map((r) => r.name);
  async function startNow(page) {
    await tap(page, '#fNext');
    await page.waitFor('document.querySelector("#fStartAnyway") || JSON.parse(document.body.dataset.probe || "null").fight.started');
    if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
    return until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
  }
  const join = (run, p, name, over, k) => fromOther(run, [{ type: 'fightJoin', fight: p.fight.id, label: name, rows: [blankRow({ id: `t33-${k}`, name, ...over })] }]);

  it('a benched DEX 70 row ticked in below a blank row takes its place and acts first at Start', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      await join(run, p, 'Varrio', { ini: null }, 'v');
      await join(run, p, 'Ferrante', { ini: 70, dex: 70, in: false }, 'f');
      p = await until(page, 'p.fight.rows.some((r) => r.name === "Ferrante") && p.fight.rows.some((r) => r.name === "Varrio")');
      assert.ok(!names(p).includes('Ferrante'), 'benched');
      await tap(page, `[data-ftick="${named(p, 'Ferrante').id}"]`);
      p = await until(page, `p.fight.rows.find((r) => r.name === "Ferrante").in && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(names(p)[0], 'Ferrante', `placed: ${names(p)}`);
      assert.ok(names(p).indexOf('Ferrante') < names(p).indexOf('Varrio'));
      p = await startNow(page);
      assert.strictEqual(p.fight.turn, named(p, 'Ferrante').id, 'it acts first');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // Task 34 (Task 33 review): the rows come in through the GM's Add box by real input, and the order is pinned
  it('a Dock Cultist (DEX 50) added after Start through Add lands by DEX, the turn stays; a blank row typed 50 is placed then', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      p = await startNow(page);
      const turn = [p.fight.turn, p.fight.round];
      const before = names(p);
      await tap(page, '#fAddName');
      await page.type('Dock Cultist');
      await page.waitFor('document.querySelector("[data-faddpick]")');
      await tap(page, '[data-faddpick]');
      p = await until(page, 'p.fight.rows.some((r) => r.name === "Dock Cultist" && r.in) && p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(named(p, 'Dock Cultist').ini, 50);
      // DEX 50 ties: the higher combat skill first (Warden Hale 55), so the Cultist's 40 comes after him, and before the
      // Brine Walkers' DEX 48 (their figures made the fixture's own in the PRENTICE review)
      assert.deepStrictEqual(before, ['Nurse Orla Penn', 'Iris Calder', 'Warden Hale', 'Brine Walker 1', 'Brine Walker 2', 'Tobias Reed', 'Jonas Finch', 'Mabel Quill']);
      assert.deepStrictEqual(names(p), ['Nurse Orla Penn', 'Iris Calder', 'Warden Hale', 'Dock Cultist', 'Brine Walker 1', 'Brine Walker 2', 'Tobias Reed', 'Jonas Finch', 'Mabel Quill']);
      assert.deepStrictEqual([p.fight.turn, p.fight.round], turn, 'the turn did not move');
      // a blank row from "+ New", then its DEX typed
      p = await addNew(page, 'Quill');
      assert.strictEqual(names(p).at(-1), 'Quill', 'a row with no DEX stays last');
      p = await typeInto(page, box(p, 'Quill', 'dex'), 50);
      // no combat skill: last of the DEX 50s
      assert.deepStrictEqual(names(p), ['Nurse Orla Penn', 'Iris Calder', 'Warden Hale', 'Dock Cultist', 'Quill', 'Brine Walker 1', 'Brine Walker 2', 'Tobias Reed', 'Jonas Finch', 'Mabel Quill']);
      assert.deepStrictEqual([p.fight.turn, p.fight.round], turn);
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

describe('Physical dice on CoC rows, cards and the Shoot strip (step 6b Task 37), by real input', { skip: browserSkip() }, () => {
  const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
  for (const [w, h] of SIZES) {
    it(`${w}: Dock Cultist 2's Fight Back typed 31 on its row, its CON typed 70, Iris's bout typed 7: each logged as typed`, async () => {
      const run = await start('coc', { randomInt: () => 3 });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await netLoft(page, run);
        const iris = named(p, 'Iris Calder').id;
        const c2 = named(p, 'Dock Cultist 2').id;
        // Iris acts (a PC: no box for her side); the cultist's own box on its row, typed, Enter: its usual Fight Back
        const mbox = `[data-ftyped="mdef|${c2}"]`;
        // Task 38 changed this on purpose: the row's box is "def" whatever attacks (the attacker's "atk" is on its own
        // row), and a PC attacker has no "atk" box at all
        assert.strictEqual(await attrOf(page, mbox, 'placeholder'), 'def');
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('[data-ftyped^="matk|"]'))`), false);
        sane(p, `${w} the melee box on the rows`);
        await typeInto(page, mbox, '31', { settle: false });
        p = await until(page, `p.fight.melee && !p.fight.melee.rolling && p.fight.melee.response === "fightBack"`);
        await tap(page, `[data-fmlvl="${c2}|attack|regular"]`);
        p = await until(page, `p.fight.melee === null && p.fight.dmg && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder: Regular; Dock Cultist 2 Fights Back: Regular (typed 31): a tie: Iris Calder hits Dock Cultist 2.']);
        assert.strictEqual(named(p, 'Dock Cultist 2').meleeDefences, 1);
        // the damage box the hit opened: the dice as its placeholder, short for the short box, both forms in its title
        // and description (Task 38)
        assert.deepStrictEqual(await page.evaluate(`(() => { const b = document.querySelector('[data-fhp="${c2}"]'); return [b.placeholder, b.title, b.getAttribute('aria-description')]; })()`),
          ['1D6+DB', 'The dice, e.g. 1D6+DB, or the total rolled, e.g. 7', 'The dice, e.g. 1D6+DB, or the total rolled, e.g. 7']);
        // 7 damage, 6 after armour: a Major Wound; its CON rolled at the table, 70, typed beside Roll
        await typeInto(page, `[data-fhp="${c2}"]`, '7');
        const card = `#acting .fcard[data-fcrow="${c2}"]`;
        p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
        await typeInto(page, `${card} input.typed`, '70');
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 2: Major wound, CON 55, rolled 70 (typed), Fail.']);
        assert.deepStrictEqual(await texts(page, `${card} .clines .offer`), ['Prone, Unconscious']);
        sane(p, `${w} the typed card`);
        // Iris's SAN: Passed tapped, and the bout's 1D10 rolled at the table: 7 typed beside Temporary insanity
        await typeInto(page, `[data-fhp="${iris}"]`, 's-6');
        const icard = `#acting .fcard[data-fcrow="${iris}"]`;
        p = await until(page, `document.querySelector(${q(icard)}) && p.saved === "Saved" && p.pending === 0`);
        await tap(page, `${icard} button.pass`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
        await typeInto(page, `${icard} input.typed`, '7');
        p = await until(page, `(p.fight.rows.find((r) => r.id === ${q(iris)}).cards || []).length === 0 && p.saved === "Saved" && p.pending === 0`);
        const st = (await (await fetch(`${run.base}/api/state`)).json()).state;
        assert.deepStrictEqual(st.fight.rows.find((r) => r.id === iris).bout, { left: 7, of: 7, from: 1 });
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder: SAN loss: Temporary insanity, a bout of 7 rounds (typed).']);
        sane(p, `${w} the typed bout`);
        await shot(page, `t37-coc-${w}`);
      });
    });
  }

  it('a dive typed 12, the Aimed chip tapped on by hand, and a cultist\'s shot typed 20', async () => {
    const run = await start('coc', { randomInt: seq(0, 5) });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      await tap(page, `[data-fshoot="${c2}"]`);
      p = await until(page, 'p.fight.shot');
      // the cultist's Dodge to dive, rolled at the table
      await typeInto(page, `[data-ftyped="dive|${c2}"]`, '12');
      p = await until(page, `p.fight.shot && p.fight.shot.dive && p.fight.rows.find((r) => r.id === ${q(c2)}).lostAttack && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 2 dives for cover: Dodge rolled 12 (typed), Regular: a penalty die on the shot; loses its next 2 attacks.']);
      // Iris aimed last round and nobody tapped it: the Aimed chip is live, and tapped on it counts
      const aim = `[data-fshc="${c2}|aim"]`;
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(aim)}).disabled`), false);
      await tap(page, aim);
      p = await until(page, 'p.fight.shot && p.fight.shot.chips.includes("aim")');
      await tap(page, `[data-fshlvl="${c2}|regular"]`);
      p = await until(page, 'p.fight.shot && p.fight.shot.last && p.saved === "Saved" && p.pending === 0');
      assert.match((await logOf(run)).slice(-1)[0], /aimed/);
      // Dock Cultist 1's shot at Iris, rolled at the table: 20 typed beside Roll
      await tap(page, '#fNext');
      p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0');
      await tap(page, `[data-fshoot="${iris}"]`);
      p = await until(page, 'p.fight.shot');
      await typeInto(page, `[data-ftyped="shot|${iris}"]`, '20');
      p = await until(page, `p.fight.shot && p.fight.shot.last && p.fight.dmg && p.saved === "Saved" && p.pending === 0`);
      assert.match((await logOf(run)).slice(-1)[0], /rolled 20 \(typed\): Regular: a hit\.$/);
      sane(p, 'the typed shot');
    });
  });
});

describe('Typed rolls, fix round (step 6b Task 37), by real input', { skip: browserSkip() }, () => {
  const notes = (page) => texts(page, '#hnotes .hnote span');
  const focusIs = (page, sel) => page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 3000);
  // two Bouncers, Bouncer 1 fastest; `more` typed on Bouncer 2 in its panel
  async function bouncers(page, run, more) {
    let p = await fightOn(page, run, 1);
    await tap(page, '#fAddCount');
    await page.type('2');
    await tap(page, '#fAddName');
    await page.type('Bouncer');
    await page.waitFor('document.querySelector("[data-faddnew]")');
    await tap(page, '[data-faddnew]');
    p = await until(page, 'p.fight.rows.some((r) => r.name === "Bouncer 2") && p.saved === "Saved" && p.pending === 0');
    p = await peek(page, p, 'Bouncer 1');
    p = await typeInto(page, box(p, 'Bouncer 1', 'speed'), '9');
    p = await peek(page, p, 'Bouncer 2');
    for (const [key, value] of more) p = await typeInto(page, box(p, 'Bouncer 2', key), value);
    await tap(page, '#fNext');
    if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
    return until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
  }

  // PRENTICE review I1: one typed number per foe. The row's box and the panel's show the same number; a defence tapped
  // on either takes it, logged typed, counted once, and both boxes empty. Dice fixed at 4 (a server roll is 12).
  // PRENTICE review M1: cards left waiting fold to one line each (name, what is due, ✕), the newest open; with five on
  // one foe at 1449x762 its panel's Defend row stays in view. A folded card opens on a tap; ✕ still dismisses at once.
  it('GURPS 1449: five ignored cards on Bouncer 2 fold to lines and its Defend row stays in view; a tap opens one, ✕ dismisses one', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const b2 = named(p, 'Bouncer 2').id;
      for (const hit of ['12 imp vitals', '7 cr', '30 cut neck', '9 imp vitals', '8 cr skull']) {
        const n = named(p, 'Bouncer 2').cards.length;
        p = await typeInto(page, `[data-fhp="${b2}"]`, hit);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards.length > ${n} && p.saved === "Saved" && p.pending === 0`);
      }
      assert.strictEqual(named(p, 'Bouncer 2').cards.length, 5);
      p = await peek(page, p, 'Bouncer 2');
      const look = await page.evaluate(`(() => {
        const a = document.querySelector('#acting').getBoundingClientRect();
        const d = document.querySelector('#acting .pdefs').getBoundingClientRect();
        const cards = Array.from(document.querySelectorAll('#acting .fcard'));
        return { a: [Math.round(a.top), Math.round(a.bottom)], d: [Math.round(d.top), Math.round(d.bottom)], st: document.querySelector('#acting').scrollTop, sh: document.querySelector('#acting').scrollHeight,
          strip: Math.round(document.querySelector('#acting .fcards').getBoundingClientRect().height), inView: d.top >= Math.max(a.top, 0) - 1 && d.bottom <= Math.min(a.bottom, innerHeight) + 1,
          folded: cards.filter((c) => c.classList.contains('fold')).length, open: cards.filter((c) => !c.classList.contains('fold')).length,
          lineH: Math.max(...cards.filter((c) => c.classList.contains('fold')).map((c) => Math.round(c.getBoundingClientRect().height))) };
      })()`);
      assert.deepStrictEqual([look.folded, look.open], [4, 1], JSON.stringify(look));
      assert.ok(look.lineH <= 34, `a folded card is one line (${look.lineH} px)`);
      assert.ok(look.inView, `the Defend row is in view: ${JSON.stringify(look)}`);
      // a folded card says what is due and opens on a tap
      const folded = '#acting .fcard.fold';
      assert.match(await text(page, `${folded} [data-fcardopen]`), /\S/);
      const id = await page.evaluate(`document.querySelector(${q(folded)}).dataset.fcard`);
      await tap(page, `${folded} [data-fcardopen]`);
      await page.waitFor(`!document.querySelector('#acting .fcard[data-fcard="${id}"]').classList.contains('fold')`, 3000);
      // ✕ on a folded card dismisses it in one tap, as on an open one
      const other = await page.evaluate(`document.querySelector(${q(folded)}).dataset.fcard`);
      await tap(page, `#acting .fcard.fold[data-fcard="${other}"] .x`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards.length === 4 && p.saved === "Saved" && p.pending === 0`);
      assert.ok(!named(p, 'Bouncer 2').cards.some((c) => c.id === other));
      sane(p, 'folded cards 1449');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('GURPS: 7 typed in the panel\'s box, the row\'s Parry tapped: typed, one parry, both boxes empty; and the reverse with Dodge', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const b2 = named(p, 'Bouncer 2').id;
      p = await peek(page, p, 'Bouncer 2');
      const rowBox = `li[data-frow="${b2}"] .defs input.typed`;
      const panelBox = `#acting [data-ftyped="pdef|${b2}"]`;
      // the row's box reads as a place to type, as the panel's does
      assert.deepStrictEqual([await attrOf(page, rowBox, 'placeholder'), await attrOf(page, panelBox, 'placeholder')], ['rolled', 'rolled']);
      const both = () => page.evaluate(`[document.querySelector(${q(rowBox)}).value, document.querySelector(${q(panelBox)}).value]`);
      await typeInto(page, panelBox, '7', { enter: false, settle: false });
      assert.deepStrictEqual(await both(), ['7', '7'], 'the row\'s box shows the panel\'s number');
      await tap(page, `[data-fdef="${b2}|parry"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).parries === 1 && p.saved === "Saved" && p.pending === 0`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: Parry 9, rolled 7 (typed), made it by 2.']);
      await page.waitFor(`document.querySelector(${q(rowBox)}).value === "" && document.querySelector(${q(panelBox)}).value === ""`, 3000);
      assert.strictEqual(named(p, 'Bouncer 2').parries, 1, 'counted once');
      // the reverse: typed in the row's box, the panel's Dodge tapped
      await typeInto(page, rowBox, '6', { enter: false, settle: false });
      assert.deepStrictEqual(await both(), ['6', '6']);
      const dodge = await page.evaluate(`document.querySelector('[data-fpdef="${b2}|dodge"]').textContent`);
      await tap(page, `[data-fpdef="${b2}|dodge"]`);
      p = await settled(page);
      await page.waitFor(`document.querySelector(${q(rowBox)}).value === "" && document.querySelector(${q(panelBox)}).value === ""`, 3000);
      assert.match((await logOf(run)).slice(-1)[0], new RegExp(`^Bouncer 2: ${dodge.replace(/[()]/g, '.')}, rolled 6 \\(typed\\)`));
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('GURPS: 7 Enter Enter in a row\'s box with Dodge and Parry open logs nothing and keeps focus; "12a" is refused in words; a number typed for a skipped line goes with it; a manoeuvre set ahead shows on the row', async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await bouncers(page, run, [['st', 11], ['ht', 10], ['dx', 10], ['parry', 9]]);
      const b2 = named(p, 'Bouncer 2').id;
      const dbox = `li[data-frow="${b2}"] .defs input.typed`;
      const before = (await logOf(run)).length;
      await typeInto(page, dbox, '7', { settle: false });
      await page.key('Enter');
      await page.sleep(300);
      await focusIs(page, dbox);
      assert.strictEqual((await logOf(run)).length, before, 'nothing rolled');
      assert.ok((await notes(page)).includes('7: tap the defence it was for.'), JSON.stringify(await notes(page)));
      await typeInto(page, dbox, '12a', { settle: false });
      await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote span")).some((n) => n.textContent === \'Not taken: "12a" is not a roll; type the number the dice show.\')', 3000);
      assert.strictEqual(await attrOf(page, dbox, 'aria-invalid'), 'true');
      assert.strictEqual((await logOf(run)).length, before);
      // a card: 9 typed beside Roll and not sent, then the line skipped: the 9 goes with it
      p = await typeInto(page, `[data-fhp="${b2}"]`, '9 imp vitals');
      const card = `#acting .fcard[data-fcrow="${b2}"]`;
      await page.waitFor(`document.querySelector(${q(card)})`, 3000);
      await typeInto(page, `${card} input.typed`, '9', { enter: false, settle: false });
      await tap(page, `${card} .clines li:nth-child(1) .decline.skip`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[0].declined && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(`${card} input.typed`)}).value`), '');
      // Bouncer 2's All-Out Attack set ahead, from its panel: its row shows it, for its next turn
      p = await peek(page, p, 'Bouncer 2');
      await tap(page, `#acting [data-fman="${b2}|all-out attack"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).manoeuvre === "all-out attack" && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await text(page, `li[data-frow="${b2}"] [data-fmanrow]`), 'AoA');
      assert.match(await attrOf(page, `li[data-frow="${b2}"] [data-fmanrow]`, 'title'), /set off its turn: for its next turn/);
      for (let i = 0; i < 12 && p.fight.turn !== b2; i++) {
        const was = p.fight.turn;
        await tap(page, '#fNext');
        p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
      }
      assert.equal(p.fight.turn, b2);
      assert.strictEqual(await text(page, `li[data-frow="${b2}"] [data-fmanrow]`), 'AoA', 'kept on its turn');
    });
  });

  for (const [w, h] of SIZES) {
    it(`GURPS at ${w}: a made-up foe with no HT: its card offers Passed and Failed; Failed on the death check offers Mortal wound and Dead`, async () => {
      const run = await start('gurps', { randomInt: () => 4 });
      await withPage({ width: w, height: h }, async (page) => {
        let p = await bouncers(page, run, [['st', 11], ['dx', 10], ['parry', 9]]);
        const b2 = named(p, 'Bouncer 2').id;
        assert.strictEqual(named(p, 'Bouncer 2').ht, null);
        p = await typeInto(page, `[data-fhp="${b2}"]`, '9 imp vitals');
        const card = `#acting .fcard[data-fcrow="${b2}"]`;
        p = await until(page, `document.querySelector(${q(card)}) && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(await attrOf(page, `${card} button.roll`, 'disabled'), '', 'Roll still waits for HT');
        assert.strictEqual(await text(page, `${card} .cht .note`), 'for Roll, or tap Passed or Failed');
        await tap(page, `${card} button.fail`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
        assert.deepStrictEqual(named(p, 'Bouncer 2').cards[0].lines[0].offers, ['mortal', 'dead']);
        assert.deepStrictEqual((await logOf(run)).slice(-1), ['Bouncer 2: death check (−1×HP), failed.']);
        // the knockdown is next: the taps again
        await page.waitFor(`document.querySelector(${q(`${card} button.pass:not([disabled])`)})`, 3000);
        sane(p, `no-HT card ${w}`);
        await tap(page, `${card} .clines li:nth-child(1) .offer`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(b2)}).conds.includes("Mortal wound") && p.saved === "Saved" && p.pending === 0`);
      });
    });
  }

  // Task 38 changed this on purpose: the attacker's "atk" is one box on its own row (key `matk|<attacker>`), so the wait
  // runs the other way: Enter in a target's "def" with "atk" empty goes to "atk", and Enter there goes on with that row
  it('CoC: NPC against NPC, Enter in "def" with "atk" empty goes to "atk" on the attacker\'s row; both typed, one exchange; "0" on a d100 is refused in the server\'s words', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      await tap(page, '#fNext');
      p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0');
      const c1 = named(p, 'Dock Cultist 1').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      const atk = `[data-ftyped="matk|${c1}"]`;
      const def = `[data-ftyped="mdef|${c2}"]`;
      assert.strictEqual(await page.evaluate(`document.querySelector(${q(atk)}).closest('li').dataset.frow`), c1, 'atk is on the attacker\'s row');
      assert.strictEqual(await page.evaluate(`document.querySelectorAll('[data-ftyped^="matk|"]').length`), 1, 'one atk box');
      assert.match(await attrOf(page, def, 'title'), /with Dock Cultist 1's atk empty, Enter goes there first/);
      const before = (await logOf(run)).length;
      await typeInto(page, def, '22', { settle: false });
      // Enter in def with atk empty: focus to atk, nothing sent
      await focusIs(page, atk);
      assert.strictEqual(p.fight.melee, null);
      await typeInto(page, atk, '0', { settle: false });
      // atk holds 0: refused by the server in its own words, nothing logged
      await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote span")).some((n) => /Not taken: a typed d100 roll is a whole number from 1 to 100/.test(n.textContent))', 3000);
      assert.strictEqual((await logOf(run)).length, before);
      await typeInto(page, atk, '31', { settle: false });
      p = await until(page, `p.fight.melee === null && p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDefences === 1`);
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Dock Cultist 1: Regular (typed 31); Dock Cultist 2 Fights Back: Regular (typed 22): a tie: Dock Cultist 1 hits Dock Cultist 2.']);
    });
  });
});

describe('Typed rolls, fix round 2 (step 6b Task 37), by real input', { skip: browserSkip() }, () => {
  it('CoC: the bout\'s die typed "0" is a 10', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      const iris = named(p, 'Iris Calder').id;
      await typeInto(page, `[data-fhp="${iris}"]`, 's-6');
      const icard = `#acting .fcard[data-fcrow="${iris}"]`;
      p = await until(page, `document.querySelector(${q(icard)}) && p.saved === "Saved" && p.pending === 0`);
      await tap(page, `${icard} button.pass`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(iris)}).cards[0].lines[0].result && p.saved === "Saved" && p.pending === 0`);
      await typeInto(page, `${icard} input.typed`, '0');
      p = await until(page, `(p.fight.rows.find((r) => r.id === ${q(iris)}).cards || []).length === 0 && p.saved === "Saved" && p.pending === 0`);
      const st = (await (await fetch(`${run.base}/api/state`)).json()).state;
      assert.deepStrictEqual(st.fight.rows.find((r) => r.id === iris).bout, { left: 10, of: 10, from: 1 });
      assert.deepStrictEqual((await logOf(run)).slice(-1), ['Iris Calder: SAN loss: Temporary insanity, a bout of 10 rounds (typed).']);
    });
  });

  // `speed` 9 puts the Bouncer first in the round; 1 puts it last, so the Next after its forgotten turn starts a new
  // round (fix round 3: the late pick is the previous actor's, across a round's end)
  const lateAim = (speed) => async () => {
    const run = await start('gurps', { randomInt: () => 4 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      await tap(page, '#fAddName');
      await page.type('Bouncer');
      await page.waitFor('document.querySelector("[data-faddnew]")');
      await tap(page, '[data-faddnew]');
      p = await until(page, 'p.fight.rows.some((r) => r.name === "Bouncer") && p.saved === "Saved" && p.pending === 0');
      p = await peek(page, p, 'Bouncer');
      p = await typeInto(page, box(p, 'Bouncer', 'speed'), String(speed));
      await tap(page, '#fNext');
      if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
      p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
      const b = named(p, 'Bouncer').id;
      const live = p.fight.rows.filter((r) => r.in && !r.out).map((r) => r.id);
      assert.strictEqual(speed === 1 ? live[live.length - 1] : live[0], b, `the Bouncer is ${speed === 1 ? 'last' : 'first'} in the order`);
      const aimOf = async () => (await (await fetch(`${run.base}/api/state`)).json()).state.fight.rows.find((r) => r.id === b).aim;
      // Next until the turn is the Bouncer's (`n` times round), or just past it
      const toTurn = async (past) => {
        for (let i = 0; i < 20; i++) {
          if (p.fight.turn === b && !past) return;
          const was = p.fight.turn;
          await tap(page, '#fNext');
          p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
          if (past && was === b) return;
        }
        throw new Error('the turn never came round');
      };
      const aimBtn = `#acting [data-fman="${b}|aim"]`;
      await toTurn(false);
      p = await peek(page, p, 'Bouncer');
      await tap(page, aimBtn);
      p = await until(page, `p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await aimOf(), 1);
      await toTurn(true); // its aim turn ends
      await toTurn(false); // its next turn: the Aim is forgotten
      const round = p.fight.round;
      await toTurn(true); // and ends with no pick
      if (speed === 1) assert.strictEqual(p.fight.round, round + 1, 'the Next after the last row starts a new round');
      assert.strictEqual(await aimOf(), 0);
      p = await peek(page, p, 'Bouncer');
      await tap(page, aimBtn);
      p = await until(page, `p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await aimOf(), 2, 'the late Aim counts on');
      await toTurn(false); // its next turn starts clear: the late pick was the turn just gone's
      p = await peek(page, p, 'Bouncer');
      await page.waitFor(`document.querySelector(${q(aimBtn)}) && document.querySelector(${q(aimBtn)}).getAttribute('aria-pressed') === 'false'`, 3000);
      await tap(page, aimBtn);
      p = await until(page, `p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await aimOf(), 3);
    });
  };
  it('GURPS: Aim, forgotten next turn, set late after Next (2); on its next turn the usual tap on Aim makes 3', lateAim(9));
  it('GURPS: the round\'s last row: Aim, forgotten, Next into a new round, late Aim (2); its next turn unlit, Aim makes 3 (fix round 3)', lateAim(1));
});

// Task 37 fix round: the entry box never runs into the HP figure beside it, its focus ring counted, focused or not;
// its placeholder has room inside it. Seen on a CoC copy at 1449: the focused box's ring over Dell's HP.
describe('the entry box and the HP figure never overlap (step 6b Task 37 fix round), by real input', { skip: browserSkip() }, () => {
  // every row's entry box against its HP figure: the box's right edge, with its outline when focused, stays left of
  // the figure's left edge; and the placeholder's text fits inside the box
  const clash = (page) => page.evaluate(`(() => {
    const out = [];
    for (const box of document.querySelectorAll('#side ol.to > li[data-frow] input.hpin')) {
      const hp = box.parentElement.querySelector('.hpv:not(.fpv)');
      if (!hp) continue;
      const b = box.getBoundingClientRect();
      const h = hp.getBoundingClientRect();
      const cs = getComputedStyle(box);
      const ring = document.activeElement === box && cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset) : 0;
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.font;
      const room = b.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      const text = ctx.measureText(box.placeholder || '').width;
      if (b.right + ring > h.left || text > room + 0.5) out.push({ row: box.dataset.fhp, right: b.right, ring, hpLeft: h.left, text, room });
    }
    // the "rolled" boxes' placeholders fit too (a clipped "d10(" on a CoC row)
    for (const box of document.querySelectorAll('input.typed')) {
      const cs = getComputedStyle(box);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.font;
      const room = box.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      if (ctx.measureText(box.placeholder).width > room + 0.5) out.push({ typed: box.dataset.ftyped, placeholder: box.placeholder, room });
    }
    return out;
  })()`);
  for (const [w, h] of SIZES) {
    it(`${w}: CoC rows after Start, and GURPS rows, with no box focused and with each focused`, async () => {
      for (const sys of ['coc', 'gurps']) {
        const run = await start(sys, { randomInt: () => 3 });
        await withPage({ width: w, height: h }, async (page) => {
          let p = sys === 'coc' ? await netLoft(page, run) : await fightOn(page, run, 1);
          assert.deepStrictEqual(await clash(page), [], `${sys} ${w}: nothing focused`);
          for (const r of p.fight.rows.filter((x) => x.in && x.hp !== null && x.hp !== undefined)) {
            const sel = `[data-fhp="${r.id}"]`;
            if (!(await page.evaluate(`Boolean(document.querySelector(${q(sel)}))`))) continue;
            await tap(page, sel);
            await page.waitFor(`document.activeElement === document.querySelector(${q(sel)})`, 2000);
            assert.deepStrictEqual(await clash(page), [], `${sys} ${w}: ${r.name}'s box focused`);
          }
          p = await settled(page);
          sane(p, `${sys} ${w} entry boxes`);
        });
      }
    });
  }
});

// Task 38: a CoC row fits one line. The entry box's placeholder is short with the whole hint in its title and
// description; the dice are one button that opens the stepper on the row's second line; the attacker's "atk" is one box
// on its own row; a long name's reserved width stops at 10 rem (fix round 2: 11 left 1 px). Real input only.
describe('CoC fight rows on one line (step 6b Task 38), by real input', { skip: browserSkip() }, () => {
  const LONG = 'Bartholomew Featherstonehaugh the Younger';
  for (const [w, h] of SIZES) {
    it(`${w}: the split holds from Fight through Start, a turn, the dice set in two taps and a typed attack; the hint is reachable; a long name is capped`, async () => {
      const run = await start('coc', { randomInt: () => 3 });
      await withPage({ width: w, height: h }, async (page) => {
        const edge = async (label) => { const p = await settled(page); return [label, p.layout.paneBox.left, p.layout.folded, p.layout.railFolded, p.layout.orderMin]; };
        const seen = [];
        const at = run.model.beats.findIndex((b) => /Net Loft/.test(b.title));
        let p = await fightOn(page, run, at);
        seen.push(await edge('fight'));
        const iris = named(p, 'Iris Calder').id;
        const c1 = named(p, 'Dock Cultist 1').id;
        const c2 = named(p, 'Dock Cultist 2').id;
        // the hint: short on the box, whole in its title and its description
        const hint = 'Damage -7, healing +3, MP m-2, SAN s-5';
        assert.deepStrictEqual([await attrOf(page, `[data-fhp="${c2}"]`, 'placeholder'), await attrOf(page, `[data-fhp="${c2}"]`, 'title'), await attrOf(page, `[data-fhp="${c2}"]`, 'aria-description')],
          ['-7 / +3…', hint, hint]);
        await tap(page, '#fNext');
        await page.waitFor('document.querySelector("#fStartAnyway")', 3000);
        await tap(page, '#fStartAnyway');
        p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
        seen.push(await edge('start'));
        assert.strictEqual(p.fight.turn, iris);
        // a bonus die in two taps: the ± button, then the stepper's +, which has focus
        const dice = `[data-fmdopen="${c2}"]`;
        assert.deepStrictEqual([await text(page, dice), await attrOf(page, dice, 'aria-pressed')], ['±', 'false']);
        await tap(page, dice);
        await page.waitFor(`document.activeElement === document.querySelector('[data-fmdice="${c2}|1"]')`, 3000);
        assert.strictEqual(await attrOf(page, dice, 'aria-pressed'), 'true');
        await tap(page, `[data-fmdice="${c2}|1"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDice === "+1"`);
        assert.match(await attrOf(page, dice, 'title'), /bonus die/);
        seen.push(await edge('a bonus die'));
        // a tap on the button shuts the stepper, the die kept, focus on the button
        await tap(page, dice);
        await page.waitFor(`document.activeElement === document.querySelector(${q(dice)}) && !document.querySelector('[data-fmdice="${c2}|1"]')`, 3000);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(c2)}).meleeDice === "+1"`);
        // the next turn: Dock Cultist 1 attacks; its "atk" is on its own row, the one on the page; typed, then Dodge on
        // Iris's row: the typed roll goes to the server marked typed, and the log says so
        await tap(page, '#fNext');
        p = await until(page, `p.fight.turn === ${q(c1)} && p.saved === "Saved" && p.pending === 0`);
        seen.push(await edge('a turn'));
        assert.strictEqual(await page.evaluate(`document.querySelectorAll('[data-ftyped^="matk|"]').length`), 1);
        assert.strictEqual(await page.evaluate(`document.querySelector('[data-ftyped="matk|${c1}"]').closest('li').dataset.frow`), c1);
        assert.strictEqual(await page.evaluate(`Boolean(document.querySelector('[data-ftyped="mdef|${iris}"]'))`), false, 'a PC has no def box');
        await page.evaluate(`(() => { window.__rolls = []; const of = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/api/roll')) window.__rolls.push(JSON.parse(o.body)); return of(u, o); }; return true; })()`);
        await typeInto(page, `[data-ftyped="matk|${c1}"]`, '44', { settle: false });
        assert.strictEqual(p.fight.melee, null, 'Enter in atk waits for the tap on the row it attacks');
        // and one line says so (Task 38 fix round, M2)
        await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote span")).some((n) => n.textContent === "44: tap the row it attacks.")', 3000);
        await tap(page, `[data-fmelee="${iris}|dodge"]`);
        p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
        const sent = JSON.parse(await page.evaluate('JSON.stringify(window.__rolls)'));
        assert.deepStrictEqual(sent.map((b) => b.rolls.map((x) => x.typed)), [[44]], JSON.stringify(sent));
        await tap(page, `[data-fmlvl="${iris}|defence|fail"]`);
        p = await until(page, 'p.fight.melee === null && p.saved === "Saved" && p.pending === 0');
        assert.match((await logOf(run)).slice(-1)[0], /^Dock Cultist 1: Fail \(typed 44\); Iris Calder Dodges: Fail/);
        seen.push(await edge('a typed attack'));
        assert.strictEqual(new Set(seen.map((x) => `${x[1]}|${x[2]}|${x[3]}|${x[4]}`)).size, 1, `${w}: the split moved ${JSON.stringify(seen)}`);
        if (w === 1449) assert.strictEqual(seen[0][3], false, '1449: the run list stays open');
        sane(p, `t38 ${w}`);
        // a long name (Task 38 fix round; 10 rem since fix round 2): CoC's row name reserves at most 10 rem, cut with "…" past it, whole in its
        // title; the folds stay as they were, so at 1449 the run list stays open
        const folds = [p.layout.railFolded, p.layout.folded];
        p = await addNew(page, LONG);
        const nm = await page.evaluate(`(() => { const n = Array.from(document.querySelectorAll('#side ol.to > li > .nm')).find((x) => x.textContent === ${q(LONG)}); return [n.title.startsWith(${q(LONG)}), parseFloat(n.style.minWidth || '0'), 10 * parseFloat(getComputedStyle(document.documentElement).fontSize), getComputedStyle(n).textOverflow]; })()`);
        assert.strictEqual(nm[0], true, 'the whole name in its title');
        assert.ok(nm[1] > 0 && nm[1] <= nm[2], `its reserved width ${nm[1]} is at most 10 rem (${nm[2]})`);
        assert.strictEqual(nm[3], 'ellipsis');
        p = await settled(page);
        assert.deepStrictEqual([p.layout.railFolded, p.layout.folded], folds, `${w}: the long name moved the folds`);
        if (w === 1449) assert.strictEqual(p.layout.railFolded, false, '1449: the run list stays open with the long name');
        sane(p, `t38 long name ${w}`);
        await shot(page, `t38-coc-${w}`);
      });
    });
  }

  // Task 38 fix round, M1: Enter in atk goes on with the remembered row only while its def still holds a number; M3:
  // the stepper opened while the row's exchange is open leaves focus on the dice button, never a disabled one
  it('NPC against NPC: def emptied after its Enter, atk\'s Enter sends nothing; the stepper during an exchange keeps focus on ±', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      await tap(page, '#fNext');
      p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0');
      const c1 = named(p, 'Dock Cultist 1').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      const atk = `[data-ftyped="matk|${c1}"]`;
      const def = `[data-ftyped="mdef|${c2}"]`;
      const before = (await logOf(run)).length;
      await typeInto(page, def, '22', { settle: false });
      await page.waitFor(`document.activeElement === document.querySelector(${q(atk)})`, 3000);
      // the def emptied by keys, then atk typed and Enter: nothing goes, and the line says what to do
      await tap(page, def);
      for (let i = 0; i < 3; i++) await page.key('Backspace');
      assert.strictEqual(await attrOf(page, def, 'value'), '');
      await typeInto(page, atk, '31', { settle: false });
      await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote span")).some((n) => n.textContent === "31: tap the row it attacks.")', 3000);
      p = await settled(page);
      assert.strictEqual(p.fight.melee, null);
      assert.strictEqual((await logOf(run)).length, before, 'nothing logged');
      // Iris's turn comes round: her exchange with the cultist open (her level waits), then the stepper opened
      for (let i = 0; i < 6 && p.fight.rows.find((r) => r.id === p.fight.turn).name !== 'Iris Calder'; i++) {
        const was = p.fight.turn; await tap(page, '#fNext'); p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
      }
      await tap(page, `[data-fmelee="${c2}|fightBack"]`);
      p = await until(page, 'p.fight.melee && !p.fight.melee.rolling');
      await tap(page, `[data-fmdopen="${c2}"]`);
      await page.waitFor(`document.querySelector('[data-fmdice="${c2}|1"]')`, 3000);
      assert.deepStrictEqual(await page.evaluate(`[document.querySelector('[data-fmdice="${c2}|1"]').disabled, document.querySelector('[data-fmdice="${c2}|-1"]').disabled]`), [true, true]);
      await page.waitFor(`document.activeElement === document.querySelector('[data-fmdopen="${c2}"]')`, 3000);
    });
  });

  // fix round 2 (m6): the attacker picked anew between the def's Enter and the atk's: the remembered row is the old
  // attacker's, so the new attacker's Enter sends nothing and says what to do
  it('NPC against NPC: Enter in def, then another attacker picked; its atk\'s Enter sends nothing', async () => {
    const run = await start('coc', { randomInt: () => 3 });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await netLoft(page, run);
      await tap(page, '#fNext');
      p = await until(page, 'p.fight.rows.find((r) => r.id === p.fight.turn).name === "Dock Cultist 1" && p.saved === "Saved" && p.pending === 0');
      const c1 = named(p, 'Dock Cultist 1').id;
      const c2 = named(p, 'Dock Cultist 2').id;
      const before = (await logOf(run)).length;
      await typeInto(page, `[data-ftyped="mdef|${c2}"]`, '22', { settle: false });
      await page.waitFor(`document.activeElement === document.querySelector('[data-ftyped="matk|${c1}"]')`, 3000);
      // Dock Cultist 2 picked: it is the attacker now, its atk on its row
      p = await peek(page, p, 'Dock Cultist 2');
      await typeInto(page, `[data-ftyped="matk|${c2}"]`, '31', { settle: false });
      await page.waitFor('Array.from(document.querySelectorAll("#hnotes .hnote span")).some((n) => n.textContent === "31: tap the row it attacks.")', 3000);
      p = await settled(page);
      assert.strictEqual(p.fight.melee, null);
      assert.strictEqual((await logOf(run)).length, before, 'nothing logged');
    });
  });

  // fix round 2 (m5): a long-named NPC made an ally gains SAN on its row and loses its seen and Out buttons; at 1449 the
  // run list stays open and the split holds
  it('1449: a long-named NPC tapped to ally keeps the run list open and the split still', async () => {
    const LONGN = 'Bartholomew Featherstonehaugh the Younger';
    const run = await start('coc', {}, (vault) => {
      const f = path.join(vault, 'Characters/NPCs/Tobias Reed.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('name: Tobias Reed', `name: ${LONGN}`));
    });
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      const edge = (x) => [x.layout.paneBox.left, x.layout.folded, x.layout.railFolded, x.layout.orderMin];
      const was = edge(p);
      assert.strictEqual(p.layout.railFolded, false, 'the run list is open');
      p = await peek(page, p, LONGN);
      const id = named(p, LONGN).id;
      await tap(page, `#acting [data-fside="ally"][data-fsiderow="${id}"]`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(id)}).side === "ally" && p.saved === "Saved" && p.pending === 0`);
      assert.strictEqual(await text(page, `li[data-frow="${id}"] .pools`), 'SAN 45');
      assert.deepStrictEqual(edge(p), was, 'the split and the folds hold');
      sane(p, 'long ally 1449');
    });
  });
});

// Ant, 2026-11-24: "as GM, I frequently simply decide at the table 'the NPC speed is 5.0, main combat skill is 12, his
// dodge is 8 and parry is 9, his HP is 10' and roll on that, and not worry about all the underlying stats ... The real
// benefit is simply tracking turn order, and remaining HP, and whether they are still in the fight."
describe('A GURPS foe made up at the table: the quick figures first (step 6b Task 36), by real input', { skip: browserSkip() }, () => {
  const MEASURED = {};
  // fix round (review Important 1): a Tab past a worked-out figure, nothing typed, keeps it worked out
  it('GURPS: Tab through Rafe Kell\'s worked-out Speed, Dodge and HP without typing keeps their tags; ST typed then moves HP; 8 typed over a worked-out 8 drops it', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      p = await peek(page, p, 'Rafe Kell');
      const id = named(p, 'Rafe Kell').id;
      assert.deepStrictEqual(Object.keys(named(p, 'Rafe Kell').from).sort(), ['dodge', 'fp', 'hp', 'speed']);
      await tap(page, box(p, 'Rafe Kell', 'speed'));
      const went = [];
      for (let i = 0; i < 6; i++) { await page.key('Tab'); went.push(await where(page)); }
      assert.deepStrictEqual(went, ['skill', 'dodge', 'parry', 'block', 'hp', 'st'].map((k) => `data-fs-${k}=${id}`));
      p = await settled(page);
      const r = named(p, 'Rafe Kell');
      assert.deepStrictEqual(Object.keys(r.from).sort(), ['dodge', 'fp', 'hp', 'speed'], 'every tag stays');
      await page.type('13');
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(id)}).st === 13`);
      assert.deepStrictEqual([named(p, 'Rafe Kell').max, named(p, 'Rafe Kell').from.hp], [13, 'from ST'], 'HP follows ST');
      // a Dodge typed as the 8 Speed gives is the GM's own: its tag goes
      p = await typeInto(page, box(p, 'Rafe Kell', 'dodge'), '8');
      assert.strictEqual(named(p, 'Rafe Kell').from.dodge, undefined);
      assert.strictEqual(named(p, 'Rafe Kell').dodge, 8);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // review Minor 1: the row's HP max box and the panel's are one figure
  it('GURPS: HP max typed in the row\'s box shows in the panel\'s, and the reverse', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 1);
      let p = await addNew(page, 'Thug');
      const id = named(p, 'Thug').id;
      const values = () => page.evaluate(`[document.querySelector('[data-fmax="${id}"]').value, document.querySelector('#acting [data-fs-hp="${id}"]').value]`);
      p = await typeInto(page, `[data-fmax="${id}"]`, '14');
      assert.deepStrictEqual(await values(), ['14', '14']);
      p = await typeInto(page, `#acting [data-fs-hp="${id}"]`, '11');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.find((r) => r.id === ${q(id)}).max === 11`);
      assert.deepStrictEqual(await values(), ['11', '11']);
      assert.deepStrictEqual([named(p, 'Thug').hp, named(p, 'Thug').max], [11, 11]);
    });
  });

  // Task 36 re-review M1 (in the Task 38 fix round): Esc takes the typing back, the dirty mark with it, so a Tab after
  // it sends nothing and the worked-out figure keeps its tag
  it('GURPS: 8 typed over Rafe Kell\'s worked-out Dodge 8, Esc, Tab: the tag stays', async () => {
    const run = await start('gurps');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 1);
      p = await peek(page, p, 'Rafe Kell');
      const id = named(p, 'Rafe Kell').id;
      assert.strictEqual(named(p, 'Rafe Kell').dodge, 8);
      assert.ok(named(p, 'Rafe Kell').from.dodge, 'Dodge is worked out');
      const dodge = box(p, 'Rafe Kell', 'dodge');
      await tap(page, dodge);
      await page.type('8');
      await page.key('Escape');
      await page.key('Tab');
      assert.strictEqual(await where(page), `data-fs-parry=${id}`);
      p = await settled(page);
      assert.ok(named(p, 'Rafe Kell').from.dodge, 'the tag stays');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  // the CoC panel, checked for the same and changed: DEX, Fighting, Dodge and HP first
  it('CoC: Add "Cultist", 60 Tab 50 Tab 30 Tab 12: DEX, Fighting, Dodge and HP, placed by DEX', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      await fightOn(page, run, 0);
      let p = await addNew(page, 'Cultist');
      const id = named(p, 'Cultist').id;
      await page.waitFor(`document.activeElement === document.querySelector('#acting [data-fs-dex="${id}"]')`, 3000);
      const went = [];
      for (const k of ['60', 'Tab', '50', 'Tab', '30', 'Tab', '12']) {
        if (k === 'Tab') { await page.key('Tab'); went.push(await where(page)); } else await page.type(k);
      }
      assert.deepStrictEqual(went, ['fighting', 'dodge', 'hp'].map((k) => `data-fs-${k}=${id}`));
      await page.key('Enter');
      p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.every((r) => !r.held) && p.fight.rows.find((r) => r.id === ${q(id)}).max === 12`);
      const c = named(p, 'Cultist');
      assert.deepStrictEqual([c.dex, c.ini, c.fighting, c.dodge, c.hp, c.max], [60, 60, 50, 30, 12, 12]);
      const n = p.fight.rows.filter((r) => r.in).map((r) => (r.ini === null ? -Infinity : r.ini));
      assert.ok(n.every((v, i) => i === 0 || n[i - 1] >= v), `sorted: ${JSON.stringify(n)}`);
      assert.deepStrictEqual(p.errors, []);
    });
  });

  after(() => { if (Object.keys(MEASURED).length) process.stdout.write(`# Task 36 measured ${JSON.stringify(MEASURED)}\n`); });
  for (const [w, h] of SIZES) {
    it(`${w}: Add "Thug", 5 Tab 12 Tab 8 Tab 9 Tab Tab 10: Speed, Skill, Dodge, Parry and HP with no ST, HT or DX, placed by Speed; To-hit opens on 12; below 0 it stays in the order; Out by a tap`, async () => {
      const run = await start('gurps');
      await withPage({ width: w, height: h }, async (page) => {
        const edge = async (label) => { const p = await settled(page); return [label, p.layout.paneBox.left, p.layout.folded, p.layout.railFolded, p.layout.orderMin]; };
        const seen = [];
        let p = await fightOn(page, run, 1);
        seen.push(await edge('fight'));
        p = await addNew(page, 'Thug');
        const id = named(p, 'Thug').id;
        // the cursor is in Thug's Speed box with no click
        await page.waitFor(`document.activeElement === document.querySelector('#acting [data-fs-speed="${id}"]')`, 3000);
        const went = [];
        for (const k of ['5', 'Tab', '12', 'Tab', '8', 'Tab', '9', 'Tab', 'Tab', '10']) {
          if (k === 'Tab') { await page.key('Tab'); went.push(await where(page)); } else await page.type(k);
        }
        assert.deepStrictEqual(went, ['skill', 'dodge', 'parry', 'block', 'hp'].map((k) => `data-fs-${k}=${id}`), 'the quick figures in Tab order');
        await page.key('Enter');
        p = await until(page, `p.saved === "Saved" && p.pending === 0 && p.fight.rows.every((r) => !r.held) && p.fight.rows.find((r) => r.id === ${q(id)}).max === 10`);
        const t = named(p, 'Thug');
        assert.deepStrictEqual([t.speed, t.ini, t.skill, t.dodge, t.parry, t.max, t.hp], [5, 5, 12, 8, 9, 10, 10]);
        assert.deepStrictEqual([t.st, t.ht, t.dx, t.fpMax], [null, null, null, null], 'no ST, HT or DX asked for or made up');
        // a Dodge typed as the figure Speed gives is the GM's own: no "(from Speed)" tag
        assert.deepStrictEqual(t.from, {}, 'nothing marked worked out');
        // placed by Speed: the order runs high to low, rows with no Speed last
        const ins = p.fight.rows.filter((r) => r.in);
        const n = ins.map((r) => (r.ini === null ? -Infinity : r.ini));
        assert.ok(n.every((v, i) => i === 0 || n[i - 1] >= v), `sorted: ${JSON.stringify(ins.map((r) => [r.name, r.ini]))}`);
        // the row reads Skill 12 beside its defences (off its turn; on it, its panel reads it out)
        assert.strictEqual(await text(page, `li[data-frow="${id}"] .defs .skill`), 'Skill 12');
        assert.ok((await texts(page, '#acting .nums > span')).includes('Skill 12'), 'the panel reads it out');
        seen.push(await edge('Thug typed'));
        if (w === 1449) await shot(page, 't36-thug-setup-1449');
        // To-hit opens on 12
        await tap(page, '#fToHit');
        p = await until(page, 'p.tohit && p.tohit.open && p.tohit.roll !== null');
        assert.deepStrictEqual([p.tohit.row, p.tohit.from, await page.evaluate('document.querySelector("#thLevel").value')], [id, 'typed', '12']);
        assert.strictEqual(p.tohit.roll, '12');
        await page.key('Escape');
        p = await until(page, '!p.tohit');
        // Start, and on to Thug's turn
        await tap(page, '#fNext');
        await page.waitFor('document.querySelector("#fStartAnyway") || JSON.parse(document.body.dataset.probe || "null").fight.started');
        if (await page.evaluate('Boolean(document.querySelector("#fStartAnyway"))')) await tap(page, '#fStartAnyway');
        p = await until(page, 'p.fight.started && p.saved === "Saved" && p.pending === 0');
        seen.push(await edge('start'));
        for (let i = 0; i < 12 && p.fight.turn !== id; i++) {
          const was = p.fight.turn;
          await tap(page, '#fNext');
          p = await until(page, `p.fight.turn !== ${q(was)} && p.saved === "Saved" && p.pending === 0`);
        }
        assert.strictEqual(p.fight.turn, id);
        // fix round (coordinator's ruling): the acting row attacks, so it shows Skill in place of its defence buttons (the
        // panel's Defend line keeps them)
        assert.strictEqual(await text(page, `li[data-frow="${id}"] .defs .skill`), 'Skill 12', 'the acting row reads its Skill');
        assert.strictEqual(await page.evaluate(`document.querySelectorAll('li[data-frow="${id}"] [data-fdef]').length`), 0, 'no defence buttons on the acting row');
        assert.ok(await page.evaluate(`Boolean(document.querySelector('#acting [data-fpdef="${id}|dodge"]'))`), 'the panel keeps its Defend line');
        assert.ok((await texts(page, '#acting .nums > span')).includes('Skill 12'), 'the acting panel reads it out');
        seen.push(await edge('Thug acting'));
        if (w === 1449) await shot(page, 't36-thug-acting-1449');
        // to 0, then below: still in the order, with its marks
        p = await typeInto(page, `[data-fhp="${id}"]`, '-10');
        assert.deepStrictEqual([named(p, 'Thug').hp, named(p, 'Thug').out, order(p).includes('Thug')], [0, false, true]);
        p = await typeInto(page, `[data-fhp="${id}"]`, '-11');
        const hurt = named(p, 'Thug');
        assert.deepStrictEqual([hurt.hp, hurt.out, order(p).includes('Thug')], [-11, false, true]);
        assert.ok(hurt.marks.includes('0 or less') && hurt.marks.includes('Reeling'), JSON.stringify(hurt.marks));
        assert.ok(await page.evaluate(`Boolean(document.querySelector('#side ol.to li[data-frow="${id}"]'))`), 'its row is in the order');
        // the panel's Shock chip, lit, can be read: its words are not the colour of its fill
        // fix round: against the background actually painted under it (its own fill, else the nearest ancestor's)
        const chip = await page.evaluate(`(() => {
          const b = document.querySelector('#acting [data-fshock="${id}"]');
          const rgb = (v) => (v.match(/[\\d.]+/g) || []).map(Number);
          let el = b; let bg = null;
          while (el && !bg) { const c = rgb(getComputedStyle(el).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0)) bg = c; el = el.parentElement; }
          const lum = (c) => { const [r, g, bl] = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
          const fg = rgb(getComputedStyle(b).color); const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          return { text: b.textContent, fg, bg, ratio: (hi + 0.05) / (lo + 0.05) };
        })()`);
        assert.match(chip.text, /^Shock \u2212\d$/);
        assert.ok(chip.ratio >= 3, `the Shock chip's words against what is painted under them: ${JSON.stringify(chip)}`);
        seen.push(await edge('Thug hurt'));
        if (w === 1449) await shot(page, 't36-thug-damaged-1449');
        // Out by a tap
        await tap(page, `[data-fout="${id}"]`);
        p = await until(page, `p.fight.rows.find((r) => r.id === ${q(id)}).out === true && p.saved === "Saved" && p.pending === 0`);
        assert.strictEqual(new Set(seen.map((x) => `${x[1]}|${x[2]}|${x[3]}|${x[4]}`)).size, 1, `${w}: the split moved ${JSON.stringify(seen)}`);
        if (w === 1449) assert.strictEqual(seen[0][3], false, '1449: the run list stays open');
        MEASURED[w] = { orderMin: seen[0][4], railFolded: seen[0][3], paneFolded: seen[0][2] };
        sane(p, `t36 ${w}`);
        assert.deepStrictEqual(p.errors, []);
      });
    });
  }
});

// PRENTICE review M2: a CoC foe made up at the table has no CON; its Major wound card offers Passed and Failed for the
// roll made at the table, as GURPS's no-HT card does, and the CON box stays for Roll. Real input.
describe('A made-up CoC foe\'s card takes a tap (PRENTICE review), by real input', { skip: browserSkip() }, () => {
  it('CoC: "Cultist" with 16 HP takes 8: its Major wound card has Passed and Failed; Failed settles the line', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      p = await addNew(page, 'Cultist');
      const id = named(p, 'Cultist').id;
      p = await typeInto(page, `[data-fmax="${id}"]`, 16);
      p = await typeInto(page, `[data-fhp="${id}"]`, '-8');
      const card = `#acting .fcard[data-fcrow="${id}"]`;
      await page.waitFor(`document.querySelector(${q(card)})`, 3000);
      assert.ok(await page.evaluate(`Boolean(document.querySelector(${q(`${card} [data-fcardstat]`)}))`), 'the CON box stays');
      assert.match(await text(page, `${card} .cht .note`), /for Roll, or tap Passed or Failed/);
      assert.strictEqual(await attrOf(page, `${card} button.roll`, 'disabled'), '', 'Roll waits for CON');
      await tap(page, `${card} button.fail`);
      p = await until(page, `p.fight.rows.find((r) => r.id === ${q(id)}).cards.length === 0 || p.fight.rows.find((r) => r.id === ${q(id)}).cards[0].lines[0].result`);
      p = await settled(page);
      const log = await logOf(run);
      assert.deepStrictEqual(log.slice(-2), ['Cultist: Major wound, failed.', 'Cultist: Major wound: Prone, Unconscious.']);
      assert.deepStrictEqual(p.errors, []);
    });
  });
});

// PRENTICE review M3: a made-up name, where "+ New" is the only choice, is added by Enter (6a refused it); a name the
// cast has still takes the cast's note first. Real input.
describe('The Add box takes a made-up name on Enter (PRENTICE review), by real input', { skip: browserSkip() }, () => {
  it('CoC: "Knife man", Enter: a blank row; "Dock Cult", Enter: the Dock Cultist\'s note', async () => {
    const run = await start('coc');
    await withPage({ width: 1449, height: 762 }, async (page) => {
      let p = await fightOn(page, run, 0);
      await tap(page, '#fAddName');
      await page.type('Knife man');
      await page.waitFor('document.querySelectorAll("#fHits button").length === 1 && document.querySelector("#fHits [data-faddnew]")', 3000);
      await page.key('Enter');
      p = await until(page, 'p.fight.rows.some((r) => r.name === "Knife man" && r.in) && p.saved === "Saved" && p.pending === 0');
      assert.strictEqual(named(p, 'Knife man').note, null, 'a blank row, no note');
      assert.strictEqual(await page.evaluate('document.querySelector("#fAddName").validationMessage'), '');
      await tap(page, '#fAddName');
      await page.type('Dock Cult');
      await page.waitFor('document.querySelector("#fHits [data-faddpick]")', 3000);
      await page.key('Enter');
      p = await until(page, 'p.fight.rows.some((r) => r.name === "Dock Cultist" && r.in) && p.saved === "Saved" && p.pending === 0');
      assert.ok(named(p, 'Dock Cultist').note, 'the cast\'s note');
      assert.deepStrictEqual(p.errors, []);
    });
  });
});
