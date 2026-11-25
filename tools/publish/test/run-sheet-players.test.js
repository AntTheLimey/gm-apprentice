'use strict';
// The players' view (plan 5b Task 6): `forPlayers` builds, from the model and the state, the only thing the
// players' window is ever sent. It is a whitelist: these tests pin its keys as well as its words.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const RS = require('../lib/run-sheet/web/state');
const M = require('../lib/run-sheet/web/fight-math');
const { forPlayers } = require('../lib/run-sheet/players');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const GILT = 'Characters/NPCs/Masked Gilt.md';
const ABBOT = 'Characters/NPCs/Hidden Abbot.md';
const QUIET = 'Characters/NPCs/Quiet Dead.md';
const VENN = 'Characters/NPCs/Brother Venn.md';
const WOLF = 'Creatures/Frost Wolf.md';
const MEPHIT = 'Creatures/Ice Mephit.md';
const GATE = 'Locations/The Gate.md';
const MAP = 'Documents/Map of the Gate.md';
const GM_MAP = 'Documents/Map of the Gate (GM).md';
const model = readRunSheet(FIXTURE, PLAN, { party: [ADA, BEN] });
const FIGHT = model.beats.find((b) => b.title === 'Ashfall Reckoning');
const HUB = model.beats.find((b) => b.spots.length > 1);
const [SPOT1, SPOT2] = HUB.spots.map((s) => s.key);
const clone = (o) => JSON.parse(JSON.stringify(o));

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
// A copy of the fixture with one note's text changed, read again.
function reread(rel, edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-players-view-'));
  made.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const file = path.join(dir, ...rel.split('/'));
  fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')));
  return readRunSheet(dir, PLAN, { party: [ADA, BEN] });
}

const picId = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 20);
const pic = (p) => `/players/pic/${picId(p)}`;
const view = (s, m = model) => forPlayers(m, s, { withheldWords: m.withheldWords, campaign: m.campaign, picId });

let n = 0;
const T0 = Date.parse('2026-11-20T19:00:00.000Z');
const now = () => new Date(T0 + (++n) * 60000).toISOString();
const fresh = () => RS.emptyState({ stateId: 's', session: 'x', plan: PLAN });
const act = (s, a) => RS.reduce(s, { id: `a${++n}`, ...a }, now());
const move = (s, pc, beat, spot) => act(s, { type: 'move', pc, to: { beat: beat.key, spot: spot || null, title: beat.title } });
// A fight on the beat as the page starts one; `bench` names notes whose rows start unticked.
const fightAt = (s, beat, { m = model, bench = [] } = {}) => {
  const id = `f${++n}`;
  const b = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: beat.key, idBase: id });
  const rows = b.rows.map((r) => (bench.some(([note, copy]) => r.note === note && (copy === undefined || r.copy === copy)) ? { ...r, in: false } : r));
  return RS.reduce(s, { id, type: 'fightStart', beat: beat.key, title: beat.title, groups: b.groups, rows, thresholds: b.thresholds }, now());
};
const F = (s, a) => act(s, { fight: s.fight.id, ...a });
const rowOf = (s, note, copy = 1) => s.fight.rows.find((r) => r.note === note && (r.kind === 'pc' || r.copy === copy));
// Ben at the fight, the fight started
const benFight = (opts) => fightAt(move(fresh(), BEN, FIGHT), FIGHT, opts);
const orderNames = (v, i = 0) => v.panels[i].order.rows.map((r) => r.name);
const orderRow = (v, name) => v.panels[0].order.rows.find((r) => r.name === name);
const keys = (o) => Object.keys(o).sort();

describe('the players\' view', () => {
  it('is a whitelist: these keys and no others', () => {
    let s = benFight();
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    const v = view(s);
    assert.deepEqual(keys(v), ['campaign', 'layout', 'panels']);
    assert.equal(v.campaign, 'The Test Campaign');
    assert.equal(v.layout, 'n1');
    const p = v.panels[0];
    assert.deepEqual(keys(p), ['backdrop', 'caption', 'id', 'order', 'pcs', 'people']);
    assert.equal(p.id, 'p1');
    for (const x of p.pcs.concat(p.people)) assert.deepEqual(keys(x), ['name', 'pic']);
    assert.deepEqual(keys(p.order), ['paused', 'round', 'rows']);
  });

  it('foe rows carry only name, ini, current, out and lair; foe and Lair rows have no hp or statuses key', () => {
    const v = view(benFight());
    const rows = v.panels[0].order.rows;
    const foes = rows.filter((r) => !('hp' in r));
    assert.ok(foes.length >= 8, 'every ticked foe and the Lair row');
    for (const r of foes) assert.deepEqual(keys(r), ['current', 'ini', 'lair', 'name', 'out']);
    const lair = rows.find((r) => r.lair);
    assert.ok(lair && !('hp' in lair) && !('statuses' in lair));
  });

  it('PC and ally rows carry HP and statuses', () => {
    let s = benFight();
    s = F(s, { type: 'hp', row: rowOf(s, BEN).id, entry: '-3' });
    s = F(s, { type: 'hp', row: rowOf(s, BEN).id, entry: 't5' });
    s = F(s, { type: 'status', row: rowOf(s, BEN).id, add: 'Prone' });
    s = F(s, { type: 'exhaustion', row: rowOf(s, BEN).id, level: 2 });
    s = F(s, { type: 'concentrating', row: rowOf(s, BEN).id, on: true });
    const venn = rowOf(s, VENN);
    s = F(s, { type: 'hp', row: venn.id, entry: `-${Math.ceil(venn.max / 2) + 1}` });
    const v = view(s);
    const ben = orderRow(v, 'Ben');
    assert.deepEqual(keys(ben), ['current', 'hp', 'ini', 'lair', 'name', 'out', 'statuses']);
    assert.equal(ben.hp, '17/20 +5');
    assert.deepEqual(ben.statuses, ['Prone', 'Exhaustion 2', 'Concentrating']);
    const ally = orderRow(v, 'Brother Venn');
    assert.ok(ally, 'an ally is named');
    assert.match(ally.hp, /^\d+\/\d+$/);
    assert.deepEqual(ally.statuses, ['Bloodied']);
  });

  it('an ally of a system with no Bloodied word shows none (CoC, GURPS): the same fight, the word given up', () => {
    let s = benFight();
    const venn = rowOf(s, VENN);
    s = F(s, { type: 'hp', row: venn.id, entry: `-${Math.ceil(venn.max / 2) + 1}` });
    assert.deepEqual(orderRow(view(s), 'Brother Venn').statuses, ['Bloodied']);
    const other = clone(model);
    other.rules.words.bloodied = '';
    assert.deepEqual(orderRow(view(s, other), 'Brother Venn').statuses, []);
  });

  it('the Lair row shows at 20', () => {
    const lair = view(benFight()).panels[0].order.rows.find((r) => r.lair);
    assert.deepEqual(lair, { name: 'Lair', ini: 20, current: false, out: false, lair: true });
  });

  it('the turn order: the round, whose turn, the number that set it, Out', () => {
    let s = benFight();
    assert.equal(view(s).panels[0].order.round, null, 'before the first turn');
    s = F(s, { type: 'setInit', row: rowOf(s, BEN).id, ini: 30 });
    s = F(s, { type: 'fightNext', from: null, round: 0 });
    s = F(s, { type: 'out', row: rowOf(s, WOLF).id, on: true });
    const o = view(s).panels[0].order;
    assert.equal(o.round, 1);
    assert.equal(o.rows[0].name, 'Ben');
    assert.equal(o.rows[0].ini, 30);
    assert.equal(o.rows[0].current, true);
    assert.equal(o.rows.filter((r) => r.current).length, 1);
    assert.equal(o.rows.filter((r) => r.out).length, 1);
  });

  it('paused keeps the order, marked', () => {
    let s = benFight();
    s = F(s, { type: 'fightPause', on: true });
    const o = view(s).panels[0].order;
    assert.equal(o.paused, true);
    assert.ok(o.rows.length > 0);
  });

  it('an unticked row is not on the order and takes no number', () => {
    let s = benFight({ bench: [[WOLF], [MEPHIT, 2]] });
    let names = orderNames(view(s));
    assert.ok(!names.includes('Ada'), 'an unticked PC is not on the order');
    assert.ok(names.includes('A mephit'), 'a lone mephit is not numbered');
    assert.ok(!names.some((x) => /^Mephit \d/.test(x)));
    assert.deepEqual(names.filter((x) => /^Stranger/.test(x)), ['Stranger 1', 'Stranger 2', 'Stranger 3', 'Stranger 4']);
    s = F(s, { type: 'fightTick', row: rowOf(s, WOLF).id, in: true });
    names = orderNames(view(s));
    assert.ok(names.includes('Stranger 5'), 'a number is given at the first tick');
  });

  it('a row whose stored word differs from the model\'s never shares a label', () => {
    let s = benFight();
    const strangers = s.fight.rows.filter((r) => r.kind === 'foe' && r.in && /^Stranger/.test(orderNames(view(s))[s.fight.rows.filter((x) => x.in).indexOf(r)]));
    assert.ok(strangers.length >= 2);
    const word = strangers[0].word;
    s = { ...s, fight: { ...s.fight, rows: s.fight.rows.map((r) => {
      if (r.id === strangers[0].id) return { ...r, word: 'a hooded one', unseenN: 1 };
      if (r.id === strangers[1].id) return { ...r, word, unseenN: 1 };
      return r;
    }) } };
    const names = orderNames(view(s)).filter((x) => /^Stranger/.test(x));
    assert.equal(new Set(names).size, names.length, names.join(', '));
  });

  it('two unseen copies are told apart', () => {
    let s = benFight();
    assert.deepEqual(orderNames(view(s)).filter((x) => /ephit/.test(x)), ['Mephit 1', 'Mephit 2']);
    s = act(s, { type: 'show', group: FIGHT.key, note: MEPHIT, on: true });
    assert.deepEqual(orderNames(view(s)).filter((x) => /ephit/.test(x)), ['Ice Mephit 1', 'Ice Mephit 2']);
  });

  it('shown then removed stays named; unseen again on untick', () => {
    let s = benFight();
    const before = orderNames(view(s));
    const i = s.fight.rows.filter((r) => r.in).findIndex((r) => r.note === WOLF);
    assert.match(before[i], /^Stranger \d$/);
    s = act(s, { type: 'show', group: FIGHT.key, note: WOLF, on: true });
    assert.equal(orderNames(view(s))[i], 'Frost Wolf');
    s = act(s, { type: 'show', group: FIGHT.key, note: WOLF, on: false });
    assert.equal(orderNames(view(s))[i], 'Frost Wolf');
    assert.deepEqual(view(s).panels[0].people, []);
    s = F(s, { type: 'seen', row: rowOf(s, WOLF).id, on: false });
    assert.equal(orderNames(view(s))[i], before[i], 'its own number again');
  });

  it('a seen withheld foe keeps the word; a seen disguised foe keeps the disguise until Unmask', () => {
    let s = benFight();
    const inRows = s.fight.rows.filter((r) => r.in);
    const ai = inRows.findIndex((r) => r.note === ABBOT);
    const gi = inRows.findIndex((r) => r.note === GILT);
    const abbotWas = orderNames(view(s))[ai];
    s = act(s, { type: 'show', group: FIGHT.key, note: ABBOT, on: true });
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    let v = view(s);
    assert.equal(orderNames(v)[ai], abbotWas);
    assert.equal(orderNames(v)[gi], 'Masked Gilt');
    s = act(s, { type: 'unmask', note: GILT, on: true, name: 'Lucan Truename', was: 'Masked Gilt' });
    v = view(s);
    assert.equal(orderNames(v)[gi], 'Lucan Truename');
    assert.ok(!JSON.stringify(v).includes('Hidden Abbot'));
  });

  it('a withheld person shows the word and no face; unmasked shows the true name and face', () => {
    let s = move(fresh(), BEN, FIGHT);
    s = act(s, { type: 'show', group: FIGHT.key, note: ABBOT, on: true });
    assert.deepEqual(view(s).panels[0].people, [{ name: 'a stranger', pic: null }]);
    const m = clone(model);
    m.notes[GILT].withheld = true;
    let t = act(move(fresh(), BEN, FIGHT), { type: 'show', group: FIGHT.key, note: GILT, on: true });
    assert.deepEqual(view(t, m).panels[0].people, [{ name: 'a stranger', pic: null }]);
    t = act(t, { type: 'unmask', note: GILT, on: true, name: 'Lucan Truename', was: 'Masked Gilt' });
    assert.deepEqual(view(t, m).panels[0].people, [{ name: 'Lucan Truename', pic: pic('_attachments/truename-face.png') }]);
    // an unmasking carried from an earlier session counts while the state is silent; masked again does not
    m.notes[GILT].unmask.since = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Table Log.md';
    const u = act(move(fresh(), BEN, FIGHT), { type: 'show', group: FIGHT.key, note: GILT, on: true });
    assert.equal(view(u, m).panels[0].people[0].name, 'Lucan Truename');
    const w = act(u, { type: 'unmask', note: GILT, on: false, was: 'Masked Gilt' });
    assert.equal(view(w, m).panels[0].people[0].name, 'a stranger');
    // the unmasked name is the note's, never words the state carries
    const x = act(move(fresh(), BEN, FIGHT), { type: 'show', group: FIGHT.key, note: QUIET, on: true });
    const y = act(x, { type: 'unmask', note: QUIET, on: true, name: 'Typed In', was: 'Quiet Dead' });
    assert.equal(view(y).panels[0].people[0].name, 'Quiet Dead');
  });

  it('a disguised NPC flips on Unmask in panels and on the turn order', () => {
    let s = benFight();
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    let v = view(s);
    assert.deepEqual(v.panels[0].people, [{ name: 'Masked Gilt', pic: pic('_attachments/gilt-face.png') }]);
    assert.ok(orderNames(v).includes('Masked Gilt'));
    s = act(s, { type: 'unmask', note: GILT, on: true, name: 'Lucan Truename', was: 'Masked Gilt' });
    v = view(s);
    assert.deepEqual(v.panels[0].people, [{ name: 'Lucan Truename', pic: pic('_attachments/truename-face.png') }]);
    assert.ok(orderNames(v).includes('Lucan Truename'));
    assert.ok(!JSON.stringify(v).includes('Masked Gilt'));
  });

  it('the server drops what is not a person or a place', () => {
    let s = move(fresh(), BEN, FIGHT);
    for (const note of [GM_MAP, MAP, PLAN, 'Characters/NPCs/Nobody.md', GATE, GILT]) s = act(s, { type: 'show', group: FIGHT.key, note, on: true });
    assert.deepEqual(view(s).panels[0].people.map((p) => p.name), ['Masked Gilt']);
    let t = act(move(fresh(), BEN, FIGHT), { type: 'showBeat', group: FIGHT.key, people: [GM_MAP, PLAN, 'Characters/NPCs/Nobody.md', GILT], place: GILT });
    let p = view(t).panels[0];
    assert.deepEqual(p.people.map((x) => x.name), ['Masked Gilt']);
    assert.deepEqual([p.backdrop, p.caption], [null, null], 'a person is no backdrop');
    t = act(t, { type: 'backdrop', group: FIGHT.key, note: 'Locations/Nowhere.md' });
    p = view(t).panels[0];
    assert.deepEqual([p.backdrop, p.caption], [null, null], 'a missing note is no backdrop');
    t = act(t, { type: 'backdrop', group: FIGHT.key, note: MAP });
    p = view(t).panels[0];
    assert.deepEqual([p.backdrop, p.caption], [pic('_attachments/gate-map.png'), 'Map of the Gate'], 'a showable map is');
  });

  it('a GM map backdrop in the state shows nothing', () => {
    let s = move(fresh(), BEN, FIGHT);
    s = act(s, { type: 'backdrop', group: FIGHT.key, note: GM_MAP });
    const v = view(s);
    assert.deepEqual([v.panels[0].backdrop, v.panels[0].caption], [null, null]);
    const text = JSON.stringify(v);
    assert.ok(!text.includes('GM') && !text.includes(picId('_attachments/gate-gm-secret.png')));
  });

  it('a GM map typed as a place is still no backdrop', () => {
    const m = clone(model);
    m.notes[GM_MAP] = { ...m.notes[GATE], path: GM_MAP, name: 'Map of the Gate (GM)', docType: 'map', portrait: m.notes[GATE].portrait.replace('gate-place', 'gate-gm-secret') };
    let s = move(fresh(), BEN, FIGHT);
    s = act(s, { type: 'backdrop', group: FIGHT.key, note: GM_MAP });
    const v = view(s, m);
    assert.deepEqual([v.panels[0].backdrop, v.panels[0].caption], [null, null]);
    assert.ok(!JSON.stringify(v).includes(picId('_attachments/gate-gm-secret.png')));
  });

  it('a group\'s place is its backdrop; a withheld place has no caption', () => {
    let s = move(fresh(), BEN, FIGHT);
    s = move(s, ADA, HUB, SPOT1);
    s = act(s, { type: 'move', pc: 'Characters/PCs/Nobody.md', to: { beat: HUB.key, spot: SPOT2 } });
    const v = view(s);
    assert.deepEqual([v.panels[0].backdrop, v.panels[0].caption], [pic('_attachments/gate-place.png'), 'The Gate']);
    assert.deepEqual([v.panels[1].backdrop, v.panels[1].caption], [pic('_attachments/gatehouse-room.png'), null]);
    assert.ok(!JSON.stringify(v).includes('Gate House'));
    assert.equal(v.panels.length, 2, 'a PC not in the party makes no panel');
  });

  it('place off and back', () => {
    let s = move(fresh(), BEN, FIGHT);
    s = act(s, { type: 'placeOff', group: FIGHT.key, on: true });
    assert.deepEqual([view(s).panels[0].backdrop, view(s).panels[0].caption], [null, null]);
    s = act(s, { type: 'placeOff', group: FIGHT.key, on: false });
    assert.equal(view(s).panels[0].caption, 'The Gate');
    // a Shown backdrop stands while the place is off
    s = act(s, { type: 'placeOff', group: FIGHT.key, on: true });
    s = act(s, { type: 'backdrop', group: FIGHT.key, note: MAP });
    assert.equal(view(s).panels[0].caption, 'Map of the Gate');
  });

  it('place off before anyone arrives holds when they do', () => {
    let s = act(fresh(), { type: 'placeOff', group: SPOT1, on: true });
    assert.deepEqual(view(s).panels, []);
    s = move(s, ADA, HUB, SPOT1);
    assert.deepEqual([view(s).panels[0].backdrop, view(s).panels[0].caption], [null, null]);
  });

  it('PCs show their first name and their face; a PC with no picture has none', () => {
    let s = move(fresh(), BEN, FIGHT);
    s = move(s, ADA, FIGHT);
    assert.deepEqual(view(s).panels[0].pcs, [{ name: 'Ada', pic: pic('_attachments/ada.png') }, { name: 'Ben', pic: null }]);
  });

  it('a renamed PC\'s name follows the note', () => {
    const m = reread(ADA, (t) => t.replace('type: pc', 'type: pc\nname: Adelaide Moss'));
    const s = move(fresh(), ADA, FIGHT);
    assert.equal(view(s).panels[0].pcs[0].name, 'Ada');
    assert.equal(view(s, m).panels[0].pcs[0].name, 'Adelaide');
  });

  it('a name never falls back to the file\'s stem', () => {
    const m = reread(QUIET, (t) => t.replace(/name: Quiet Dead\r?\n/, ''));
    const m2 = reread(GATE, (t) => t.replace(/name: The Gate\r?\n/, ''));
    let s = move(fresh(), BEN, FIGHT);
    s = act(s, { type: 'show', group: FIGHT.key, note: QUIET, on: true });
    assert.equal(view(s, m).panels[0].people[0].name, 'a stranger');
    assert.equal(view(s, m2).panels[0].caption, null);
    assert.ok(!JSON.stringify(view(s, m)).includes('Quiet'));
  });

  it('both fighting panels show the order; the third does not', () => {
    const CAL = 'Characters/PCs/Cal Ward.md';
    const m = clone(model);
    m.pcs.push({ note: CAL, name: 'Cal Ward', player: '', portrait: null, ac: 10, hpMax: 9, hpNow: 9, init: 0 });
    let s = move(fresh(), BEN, FIGHT);
    s = move(s, ADA, HUB, SPOT1);
    s = act(s, { type: 'move', pc: CAL, to: { beat: HUB.key, spot: SPOT2, title: HUB.title } });
    s = fightAt(s, FIGHT, { m });
    const id = `j${++n}`;
    const j = M.joinRows({ model: m, derived: RS.derive(m, s), state: s, fight: s.fight, add: { group: SPOT1 }, idBase: id });
    s = RS.reduce(s, { id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: '' }, now());
    const v = view(s, m);
    assert.equal(v.layout, 'n4');
    assert.deepEqual(v.panels.map((p) => p.pcs.map((x) => x.name)), [['Ben'], ['Ada'], ['Cal']]);
    assert.ok(v.panels[0].order && v.panels[1].order);
    assert.deepEqual(v.panels[0].order, v.panels[1].order, 'one turn order');
    assert.equal(v.panels[2].order, null);
    assert.ok(orderNames(v, 0).includes('Ada') && orderNames(v, 0).includes('Ben'));
  });

  it('layout names for 0, 1, 2, 3, 5, 7 and 9 groups', () => {
    const want = { 0: 'none', 1: 'n1', 2: 'n2', 3: 'n4', 4: 'n4', 5: 'n6', 6: 'n6', 7: 'n8', 8: 'n8', 9: 'n9', 12: 'n9' };
    for (const [count, layout] of Object.entries(want)) {
      const m = clone(model);
      const k = Number(count);
      m.beats = Array.from({ length: k }, (_, i) => ({ key: `b-${i}`, title: `Beat ${i}`, place: null, spots: [], who: [], foes: [], points: [], ifs: [] }));
      m.pcs = Array.from({ length: k }, (_, i) => ({ note: `Characters/PCs/P${i}.md`, name: `P${i} X`, portrait: null }));
      let s = fresh();
      for (let i = 0; i < k; i++) s = act(s, { type: 'move', pc: `Characters/PCs/P${i}.md`, to: { beat: `b-${i}`, spot: null } });
      const v = view(s, m);
      assert.equal(v.layout, layout, `${count} groups`);
      assert.equal(v.panels.length, k, 'never a panel dropped');
      assert.deepEqual(v.panels.map((p) => p.id), Array.from({ length: k }, (_, i) => `p${i + 1}`));
    }
  });

  it('pictures are opaque ids: no vault path or file name', () => {
    let s = benFight();
    s = move(s, ADA, FIGHT);
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    const text = JSON.stringify(view(s));
    for (const bad of ['_attachments', '.png', '.md', 'Characters/', 'Locations/']) assert.ok(!text.includes(bad), bad);
    assert.ok(text.includes('/players/pic/'));
  });

  it('a state with no fight or panel keys (a 5a file) still gives a view', () => {
    const s = move(fresh(), BEN, FIGHT);
    for (const k of ['fight', 'fights', 'panels', 'shownEver']) delete s[k];
    const v = view(s);
    assert.equal(v.panels.length, 1);
    assert.equal(v.panels[0].order, null);
  });
});

describe('the PR review and the proof', () => {
  const WYRM = 'Creatures/Glacier Wyrm.md';
  // retitled by plan 6a fix round 1 / review M5: under P1 the row's side is the row's, and an ally goes up
  // named only once seen; whether a row is a PC, and its unseen word, are still the model's (L1)
  it('P1: a row\'s side is the row\'s but an unseen ally row is a foe; a PC and the unseen word come from the model', () => {
    const s = clone(benFight());
    const w = s.fight.rows.find((r) => r.note === WYRM);
    w.kind = 'ally';
    assert.equal(w.seen, false, 'the hand-made ally row is unseen');
    const m1 = s.fight.rows.find((r) => r.note === MEPHIT);
    m1.word = 'The white dragon from the Plan';
    const v = view(s);
    const text = JSON.stringify(v);
    assert.ok(!text.includes('Glacier Wyrm') && !text.includes('7342'), 'a foe sent as an unseen ally is still a foe');
    assert.ok(!text.includes('white dragon'), 'the word is the model\'s');
    assert.ok(orderNames(v).includes('Mephit 1'));
    // a PC row named in the state only: no state words
    const t = clone(benFight());
    const ben = t.fight.rows.find((r) => r.note === BEN);
    ben.note = 'Characters/PCs/Nobody.md';
    ben.name = 'Secret Name';
    assert.ok(!JSON.stringify(view(t)).includes('Secret'));
  });

  // plan 6a fix round 1 / review M5, M6: the deliberate path. The GM page is the trusted author of fight rows,
  // so a row it sends as a seen ally goes up named, with its HP
  it('P1: a row sent as a seen ally goes up with its name and HP', () => {
    const s = clone(benFight());
    const w = s.fight.rows.find((r) => r.note === WYRM);
    Object.assign(w, { kind: 'ally', seen: true });
    const r = orderRow(view(s), 'Glacier Wyrm');
    assert.ok(r, 'named');
    assert.match(r.hp, /^7342\/7342$/);
    assert.ok(Array.isArray(r.statuses));
  });

  it('proof M2: a Fight where no PC stands shows the order on the panels of every ticked PC', () => {
    let s = move(fresh(), BEN, HUB, SPOT1);
    s = move(s, ADA, HUB, SPOT2);
    s = fightAt(s, FIGHT);
    const v = view(s);
    assert.equal(v.panels.length, 2);
    assert.ok(v.panels[0].order && v.panels[1].order, 'both panels show the order');
    assert.deepEqual(v.panels[0].order, v.panels[1].order);
    // a fight that has only Ben's group: Ada, ticked in later, brings her panel's order
    let t = move(fresh(), BEN, FIGHT);
    t = move(t, ADA, HUB, SPOT1);
    t = fightAt(t, FIGHT);
    assert.equal(view(t).panels[1].order, null);
    t = F(t, { type: 'fightTick', row: rowOf(t, ADA).id, in: true });
    assert.ok(view(t).panels[1].order);
  });

  it('proof Low: a Shown place with no picture keeps the group\'s own place', () => {
    const YARD = 'Locations/The Chapel Yard.md';
    const m = clone(model);
    m.notes[YARD] = { ...m.notes[GATE], path: YARD, name: 'The Chapel Yard', portrait: null };
    let s = move(fresh(), BEN, FIGHT);
    s = act(s, { type: 'backdrop', group: FIGHT.key, note: YARD });
    const p = view(s, m).panels[0];
    assert.deepEqual([p.backdrop, p.caption], [pic('_attachments/gate-place.png'), 'The Gate']);
    // with the place off there is nothing to keep
    s = act(s, { type: 'placeOff', group: FIGHT.key, on: true });
    assert.deepEqual([view(s, m).panels[0].backdrop, view(s, m).panels[0].caption], [null, null]);
  });
});
