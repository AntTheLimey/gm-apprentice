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
const { sane } = require('./helpers/fight-layout');

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

async function start(which) {
  const v = VAULTS[which];
  const vault = copyFixture(v.fixture);
  made.push(vault);
  const picked = pickSession(listSessions(vault), v.session, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: v.party, deps: { delayMs: 20, log: () => {} } });
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
// A box clicked (which selects what it holds), the text typed, Enter.
async function typeInto(page, sel, text) {
  await tap(page, sel);
  await page.type(String(text));
  await page.key('Enter');
  return settled(page);
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
      assert.deepStrictEqual(p.fight.rows.filter((r) => r.in).map((r) => r.ini), [60, 55, 50, 50, 50, 45, null, null]);
      // nothing of D&D's on the row: no Roll, no AC, no ½, no Res
      assert.strictEqual(await page.evaluate('Boolean(document.querySelector("#fRoll, [data-fac], [data-fhalf], [data-fres]"))'), false);
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
      assert.strictEqual(await attrOf(page, entry, 'placeholder'), '-7 / +3 / m-2 / s-5');
      p = await typeInto(page, entry, '-8');
      assert.deepStrictEqual([named(p, 'Cultist').hp, named(p, 'Cultist').out, named(p, 'Cultist').conds], [8, false, []]);
      p = await typeInto(page, entry, '-20');
      assert.deepStrictEqual([named(p, 'Cultist').hp, named(p, 'Cultist').out, named(p, 'Cultist').conds], [0, false, []]);
      assert.ok(p.fight.rows.every((r) => !r.out), 'nobody is Out');
      // the pools' letters: Hale's MP 12 less 2, shown on his row
      const hale = named(p, 'Warden Hale').id;
      p = await typeInto(page, `[data-fhp="${hale}"]`, 'm-2');
      assert.strictEqual(named(p, 'Warden Hale').mp, 10);
      assert.strictEqual(await text(page, `li[data-frow="${hale}"] .pools`), 'MP 10 · SAN 55');
    });
  });

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
      await tap(page, `[data-fini="${lysa}"]`);
      await page.type('6.255');
      await page.key('Enter');
      p = await until(page, `p.layout.rows.some((r) => r.id === ${q(lysa)} && r.line2 && r.line2.includes('Not a number'))`);
      assert.strictEqual(named(p, 'Lysa Venn').ini, 6.25);
      // FP now/[max] on the row, the entry box GURPS's
      assert.strictEqual(await attrOf(page, `[data-fhp="${corin}"]`, 'placeholder'), '-7 / +3 / f-2');
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
      await tap(page, box(p, 'Kev', 'dx'));
      await page.type('twelve');
      await page.key('Enter');
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
      // the row's chips, shown or moved to its second line: the two marks, no minus-HP line
      const chips = await texts(page, `li[data-frow="${id}"] .chips > .chip`);
      assert.deepStrictEqual(chips, ['Reeling', '0 or less']);
      assert.strictEqual(await page.evaluate(`document.querySelector('li[data-frow="${id}"]').textContent.includes('×HP')`), false);
      // the panel (still Kev's) and its track: every mark, all passed, −5×HP the deepest
      assert.strictEqual(p.fight.actingName, 'Kev');
      assert.deepStrictEqual(await texts(page, '#acting .mtrack li'), ['Reeling', '0 or less', '−1×HP', '−2×HP', '−3×HP', '−4×HP', '−5×HP']);
      assert.deepStrictEqual(await texts(page, '#acting .mtrack li.lit'), ['Reeling', '0 or less', '−1×HP', '−2×HP', '−3×HP', '−4×HP', '−5×HP']);
      assert.deepStrictEqual(await texts(page, '#acting .mtrack li.deep'), ['−5×HP']);
      await shot(page, 'gurps-kev');
    });
  });

  for (const [which, at, name, want] of [
    ['gurps', 1, 'Mara Quint', ['ST', 'HT', 'DX', 'Speed', 'Dodge', 'Parry', 'Block', 'DR']],
    ['coc', 0, 'Warden Hale', ['DEX', 'MP', 'SAN', 'Fighting', 'Firearms', 'Dodge', 'DB', 'Armour', 'Build', 'Attacks']],
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
});
