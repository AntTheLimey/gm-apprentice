'use strict';
// The players' page (plan 5b Task 7) in a real browser, against the real server on a fixture copy. The
// layout tests give the server a made-up view (the injected `forPlayers`) so any number of panels can be
// drawn; the fight test uses the real one. Sizes are measured in the page (`?probe=1`) on a 1920 x 1080
// window. Skipped without Chrome, except on CI (browserSkip). The two parse/scan tests run everywhere.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession, stateIdOf } = require('../lib/run-sheet/sessions');
const { readRunSheet } = require('../lib/run-sheet/read');
const RS = require('../lib/run-sheet/web/state');
const FM = require('../lib/run-sheet/web/fight-math');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');

const PLAYERS_WEB = path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'players');
const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const SESSION = 'Session 03 - Next';
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
const PARTY = ['Characters/PCs/Ada Moss.md', 'Characters/PCs/Ben Hart.md'];
const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';
const SHOTS = process.env.RS_SHOTS || '';

describe('the players\' page files', () => {
  it('players.js and render.js parse', () => {
    for (const f of ['players.js', 'render.js']) {
      const source = fs.readFileSync(path.join(PLAYERS_WEB, f), 'utf8');
      assert.doesNotThrow(() => new vm.Script(source, { filename: f }), f);
    }
  });

  it('the players\' page loads nothing from /web/, and nothing from outside', () => {
    const html = fs.readFileSync(path.join(PLAYERS_WEB, 'players.html'), 'utf8');
    assert.ok(!html.includes('/web/'), 'it never loads state.js or gm.js');
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /src="\/players\/render\.js"/);
    assert.match(html, /src="\/players\/players\.js"/);
    const js = fs.readFileSync(path.join(PLAYERS_WEB, 'players.js'), 'utf8');
    assert.doesNotMatch(js, /Math\.random|getRandomValues|randomInt/, 'no dice code');
    assert.deepStrictEqual([...js.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]), ['/api/players/view']);
  });
});

const made = [];
const servers = [];
after(async () => {
  for (const s of servers) { try { await s.close(); } catch { /* closed already */ } }
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function copyOfFixture() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-pl-page-'));
  made.push(vault);
  fs.cpSync(FIXTURE, vault, { recursive: true });
  return vault;
}
async function startOn(vault, port, deps) {
  const picked = pickSession(listSessions(vault), SESSION, vault);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: PARTY, deps: { delayMs: 20, log: () => {}, ...deps } });
  const got = await listenLocal(t.server, port);
  const run = { ...t, port: got, vault, stateId: stateIdOf(picked.session), base: `http://127.0.0.1:${got}` };
  servers.push(run);
  return run;
}
const post = async (run, url, body) => (await fetch(`${run.base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: run.base }, body: JSON.stringify(body) })).json();

// A made-up view of n panels. Pictures are null (the plain silhouette), so the page's own drawing is what is measured.
function makeView(n, { campaign = `Test ${n}`, orderOn = [], paused = false, names = ['Ada', 'Ben'] } = {}) {
  const layout = n === 0 ? 'none' : n === 1 ? 'n1' : n === 2 ? 'n2' : n <= 4 ? 'n4' : n <= 6 ? 'n6' : n <= 8 ? 'n8' : 'n9';
  const panels = [];
  for (let i = 0; i < n; i++) {
    const fighting = orderOn.includes(i);
    panels.push({
      id: `p${i + 1}`,
      pcs: names.map((x) => ({ name: x, pic: null })),
      people: [{ name: 'Brother Venn', pic: null }, { name: 'Someone 1', pic: null }],
      backdrop: null,
      caption: `The Gate ${i + 1}`,
      order: fighting ? {
        round: 2,
        paused,
        rows: [
          { name: 'Ada', ini: 19, current: false, out: false, lair: false, hp: '31/38', statuses: ['Bloodied'] },
          { name: 'Brother Venn', ini: 15, current: true, out: false, lair: false },
          { name: 'Ben', ini: 14, current: false, out: false, lair: false, hp: '12/30 +4', statuses: ['Concentrating', 'Exhaustion 1'] },
          { name: 'Someone 1', ini: 12, current: false, out: true, lair: false },
          { name: 'Someone 2', ini: 9, current: false, out: false, lair: false },
          { name: 'Lair', ini: 20, current: false, out: false, lair: true },
          { name: 'Frost Wolf 1', ini: 8, current: false, out: false, lair: false },
          { name: 'Frost Wolf 2', ini: 7, current: false, out: false, lair: false },
          { name: 'Ice Mephit 1', ini: 5, current: false, out: false, lair: false },
        ],
      } : null,
    });
  }
  return { campaign, layout, panels };
}

// A server whose players' view is whatever `box.view` says; a model load makes it look again.
async function viewServer(box) {
  const run = await startOn(copyOfFixture(), 0, { forPlayers: () => box.view });
  const show = async (view) => {
    box.view = view;
    await fetch(`${run.base}/api/model`);
  };
  return { run, show };
}
const probe = (page) => page.evaluate(PROBE);
const drawn = (page, campaign) => page.waitFor(`(() => { const p = ${PROBE}; return p && p.campaign === ${JSON.stringify(campaign)} && p; })()`);
async function shot(page, name) {
  if (SHOTS) await page.screenshot(path.join(SHOTS, `${name}.png`));
}

describe('the players\' page in a browser', { skip: browserSkip() }, () => {
  it('one and two panels: faces >= 160 px, names >= 28 px', async () => {
    const box = { view: makeView(1) };
    const { run, show } = await viewServer(box);
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      let p = await drawn(page, 'Test 1');
      assert.strictEqual(p.panels, 1);
      assert.ok(p.faceMinPx >= 160, `faces ${p.faceMinPx}`);
      assert.ok(p.nameMinPx >= 28, `names ${p.nameMinPx}`);
      await shot(page, 'n1');
      await show(makeView(2));
      p = await drawn(page, 'Test 2');
      assert.strictEqual(p.panels, 2);
      assert.ok(p.faceMinPx >= 160, `faces ${p.faceMinPx}`);
      assert.ok(p.nameMinPx >= 28, `names ${p.nameMinPx}`);
      await shot(page, 'n2');
      await show(makeView(2, { campaign: 'Test 2 fight', orderOn: [0, 1] }));
      p = await drawn(page, 'Test 2 fight');
      assert.ok(p.faceMinPx >= 160 && p.nameMinPx >= 28, `${p.faceMinPx} / ${p.nameMinPx} with the order up`);
      await shot(page, 'n2-fight');
      assert.deepStrictEqual(p.errors, []);
    });
  });

  it('three to eight: the decision 11 sizes', async () => {
    const box = { view: makeView(3) };
    const { run, show } = await viewServer(box);
    const rules = [[3, 128, 24], [4, 128, 24], [5, 104, 22], [6, 104, 22], [7, 88, 20], [8, 88, 20]];
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      for (const [n, face, name] of rules) {
        await show(makeView(n, { campaign: `Sizes ${n}`, orderOn: [0] }));
        const p = await drawn(page, `Sizes ${n}`);
        assert.strictEqual(p.panels, n);
        assert.ok(p.faceMinPx >= face, `${n} panels: faces ${p.faceMinPx} < ${face}`);
        assert.ok(p.nameMinPx >= name, `${n} panels: names ${p.nameMinPx} < ${name}`);
        if ([4, 6, 8].includes(n)) await shot(page, `n${n}`);
        assert.strictEqual(await page.evaluate('document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth'), true, `${n} panels fit the window`);
      }
    });
  });

  it('nine panels are all drawn', async () => {
    const box = { view: makeView(9, { orderOn: [0, 1] }) };
    const { run } = await viewServer(box);
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      const p = await drawn(page, 'Test 9');
      assert.strictEqual(p.panels, 9);
      assert.strictEqual(await page.evaluate('document.querySelectorAll(".panel").length'), 9);
      assert.ok(p.faceMinPx >= 88 && p.nameMinPx >= 20);
      assert.strictEqual(await page.evaluate('document.documentElement.scrollHeight <= window.innerHeight'), true);
      await shot(page, 'n9');
      // twelve, to be sure none is dropped
      box.view = makeView(12, { campaign: 'Twelve' });
      await fetch(`${run.base}/api/model`);
      assert.strictEqual((await drawn(page, 'Twelve')).panels, 12);
    });
  });

  it('a name is text, not markup', async () => {
    const view = makeView(1, { campaign: 'Marks', orderOn: [0], names: ['<b>&"x'] });
    view.panels[0].caption = '<i>"cap"</i>';
    view.panels[0].people[0].name = '<img src=x onerror="document.title=1">';
    view.panels[0].order.rows[1].name = '<b>&"x';
    const { run } = await viewServer({ view });
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      const p = await drawn(page, 'Marks');
      assert.deepStrictEqual(p.errors, []);
      assert.strictEqual(await page.evaluate('document.querySelectorAll(".panel b, .panel i, .panel img[src=x]").length'), 0, 'no element came from a name');
      const text = await page.evaluate('document.querySelector(".panel").innerText');
      assert.ok(text.includes('<b>&"x'), 'the characters show as typed');
      assert.ok(text.includes('<i>"cap"</i>'));
      assert.notStrictEqual(await page.evaluate('document.title'), '1');
    });
  });

  it('a picture shows only from the players\' own route', async () => {
    const view = makeView(1, { campaign: 'Pics' });
    view.panels[0].pcs[0].pic = 'https://example.invalid/x.png';
    view.panels[0].people[0].pic = '/vault/Characters/NPCs/x.png';
    const { run } = await viewServer({ view });
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      await drawn(page, 'Pics');
      assert.strictEqual(await page.evaluate('document.querySelectorAll("img").length'), 0, 'any other address is dropped');
    });
  });

  it('a fight panel shows the order with no foe number', async () => {
    const vault = copyOfFixture();
    const run = await startOn(vault, 0);
    const model = readRunSheet(vault, PLAN, { party: PARTY });
    const beat = model.beats.find((b) => b.title === 'Ashfall Reckoning');
    const state0 = RS.emptyState({ stateId: run.stateId, session: SESSION, plan: PLAN });
    const b = FM.rowsForFight({ model, derived: RS.derive(model, state0), state: state0, beatKey: beat.key, idBase: 'fb' });
    const foes = b.rows.filter((r) => r.kind === 'foe');
    assert.ok(foes.length >= 1);
    let seq = 0;
    const act = (a) => ({ id: `pb-${++seq}`, ...a });
    const first = (await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [
      act({ type: 'move', pc: PARTY[1], to: { beat: beat.key, spot: null, title: beat.title } }),
      act({ type: 'fightStart', beat: beat.key, title: beat.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }),
    ] }));
    const fightId = first.state ? first.state.fight.id : (await (await fetch(`${run.base}/api/state`)).json()).state.fight.id;
    let st = (await (await fetch(`${run.base}/api/state`)).json());
    const values = {};
    st.state.fight.rows.filter((r) => r.kind !== 'pc').forEach((r, i) => { values[r.id] = 17 - i; });
    const pcRow = st.state.fight.rows.find((r) => r.kind === 'pc');
    await post(run, '/api/actions', { stateId: run.stateId, base: st.rev, actions: [
      act({ type: 'rollInit', fight: fightId, values }),
      act({ type: 'fightSort', fight: fightId }),
    ] });
    st = (await (await fetch(`${run.base}/api/state`)).json());
    await post(run, '/api/actions', { stateId: run.stateId, base: st.rev, actions: [
      act({ type: 'fightNext', fight: fightId, from: null, round: 0 }),
    ] });
    st = (await (await fetch(`${run.base}/api/state`)).json());
    assert.ok(st.state.fight.started, 'the fight is running');
    const view = (await (await fetch(`${run.base}/api/players/view`)).json());
    assert.ok(view.panels[0].order, 'the panel has its order');
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      await page.waitFor('document.querySelectorAll(".panel .ord li").length > 1');
      const text = await page.evaluate('document.body.innerText');
      assert.match(text, /Round 1/i);
      assert.ok(await page.evaluate('document.querySelectorAll(".ord li.cur").length === 1'), 'one current row');
      assert.match(await page.evaluate('document.querySelector(".ord li.cur").innerText'), /▸/);
      // every number a foe row holds is nowhere on the page, less any the players may see for another reason
      // (an initiative, the round, a PC's or an ally's HP), never less what the page happens to show
      const allowed = new Set([String(st.state.fight.round)]);
      for (const r of st.state.fight.rows) {
        if (Number.isFinite(r.ini)) allowed.add(String(Math.abs(r.ini)));
        if (r.kind === 'pc' || r.kind === 'ally') for (const n of [r.hp, r.max, r.temp]) if (Number.isFinite(n)) allowed.add(String(Math.abs(n)));
      }
      const secret = new Set();
      for (const f of foes) for (const n of [f.hp, f.max, f.ac, f.mod]) if (Number.isFinite(n) && Math.abs(n) >= 10 && !allowed.has(String(Math.abs(n)))) secret.add(String(Math.abs(n)));
      assert.ok(secret.size > 0, 'there are foe numbers to look for');
      assert.ok(foes.some((f) => f.hp >= 10), 'the fixture foes have numbers to hide');
      for (const n of secret) assert.ok(!new RegExp(`\\b${n}\\b`).test(text), `${n} is not on the page`);
      assert.ok(!/\bAC\b/.test(text), 'no armour class');
      await shot(page, 'real-fight');
      assert.ok(pcRow, 'a PC row is on the order');
      assert.deepStrictEqual((await probe(page)).errors, []);
    });
  });

  it('a long order keeps the current turn in sight', async () => {
    const view = makeView(1, { campaign: 'Long', orderOn: [0] });
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push({ name: `Frost Wolf ${i + 1}`, ini: 40 - i, current: i === 26, out: false, lair: false, hp: i % 3 ? null : '9/11' });
    view.panels[0].order.rows = rows;
    const box = { view };
    const { run } = await viewServer(box);
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      await drawn(page, 'Long');
      const seen = await page.evaluate(`(() => { const li = document.querySelector('.ord li.cur'); const b = li.closest('.ord').getBoundingClientRect(); const r = li.getBoundingClientRect();
        return { inside: r.top >= b.top && r.bottom <= b.bottom, over: li.closest('.ord').scrollHeight > li.closest('.ord').clientHeight }; })()`);
      assert.strictEqual(seen.over, true, 'the order is longer than its panel');
      assert.strictEqual(seen.inside, true, 'the current row is in sight');
      await shot(page, 'long-order');
    });
  });

  it('the players\' page reconnects', async () => {
    const box = { view: makeView(2, { campaign: 'Before' }) };
    const vault = copyOfFixture();
    const first = await startOn(vault, 0, { forPlayers: () => box.view });
    const port = first.port;
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${first.base}/players?probe=1`);
      await drawn(page, 'Before');
      assert.strictEqual(await page.evaluate('document.querySelector(".conn") && getComputedStyle(document.querySelector(".conn")).display'), 'none');
      await first.close();
      await page.waitFor('document.querySelector(".conn") && getComputedStyle(document.querySelector(".conn")).display !== "none" && document.querySelector(".conn").textContent.trim() === "Not connected"');
      assert.strictEqual(await page.evaluate('document.querySelectorAll(".panel").length'), 2, 'the last picture stays up while it is down');
      box.view = makeView(3, { campaign: 'After' });
      await startOn(vault, port, { forPlayers: () => box.view });
      await drawn(page, 'After');
      await page.waitFor('getComputedStyle(document.querySelector(".conn")).display === "none"');
      assert.strictEqual(await page.evaluate('document.querySelectorAll(".panel").length'), 3, 'the new view, nothing stale');
    });
  });

  it('a second tab holds its own stream', async () => {
    const box = { view: makeView(1, { campaign: 'Tab one' }) };
    const { run, show } = await viewServer(box);
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      await drawn(page, 'Tab one');
      const other = await page.newTab(`${run.base}/players?probe=1`);
      await drawn(other, 'Tab one');
      await show(makeView(2, { campaign: 'Both' }));
      await drawn(page, 'Both');
      await drawn(other, 'Both');
    });
  });

  it('no script errors', async () => {
    const { run } = await viewServer({ view: makeView(0, { campaign: 'Quiet night' }) });
    await withPage({ width: 1920, height: 1080 }, async (page) => {
      await page.goto(`${run.base}/players?probe=1`);
      const p = await drawn(page, 'Quiet night');
      assert.strictEqual(p.panels, 0);
      assert.deepStrictEqual(p.errors, []);
      assert.strictEqual(await page.evaluate('document.body.innerText.includes("Quiet night")'), true, 'with no panel, the campaign name');
      await shot(page, 'none');
    });
  });
});
