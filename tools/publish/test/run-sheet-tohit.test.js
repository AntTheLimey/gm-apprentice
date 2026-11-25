'use strict';
// The GURPS to-hit calculator's data on the run sheet (step 6b Task 24, D7, D8): a PC's block read as the site build
// reads it, a typed skill's one-row block through the same builder, and the table server's routes for both, GURPS
// vaults only. Temp copies of test/fixtures/run-sheet-gurps and run-sheet-coc.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { buildPc } = require('./helpers/pc-vault');
const { copyFixture, removeFixture } = require('./helpers/systems-fixture');
const { buildIndex } = require('../lib/run-sheet/notes');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession } = require('../lib/run-sheet/sessions');
const { pcTohit, typedTohit, servedCss } = require('../lib/run-sheet/tohit');
const { make } = require('../js/gurps-tohit');
const { readSettings } = require('../lib/settings/read');
const { load, dataBlock, El } = require('./helpers/tohit-dom');

const SELA = 'Characters/PCs/Sela Drake.md';
const made = [];
const servers = [];
after(async () => {
  for (const t of servers) { try { await t.close(); } catch { /* closed already */ } }
  for (const d of made) removeFixture(d);
});
const fixture = (name) => { const d = copyFixture(name); made.push(d); return d; };

async function start(name, session, { calculatorOff = false } = {}) {
  const vault = fixture(name);
  if (calculatorOff) {
    const file = path.join(vault, '_meta', 'vault-config.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^player_site:\r?\n/m, (m) => `${m}  features:\n    tohit_calculator: off\n`));
  }
  const picked = pickSession(listSessions(vault), session, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party: [], deps: { delayMs: 20, log: () => {} } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  return { ...t, vault, base: `http://127.0.0.1:${port}` };
}
const post = (base, p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// The data block a built sheet page carries.
function pageBlock(html) {
  const m = /<script type="application\/json" id="gurps-tohit-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'the page carries a data block');
  return JSON.parse(m[1]);
}

describe('the to-hit calculator\'s data on the run sheet', () => {
  it('pcTohit gives the same data block the site build gives for the fixture PC', () => {
    const vault = fixture('run-sheet-gurps');
    const body = matter(fs.readFileSync(path.join(vault, ...SELA.split('/')), 'utf8')).content;
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    let built;
    try { built = buildPc('gurps-4e', body); } finally { console.log = log; console.warn = warn; }
    try {
      const site = pageBlock(built.html);
      const ours = pcTohit(buildIndex(vault), SELA, { campaignId: 'test', pcSlug: 'test-hero' });
      assert.deepStrictEqual(ours, site);
      assert.deepStrictEqual(ours.weapons.map((w) => [w.name, w.level]), [['Broadsword (swing)', 12], ['Broadsword (thrust)', 12], ['Shield bash', 12]]);
    } finally {
      fs.rmSync(built.root, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('pcTohit reads a CRLF note as it reads an LF one, and gives null for a sheet with no attack', () => {
    const lf = fixture('run-sheet-gurps');
    const crlf = copyFixture('run-sheet-gurps', { crlf: true });
    made.push(crlf);
    assert.deepStrictEqual(pcTohit(buildIndex(crlf), SELA), pcTohit(buildIndex(lf), SELA));
    assert.strictEqual(pcTohit(buildIndex(lf), 'Characters/PCs/Lysa Venn.md'), null);
    assert.strictEqual(pcTohit(buildIndex(lf), 'Characters/PCs/Nobody.md'), null);
  });

  it('typedTohit 12 melee gives one melee weapon at level 12, roll 12', () => {
    const data = typedTohit({ name: 'Bouncer', type: 'melee', level: 12 });
    assert.deepStrictEqual(data.weapons.map((w) => [w.name, w.type, w.level]), [['Bouncer', 'melee', 12]]);
    const C = make(data.rules);
    assert.strictEqual(C.effective(data, C.defaultState(data)).roll, 12);
  });

  it('typedTohit 12 ranged gives Acc 0, RoF 1', () => {
    const data = typedTohit({ name: '', type: 'ranged', level: '12' });
    const [w] = data.weapons;
    assert.deepStrictEqual([w.type, w.level, w.acc, w.rof, w.rofMult], ['ranged', 12, 0, 1, 1]);
    const C = make(data.rules);
    assert.strictEqual(C.effective(data, C.defaultState(data)).roll, 12);
  });

  it('12.5 is refused, and every level the builder would read as another number', () => {
    for (const level of [12.5, '12.5', 0, -3, '-3', 100, '', 'twelve', null, undefined, NaN, Infinity]) {
      assert.throws(() => typedTohit({ type: 'melee', level }), /whole number from 1 to 99/, String(level));
    }
    assert.throws(() => typedTohit({ type: 'thrown', level: 12 }), /melee or ranged/);
    for (const level of [1, 99, ' 7 ']) assert.ok(typedTohit({ type: 'melee', level }), String(level));
  });

  it('an empty name gives "Typed skill"', () => {
    for (const name of ['', '   ', undefined, null, 7, '[[|]]']) {
      assert.strictEqual(typedTohit({ name, type: 'melee', level: 12 }).weapons[0].name, 'Typed skill', String(name));
    }
    assert.strictEqual(typedTohit({ name: '  Brute   2 ', type: 'melee', level: 12 }).weapons[0].name, 'Brute 2');
  });

  it('no report line comes back from a typed skill: the server answers the data block alone', async () => {
    const run = await start('run-sheet-gurps', 'Session 01 - Crates');
    const res = await post(run.base, '/api/tohit/typed', { name: '', type: 'melee', level: 12 });
    assert.strictEqual(res.status, 200);
    const got = await res.json();
    assert.deepStrictEqual(Object.keys(got), ['data']);
    assert.deepStrictEqual(got.data, typedTohit({ name: '', type: 'melee', level: 12 }));
    const bad = await post(run.base, '/api/tohit/typed', { type: 'melee', level: 12.5 });
    assert.strictEqual(bad.status, 400);
    assert.match((await bad.json()).error, /whole number from 1 to 99/);
  });

  it('the server lists the PCs with weapons, gives one PC\'s block, and serves the calculator\'s script and styles', async () => {
    const run = await start('run-sheet-gurps', 'Session 01 - Crates');
    const list = await (await fetch(`${run.base}/api/tohit`)).json();
    assert.deepStrictEqual(list.pcs, [{ note: 'Characters/PCs/Corin Ash.md', name: 'Corin Ash' }, { note: SELA, name: 'Sela Drake' }]);
    const one = await fetch(`${run.base}/api/tohit?pc=${encodeURIComponent(SELA)}`);
    assert.strictEqual(one.status, 200);
    const { data } = await one.json();
    assert.deepStrictEqual(data, pcTohit(buildIndex(run.vault), SELA, { campaignId: 'the-salt-quay', pcSlug: 'sela-drake' }));
    for (const pc of ['Characters/PCs/Lysa Venn.md', 'Characters/NPCs/Rafe Kell.md', '../x.md']) {
      assert.strictEqual((await fetch(`${run.base}/api/tohit?pc=${encodeURIComponent(pc)}`)).status, 404, pc);
    }
    const js = await fetch(`${run.base}/tohit/gurps-tohit.js`);
    assert.strictEqual(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.strictEqual(await js.text(), fs.readFileSync(path.join(__dirname, '..', 'js', 'gurps-tohit.js'), 'utf8'));
    const css = await fetch(`${run.base}/tohit/tohit.css`);
    assert.strictEqual(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.strictEqual(await css.text(), servedCss(fs.readFileSync(path.join(__dirname, '..', 'css', 'tohit.css'), 'utf8')));
  });

  it("the player site's switch for the calculator does not reach the GM page (D7)", async () => {
    const run = await start('run-sheet-gurps', 'Session 01 - Crates', { calculatorOff: true });
    assert.strictEqual(readSettings({ vaultPath: run.vault }).values.player_site.features.tohit_calculator, 'off');
    const list = await (await fetch(`${run.base}/api/tohit`)).json();
    assert.strictEqual(list.pcs.length, 2);
    assert.strictEqual((await fetch(`${run.base}/api/tohit?pc=${encodeURIComponent(SELA)}`)).status, 200);
    assert.strictEqual((await post(run.base, '/api/tohit/typed', { type: 'ranged', level: 9 })).status, 200);
  });

  it('the server answers 404 on a CoC vault', async () => {
    const run = await start('run-sheet-coc', 'Session 01 - Fog Bound');
    assert.strictEqual((await fetch(`${run.base}/api/tohit`)).status, 404);
    assert.strictEqual((await fetch(`${run.base}/api/tohit?pc=${encodeURIComponent('Characters/PCs/Iris Calder.md')}`)).status, 404);
    assert.strictEqual((await post(run.base, '/api/tohit/typed', { type: 'melee', level: 12 })).status, 404);
  });
});

// mountIn (the shared script's change): the run sheet mounts the site's calculator into its own box.
describe("the calculator's mountIn, as the GM page calls it", () => {
  const mounted = (opts, { store } = {}) => {
    // no data block on the page: the site's own mount draws nothing, and the only calculator is the one in `box`
    const page = load(dataBlock(), { store, noData: true });
    assert.strictEqual(page.body.querySelectorAll('#th-weapon').length, 0);
    const box = page.body.appendChild(new El('div'));
    assert.strictEqual(page.api.mountIn(box, dataBlock(), opts), true);
    const $ = (sel) => box.querySelector(sel);
    const set = (sel, v) => { const el = $(sel); assert.ok(el, sel); el.value = String(v); page.fire(el, 'input'); page.fire(el, 'change'); };
    return { ...page, box, $, set, value: (k) => $(`#th-${k}`).value };
  };

  it('a null key reads and writes nothing; a key of its own is read and written', () => {
    const plain = mounted({ storageKey: null, narrow: true }, { store: { 'tohit-calc:six': JSON.stringify({ v: 1, state: { man: 'aod' } }) } });
    assert.strictEqual(plain.value('man'), 'attack', 'nothing read');
    plain.set('#th-man', 'committed');
    assert.deepStrictEqual([...plain.store.keys()], ['tohit-calc:six'], 'nothing written');
    const own = mounted({ storageKey: 'tohit-calc:gm-table:quay:six' }, { store: { 'tohit-calc:gm-table:quay:six': JSON.stringify({ v: 1, state: { man: 'committed' } }) } });
    assert.strictEqual(own.value('man'), 'committed');
    own.set('#th-man', 'aod');
    assert.strictEqual(JSON.parse(own.store.get('tohit-calc:gm-table:quay:six')).state.man, 'aod');
  });

  it('narrow puts th-narrow on the box; without it the box keeps its classes', () => {
    assert.ok(mounted({ narrow: true }).box.classNames().includes('th-narrow'));
    assert.ok(!mounted({}).box.classNames().includes('th-narrow'));
  });

  it('initial is laid over the saved state, and a value the calculator does not offer in initial is dropped', () => {
    const store = { k: JSON.stringify({ v: 1, state: { man: 'committed', other: '2' } }) };
    const laid = mounted({ storageKey: 'k', initial: { shock: -2, posture: -4, evaluate: 2 } }, { store });
    assert.deepStrictEqual(['man', 'other', 'shock', 'posture', 'evaluate'].map(laid.value), ['committed', '2', '-2', '-4', '2']);
    const bad = mounted({ storageKey: null, initial: { man: 'charge', shock: -9, posture: 5, evaluate: 1.5, aim: '3', weapon: 'nope', other: 'lots' } });
    assert.deepStrictEqual(['man', 'shock', 'posture', 'evaluate', 'other'].map(bad.value), ['attack', '0', '0', '0', '']);
    assert.strictEqual(bad.$('#th-weapon').value, 'Hatchet');
  });

  it('a second mount into the same box draws one calculator', () => {
    const page = mounted({ storageKey: null });
    assert.strictEqual(page.api.mountIn(page.box, dataBlock(), { storageKey: null }), true);
    assert.strictEqual(page.box.querySelectorAll('#th-weapon').length, 1);
  });
});
