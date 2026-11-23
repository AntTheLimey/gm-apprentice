'use strict';
// The fight in the run sheet's state (plan 5b Task 5): fight.js's handlers through state.js's one `reduce`,
// and what `derive` gives the page and the record. Rows come from fight-math's builders, as the page makes them.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const RS = require('../lib/run-sheet/web/state');
const M = require('../lib/run-sheet/web/fight-math');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const LUCAN = 'Characters/NPCs/Lucan Grey.md';
const WOLF = 'Creatures/Frost Wolf.md';
const ASH = 'Characters/NPCs/Brother Ash.md';
const MEPHIT = 'Creatures/Ice Mephit.md';
const DRAKE = 'Creatures/Ice Drake.md';
const GUARD = 'Characters/NPCs/Guard.md';
const base = readRunSheet(FIXTURE, PLAN, { party: [ADA, BEN] });
const clone = (o) => JSON.parse(JSON.stringify(o));
// the Gate gets an HP line a wolf can cross and one a bare Bloodied names
const model = (() => {
  const m = clone(base);
  m.beats[0].points.push({ key: `${m.beats[0].key}.pt.hp10`, text: 'Bloodied (10 HP or less): the pack breaks' });
  return m;
})();
const GATE = model.beats[0];
const HUB = model.beats[2];
const SPOT = HUB.spots[0].key;
const TOWER = model.beats[1];

const T0 = Date.parse('2026-11-20T19:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + (++tick) * 60000).toISOString();
let n = 0;
const nextId = () => `a${++n}`;
const fresh = () => RS.emptyState({ stateId: 's', session: 'x', plan: PLAN });
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };

const red = (s, a, m) => RS.reduce(s, a, now(), m);
const act = (s, a) => red(s, { id: nextId(), ...a });
const move = (s, pc, beat, spot) => act(s, { type: 'move', pc, to: { beat: beat.key, spot: spot || null, title: beat.title } });
// Fight on a beat, as the page builds it
const fightAt = (s, beat, { m = model, groups } = {}) => {
  const id = nextId();
  const b = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: beat.key, groups, idBase: id });
  return RS.reduce(s, { id, type: 'fightStart', beat: beat.key, title: beat.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, now());
};
const join = (s, add, m = model) => {
  const id = nextId();
  const j = M.joinRows({ model: m, derived: RS.derive(m, s), state: s, fight: s.fight, add, idBase: id });
  assert.equal(j.refused, null, j.refused);
  return RS.reduce(s, { id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: '' }, now());
};
const F = (s, a) => act(s, { fight: s.fight.id, ...a });
const rows = (s, note) => s.fight.rows.filter((r) => r.note === note);
const row = (s, note, copy = 1) => s.fight.rows.find((r) => r.note === note && (r.kind === 'pc' || r.copy === copy));
const next = (s) => F(s, { type: 'fightNext', from: s.fight.turn, round: s.fight.round });
const hit = (s, note, entry, copy) => F(s, { type: 'hp', row: row(s, note, copy).id, entry });
const end = (s) => F(s, { type: 'fightEnd' });
const texts = (s) => s.events.filter((e) => e.fight).map((e) => e.text);
const vital = (s, id, m = model) => RS.derive(m, s).vitals.find((v) => v.rowId === id);
const recorded = (s, id, m = model) => RS.derive(m, s).vitalsRecorded.find((v) => v.rowId === id);
// Ada at the Gate and a fight on it
const gateFight = () => fightAt(move(fresh(), ADA, GATE), GATE);

describe('the fight in the state', () => {
  it('fight start ticks the beat\'s people', () => {
    const s = gateFight();
    assert.equal(row(s, ADA).in, true);
    assert.equal(row(s, BEN).in, false, 'a PC elsewhere is listed unticked');
    assert.equal(rows(s, WOLF).length, 3);
    assert.ok(rows(s, WOLF).every((r) => r.in));
    assert.equal(row(s, LUCAN).kind, 'ally');
    assert.equal(row(s, LUCAN).in, true);
    const lair = s.fight.rows.find((r) => r.kind === 'lair');
    assert.deepEqual(lair.of, rows(s, WOLF).map((r) => r.id));
    // Brother Ash and the wolves share the withheld person word, so all four are numbered
    assert.equal(row(s, ASH).unseenN, 1);
    assert.deepEqual(rows(s, WOLF).map((r) => r.unseenN), [2, 3, 4], 'numbered when first ticked in');
    // changed on purpose by plan 6a fix round 1 / review M4: Lucan is an inferred ally (the Plan's quick
    // reference), so he starts unseen and keeps a number in the stranger run like a foe
    assert.equal(row(s, LUCAN).seen, false);
    assert.equal(row(s, LUCAN).unseenN, 5, 'an unseen ally keeps a number');
    assert.equal(rows(s, WOLF)[0].word, 'a stranger', 'the withheld person word');
    assert.deepEqual(s.fight.groups, [GATE.key]);
    assert.equal(s.fight.round, 0);
    assert.equal(s.fight.turn, null);
    assert.deepEqual(texts(s), ['Fight starts at The Gate.']);
    assert.ok(s.events.every((e) => e.beat === GATE.key));
  });

  it('a second fightStart is dropped', () => {
    const s = gateFight();
    const s2 = fightAt(s, TOWER);
    assert.equal(s2.fight.id, s.fight.id);
    assert.deepEqual(s2.fight.rows, s.fight.rows);
    assert.equal(texts(s2).length, 1);
  });

  it('two Nexts built on the same turn advance once', () => {
    let s = gateFight();
    const a = { type: 'fightNext', fight: s.fight.id, from: null, round: 0 };
    s = red(s, { id: 'n1', ...a });
    const first = s.fight.turn;
    s = red(s, { id: 'n2', ...a });
    assert.equal(s.fight.turn, first, 'the second Next built before the start is dropped');
    const b = { type: 'fightNext', fight: s.fight.id, from: s.fight.turn, round: 1 };
    s = red(s, { id: 'n3', ...b });
    const second = s.fight.turn;
    assert.notEqual(second, first);
    s = red(s, { id: 'n4', ...b });
    assert.equal(s.fight.turn, second, 'a Next built on a turn that moved on is dropped');
    s = red(s, { id: 'n5', ...b, from: second, round: 2 });
    assert.equal(s.fight.turn, second, 'the wrong round is dropped');
  });

  it('an action for an ended fight changes nothing', () => {
    let s = gateFight();
    const old = s.fight.id;
    const wolf = row(s, WOLF).id;
    s = end(s);
    s = fightAt(s, GATE);
    const before = s.fight.rows;
    for (const a of [{ type: 'hp', row: wolf, entry: '-5' }, { type: 'fightNext', from: null, round: 0 }, { type: 'fightPause', on: true }, { type: 'fightEnd' }]) {
      s = act(s, { ...a, fight: old });
    }
    assert.deepEqual(s.fight.rows, before);
    assert.equal(s.fight.paused, false);
    assert.equal(s.fight.turn, null);
    // and a row this fight does not hold
    const s2 = F(s, { type: 'hp', row: 'nope', entry: '-5' });
    assert.deepEqual(s2.fight, s.fight);
    // with no fight running, every fight action is a no-op
    const e = end(s);
    assert.equal(e.fight, null);
    assert.deepEqual(act(e, { type: 'hp', fight: s.fight.id, row: wolf, entry: '-5' }).fights, e.fights);
  });

  it('a second fight starts from the first\'s figures', () => {
    let s = gateFight();
    s = hit(s, ADA, '-10');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = F(s, { type: 'exhaustion', row: row(s, ADA).id, level: 1 });
    s = F(s, { type: 'concentrating', row: row(s, ADA).id, on: true });
    s = F(s, { type: 'hp', row: row(s, ADA).id, entry: 't5' });
    s = end(s);
    s = fightAt(s, GATE);
    const ada = row(s, ADA);
    assert.equal(ada.hp, 12);
    assert.equal(ada.max, 30);
    assert.deepEqual(ada.conds, ['Prone']);
    assert.equal(ada.exhaustion, 1);
    assert.equal(ada.conc, false, 'concentration starts empty');
    assert.equal(ada.temp, 0, 'temp starts empty');
    assert.deepEqual(ada.start, { hp: 12, max: 30, conds: ['Prone'], exhaustion: 1, conc: false });
  });

  it('a long rest between fights', () => {
    let s = gateFight();
    s = hit(s, ADA, '-10');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Stable' });
    s = F(s, { type: 'exhaustion', row: row(s, ADA).id, level: 2 });
    s = end(s);
    s = act(s, { type: 'longRest' });
    assert.equal(vital(s, ADA).conditions, 'Prone, Exhaustion 1');
    s = fightAt(s, GATE);
    const ada = row(s, ADA);
    assert.equal(ada.hp, 30, 'at max');
    assert.equal(ada.exhaustion, 1, 'one lower');
    assert.deepEqual(ada.conds, ['Prone'], 'Prone kept, Stable gone');
  });

  it('a status cleared after a long rest keeps the rest\'s Exhaustion step', () => {
    const base = () => {
      let s = gateFight();
      s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
      s = F(s, { type: 'exhaustion', row: row(s, ADA).id, level: 2 });
      return end(s);
    };
    const conds = (s) => vital(s, ADA).conditions;
    const clear = (s, t) => RS.reduce(s, { id: nextId(), type: 'afterClear', fight: s.fights[0].id, row: s.fights[0].rows.find((r) => r.note === ADA).id, status: 'Prone' }, t);
    const rest = (s, t) => RS.reduce(s, { id: nextId(), type: 'longRest' }, t);
    const plus = (s, m) => new Date(Date.parse(s.fights[0].endedAt) + m * 60000).toISOString();
    // F: nothing after the rest
    let s = base();
    assert.equal(conds(rest(s, plus(s, 5))), 'Prone, Exhaustion 1');
    // G: Prone cleared on the ended fight after the rest
    s = base();
    assert.equal(conds(clear(rest(s, plus(s, 5)), plus(s, 10))), 'Exhaustion 1');
    // H: Prone cleared before the rest, then the rest
    s = base();
    assert.equal(conds(rest(clear(s, plus(s, 4)), plus(s, 5))), 'Exhaustion 1');
  });

  it('an initiative typed after an end-panel clear leaves the clear standing', () => {
    let s = gateFight();
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = act(s, { type: 'endSet', vitals: { [ADA]: { conditions: '' } } });
    s = F(s, { type: 'setInit', row: row(s, ADA).id, ini: 14 });
    s = F(s, { type: 'half', row: row(s, ADA).id, on: true });
    assert.equal(vital(s, ADA).conditions, '');
    // a status the fight adds after the clear still wins
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Grappled' });
    assert.equal(vital(s, ADA).conditions, 'Prone, Grappled');
  });

  it('a clear after the fight takes its status off what the end panel holds', () => {
    let s = gateFight();
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Frightened' });
    s = end(s);
    s = act(s, { type: 'endSet', vitals: { [ADA]: { conditions: 'Prone, Poisoned' } } });
    s = act(s, { type: 'afterClear', fight: s.fights[0].id, row: s.fights[0].rows.find((r) => r.note === ADA).id, status: 'Prone' });
    assert.equal(vital(s, ADA).conditions, 'Poisoned');
    // Clear all takes off only what the fight still held
    s = act(s, { type: 'afterClear', fight: s.fights[0].id, row: s.fights[0].rows.find((r) => r.note === ADA).id, all: true });
    assert.equal(vital(s, ADA).conditions, 'Poisoned');
  });

  it('an end-panel 0 HP set before a long rest means the rest does nothing', () => {
    let s = move(fresh(), ADA, GATE);
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 0 } } });
    s = act(s, { type: 'longRest' });
    const v = vital(s, ADA);
    assert.equal(v.hp, 0);
    assert.equal(v.restSkipped, true);
    // a non-zero HP set before it is restored to full
    let t = move(fresh(), ADA, GATE);
    t = act(t, { type: 'endSet', vitals: { [ADA]: { hp: 5 } } });
    t = act(t, { type: 'longRest' });
    assert.equal(vital(t, ADA).hp, vital(t, ADA).max);
  });

  it('a second fight after a skipped rest keeps the skip and its own HP', () => {
    let s = gateFight();
    s = hit(s, ADA, `-${row(s, ADA).hp}`);
    s = end(s);
    s = act(s, { type: 'longRest' });
    assert.equal(vital(s, ADA).restSkipped, true);
    s = fightAt(s, GATE);
    assert.equal(row(s, ADA).hp, 0);
    s = hit(s, ADA, '+4');
    s = end(s);
    const v = vital(s, ADA);
    assert.equal(v.hp, 4, 'the later fight is the current figure');
    assert.equal(v.restSkipped, true, 'the rest still saw the 0 the first fight left');
  });

  it('temp HP alone never makes the fight\'s older HP the newer figure', () => {
    let s = gateFight();
    s = hit(s, ADA, '-10');
    const hpNow = row(s, ADA).hp;
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: hpNow + 6 } } });
    s = hit(s, ADA, 't5');
    assert.equal(vital(s, ADA).hp, hpNow + 6, 'temp HP given');
    s = hit(s, ADA, '-3');
    assert.equal(vital(s, ADA).hp, hpNow + 6, 'a hit the temp HP soaked whole');
    s = F(s, { type: 'area', amount: 4, hits: [{ row: row(s, ADA).id }] });
    assert.equal(row(s, ADA).hp, hpNow - 2, 'the area hit went past the temp HP');
    assert.equal(vital(s, ADA).hp, hpNow - 2, 'and a hit that reaches HP wins');
  });

  it('a row with no HP still loses its temp HP to a hit', () => {
    let s = gateFight();
    const id = row(s, WOLF).id;
    s = { ...s, fight: { ...s.fight, rows: s.fight.rows.map((r) => (r.id === id ? { ...r, hp: null, max: null } : r)) } };
    s = F(s, { type: 'hp', row: id, entry: 't5' });
    s = F(s, { type: 'hp', row: id, entry: '3' });
    const r = s.fight.rows.find((x) => x.id === id);
    assert.deepEqual([r.hp, r.temp], [null, 2]);
  });

  it('an end-panel edit between fights wins', () => {
    let s = gateFight();
    s = hit(s, ADA, '-10');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = end(s);
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 18 } } });
    assert.equal(vital(s, ADA).hp, 18);
    assert.equal(vital(s, ADA).source, 'end');
    s = fightAt(s, GATE);
    assert.equal(row(s, ADA).hp, 18);
    assert.deepEqual(row(s, ADA).conds, ['Prone'], 'the conditions the end panel left alone are the fight\'s');
  });

  it('a long rest after a fight wins over the fight\'s figure; one before it loses', () => {
    let s = gateFight();
    s = hit(s, ADA, '-10');
    s = end(s);
    const after = act(s, { type: 'longRest' });
    assert.equal(vital(after, ADA).hp, 30);
    assert.equal(vital(after, ADA).source, 'rest');
    let t = act(move(fresh(), ADA, GATE), { type: 'longRest' });
    t = fightAt(t, GATE);
    t = hit(t, ADA, '-10');
    assert.equal(vital(t, ADA).hp, 20, 'the fight after the rest wins');
    assert.equal(vital(t, ADA).source, 'fight');
    // undoing the rest gives the fight's figure back
    assert.equal(vital(act(after, { type: 'longRest', on: false }), ADA).hp, 12);
  });

  it('a 5a end-panel row with no at loses to a fight row', () => {
    let s = move(fresh(), ADA, GATE);
    s = { ...s, end: { ...s.end, vitals: { [ADA]: { hp: 5, conditions: 'Winded' } } } };
    s = fightAt(s, GATE);
    assert.equal(row(s, ADA).hp, 5, 'the fight starts from it');
    s = hit(s, ADA, '-2');
    const v = vital(s, ADA);
    assert.equal(v.hp, 3);
    assert.equal(v.source, 'fight');
    assert.equal(v.conditions, 'Winded');
  });

  it('attach carries a fight', () => {
    const m = clone(model);
    m.beats[0].ifs.push({ key: `${GATE.key}.if.bl`, do: 'Bloodied', then: 'it flees' });
    let s = act(move(fresh(), ADA, GATE), { type: 'move', pc: BEN, to: { beat: HUB.key, spot: SPOT, title: HUB.title } });
    s = fightAt(s, GATE, { m });
    // a queued join built before the attach names the old group
    const id = nextId();
    const j = M.joinRows({ model: m, derived: RS.derive(m, s), state: s, fight: s.fight, add: { group: GATE.key }, idBase: id });
    s = hit(s, WOLF, '-6');
    assert.ok(Object.keys(s.fight.lit).length, 'the 10 HP line lit');
    const NEW = 'b-new';
    s = act(s, { type: 'attach', from: GATE.key, to: NEW });
    assert.equal(s.fight.beat, NEW);
    assert.deepEqual(s.fight.groups, [NEW]);
    assert.ok(s.fight.thresholds.every((t) => t.beat === NEW && t.key.startsWith(`${NEW}.`)));
    assert.ok(Object.keys(s.fight.lit).every((k) => k.startsWith(`${NEW}.`)));
    assert.ok(rows(s, WOLF).every((r) => r.foeKey.startsWith(`${NEW}.`)));
    assert.equal(row(s, ADA).group, NEW);
    s = RS.reduce(s, { id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: [GATE.key], thresholds: j.thresholds, label: 'x' }, now());
    assert.deepEqual(s.fight.groups, [NEW], 'the old group is remapped, not added');
    // an ended fight follows too
    s = end(s);
    s = act(s, { type: 'attach', from: NEW, to: 'b-newer' });
    assert.equal(s.fights[0].beat, 'b-newer');
    assert.equal(s.fights[0].rows.find((r) => r.note === ADA).group, 'b-newer');
  });

  it('a fight whose beat left the Plan still runs', () => {
    let s = gateFight();
    s = act(s, { type: 'attach', from: GATE.key, to: 'b-gone' });
    const d = RS.derive(model, s);
    assert.equal(d.fight.view.beatGone, true);
    s = next(s);
    assert.equal(s.fight.round, 1);
    assert.equal(RS.derive(model, gateFight()).fight.view.beatGone, false);
  });

  it('a labelled join of only benched newcomers logs nothing', () => {
    let s = move(fresh(), ADA, GATE);
    s = fightAt(s, GATE);
    const before = texts(s).length;
    const id = nextId();
    const j = M.joinRows({ model, derived: RS.derive(model, s), state: s, fight: s.fight, add: { group: SPOT }, idBase: id });
    const benched = j.rows.filter((r) => r.in === false && r.kind !== 'pc');
    assert.ok(benched.length, 'the spot brings a benched person');
    s = RS.reduce(s, { id, type: 'fightJoin', fight: s.fight.id, rows: benched, tick: [], groups: [], thresholds: [], label: 'Sister Fen' }, now());
    assert.equal(texts(s).length, before, 'no line for nobody coming in');
  });

  it('changed means differs from the start', () => {
    let s = gateFight();
    s = hit(s, ADA, '-5');
    s = hit(s, ADA, '+5');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = F(s, { type: 'status', row: row(s, ADA).id, remove: 'Prone' });
    assert.equal(recorded(s, ADA), undefined, 'touched and put back is not recorded');
    s = hit(s, ADA, '-1');
    assert.equal(recorded(s, ADA).hp, 21);
  });

  it('a fight spans two groups', () => {
    let s = move(fresh(), ADA, GATE);
    s = move(s, BEN, HUB, SPOT);
    s = fightAt(s, GATE);
    s = next(s);
    const turn = s.fight.turn;
    assert.equal(row(s, BEN).in, false);
    s = join(s, { group: SPOT });
    assert.deepEqual(s.fight.groups, [GATE.key, SPOT]);
    assert.equal(s.fight.turn, turn, 'the turn unchanged');
    assert.equal(row(s, BEN).in, true, 'the joined PC ticked');
    assert.equal(s.fight.rows.filter((r) => r.kind === 'pc').length, 2, 'no second row for him');
    assert.equal(rows(s, LUCAN).length, 1, 'Lucan, planned on both beats, is one row');
    assert.equal(texts(s).at(-1), 'Ben Hart joins the fight.');
    assert.equal(RS.derive(model, s).fight.id, s.fight.id, 'one fight');
  });

  it('a group joined from two windows at once brings its planned foes once', () => {
    const m = clone(model);
    m.beats[2].foes.push({ key: `${HUB.key}.foe.imp`, note: MEPHIT, name: 'Ice Mephit', ally: false, ac: 11, hp: 21, init: 1 });
    let s = move(fresh(), ADA, GATE);
    s = move(s, BEN, HUB, SPOT);
    s = fightAt(s, GATE, { m });
    // both windows build the join on the same state, before either lands
    const build = (id) => {
      const j = M.joinRows({ model: m, derived: RS.derive(m, s), state: s, fight: s.fight, add: { group: SPOT }, idBase: id });
      return { id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: '', planned: true };
    };
    const one = build('w1');
    const two = build('w2');
    s = RS.reduce(RS.reduce(s, one, now()), two, now());
    assert.equal(rows(s, MEPHIT).length, 1, 'one Mephit, not two');
    assert.equal(rows(s, BEN).length, 1);
    assert.equal(texts(s).filter((x) => /joins? the fight/.test(x)).length, 1, 'one line in the log');
    // Add by name keeps its copies
    s = join(s, { cast: MEPHIT, count: 2 });
    assert.equal(rows(s, MEPHIT).length, 3);
  });

  it('copies', () => {
    let s = gateFight();
    s = join(s, { cast: MEPHIT, count: 2 });
    s = join(s, { cast: MEPHIT, count: 1 });
    assert.deepEqual(rows(s, MEPHIT).map((r) => r.copy), [1, 2, 3]);
    // plan 6a fix round 1 / review M4: the unseen Lucan holds 5 in the stranger run
    assert.deepEqual(rows(s, MEPHIT).map((r) => r.unseenN), [6, 7, 8], 'they share the stranger word with Ash, the wolves and Lucan');
    const d = RS.derive(model, s);
    assert.deepEqual(d.fight.view.rows.filter((r) => r.note === MEPHIT).map((r) => r.gmName), ['Ice Mephit 1', 'Ice Mephit 2', 'Ice Mephit 3']);
    // ally copies get rowIds note, note#2
    const am = clone(model);
    const guard = (k) => ({ key: k, note: GUARD, name: 'Guard', ally: true, ac: 12, hp: 11, init: 0 });
    am.beats[0].foes = [guard('g1'), guard('g2')];
    let t = fightAt(move(fresh(), ADA, GATE), GATE, { m: am });
    t = F(t, { type: 'hp', row: row(t, GUARD, 2).id, entry: '-4' });
    t = F(t, { type: 'hp', row: row(t, GUARD, 1).id, entry: '-1' });
    const rec = RS.derive(am, t).vitalsRecorded;
    assert.equal(rec.find((v) => v.rowId === `${GUARD}#2`).hp, 7);
    assert.equal(rec.find((v) => v.rowId === GUARD).hp, 10);
  });

  it('rollInit fills only empty boxes', () => {
    let s = gateFight();
    const [w1, w2] = rows(s, WOLF);
    s = F(s, { type: 'setInit', row: w1.id, ini: 3 });
    s = F(s, { type: 'rollInit', values: { [w1.id]: 19, [w2.id]: 7, [row(s, ADA).id]: 15, nope: 4 } });
    assert.equal(row(s, WOLF, 1).ini, 3, 'the typed number wins');
    assert.equal(row(s, WOLF, 2).ini, 7);
    assert.equal(row(s, ADA).ini, null, 'a PC is never rolled');
    s = F(s, { type: 'setInit', row: w1.id, ini: null });
    assert.equal(row(s, WOLF, 1).ini, null);
  });

  it('a Lair row whose owners are all Out is not in round one\'s line', () => {
    let s = gateFight();
    for (const w of rows(s, WOLF)) s = F(s, { type: 'out', row: w.id, on: true });
    s = next(s);
    assert.notEqual(s.fight.rows.find((r) => r.id === s.fight.turn).kind, 'lair');
    assert.doesNotMatch(texts(s).find((x) => x.startsWith('Round 1:')), /Lair/);
  });

  it('first Next sorts once; a number typed after Start moves that one row; Sort keeps the turn', () => {
    let s = gateFight();
    const set = (note, ini, copy) => { s = F(s, { type: 'setInit', row: row(s, note, copy).id, ini }); };
    set(ADA, 5); set(WOLF, 18, 1); set(WOLF, 10, 2); set(WOLF, 2, 3); set(LUCAN, 12); set(ASH, 1);
    assert.equal(s.fight.sorted, false);
    s = next(s);
    assert.equal(s.fight.sorted, true);
    const order = s.fight.rows.filter((r) => r.in).map((r) => r.id);
    assert.equal(s.fight.rows.find((r) => r.id === s.fight.turn).kind, 'lair', 'the Lair row on 20 goes first');
    assert.match(texts(s).at(-1), /^Round 1: Lair action 20, Frost Wolf 1 18, Lucan Grey 12, Frost Wolf 2 10, Ada Moss 5, Frost Wolf 3 2, Brother Ash 1\.$/);
    s = next(s);
    const turn = s.fight.turn;
    // Ruling "latest entry wins" (step6.md): after Start a typed number places that one row, by one insert at
    // its sorted place. The others keep the order they have, and the turn stays with its row. (5b pinned the
    // opposite, "typing does not re-sort"; that is changed on purpose.)
    set(ASH, 30);
    const moved = s.fight.rows.filter((r) => r.in).map((r) => r.id);
    assert.equal(moved[0], row(s, ASH).id, 'Brother Ash at 30 goes to the top by one insert');
    assert.deepEqual(moved.filter((id) => id !== row(s, ASH).id), order.filter((id) => id !== row(s, ASH).id), 'the rest are not re-sorted');
    assert.equal(s.fight.turn, turn, 'the turn stays with its row');
    s = F(s, { type: 'fightSort' });
    assert.equal(s.fight.rows.filter((r) => r.in)[0].note, ASH);
    assert.equal(s.fight.turn, turn, 'the turn stays with its row');
  });

  it('setInit after Start inserts one row and keeps the turn; before Start it changes the number only', () => {
    let s = gateFight();
    const set = (note, ini, copy) => { s = F(s, { type: 'setInit', row: row(s, note, copy).id, ini }); };
    const ids = () => s.fight.rows.map((r) => r.id);
    const before = ids();
    set(WOLF, 15, 3);
    assert.deepEqual(ids(), before, 'before Start the order is not touched');
    assert.equal(row(s, WOLF, 3).typed, true);
    set(ADA, 5); set(WOLF, 18, 1); set(WOLF, 10, 2); set(LUCAN, 12); set(ASH, 1);
    s = next(s);
    s = next(s);
    const turn = s.fight.turn;
    const was = s.fight.rows.map((r) => r.id);
    const lines = texts(s).length;
    set(WOLF, 16, 2);
    // Wolf 2 goes from 10 to 16, between Wolf 1 (18) and Wolf 3 (15): one row moved, the others stand where they were
    const cut = (list, id) => list.filter((x) => x !== id);
    assert.deepEqual(cut(ids(), row(s, WOLF, 2).id), cut(was, row(s, WOLF, 2).id), 'one row moved, nothing else');
    assert.equal(s.fight.turn, turn, 'the turn stays with its row');
    assert.equal(s.fight.rows.find((r) => r.id === s.fight.turn).id, turn);
    assert.equal(texts(s).length, lines + 1, 'and the log says so');
    assert.match(texts(s).at(-1), /Frost Wolf 2.*16/);
    set(WOLF, 16, 2);
    assert.equal(texts(s).length, lines + 1, 'the same number again says nothing');
  });

  // Add by a typed name (no note), as the page sends it after "+ New"; answers the new state and the join's id.
  const addNamed = (s, name, count, m = model) => {
    const id = nextId();
    const j = M.joinRows({ model: m, derived: RS.derive(m, s), state: s, fight: s.fight, add: { name, count }, idBase: id });
    assert.equal(j.refused, null, j.refused);
    return [RS.reduce(s, { id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: `${name}${count > 1 ? ` ×${count}` : ''}` }, now()), id];
  };
  const playersOrder = (s) => RS.derive(model, s) && require('../lib/run-sheet/players').forPlayers(model, s, { withheldWords: { person: 'someone' } }).panels.find((p) => p.order).order.rows.map((r) => r.name);

  it('add a typed name nobody has, by choosing New: three blank Bouncers, unseen', () => {
    let s = gateFight();
    const [t, id] = addNamed(s, 'Bouncer', 3);
    s = t;
    const b = s.fight.rows.filter((r) => /^Bouncer/.test(r.name));
    assert.deepEqual(b.map((r) => r.name), ['Bouncer 1', 'Bouncer 2', 'Bouncer 3']);
    assert.ok(b.every((r) => r.kind === 'foe' && r.seen === false && r.in && r.note === null && r.hp === null && r.joinId === id));
    assert.ok(playersOrder(s).every((n) => !/Bouncer/.test(n)), 'the players never see a typed name');
    assert.match(texts(s).at(-1), /^Bouncer ×3 join the fight\.$/);
    assert.equal(s.events.at(-1).join, id, 'the join line carries its id, for Undo');
  });

  it('a cast name still adds the note', () => {
    let s = gateFight();
    s = join(s, { cast: MEPHIT, count: 2 });
    assert.equal(rows(s, MEPHIT).length, 2);
    assert.ok(rows(s, MEPHIT).every((r) => r.note === MEPHIT && r.joinId));
  });

  it('sameForAll copies to the untouched only', () => {
    let s = gateFight();
    [s] = addNamed(s, 'Bouncer', 4);
    const [b1, b2, b3, b4] = s.fight.rows.filter((r) => /^Bouncer/.test(r.name));
    s = F(s, { type: 'setMax', row: b1.id, max: 30 });
    s = F(s, { type: 'setAc', row: b1.id, ac: 14 });
    s = F(s, { type: 'setAc', row: b2.id, ac: 9 });
    s.fight.rows.find((r) => r.id === b1.id).mod = 3;
    const src = s.fight.rows.find((r) => r.id === b1.id);
    src.str = 17; src.seen = true; src.seenTick = true; src.sideFrom = 'you set it'; src.neutral = true; src.kind = 'ally';
    s.fight.rows.find((r) => r.id === b1.id).ini = 8;
    s = F(s, { type: 'sameForAll', row: b1.id });
    const get = (id) => s.fight.rows.find((r) => r.id === id);
    for (const id of [b3.id, b4.id]) {
      assert.deepEqual([get(id).max, get(id).hp, get(id).ac, get(id).mod], [30, 30, 14, 3], 'an untouched copy');
      // only the stat keys are copied: never a side, a seen mark, typed, or a number a system has not declared
      assert.deepEqual([get(id).str, get(id).seen, get(id).seenTick, get(id).sideFrom, get(id).neutral, get(id).kind, get(id).typed], [undefined, false, null, null, false, 'foe', false]);
      assert.equal(get(id).ini, null, 'initiative is not copied');
      assert.equal(get(id).typed, false, 'copying is not typing');
    }
    assert.equal(get(b2.id).ac, 9, 'a row someone typed into is left alone');
    assert.equal(get(b2.id).max, null);
    assert.match(texts(s).at(-1), /Bouncer 3, Bouncer 4.*Bouncer 1/);
    // another group and a PC are never touched
    assert.equal(row(s, WOLF, 1).max === 30, false);
    // nothing untouched: nothing happens, nothing is said
    s = F(s, { type: 'setMax', row: b3.id, max: 31 });
    s = F(s, { type: 'setMax', row: b4.id, max: 32 });
    const n = texts(s).length;
    s = F(s, { type: 'sameForAll', row: b1.id });
    assert.equal(get(b3.id).max, 31);
    assert.equal(texts(s).length, n, 'a pass with nothing to copy is silent');
  });

  it('sameForAll never overwrites a wounded copy or one with a status', () => {
    let s = gateFight();
    [s] = addNamed(s, 'Bouncer', 4);
    const [b1, b2, b3, b4] = s.fight.rows.filter((r) => /^Bouncer/.test(r.name));
    const get = (id) => s.fight.rows.find((r) => r.id === id);
    s = F(s, { type: 'setMax', row: b2.id, max: 20 });
    s.fight.rows.find((r) => r.id === b2.id).typed = false; // hp 20/20 from a stat block, not typed: only the wound should protect it
    s = F(s, { type: 'hp', row: b2.id, entry: '-4' });
    s = F(s, { type: 'status', row: b4.id, add: 'Prone' });
    s = F(s, { type: 'setMax', row: b1.id, max: 11 });
    s = F(s, { type: 'sameForAll', row: b1.id });
    assert.deepEqual([get(b3.id).max, get(b3.id).hp], [11, 11], 'the untouched copy gets it');
    assert.deepEqual([get(b2.id).max, get(b2.id).hp], [20, 16], 'a wounded copy keeps its numbers and HP');
    assert.equal(get(b4.id).max, null, 'a copy with a status is left alone');
    // a second copy may overwrite the first (a copy is not a touch), even though a line names it
    s = F(s, { type: 'setMax', row: b1.id, max: 12 });
    s = F(s, { type: 'sameForAll', row: b1.id });
    assert.deepEqual([get(b3.id).max, get(b3.id).hp], [12, 12]);
  });

  it('undoAdd takes back an untouched add, and the log says so', () => {
    let s = gateFight();
    s = join(s, { cast: MEPHIT, count: 2 });
    const rowsBefore = s.fight.rows.map((r) => r.id);
    const wordOf = (r) => r.word || '';
    const labels = (x) => [...M.unseenLabels(x.fight.rows, wordOf)];
    const was = { order: playersOrder(s), labels: labels(s), vitals: RS.derive(model, s).vitalsRecorded.length, events: s.events.filter((e) => !e.join).length };
    const [t, id] = addNamed(s, 'Bouncer', 13);
    s = t;
    assert.equal(s.fight.rows.length, rowsBefore.length + 13);
    s = F(s, { type: 'undoAdd', join: id });
    assert.deepEqual(s.fight.rows.map((r) => r.id), rowsBefore, 'the order is as it was');
    assert.deepEqual(playersOrder(s), was.order, 'the order and the players\' labels are as before');
    assert.deepEqual(labels(s), was.labels);
    assert.match(texts(s).at(-1), /^Took back: Bouncer ×13\.$/);
    assert.ok(texts(s).every((x) => !/Bouncer \d/.test(x)), 'no line names an undone row');
    assert.ok(s.events.every((e) => e.join !== id), 'the join line goes with its rows');
    // a second undo of the same join does nothing
    const before = JSON.stringify(s);
    s = F(s, { type: 'undoAdd', join: id });
    assert.equal(JSON.stringify(s.fight), JSON.stringify(JSON.parse(before).fight));
    assert.equal(texts(s).filter((x) => /Took back/.test(x)).length, 1);
    // and the next add numbers from 1 again
    [s] = addNamed(s, 'Bouncer', 2);
    assert.deepEqual(s.fight.rows.filter((r) => /^Bouncer/.test(r.name)).map((r) => r.name), ['Bouncer 1', 'Bouncer 2']);
  });

  it('Start and a round end do not touch an add; undo takes its names out of every roster line', () => {
    let s = gateFight();
    let id;
    [s, id] = addNamed(s, 'Bouncer', 3);
    s = next(s);
    assert.match(texts(s).find((x) => x.startsWith('Round 1:')), /Bouncer 1/);
    s = next(s);
    // wrap the round by hand, the way the last turn does: the roster names everyone, nobody has acted on the Bouncers
    const lastId = s.fight.rows.filter((r) => M.takesTurn(r, s.fight.rows)).at(-1).id;
    s.fight.turn = lastId;
    s = next(s);
    assert.ok(texts(s).some((x) => /^Round 1 ends:.*Bouncer 1/.test(x)), 'a round end names them');
    assert.ok(s.fight.rows.filter((r) => /^Bouncer/.test(r.name)).every((r) => !r.logged), 'a roster line is not a touch');
    s.fight.rows.filter((r) => /^Bouncer/.test(r.name)).forEach((r) => { r.turned = false; });
    assert.equal(M.undoable(s.fight, id), true, 'Undo is still offered');
    s = F(s, { type: 'undoAdd', join: id });
    assert.ok(!s.fight.rows.some((r) => /^Bouncer/.test(r.name)));
    assert.ok(texts(s).every((x) => !/Bouncer \d/.test(x) || /^Took back/.test(x)), 'no roster line names an undone row');
    assert.match(texts(s).find((x) => x.startsWith('Round 1:')), /^Round 1: .*\.$/);
    assert.doesNotMatch(require('../lib/run-sheet/record').tableLogBody(model, s, { linkFor: (p) => `[[${p}]]` }), /Bouncer/);
  });

  it('Roll after Start places each filled row, in the order rolled, and keeps the turn', () => {
    let s = gateFight();
    const set = (note, ini, copy) => { s = F(s, { type: 'setInit', row: row(s, note, copy).id, ini }); };
    set(ADA, 5); set(WOLF, 18, 1); set(WOLF, 10, 2); set(WOLF, 2, 3); set(LUCAN, 12); set(ASH, 1);
    s = next(s); s = next(s);
    let id;
    [s, id] = addNamed(s, 'Bouncer', 3);
    const turn = s.fight.turn;
    const [b1, b2, b3] = s.fight.rows.filter((r) => /^Bouncer/.test(r.name));
    const lines = texts(s).length;
    s = F(s, { type: 'rollInit', values: { [b1.id]: 15, [b2.id]: 11, [b3.id]: 3 } });
    const inis = s.fight.rows.filter((r) => r.in && r.kind !== 'lair').map((r) => r.ini);
    assert.deepEqual(inis, [18, 15, 12, 11, 10, 5, 3, 2, 1], 'each at its sorted place');
    assert.equal(s.fight.turn, turn);
    assert.equal(texts(s).length, lines + 3, 'the log says so for each');
    assert.equal(s.fight.rows.find((r) => r.id === b1.id).typed, false, 'rolled is not typed');
    assert.equal(M.undoable(s.fight, id), false, 'a row the log names is not taken back');
  });

  it('an undone add leaves the unseen numbers of the others alone, even after the add took one', () => {
    let s = gateFight();
    const labelsOf = (x) => Object.fromEntries(x.fight.rows.map((r) => [r.id, r.unseenN]));
    const before = labelsOf(s);
    const [t, id] = addNamed(s, 'Bouncer', 3);
    s = F(t, { type: 'undoAdd', join: id });
    assert.deepEqual(labelsOf(s), before);
  });

  it('undoAdd refuses once a row is touched', () => {
    const touch = {
      typed: (s, r) => F(s, { type: 'setAc', row: r.id, ac: 12 }),
      hp: (s, r) => F(s, { type: 'hp', row: r.id, entry: 't4' }),
      status: (s, r) => F(s, { type: 'status', row: r.id, add: 'Prone' }),
      init: (s, r) => F(s, { type: 'setInit', row: r.id, ini: 12 }),
    };
    for (const [how, fn] of Object.entries(touch)) {
      let s = gateFight();
      let id;
      [s, id] = addNamed(s, 'Bouncer', 3);
      const r = s.fight.rows.find((x) => x.name === 'Bouncer 2');
      s = fn(s, r);
      const n = s.fight.rows.length;
      const lines = texts(s).length;
      s = F(s, { type: 'undoAdd', join: id });
      assert.equal(s.fight.rows.length, n, `${how}: refused`);
      assert.equal(texts(s).length, lines, `${how}: and silent`);
      assert.equal(M.undoable(s.fight, id), false, how);
    }
    // a row that has had its turn counts too
    let s = gateFight();
    let id;
    [s, id] = addNamed(s, 'Bouncer', 2);
    assert.equal(M.undoable(s.fight, id), true);
    s = F(s, { type: 'setInit', row: s.fight.rows.find((r) => r.name === 'Bouncer 1').id, ini: 30 });
    assert.equal(M.undoable(s.fight, id), false, 'typed');
    [s, id] = addNamed(gateFight(), 'Bouncer', 2);
    for (let i = 0; i < 14 && M.undoable(s.fight, id); i++) s = next(s);
    assert.equal(M.undoable(s.fight, id), false, 'once the turns reach them');
    // a turn or a log line on the second or third row blocks it as the first row's does (CodeRabbit, PR #843)
    for (const mark of ['turned', 'logged']) {
      for (const at of [1, 2]) {
        [s, id] = addNamed(gateFight(), 'Bouncer', 3);
        s.fight.rows.find((r) => r.name === `Bouncer ${at + 1}`)[mark] = true;
        assert.equal(M.undoable(s.fight, id), false, `Bouncer ${at + 1} ${mark}`);
      }
    }
    // an unknown join, and a join that was not an add of rows only, never undo
    s = gateFight();
    const n = s.fight.rows.length;
    s = F(s, { type: 'undoAdd', join: 'nope' });
    assert.equal(s.fight.rows.length, n);
  });

  it('rounds wrap with a round-end line naming every combatant\'s HP', () => {
    let s = gateFight();
    s = F(s, { type: 'fightTick', row: row(s, WOLF, 2).id, in: false });
    s = F(s, { type: 'fightTick', row: row(s, WOLF, 3).id, in: false });
    s = hit(s, ADA, '-2');
    const live = s.fight.rows.filter((r) => r.in && !r.out).length;
    for (let i = 0; i < live; i++) s = next(s);
    assert.equal(s.fight.round, 1);
    s = next(s);
    assert.equal(s.fight.round, 2);
    const line = texts(s).find((t) => t.startsWith('Round 1 ends:'));
    assert.ok(line, texts(s).join('\n'));
    for (const name of ['Ada Moss 20/30', 'Brother Ash 9/9', 'Frost Wolf 1 15/15', 'Lucan Grey 16/16']) assert.ok(line.includes(name), `${name} in ${line}`);
    assert.ok(!line.includes('Frost Wolf 2'), 'an unticked row is no combatant');
    assert.ok(!line.includes('Lair'), 'the Lair row has no HP');
  });

  it('legendary actions refill on its turn; recharge rolls once per round; a roll under rechargeAt keeps it spent', () => {
    let s = gateFight();
    const w = row(s, WOLF).id;
    for (const r of s.fight.rows) if (r.id !== w) s = F(s, { type: 'fightTick', row: r.id, in: false });
    s = F(s, { type: 'fightTick', row: row(s, ADA).id, in: true });
    s = F(s, { type: 'counter', row: w, kind: 'la', value: 0 });
    s = F(s, { type: 'counter', row: w, kind: 'lr', value: 9 });
    assert.equal(row(s, WOLF).lr, 1, 'clamped to its max');
    s = F(s, { type: 'recharge', row: w, name: 'Howl', ready: false });
    s = F(s, { type: 'setInit', row: w, ini: 15 });
    s = F(s, { type: 'setInit', row: row(s, ADA).id, ini: 3 });
    s = next(s);
    assert.equal(s.fight.turn, w);
    assert.equal(row(s, WOLF).la, 2, 'refilled on its turn');
    assert.equal(s.fight.lastFoe, w);
    s = F(s, { type: 'rechargeRoll', row: w, name: 'Howl', roll: 4, round: 1 });
    assert.equal(row(s, WOLF).recharge[0].ready, false, 'under 5 stays spent');
    s = F(s, { type: 'rechargeRoll', row: w, name: 'Howl', roll: 6, round: 1 });
    assert.deepEqual(row(s, WOLF).recharge[0].rolled, { round: 1, roll: 4 }, 'one roll a round');
    assert.equal(row(s, WOLF).recharge[0].ready, false);
    s = F(s, { type: 'rechargeRoll', row: w, name: 'Howl', roll: 5, round: 2 });
    assert.equal(row(s, WOLF).recharge[0].ready, false, 'a roll for a round that is not the current one is dropped');
    s = next(s);
    s = next(s);
    assert.equal(s.fight.round, 2);
    s = F(s, { type: 'rechargeRoll', row: w, name: 'Howl', roll: 5, round: 2 });
    assert.equal(row(s, WOLF).recharge[0].ready, true);
    s = F(s, { type: 'rechargeRoll', row: w, name: 'Howl', roll: 1, round: 2 });
    assert.equal(row(s, WOLF).recharge[0].ready, true, 'a ready recharge takes no roll');
  });

  it('the Lair row takes its turn at 20 after the 20s', () => {
    let s = gateFight();
    for (const r of s.fight.rows) if (r.kind !== 'lair') s = F(s, { type: 'setInit', row: r.id, ini: 20 });
    s = F(s, { type: 'fightSort' });
    const live = s.fight.rows.filter((r) => r.in);
    assert.equal(live.at(-1).kind, 'lair');
  });

  it('hp entries: -37, +8, t5; half is one-shot; resisted stays', () => {
    let s = gateFight();
    const id = row(s, LUCAN).id;
    s = F(s, { type: 'hp', row: id, entry: '-7' });
    assert.equal(row(s, LUCAN).hp, 9);
    s = F(s, { type: 'hp', row: id, entry: '+8' });
    assert.equal(row(s, LUCAN).hp, 16, 'healing stops at max');
    s = F(s, { type: 'hp', row: id, entry: 't5' });
    assert.equal(row(s, LUCAN).temp, 5);
    s = F(s, { type: 'hp', row: id, entry: '3' });
    assert.deepEqual([row(s, LUCAN).hp, row(s, LUCAN).temp], [16, 2]);
    const before = s;
    s = F(s, { type: 'hp', row: id, entry: 'nonsense' });
    assert.deepEqual(s.fight, before.fight);
    s = F(s, { type: 'half', row: id, on: true });
    s = F(s, { type: 'hp', row: id, entry: '-10' });
    assert.equal(row(s, LUCAN).hp, 13, '10 halved to 5, 2 to temp');
    assert.equal(row(s, LUCAN).half, false, 'half is one-shot');
    s = F(s, { type: 'resisted', row: id, on: true });
    s = F(s, { type: 'hp', row: id, entry: '-4' });
    s = F(s, { type: 'hp', row: id, entry: '-4' });
    assert.equal(row(s, LUCAN).hp, 9);
    assert.equal(row(s, LUCAN).resisted, true, 'resisted stays');
  });

  it('a foe at 0 is out and logged; a PC at 0 is Down, concentration ends, logged', () => {
    let s = gateFight();
    s = hit(s, ASH, '-30');
    assert.equal(row(s, ASH).hp, 0);
    assert.equal(row(s, ASH).out, true);
    assert.ok(texts(s).includes('Brother Ash drops.'));
    s = F(s, { type: 'concentrating', row: row(s, ADA).id, on: true });
    s = hit(s, ADA, '-40');
    assert.deepEqual(row(s, ADA).conds, ['Down']);
    assert.equal(row(s, ADA).conc, false);
    assert.equal(row(s, ADA).out, false, 'a PC is Down, not Out');
    assert.deepEqual(texts(s).slice(-2), ['Ada Moss is Down.', 'Ada Moss\'s concentration ends.']);
  });

  // SRD 5.2.1: Concentration ends when the concentrator has the Incapacitated condition, which Paralyzed,
  // Petrified, Stunned and Unconscious each include.
  it('Incapacitated, or a status that includes it, ends concentration with a Log line', () => {
    for (const status of ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious']) {
      let s = gateFight();
      const id = row(s, ADA).id;
      s = F(s, { type: 'concentrating', row: id, on: true });
      s = F(s, { type: 'status', row: id, add: status });
      assert.equal(row(s, ADA).conc, false, status);
      assert.deepEqual(row(s, ADA).conds, [status]);
      assert.equal(texts(s).at(-1), 'Ada Moss\'s concentration ends.', status);
    }
    // other statuses leave it on, and no line is written when there is none to end
    let s = gateFight();
    const id = row(s, ADA).id;
    s = F(s, { type: 'concentrating', row: id, on: true });
    s = F(s, { type: 'status', row: id, add: 'Prone' });
    s = F(s, { type: 'status', row: id, add: 'Poisoned' });
    assert.equal(row(s, ADA).conc, true);
    const before = texts(s).length;
    s = F(s, { type: 'concentrating', row: id, on: false });
    s = F(s, { type: 'status', row: id, add: 'Stunned' });
    assert.equal(texts(s).length, before, 'no concentration, no line');
  });

  it('healing from 0 clears Down, Stable and death saves', () => {
    let s = gateFight();
    s = hit(s, ADA, '-40');
    s = F(s, { type: 'deathSave', row: row(s, ADA).id, s: 3, f: 1 });
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    assert.deepEqual(row(s, ADA).conds, ['Down', 'Stable', 'Prone']);
    s = F(s, { type: 'deathSave', row: row(s, ADA).id, f: 2 });
    s = hit(s, ADA, '+4');
    assert.equal(row(s, ADA).hp, 4);
    assert.deepEqual(row(s, ADA).conds, ['Prone']);
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 0 });
  });

  it('three death-save successes add Stable', () => {
    let s = gateFight();
    s = hit(s, ADA, '-40');
    const id = row(s, ADA).id;
    s = F(s, { type: 'deathSave', row: id, s: 2 });
    assert.ok(!row(s, ADA).conds.includes('Stable'));
    s = F(s, { type: 'deathSave', row: id, s: 9, f: -2 });
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 0 }, 'both counts reset at Stable (SRD)');
    assert.ok(row(s, ADA).conds.includes('Stable'));
    assert.ok(texts(s).includes('Ada Moss is Stable.'));
    s = F(s, { type: 'deathSave', row: id, f: 3 });
    assert.ok(texts(s).includes('Ada Moss has failed three death saves.'));
  });

  it('Bloodied is logged for a foe, never stored, and lights the HP line once', () => {
    let s = gateFight();
    s = hit(s, WOLF, '-6');
    let d = RS.derive(model, s);
    const w = row(s, WOLF).id;
    const key = `${GATE.key}.pt.hp10`;
    assert.ok(d.fight.view.lit.has(key), '9 of 15 is under the 10 line');
    assert.ok(!d.fight.view.bloodied.has(w), 'but not Bloodied');
    assert.deepEqual(texts(s).filter((t) => t.includes('pack breaks')), ['Frost Wolf 1: Bloodied (10 HP or less): the pack breaks']);
    s = hit(s, WOLF, '-2');
    d = RS.derive(model, s);
    assert.ok(d.fight.view.bloodied.has(w));
    assert.ok(texts(s).includes('Frost Wolf 1 is Bloodied.'));
    s = hit(s, WOLF, '-1');
    assert.equal(texts(s).filter((t) => t.includes('pack breaks')).length, 1, 'logged once');
    assert.equal(texts(s).filter((t) => t.endsWith('is Bloodied.')).length, 1);
    assert.ok(!('bloodied' in row(s, WOLF)), 'never stored');
    assert.ok(!row(s, WOLF).conds.includes('Bloodied'));
    // a PC's Bloodied shows, but is not logged
    s = hit(s, ADA, '-10');
    assert.ok(RS.derive(model, s).fight.view.bloodied.has(row(s, ADA).id));
    assert.ok(!texts(s).includes('Ada Moss is Bloodied.'));
    // at 0 it is no longer lit
    s = hit(s, WOLF, '-30');
    assert.ok(!RS.derive(model, s).fight.view.lit.has(key));
  });

  it('area: each ticked row once, half per row, recharge spent in the same action', () => {
    let s = gateFight();
    const w = row(s, WOLF).id;
    s = F(s, { type: 'area', amount: 9, hits: [{ row: row(s, ADA).id, half: false }, { row: row(s, LUCAN).id, half: true }, { row: row(s, ADA).id, half: false }, { row: 'nope' }], spend: { row: w, name: 'Howl' } });
    assert.equal(row(s, ADA).hp, 13, 'hit once');
    assert.equal(row(s, LUCAN).hp, 12, 'half: 4');
    assert.equal(row(s, WOLF).recharge[0].ready, false);
    const line = texts(s).at(-1);
    assert.equal(line, 'Howl: 9 damage to Ada Moss 9, Lucan Grey 4 (half).');
    s = F(s, { type: 'area', amount: 20, hits: [{ row: row(s, ASH).id, half: false }], spend: null });
    assert.deepEqual(texts(s).slice(-2), ['Area: 20 damage to Brother Ash 20.', 'Brother Ash drops.']);
  });

  it('exhaustion 1-6 as one value', () => {
    let s = gateFight();
    const id = row(s, ADA).id;
    s = F(s, { type: 'exhaustion', row: id, level: 3 });
    assert.equal(row(s, ADA).exhaustion, 3);
    s = F(s, { type: 'exhaustion', row: id, level: 9 });
    assert.equal(row(s, ADA).exhaustion, 6);
    s = F(s, { type: 'exhaustion', row: id, level: -1 });
    assert.equal(row(s, ADA).exhaustion, 0);
  });

  it('max typed on a no-numbers row sets its HP', () => {
    let s = gateFight();
    s = join(s, { cast: DRAKE, count: 1 });
    assert.equal(row(s, DRAKE).hp, null);
    s = F(s, { type: 'setMax', row: row(s, DRAKE).id, max: 30 });
    assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).max], [30, 30]);
    // changed on purpose by final review P4.3: a full row follows its max
    s = F(s, { type: 'setMax', row: row(s, DRAKE).id, max: 40 });
    assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).max], [40, 40], 'a full row stays full');
    s = F(s, { type: 'setAc', row: row(s, DRAKE).id, ac: 14 });
    assert.equal(row(s, DRAKE).ac, 14);
  });

  // Task 13 proof: a fight with nobody in it, ended before the first turn, says so with no empty list
  it('a fight ended before the first turn with no one ticked writes "Fight ends before the first turn."', () => {
    let s = gateFight();
    for (const r of s.fight.rows) if (r.in && r.kind !== 'lair') s = F(s, { type: 'fightTick', row: r.id, in: false });
    s = end(s);
    assert.equal(texts(s).at(-1), 'Fight ends before the first turn.');
    // with someone in it, the list stays
    const t = end(gateFight());
    assert.match(texts(t).at(-1), /^Fight ends before the first turn: \S.*\.$/);
  });

  // final review P4.3
  it('a corrected max brings a full row\'s HP with it; a wounded row keeps its HP', () => {
    let s = gateFight();
    s = join(s, { cast: DRAKE, count: 1 });
    const id = row(s, DRAKE).id;
    for (const [max, hp] of [[21, 21], [2, 2], [20, 20]]) {
      s = F(s, { type: 'setMax', row: id, max });
      assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).max], [hp, max], `max ${max}`);
    }
    // a "0" slip puts it Out; the corrected max brings it back full
    s = F(s, { type: 'setMax', row: id, max: 0 });
    assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).out], [0, true]);
    s = F(s, { type: 'setMax', row: id, max: 33 });
    assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).max, row(s, DRAKE).out], [33, 33, false]);
    // wounded: 15/21, max 25 keeps 15
    s = F(s, { type: 'setMax', row: id, max: 21 });
    s = F(s, { type: 'hp', row: id, entry: '-6' });
    assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).max], [15, 21]);
    s = F(s, { type: 'setMax', row: id, max: 25 });
    assert.deepEqual([row(s, DRAKE).hp, row(s, DRAKE).max], [15, 25], 'a wounded row keeps its HP');
  });

  it('pause and resume keep the turn and round, and are logged', () => {
    let s = gateFight();
    s = next(s);
    s = next(s);
    const { turn, round } = s.fight;
    s = F(s, { type: 'fightPause', on: true });
    assert.equal(s.fight.paused, true);
    s = F(s, { type: 'fightPause', on: true });
    s = F(s, { type: 'fightPause', on: false });
    assert.deepEqual([s.fight.turn, s.fight.round, s.fight.paused], [turn, round, false]);
    assert.deepEqual(texts(s).slice(-2), ['Fight paused.', 'Fight resumed.']);
  });

  it('end fight keeps every status; after-fight clear each and clear all', () => {
    let s = gateFight();
    const ada = row(s, ADA).id;
    s = F(s, { type: 'status', row: ada, add: 'Prone' });
    s = F(s, { type: 'status', row: ada, add: 'Poisoned' });
    s = F(s, { type: 'exhaustion', row: ada, level: 2 });
    s = F(s, { type: 'concentrating', row: ada, on: true });
    s = F(s, { type: 'status', row: row(s, LUCAN).id, add: 'Frightened' });
    s = F(s, { type: 'status', row: row(s, WOLF).id, add: 'Grappled' });
    assert.equal(RS.derive(model, s).afterFight, null, 'none while a fight runs');
    const id = s.fight.id;
    s = end(s);
    assert.equal(s.fight, null);
    assert.equal(s.fights.length, 1);
    assert.match(texts(s).at(-1), /^Fight ends before the first turn: .*Ada Moss 22\/30 \(Prone, Poisoned, Exhaustion 2, Concentrating\)/);
    let a = RS.derive(model, s).afterFight;
    assert.equal(a.fight, id);
    const byName = (x, y) => (x[0] < y[0] ? -1 : 1);
    assert.deepEqual(a.rows.map((r) => [r.name, r.statuses]).sort(byName), [
      ['Ada Moss', ['Prone', 'Poisoned', 'Exhaustion 2', 'Concentrating']],
      ['Frost Wolf 1', ['Grappled']],
      ['Lucan Grey', ['Frightened']],
    ]);
    s = act(s, { type: 'afterClear', fight: id, row: ada, status: 'Prone' });
    s = act(s, { type: 'afterClear', fight: id, row: ada, status: 'Concentrating' });
    s = act(s, { type: 'afterClear', fight: id, row: ada, status: 'Exhaustion' });
    assert.deepEqual(RS.derive(model, s).afterFight.rows.find((r) => r.id === ada).statuses, ['Poisoned']);
    assert.equal(vital(s, ADA).conditions, 'Poisoned');
    s = act(s, { type: 'afterClear', fight: id, row: row({ fight: s.fights[0] }, LUCAN).id, all: true });
    assert.ok(!RS.derive(model, s).afterFight.rows.some((r) => r.note === LUCAN));
    s = act(s, { type: 'afterClearAll', fight: 'other' });
    assert.ok(RS.derive(model, s).afterFight, 'another id changes nothing');
    s = act(s, { type: 'afterClearAll', fight: id });
    assert.equal(RS.derive(model, s).afterFight, null);
  });

  it('vitals come from the last fight; a later end-panel edit wins; an earlier one loses', () => {
    let s = move(fresh(), ADA, GATE);
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 25, conditions: 'Winded' } } });
    s = fightAt(s, GATE);
    assert.equal(row(s, ADA).hp, 25);
    s = hit(s, ADA, '-5');
    s = end(s);
    let v = recorded(s, ADA);
    assert.deepEqual([v.hp, v.max, v.conditions, v.source], [20, 30, 'Winded', 'fight'], 'the earlier edit loses');
    assert.ok(v.at);
    s = fightAt(s, GATE);
    s = hit(s, ADA, '-5');
    s = end(s);
    assert.equal(recorded(s, ADA).hp, 15, 'the last fight');
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 29 } } });
    v = recorded(s, ADA);
    assert.deepEqual([v.hp, v.source], [29, 'end'], 'the later edit wins');
  });

  it('an unended fight still gives vitals', () => {
    let s = gateFight();
    s = hit(s, LUCAN, '-6');
    const v = recorded(s, LUCAN);
    assert.deepEqual([v.hp, v.max, v.source, v.ally], [10, 16, 'fight', true]);
  });

  it('foes are never in the vitals', () => {
    let s = gateFight();
    s = hit(s, WOLF, '-5');
    s = hit(s, ASH, '-5');
    s = end(s);
    const d = RS.derive(model, s);
    assert.ok(!d.vitals.some((v) => v.note === WOLF || v.note === ASH));
  });

  it('a PC renamed mid-fight', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-fight-'));
    try {
      fs.cpSync(FIXTURE, tmp, { recursive: true });
      const m1 = readRunSheet(tmp, PLAN, { party: [ADA, BEN] });
      let s = fightAt(move(fresh(), ADA, m1.beats[0]), m1.beats[0], { m: m1 });
      s = F(s, { type: 'hp', row: row(s, ADA).id, entry: '-5' });
      const NEW = 'Characters/PCs/Ada Rowe.md';
      fs.renameSync(path.join(tmp, ADA), path.join(tmp, NEW));
      // the Plan's roster is the party now, so a rename carries its link along, as Obsidian does
      const planFile = path.join(tmp, PLAN);
      fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('- **[[Ada Moss]]** (Pat)', '- **[[Ada Rowe]]** (Pat)'));
      const m2 = readRunSheet(tmp, PLAN, { party: [NEW, BEN] });
      const d = RS.derive(m2, s);
      const r = d.fight.view.rows.find((x) => x.note === ADA);
      assert.equal(r.gone, true);
      assert.equal(r.name, 'Ada Moss', 'its stored name');
      assert.ok(!d.fight.view.rows.find((x) => x.note === BEN).gone);
      assert.ok(!d.vitals.some((v) => v.rowId === ADA));
      const nv = d.vitals.find((v) => v.rowId === NEW);
      assert.deepEqual([nv.hp, nv.source], [22, 'note'], 'the new path comes from the note');
      assert.ok(!d.vitalsRecorded.some((v) => v.rowId === NEW || v.rowId === ADA));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('re-applied actions land once', () => {
    // the page builds on state N; another window's hit moves the server to N+1; the page's queue is re-applied there
    const N = gateFight();
    const w = row(N, WOLF).id;
    const mine = [{ id: 'p1', type: 'hp', fight: N.fight.id, row: w, entry: '-3' }, { id: 'p2', type: 'status', fight: N.fight.id, row: w, add: 'Prone' }];
    const local = mine.reduce((s, a) => RS.reduce(s, a, now()), N);
    assert.equal(row(local, WOLF).hp, 12);
    const N1 = RS.reduce(N, { id: 'o1', type: 'hp', fight: N.fight.id, row: w, entry: '-4' }, now());
    let s = mine.reduce((x, a) => RS.reduce(x, a, now()), N1);
    assert.equal(row(s, WOLF).hp, 8, 'both hits, each once');
    const again = mine.reduce((x, a) => RS.reduce(x, a, now()), s);
    assert.deepEqual(again, s, 'the same ids again change nothing');
    // a fight started twice with the same action makes the same rows
    const st = move(fresh(), ADA, GATE);
    const b = M.rowsForFight({ model, derived: RS.derive(model, st), state: st, beatKey: GATE.key, idBase: 'f1' });
    const fa = { id: 'f1', type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds };
    s = RS.reduce(st, fa, now());
    assert.equal(RS.reduce(s, fa, now()), s);
  });

  it('two windows\' damage both land', () => {
    const N = gateFight();
    const a = { id: 'w1', type: 'hp', fight: N.fight.id, row: row(N, ADA).id, entry: '-2' };
    const b = { id: 'w2', type: 'hp', fight: N.fight.id, row: row(N, ADA).id, entry: '-3' };
    const s = [a, b, a, b].reduce((x, y) => RS.reduce(x, y, now()), N);
    assert.equal(row(s, ADA).hp, 17);
  });

  it('a fight survives a JSON round trip', () => {
    let s = gateFight();
    s = next(s);
    s = hit(s, WOLF, '-8');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = F(s, { type: 'fightPause', on: true });
    const plain = (d) => JSON.stringify(d, (k, v) => (v instanceof Set ? [...v].sort() : v));
    const back = JSON.parse(JSON.stringify(s));
    assert.equal(plain(RS.derive(model, back)), plain(RS.derive(model, s)));
    assert.deepEqual(back, s);
    const ended = end(s);
    assert.equal(plain(RS.derive(model, JSON.parse(JSON.stringify(ended)))), plain(RS.derive(model, ended)));
  });

  it('reduce never mutates its input', () => {
    let s = deepFreeze(move(fresh(), ADA, GATE));
    const id = 'fz';
    const b = M.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: GATE.key, idBase: id });
    const start = deepFreeze({ id, type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds });
    s = deepFreeze(RS.reduce(s, start, now()));
    const w = row(s, WOLF).id;
    const ada = row(s, ADA).id;
    const j = M.joinRows({ model, derived: RS.derive(model, s), state: s, fight: s.fight, add: { cast: MEPHIT, count: 1 }, idBase: 'fj' });
    const all = [
      { type: 'fightJoin', rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: 'M' },
      { type: 'fightTick', row: w, in: false }, { type: 'fightTick', row: w, in: true },
      { type: 'setInit', row: w, ini: 12 }, { type: 'rollInit', values: { [w]: 3 } }, { type: 'fightSort' },
      { type: 'fightNext', from: null, round: 0 },
      { type: 'hp', row: w, entry: '-9' }, { type: 'half', row: w, on: true }, { type: 'resisted', row: w, on: true },
      { type: 'setMax', row: w, max: 20 }, { type: 'setAc', row: w, ac: 11 },
      { type: 'status', row: ada, add: 'Prone' }, { type: 'status', row: ada, remove: 'Prone' },
      { type: 'exhaustion', row: ada, level: 1 }, { type: 'concentrating', row: ada, on: true },
      { type: 'hp', row: ada, entry: '-99' }, { type: 'deathSave', row: ada, s: 3, f: 0 },
      { type: 'out', row: w, on: true }, { type: 'counter', row: w, kind: 'la', value: 1 },
      { type: 'recharge', row: w, name: 'Howl', ready: false }, { type: 'rechargeRoll', row: w, name: 'Howl', roll: 6, round: 1 },
      { type: 'area', hits: [{ row: ada, half: true }], amount: 4, spend: null }, { type: 'seen', row: w, on: true },
      { type: 'fightPause', on: true }, { type: 'fightEnd' },
    ];
    const fid = s.fight.id;
    for (const a of all) s = deepFreeze(RS.reduce(s, deepFreeze({ id: nextId(), fight: fid, ...a }), now()));
    for (const a of [{ type: 'afterClear', row: ada, status: 'Down' }, { type: 'afterClear', row: ada, all: true }, { type: 'afterClearAll' }]) {
      s = deepFreeze(RS.reduce(s, deepFreeze({ id: nextId(), fight: fid, ...a }), now()));
    }
    assert.equal(s.fight, null);
    assert.equal(s.fights.length, 1);
  });

  it('an old state with no fight keys loads and derives', () => {
    const old = move(fresh(), ADA, GATE);
    for (const k of ['fight', 'fights', 'panels', 'shownEver']) delete old[k];
    const d = RS.derive(model, old);
    assert.equal(d.fight, null);
    assert.deepEqual(d.fightLog, []);
    assert.equal(d.afterFight, null);
    const up = RS.upgrade(old, fresh());
    assert.deepEqual([up.fight, up.fights, up.panels, up.shownEver], [null, [], {}, {}]);
    let s = fightAt(old, GATE);
    assert.ok(s.fight);
    s = end(s);
    assert.equal(s.fights.length, 1);
  });

  it('unimprovise keeps a fight\'s Log lines', () => {
    let s = act(move(fresh(), ADA, GATE), { type: 'improvise', title: 'A brawl', key: 'i-x' });
    const m = model;
    const d = RS.derive(m, s);
    const beat = d.beats.find((b) => b.key === 'i-x');
    s = fightAt(s, beat);
    s = end(s);
    const fightLines = texts(s);
    s = act(s, { type: 'unimprovise', key: 'i-x' });
    assert.deepEqual(texts(s), fightLines);
    assert.ok(!s.events.some((e) => !e.fight && e.beat === 'i-x'));
    assert.deepEqual(RS.derive(m, s).fightLog.map((l) => l.text), fightLines);
  });

  it('a join with lair actions is listed on the Lair row; unseen numbers carry on', () => {
    let s = gateFight();
    s = join(s, { cast: WOLF, count: 1 });
    const lair = s.fight.rows.find((r) => r.kind === 'lair');
    assert.equal(s.fight.rows.filter((r) => r.kind === 'lair').length, 1);
    assert.deepEqual(lair.of, rows(s, WOLF).map((r) => r.id));
    assert.equal(rows(s, WOLF)[3].copy, 4);
    // plan 6a fix round 1 / review M4: the unseen Lucan holds 5 in the stranger run
    assert.equal(rows(s, WOLF)[3].unseenN, 6);
    s = F(s, { type: 'fightTick', row: rows(s, WOLF)[3].id, in: false });
    assert.equal(rows(s, WOLF)[3].unseenN, 6, 'kept once given');
    // an unticked foe gets its number when first ticked in
    let t = move(fresh(), ADA, GATE);
    t = fightAt(t, GATE);
    t = F(t, { type: 'fightTick', row: row(t, WOLF, 3).id, in: false });
    const id = nextId();
    const j = M.joinRows({ model, derived: RS.derive(model, t), state: t, fight: t.fight, add: { cast: MEPHIT, count: 1 }, idBase: id });
    j.rows[0].in = false;
    t = RS.reduce(t, { id, type: 'fightJoin', fight: t.fight.id, rows: j.rows, tick: [], groups: [], thresholds: [], label: 'M' }, now());
    assert.equal(row(t, MEPHIT).unseenN, null, 'unticked: no number');
    t = F(t, { type: 'fightTick', row: row(t, MEPHIT).id, in: true });
    assert.equal(row(t, MEPHIT).unseenN, 6, 'the next number when first ticked in (Lucan holds 5: review M4)');
  });

  it('derive names rows for the GM and picks the acting panel', () => {
    let s = act(move(fresh(), ADA, GATE), { type: 'unmask', note: ASH, on: true, name: 'Ash the Knife', beat: GATE.key });
    s = fightAt(s, GATE);
    s = hit(s, ASH, '-20');
    assert.ok(texts(s).includes('Ash the Knife drops.'), 'the log uses the unmasked name');
    const d = RS.derive(model, s);
    assert.equal(d.fight.view.rows.find((r) => r.note === ASH).gmName, 'Ash the Knife');
    assert.equal(d.fight.view.acting.why, 'first-foe');
    assert.deepEqual(d.fightLog.map((l) => l.text), texts(s));
    assert.ok(d.fightLog.every((l) => l.beatTitle === GATE.title));
  });

  it('gm.html loads fight-math.js and fight.js before state.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'gm.html'), 'utf8');
    const i = (f) => html.indexOf(`src="/web/${f}"`);
    assert.ok(i('fight-math.js') > 0 && i('fight-math.js') < i('fight.js') && i('fight.js') < i('state.js'));
  });
});

describe('the first review\'s fixes', () => {
  it('an end-panel edit on one field leaves the other fields\' times alone', () => {
    let s = move(fresh(), ADA, GATE);
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 18 } } });
    s = fightAt(s, GATE);
    s = hit(s, ADA, '-10');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    s = end(s);
    assert.equal(vital(s, ADA).hp, 8);
    s = act(s, { type: 'endSet', vitals: { [ADA]: { conditions: '' } } });
    const v = vital(s, ADA);
    assert.equal(v.hp, 8, 'the fight\'s HP stays');
    assert.equal(v.source, 'fight');
    assert.equal(v.conditions, '', 'the later conditions edit wins');
    assert.equal(recorded(s, ADA).hp, 8);
    // and an HP typed after the fight still wins
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 20 } } });
    assert.deepEqual([vital(s, ADA).hp, vital(s, ADA).source], [20, 'end']);
  });

  it('three death-save successes reset both counts', () => {
    let s = gateFight();
    s = hit(s, ADA, '-40');
    const id = row(s, ADA).id;
    s = F(s, { type: 'deathSave', row: id, f: 2 });
    s = F(s, { type: 'deathSave', row: id, s: 3 });
    assert.ok(row(s, ADA).conds.includes('Stable'));
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 0 });
  });

  it('damage at 0 HP removes Stable and is a death save failure; a crit\'s second failure goes on the pips', () => {
    let s = gateFight();
    s = hit(s, ADA, '-40');
    const id = row(s, ADA).id;
    s = F(s, { type: 'deathSave', row: id, s: 3 });
    s = hit(s, ADA, '-3');
    assert.ok(!row(s, ADA).conds.includes('Stable'));
    assert.ok(row(s, ADA).conds.includes('Down'));
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 1 });
    assert.equal(row(s, ADA).hp, 0);
    assert.equal(texts(s).at(-1), 'Ada Moss takes damage at 0 HP: a death save failure.');
    // no control sends a crit (Review L5): the field is ignored, the GM adds the second failure on the pips
    s = F(s, { type: 'hp', row: id, entry: '-3', crit: true });
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 2 });
    s = F(s, { type: 'deathSave', row: id, f: 3 });
    s = hit(s, ADA, '-1');
    assert.ok(texts(s).includes('Ada Moss has failed three death saves.'));
    s = hit(s, ADA, '-1');
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 3 }, 'stops at three');
  });

  it('temp HP soaks damage at 0 with no failure; an area hit at 0 is a failure; a foe at 0 takes none', () => {
    let s = gateFight();
    s = hit(s, ADA, '-40');
    s = hit(s, ADA, 't5');
    s = hit(s, ADA, '-3');
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 0 });
    s = F(s, { type: 'area', amount: 4, hits: [{ row: row(s, ADA).id }, { row: row(s, WOLF).id }] });
    assert.deepEqual(row(s, ADA).ds, { s: 0, f: 1 });
    s = hit(s, WOLF, '-30');
    s = hit(s, WOLF, '-3');
    assert.ok(!('ds' in row(s, WOLF)) || (row(s, WOLF).ds.f || 0) === 0);
  });

  it('damage left over that reaches the HP max is logged', () => {
    let s = gateFight();
    s = hit(s, ADA, '-60');
    assert.ok(texts(s).includes('Ada Moss: the damage left over is at least the HP max.'));
    let t = gateFight();
    t = hit(t, ADA, '-40');
    assert.ok(!texts(t).some((x) => x.includes('left over')), '28 left over of 30');
  });

  it('a single-point attach keeps a lit threshold lit', () => {
    let s = gateFight();
    s = hit(s, WOLF, '-6');
    const key = `${GATE.key}.pt.hp10`;
    const line = texts(s).filter((x) => x.includes('pack breaks'));
    assert.equal(line.length, 1);
    s = act(s, { type: 'attach', from: key, to: `${GATE.key}.pt.moved` });
    assert.ok(Object.keys(s.fight.lit).every((k) => k.startsWith(`${GATE.key}.pt.moved|`)), Object.keys(s.fight.lit).join());
    s = hit(s, WOLF, '-1');
    assert.equal(texts(s).filter((x) => x.includes('pack breaks')).length, 1, 'lit once per threshold and row');
  });

  it('an If-row threshold logs its consequence', () => {
    const m = clone(model);
    m.beats[0].ifs.push({ key: `${GATE.key}.if.bl`, do: 'Bloodied', then: 'it flees' });
    let s = fightAt(move(fresh(), ADA, GATE), GATE, { m });
    s = hit(s, WOLF, '-8');
    assert.ok(texts(s).includes('Frost Wolf 1: Bloodied: it flees'), texts(s).join(' | '));
  });

  it('the Lair row loses its turn once every owner is Out', () => {
    let s = gateFight();
    const lair = s.fight.rows.find((r) => r.kind === 'lair');
    for (const r of s.fight.rows) if (r.kind !== 'lair') s = F(s, { type: 'setInit', row: r.id, ini: 10 });
    s = F(s, { type: 'fightSort' });
    for (const r of rows(s, WOLF)) s = F(s, { type: 'out', row: r.id, on: true });
    const seen = [];
    for (let i = 0; i < 12; i++) { s = next(s); seen.push(s.fight.turn); }
    assert.ok(!seen.includes(lair.id), 'skipped');
    s = F(s, { type: 'out', row: rows(s, WOLF)[0].id, on: false });
    const back = [];
    for (let i = 0; i < 12; i++) { s = next(s); back.push(s.fight.turn); }
    assert.ok(back.includes(lair.id), 'back once an owner is in again');
  });

  it('an owner ticked in later gets a Lair row when the fight has none', () => {
    let s = gateFight();
    s = clone(s);
    s.fight.rows = s.fight.rows.filter((r) => r.kind !== 'lair');
    const w = rows(s, WOLF)[0];
    s = F(s, { type: 'fightTick', row: w.id, in: false });
    s = F(s, { type: 'fightTick', row: w.id, in: true });
    const lair = s.fight.rows.filter((r) => r.kind === 'lair');
    assert.equal(lair.length, 1);
    assert.ok(lair[0].of.includes(w.id));
    s = F(s, { type: 'fightTick', row: rows(s, WOLF)[1].id, in: false });
    s = F(s, { type: 'fightTick', row: rows(s, WOLF)[1].id, in: true });
    assert.equal(s.fight.rows.filter((r) => r.kind === 'lair').length, 1, 'never a second');
  });

  it('a foe healed from 0 is back in the fight', () => {
    let s = gateFight();
    s = hit(s, WOLF, '-40');
    assert.equal(row(s, WOLF).out, true);
    s = hit(s, WOLF, '+4');
    assert.equal(row(s, WOLF).out, false);
    assert.ok(texts(s).includes('Frost Wolf 1 is back in the fight.'));
  });

  it('ending a fight before its first turn says so', () => {
    const s = end(gateFight());
    assert.match(texts(s).at(-1), /^Fight ends before the first turn: /);
  });

  it('a long rest does nothing for a creature at 0 HP, and the Log says so', () => {
    let s = gateFight();
    s = hit(s, ADA, '-40');
    s = end(s);
    s = act(s, { type: 'longRest' });
    const v = vital(s, ADA);
    assert.equal(v.hp, 0);
    assert.equal(v.conditions, 'Down');
    assert.equal(v.source, 'fight');
    const log = RS.derive(model, s).log.map((l) => l.text);
    assert.ok(log.includes('Ada Moss is at 0 HP, so the long rest does nothing for them.'), log.join(' | '));
    // someone above 0 is rested as before
    let t = gateFight();
    t = hit(t, ADA, '-10');
    t = end(t);
    t = act(t, { type: 'longRest' });
    assert.equal(vital(t, ADA).hp, 30);
    assert.ok(!RS.derive(model, t).log.some((l) => l.text.includes('long rest does nothing')));
  });
});

describe('the PR review and the proof', () => {
  // Ada 22/30 takes 10 and goes Prone; the fight ends (Review H1's probe)
  const afterFight = () => {
    let s = gateFight();
    s = hit(s, ADA, '-10');
    s = F(s, { type: 'status', row: row(s, ADA).id, add: 'Prone' });
    return end(s);
  };
  const adaRow = (s) => s.fights.at(-1).rows.find((r) => r.note === ADA);

  it('H1 B: an end-panel HP, then a status cleared after the fight: the end panel\'s HP stands', () => {
    let s = afterFight();
    s = act(s, { type: 'endSet', vitals: { [ADA]: { hp: 25 } } });
    s = act(s, { type: 'afterClear', fight: s.fights.at(-1).id, row: adaRow(s).id, status: 'Prone' });
    const v = vital(s, ADA);
    assert.deepEqual([v.hp, v.max, v.conditions, v.source], [25, 30, '', 'end']);
  });

  it('H1 C: a long rest, then a status cleared after the fight: the rest stands', () => {
    let s = afterFight();
    s = act(s, { type: 'longRest' });
    s = act(s, { type: 'afterClear', fight: s.fights.at(-1).id, row: adaRow(s).id, status: 'Prone' });
    const v = vital(s, ADA);
    assert.deepEqual([v.hp, v.max, v.conditions, v.source], [30, 30, '', 'rest']);
  });

  it('H1 D: a long rest, then Clear all: the rest stands', () => {
    let s = afterFight();
    s = act(s, { type: 'longRest' });
    s = act(s, { type: 'afterClearAll', fight: s.fights.at(-1).id });
    const v = vital(s, ADA);
    assert.deepEqual([v.hp, v.conditions, v.source], [30, '', 'rest']);
    assert.equal(recorded(s, ADA).hp, 30);
  });

  it('H1: seen, init, AC and counters never move the HP\'s time; hp, area and max do', () => {
    let s = gateFight();
    const id = row(s, ADA).id;
    const t0 = row(s, ADA).hpAt;
    assert.ok(t0, 'a row takes the fight start as its HP time');
    s = F(s, { type: 'setInit', row: id, ini: 12 });
    s = F(s, { type: 'setAc', row: id, ac: 15 });
    s = F(s, { type: 'status', row: id, add: 'Prone' });
    assert.equal(row(s, ADA).hpAt, t0);
    s = hit(s, ADA, '-1');
    const t1 = row(s, ADA).hpAt;
    assert.ok(t1 > t0);
    s = F(s, { type: 'area', amount: 2, hits: [{ row: id }] });
    const t2 = row(s, ADA).hpAt;
    assert.ok(t2 > t1);
    s = F(s, { type: 'setMax', row: id, max: 31 });
    assert.ok(row(s, ADA).hpAt > t2);
    // a row from before hpAt reads `at` for both
    const old = clone(s);
    delete old.fight.rows.find((r) => r.id === id).hpAt;
    assert.equal(vital(old, ADA).at, old.fight.rows.find((r) => r.id === id).at);
  });

  it('L5: max set below HP brings HP down; a max-only fix is recorded; a long rest restores a reduced max', () => {
    let s = gateFight();
    const id = row(s, ADA).id;
    s = F(s, { type: 'setMax', row: id, max: 20 });
    assert.equal(row(s, ADA).hp, 20, 'HP never above the max');
    let t = gateFight();
    t = F(t, { type: 'setMax', row: row(t, ADA).id, max: 31 });
    assert.equal(row(t, ADA).hp, 22);
    assert.deepEqual([recorded(t, ADA).hp, recorded(t, ADA).max], [22, 31], 'a max-only fix is recorded');
    s = end(s);
    assert.equal(vital(s, ADA).max, 20);
    s = act(s, { type: 'longRest' });
    assert.deepEqual([vital(s, ADA).hp, vital(s, ADA).max], [30, 30], 'the rest restores the reduced max');
  });

  it('proof M1: people an arrivals cue names join benched', () => {
    const m = clone(model);
    m.beats[0].arrivals = [{ key: `${GATE.key}.arrive.x`, when: 'Arriving, start of round 3', text: '[[Brother Ash]]', people: [ASH] }];
    let s = fightAt(move(fresh(), ADA, GATE), GATE, { m });
    assert.equal(row(s, ASH).in, false, 'benched');
    assert.equal(row(s, ASH).unseenN, null, 'no unseen number while benched');
    assert.ok(rows(s, WOLF).every((r) => r.in), 'the rest of the beat is ticked');
    s = join(s, { cast: ASH, count: 1 }, m);
    assert.equal(row(s, ASH).in, true, 'Add by name ticks the benched row in');
    assert.equal(rows(s, ASH).length, 1, 'not a copy');
  });

  it('proof M2: a Fight on a beat where no PC stands takes every group holding a ticked PC', () => {
    let s = move(fresh(), ADA, HUB, SPOT);
    s = move(s, BEN, HUB, SPOT);
    s = fightAt(s, TOWER);
    assert.ok(row(s, ADA).in && row(s, BEN).in);
    assert.deepEqual(s.fight.groups, [SPOT]);
  });

  it('proof Low: a foe shown before the fight takes no unseen number; it takes one if it goes back to unseen', () => {
    let s = move(fresh(), ADA, GATE);
    s = act(s, { type: 'show', group: GATE.key, note: ASH, on: true });
    s = fightAt(s, GATE);
    assert.equal(row(s, ASH).seen, true);
    assert.equal(row(s, ASH).unseenN, null);
    assert.deepEqual(rows(s, WOLF).map((r) => r.unseenN), [1, 2, 3], 'the wolves start at 1');
    s = F(s, { type: 'seen', row: row(s, ASH).id, on: false });
    // plan 6a fix round 1 / review M4: the unseen Lucan holds 4
    assert.equal(row(s, ASH).unseenN, 5);
  });

  it('proof Low: a join line agrees in number', () => {
    let s = gateFight();
    s = join(s, { cast: MEPHIT, count: 2 });
    assert.equal(texts(s).at(-1), 'Ice Mephit 1, Ice Mephit 2 join the fight.');
    s = join(s, { cast: DRAKE, count: 1 });
    assert.match(texts(s).at(-1), / joins the fight\.$/);
    const id = nextId();
    const t = RS.reduce(gateFight(), { id, type: 'fightJoin', fight: null, rows: [], tick: [], groups: [], thresholds: [], label: '' }, now());
    assert.ok(t);
  });
});

describe('RS.upgrade and the fight\'s keys', () => {
  it('a saved state with a running fight, an ended one and the players\' panels comes back as it was', () => {
    let s = move(fresh(), ADA, GATE);
    s = act(s, { type: 'show', group: GATE.key, note: ASH, on: true });
    s = end(gateFight());
    s = fightAt(move(s, ADA, GATE), GATE);
    s = act(s, { type: 'show', group: GATE.key, note: ASH, on: true });
    assert.ok(s.fight && s.fights.length === 1 && Object.keys(s.panels).length && Object.keys(s.shownEver).length);
    const saved = clone(s);
    assert.deepEqual(RS.upgrade(saved, fresh()), saved);
  });

  it('a fight, a fight\'s rows or a panel of the wrong kind is refused, code BAD_STATE', () => {
    for (const bad of [{ fight: 'x' }, { fight: [] }, { fight: { rows: {} } }, { fight: { rows: [null] } },
      { fights: {} }, { fights: [null] }, { fights: [{ rows: 'x' }] }, { panels: [] }, { panels: { g: null } }, { shownEver: [] }]) {
      assert.throws(() => RS.upgrade(bad, fresh()), (e) => e.code === 'BAD_STATE', JSON.stringify(bad));
    }
    assert.doesNotThrow(() => RS.upgrade({ fight: null, fights: [], panels: {}, shownEver: { [ASH]: true } }, fresh()));
  });
});

// plan 6a Task 5: a neutral side, the side the GM sets, and its memory
describe('sides in the fight', () => {
  const side = (s, note, to, copy) => F(s, { type: 'setSide', row: row(s, note, copy).id, side: to });
  const sideOf = (r) => M.sideOfRow(r);

  it('setSide sets each side directly, and the side is remembered into the next fight', () => {
    let s = gateFight();
    assert.equal(sideOf(row(s, ASH)), 'foe');
    for (const to of ['neutral', 'ally', 'foe']) { s = side(s, ASH, to); assert.equal(sideOf(row(s, ASH)), to); }
    s = side(s, ASH, 'neutral');
    assert.deepEqual([row(s, ASH).kind, row(s, ASH).neutral], ['foe', true]);
    assert.equal(s.sides[ASH], 'neutral');
    s = side(s, LUCAN, 'foe');
    assert.equal(s.sides[LUCAN], 'foe');
    // a side that is none of the three, a Lair row and a PC row are left alone
    const before = clone(s);
    s = F(s, { type: 'setSide', row: row(s, WOLF).id, side: 'friend' });
    s = F(s, { type: 'setSide', row: row(s, ADA).id, side: 'foe' });
    s = F(s, { type: 'setSide', row: s.fight.rows.find((r) => r.kind === 'lair').id, side: 'ally' });
    assert.deepEqual(s.fight.rows, before.fight.rows);
    assert.deepEqual(s.sides, before.sides);
    s = end(s);
    assert.equal(s.fights[0].rows.find((r) => r.note === ASH).neutral, true, 'an ended fight keeps its rows\' sides');
    s = fightAt(s, GATE);
    assert.deepEqual([row(s, ASH).kind, row(s, ASH).neutral, row(s, ASH).sideFrom], ['foe', true, 'you set it']);
    assert.deepEqual([row(s, LUCAN).kind, row(s, LUCAN).neutral], ['foe', false]);
    assert.ok(rows(s, WOLF).every((r) => r.kind === 'foe' && !r.neutral), 'a note nobody set keeps the reader\'s side');
  });

  it('the side switch is logged', () => {
    let s = gateFight();
    s = side(s, ASH, 'ally');
    s = side(s, ASH, 'neutral');
    s = side(s, ASH, 'foe');
    assert.deepEqual(texts(s).slice(-3), ['Brother Ash is now an ally.', 'Brother Ash is now neutral.', 'Brother Ash is now a foe.']);
    const n = texts(s).length;
    s = side(s, ASH, 'foe');
    assert.equal(texts(s).length, n, 'the side it already has: nothing happens');
  });

  it('set to ally becomes seen; set back to foe or neutral, it is as seen as a foe starts', () => {
    let s = gateFight();
    assert.equal(row(s, ASH).seen, false);
    s = side(s, ASH, 'ally');
    assert.equal(row(s, ASH).seen, true);
    // plan 6a fix round 1 / review I2: ticked in and seen as an ally, the players have its name: it stays
    s = side(s, ASH, 'neutral');
    assert.equal(row(s, ASH).seen, true, 'seen and ticked in: still seen');
    s = side(s, ASH, 'foe');
    assert.equal(row(s, ASH).seen, true, 'neutral to foe leaves seen alone');
    // benched while an ally, nobody saw it: back to how a foe starts
    s = side(s, ASH, 'ally');
    s = F(s, { type: 'fightTick', row: row(s, ASH).id, in: false });
    s = side(s, ASH, 'neutral');
    assert.equal(row(s, ASH).seen, false, 'not ticked in, no publish, no Show, no tick: unseen');
    assert.ok(row(s, ASH).unseenN !== null && row(s, ASH).unseenN !== undefined, 'and it keeps a number for its unseen word');
    s = F(s, { type: 'fightTick', row: row(s, ASH).id, in: true });
    // the GM's own tick wins
    s = F(s, { type: 'seen', row: row(s, ASH).id, on: true });
    s = side(s, ASH, 'ally');
    s = side(s, ASH, 'foe');
    assert.equal(row(s, ASH).seen, true, 'ticked seen by the GM: stays seen');
    // a reader-ally (Lucan, an inferred ally) set to ally by the GM is seen
    s = side(s, LUCAN, 'neutral');
    s = side(s, LUCAN, 'ally');
    assert.equal(row(s, LUCAN).seen, true);
  });

  it('a neutral is never the last foe', () => {
    let s = gateFight();
    for (const r of s.fight.rows.filter((x) => x.kind === 'foe')) s = side(s, r.note, 'neutral', r.copy);
    // every foe is neutral: Next walks every turn and none of them becomes the last foe
    s = F(s, { type: 'rollInit', values: Object.fromEntries(s.fight.rows.filter((r) => r.kind !== 'pc').map((r, i) => [r.id, 20 - i])) });
    s = F(s, { type: 'setInit', row: row(s, ADA).id, ini: 1 });
    const turns = s.fight.rows.filter((r) => r.in).length + 1;
    for (let i = 0; i < turns; i++) {
      s = next(s);
      assert.equal(s.fight.lastFoe, null, `turn ${i + 1}`);
    }
    // a foe's turn still sets it
    s = side(s, ASH, 'foe');
    do s = next(s); while (s.fight.turn !== row(s, ASH).id);
    assert.equal(s.fight.lastFoe, row(s, ASH).id);
  });

  it('0 HP: neutral Out, ally Down', () => {
    let s = gateFight();
    s = side(s, ASH, 'neutral');
    s = hit(s, ASH, '-999');
    assert.equal(row(s, ASH).out, true);
    assert.ok(!row(s, ASH).conds.includes('Down'));
    assert.ok(texts(s).includes('Brother Ash drops.'));
    s = side(s, WOLF, 'ally', 1);
    s = hit(s, WOLF, '-999', 1);
    assert.equal(row(s, WOLF, 1).out, false);
    assert.ok(row(s, WOLF, 1).conds.includes('Down'));
  });

  it('neutrals and reader-allies set neutral are not in vitals', () => {
    let s = gateFight();
    assert.ok(RS.derive(model, s).vitals.some((v) => v.note === LUCAN), 'Lucan, a reader-ally, has a vitals row');
    s = side(s, LUCAN, 'neutral');
    s = hit(s, LUCAN, '-3');
    s = side(s, ASH, 'neutral');
    s = hit(s, ASH, '-3');
    let d = RS.derive(model, s);
    assert.ok(!d.vitals.some((v) => v.note === LUCAN || v.note === ASH));
    s = end(s);
    d = RS.derive(model, s);
    assert.ok(!d.vitals.some((v) => v.note === LUCAN || v.note === ASH));
    assert.ok(!d.vitalsRecorded.some((v) => v.note === LUCAN));
    // an ally in an earlier fight, set neutral since: still not in the vitals
    let t = gateFight();
    t = hit(t, LUCAN, '-3');
    t = end(t);
    assert.ok(RS.derive(model, t).vitals.some((v) => v.note === LUCAN));
    t = fightAt(t, GATE);
    t = side(t, LUCAN, 'neutral');
    assert.ok(!RS.derive(model, t).vitals.some((v) => v.note === LUCAN));
    // a carried neutral too
    const carried = { ...model, sidesCarried: { [LUCAN]: 'neutral' } };
    assert.ok(!RS.derive(carried, fresh()).vitals.some((v) => v.note === LUCAN));
    // and a foe the GM set to ally has one
    t = side(t, ASH, 'ally');
    assert.ok(RS.derive(model, t).vitals.some((v) => v.note === ASH));
  });

  // plan 6a fix round 1 / review C1: one copy's side is that copy's, never the note's
  // changed on purpose by the final review (ledger 86): the copy the players saw as an ally leaves its name seen
  it('one copy of two set to ally: no side remembered, the next fight is the reader\'s, no Sides set line', () => {
    let s = gateFight();
    s = side(s, WOLF, 'ally', 1);
    assert.equal(row(s, WOLF, 1).kind, 'ally');
    assert.equal(s.sides[WOLF], undefined);
    assert.deepEqual(RS.derive(model, s).sidesSet, []);
    s = fightAt(end(s), GATE);
    assert.ok(rows(s, WOLF).every((r) => r.kind === 'foe' && !r.neutral), 'every wolf a foe again');
    assert.ok(rows(s, WOLF).every((r) => r.seen), 'named, as the players saw it');
  });

  // final review, ledger 86: a turned ally is no "Stranger" in the next fight
  it('a seen ally set to foe, End fight, a new fight with him: named, not a stranger', () => {
    let s = gateFight();
    s = side(s, ASH, 'ally');
    assert.equal(row(s, ASH).seen, true, 'an ally is seen');
    s = side(s, ASH, 'foe');
    assert.equal(row(s, ASH).seen, true, 'set back to foe, the name stays (ruling I2)');
    s = end(s);
    assert.ok(s.seenEver[ASH], 'remembered as seen');
    s = fightAt(s, GATE);
    assert.deepEqual([row(s, ASH).kind, row(s, ASH).seen], ['foe', true]);
    const { forPlayers } = require('../lib/run-sheet/players');
    const v = forPlayers(model, s, { withheldWords: model.withheldWords, picId: () => '0'.repeat(20) });
    const names = v.panels.flatMap((p) => (p.order ? p.order.rows.map((r) => r.name) : []));
    assert.ok(names.includes('Brother Ash'), `his name, not his unseen word: ${names.join(', ')}`);
    // a foe never seen leaves nothing behind
    let t = gateFight();
    t = end(t);
    assert.ok(!t.seenEver[ASH]);
    t = fightAt(t, GATE);
    assert.equal(row(t, ASH).seen, false);
  });

  // final review, ledger 88: a side carried from an earlier session still applies after a mixed group drops s.sides
  it('a carried side still applies after setSide forgets the note for a mixed group', () => {
    const carried = { ...model, sidesCarried: { [WOLF]: 'neutral' } };
    let s = fightAt(move(fresh(), ADA, GATE), GATE, { m: carried });
    assert.ok(rows(s, WOLF).every((r) => r.neutral && r.sideFrom === 'you set it'), 'every wolf starts neutral from the Table Log');
    s = side(s, WOLF, 'foe', 1);
    assert.equal(s.sides[WOLF], undefined, 'mixed: tonight\'s side for the note is dropped');
    assert.deepEqual(rows(s, WOLF).map((r) => M.sideOfRow(r)), ['foe', 'neutral', 'neutral'], 'the other copies keep theirs');
    s = end(s);
    const id = nextId();
    const b = M.rowsForFight({ model: carried, derived: RS.derive(carried, s), state: s, beatKey: GATE.key, idBase: id });
    s = RS.reduce(s, { id, type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, now());
    assert.ok(rows(s, WOLF).every((r) => r.neutral), 'the next fight starts from the carried side again');
  });

  it('every copy set: remembered; one set back: forgotten', () => {
    let s = gateFight();
    for (const r of rows(s, WOLF)) s = side(s, WOLF, 'ally', r.copy);
    assert.equal(s.sides[WOLF], 'ally');
    assert.deepEqual(RS.derive(model, s).sidesSet, [{ note: WOLF, side: 'ally' }]);
    const next = fightAt(end(s), GATE);
    assert.ok(rows(next, WOLF).every((r) => r.kind === 'ally'), 'remembered into the next fight');
    s = side(s, WOLF, 'foe', 2);
    assert.equal(s.sides[WOLF], undefined, 'mixed again: forgotten');
    s = fightAt(end(s), GATE);
    assert.ok(rows(s, WOLF).every((r) => r.kind === 'foe'));
  });

  it('derive lists the sides set tonight for the record', () => {
    let s = gateFight();
    s = side(s, ASH, 'ally');
    s = side(s, LUCAN, 'neutral');
    s = side(s, ASH, 'foe');
    assert.deepEqual(RS.derive(model, s).sidesSet, [{ note: ASH, side: 'foe' }, { note: LUCAN, side: 'neutral' }]);
    assert.deepEqual(RS.derive(model, fresh()).sidesSet, []);
  });

  it('an old saved state with no sides derives', () => {
    let old = gateFight();
    delete old.sides;
    for (const r of old.fight.rows) delete r.neutral;
    const d = RS.derive(model, old);
    assert.deepEqual(d.sidesSet, []);
    assert.equal(d.fight.view.rows.find((r) => r.note === ASH).kind, 'foe');
    const up = RS.upgrade(old, fresh());
    assert.deepEqual(up.sides, {});
    old = side(up, ASH, 'neutral');
    assert.equal(old.sides[ASH], 'neutral');
    // a row with no neutral key is no neutral
    assert.equal(M.sideOfRow(up.fight.rows.find((r) => r.note === ASH)), 'foe');
    assert.throws(() => RS.upgrade({ sides: [] }, fresh()), (e) => e.code === 'BAD_STATE');
  });
});

// Task 7 fix round 1 (a Task 6 leftover): a group or beat join's line carries no `join` id, so its rows carry none
// and `undoable` says no: the Undo button is never offered for it
describe('undo is only for a plain add', () => {
  it('a beat or group join is not undoable; an add by name is', () => {
    // the reviewer's case: a place beat holding a creature and a statless NPC, joined by its beat
    const YARD = 'Locations/The Chapel Yard.md';
    const m = clone(model);
    m.placePeople = { [YARD]: [DRAKE, 'Characters/NPCs/Sister Fen.md'] };
    const key = m.placeKeys[YARD];
    let s = fightAt(move(fresh(), ADA, GATE), GATE, { m });
    s = act(s, { type: 'improvise', key, title: 'The Chapel Yard', place: YARD, quiet: true });
    const id = `j${++n}`;
    const j = M.joinRows({ model: m, derived: RS.derive(m, s), state: s, fight: s.fight, add: { beat: key }, idBase: id });
    assert.ok(j.rows.some((r) => r.kind !== 'pc'), `a join that brings new rows: ${j.rows.map((r) => r.name)}`);
    assert.ok(j.groups.length, 'and a group');
    s = RS.reduce(s, { id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: '', planned: true }, now());
    assert.ok(!s.events.some((e) => e.join === id), 'its line has no join id');
    assert.ok(!s.fight.rows.some((r) => r.joinId === id), 'nor do its rows');
    assert.equal(M.undoable(s.fight, id), false);
    const before = JSON.stringify(s.fight.rows);
    s = F(s, { type: 'undoAdd', join: id });
    assert.equal(JSON.stringify(s.fight.rows), before, 'an undo of it does nothing');
    // a plain add by name still is
    const id2 = `j${++n}`;
    const j2 = M.joinRows({ model, derived: RS.derive(model, s), state: s, fight: s.fight, add: { name: 'Bouncer', count: 2 }, idBase: id2 });
    s = RS.reduce(s, { id: id2, type: 'fightJoin', fight: s.fight.id, rows: j2.rows, tick: j2.tick, groups: j2.groups, thresholds: j2.thresholds, label: 'Bouncer ×2' }, now());
    assert.equal(M.undoable(s.fight, id2), true);
    assert.equal(s.fight.rows.filter((r) => r.joinId === id2).length, 2);
  });
});

describe('fight maths by system (step 6b Task 6)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const COC = systemFor('coc-7e').describe().fight;
  const GURPS = systemFor('gurps-4e').describe().fight;
  const { forPlayers } = require('../lib/run-sheet/players');
  // a fight of inline rows, as the page would send them (Task 7 builds the page's)
  const begin = (rules, list) => {
    const rowsIn = list.map((o, i) => M.blankRow({ id: `r${i + 1}`, ...o }));
    return RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', ...(rules ? { rules } : {}), rows: rowsIn }, now());
  };
  const G = (s, a) => RS.reduce(s, { id: nextId(), fight: 'f1', ...a }, now());
  const named = (s, name) => s.fight.rows.find((r) => r.name === name);
  const order = (s) => s.fight.rows.map((r) => r.name);
  const go = (s) => G(s, { type: 'fightNext', from: s.fight.turn, round: s.fight.round });
  const typeIn = (s, name, entry) => G(s, { type: 'hp', row: named(s, name).id, entry });
  const lines = (s) => s.events.filter((e) => e.fight).map((e) => e.text);
  const turnName = (s) => s.fight.rows.find((r) => r.id === s.fight.turn).name;

  it('GURPS damage goes below 0 and is never Out', () => {
    let s = begin(GURPS, [{ name: 'Bouncer', hp: 12, max: 12 }, { name: 'Kev', kind: 'pc', hp: 10, max: 10 }, { name: 'Guard', hp: 5, max: 5 }]);
    s = typeIn(s, 'Bouncer', '-20');
    s = typeIn(s, 'Kev', '-10');
    assert.deepEqual([named(s, 'Kev').hp, named(s, 'Kev').conds], [0, []], 'exactly 0: no Down');
    s = typeIn(s, 'Kev', '-4');
    s = typeIn(s, 'Guard', '-5');
    assert.deepEqual([named(s, 'Guard').hp, named(s, 'Guard').out], [0, false], 'exactly 0: not Out');
    assert.deepEqual([named(s, 'Bouncer').hp, named(s, 'Bouncer').out], [-8, false]);
    assert.deepEqual([named(s, 'Kev').hp, named(s, 'Kev').conds], [-4, []], 'no Down outside D&D');
    assert.ok(!lines(s).some((t) => /drops|Down|Bloodied|death save/.test(t)), lines(s).join('\n'));
  });

  it('CoC: HP stops at 0 and is never Out; MP at 0 is logged', () => {
    let s = begin(COC, [{ name: 'Cultist', hp: 12, max: 12, mp: 3, mpMax: 9, san: 40, sanMax: 40 }]);
    s = typeIn(s, 'Cultist', '-20');
    assert.deepEqual([named(s, 'Cultist').hp, named(s, 'Cultist').out], [0, false]);
    s = typeIn(s, 'Cultist', 'm-5');
    assert.equal(named(s, 'Cultist').mp, 0, 'MP stops at 0');
    assert.ok(lines(s).includes('Cultist: MP 0.'), lines(s).join('\n'));
    s = typeIn(s, 'Cultist', 'm+20');
    assert.equal(named(s, 'Cultist').mp, 9, 'MP heals to its max');
    s = typeIn(s, 'Cultist', 's-6');
    assert.equal(named(s, 'Cultist').san, 34);
    s = typeIn(s, 'Cultist', 's+90');
    // fix round 1: a gain stops at the lower of 99 and the row's own max (here 40)
    assert.equal(named(s, 'Cultist').san, 40, 's+90 at 34/40 SAN leaves 40');
    assert.ok(!lines(s).some((t) => /drops|Down|Bloodied/.test(t)));
  });

  it('D&D unchanged: a foe at 0 drops, a fight with no rules runs as D&D', () => {
    let s = begin(null, [{ name: 'Wolf', hp: 4, max: 11 }]);
    assert.equal(s.fight.rules, undefined);
    s = typeIn(s, 'Wolf', '-9');
    assert.deepEqual([named(s, 'Wolf').hp, named(s, 'Wolf').out], [0, true]);
    assert.ok(lines(s).includes('Wolf drops.'));
    s = typeIn(s, 'Wolf', 'm-2');
    assert.equal(named(s, 'Wolf').mp, null, 'a pool prefix means nothing in D&D');
  });

  it('marks: 12 → 3 Reeling → 0 or less, each logged once; +20 clears', () => {
    let s = begin(GURPS, [{ name: 'Kev', kind: 'pc', hp: 12, max: 12 }]);
    s = typeIn(s, 'Kev', '-9');
    assert.deepEqual(named(s, 'Kev').marks, ['Reeling']);
    s = typeIn(s, 'Kev', '-1');
    s = typeIn(s, 'Kev', '-2');
    assert.deepEqual(named(s, 'Kev').marks, ['Reeling', '0 or less']);
    s = typeIn(s, 'Kev', '-1');
    assert.deepEqual(lines(s).filter((t) => /^Kev:/.test(t)), ['Kev: Reeling.', 'Kev: HP 0 or less.']);
    s = typeIn(s, 'Kev', '-64');
    assert.equal(named(s, 'Kev').deepest, 5, 'the deepest line passed, for Task 13');
    assert.equal(named(s, 'Kev').out, false);
    s = typeIn(s, 'Kev', '+70');
    s = typeIn(s, 'Kev', '+20');
    assert.deepEqual([named(s, 'Kev').hp, named(s, 'Kev').marks, named(s, 'Kev').deepest], [12, [], 0]);
    // crossed again, logged again
    s = typeIn(s, 'Kev', '-10');
    assert.equal(lines(s).filter((t) => t === 'Kev: Reeling.').length, 2);
  });

  it('Tired at a third of FP, logged when crossed', () => {
    let s = begin(GURPS, [{ name: 'Kev', kind: 'pc', hp: 12, max: 12, fp: 12, fpMax: 12 }]);
    s = typeIn(s, 'Kev', 'f-8');
    assert.deepEqual([named(s, 'Kev').fp, named(s, 'Kev').tired], [4, false]);
    s = typeIn(s, 'Kev', 'f-1');
    assert.deepEqual([named(s, 'Kev').fp, named(s, 'Kev').tired], [3, true]);
    s = typeIn(s, 'Kev', 'f-1');
    assert.equal(lines(s).filter((t) => t === 'Kev: Tired.').length, 1);
    s = typeIn(s, 'Kev', 'f-40');
    assert.equal(named(s, 'Kev').fp, -12, 'f-40 at 3/12 FP leaves -12');
    s = typeIn(s, 'Kev', 'f+30');
    assert.deepEqual([named(s, 'Kev').fp, named(s, 'Kev').tired], [12, false]);
    assert.equal(named(s, 'Kev').hp, 12, 'FP never touches HP');
  });

  it('sort at Fight: CoC and GURPS open sorted, blanks last; D&D waits for Sort', () => {
    const list = [{ name: 'Blank', ini: null }, { name: 'Slow', ini: 4.5 }, { name: 'Fast', ini: 6 }];
    assert.deepEqual(order(begin(GURPS, list)), ['Fast', 'Slow', 'Blank']);
    assert.deepEqual(order(begin(COC, [{ name: 'Blank', ini: null }, { name: 'Slow', ini: 40 }, { name: 'Fast', ini: 70 }])), ['Fast', 'Slow', 'Blank']);
    assert.deepEqual(order(begin(null, list)), ['Blank', 'Slow', 'Fast']);
    assert.equal(begin(GURPS, list).fight.sorted, true);
  });

  it('decimal Speed 5.25 kept through setInit, the sort, Next\'s round line and the players\' order', () => {
    let s = begin(GURPS, [{ name: 'Kev', kind: 'pc', ini: null, note: ADA }, { name: 'Bouncer', ini: 5.5 }]);
    s = G(s, { type: 'setInit', row: named(s, 'Kev').id, ini: '5.25' });
    assert.equal(named(s, 'Kev').ini, 5.25);
    s = G(s, { type: 'setInit', row: named(s, 'Bouncer').id, ini: 5 });
    assert.deepEqual(order(s), ['Kev', 'Bouncer'], 'before Start the latest entry re-places');
    s = go(s);
    assert.ok(lines(s).includes('Round 1: Kev 5.25, Bouncer 5.'), lines(s).join('\n'));
    // the players' order, on a fight the page's builders made at the Gate
    const gm = { ...model, rules: { ...model.rules, fight: GURPS } };
    let p = move(fresh(), ADA, GATE);
    const fid = nextId();
    const b = M.rowsForFight({ model: gm, derived: RS.derive(gm, p), state: p, beatKey: GATE.key, idBase: fid });
    p = RS.reduce(p, { id: fid, type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds, rules: GURPS }, now());
    p = F(p, { type: 'setInit', row: row(p, ADA).id, ini: 5.25 });
    p = next(p);
    const panel = forPlayers(model, p, { withheldWords: model.withheldWords, campaign: model.campaign, picId: () => null }).panels.find((x) => x.order);
    assert.ok(panel, 'the players see the order');
    assert.deepEqual(panel.order.rows.filter((r) => !r.lair && r.ini !== null).map((r) => r.ini), [5.25]);
    // more places than the rules keep is refused; D&D and CoC keep none, never truncated
    s = G(s, { type: 'setInit', row: named(s, 'Kev').id, ini: 5.255 });
    assert.equal(named(s, 'Kev').ini, 5.25);
    let d = begin(null, [{ name: 'Wolf', ini: 3 }]);
    d = G(d, { type: 'setInit', row: named(d, 'Wolf').id, ini: 5.25 });
    assert.equal(named(d, 'Wolf').ini, 3, 'a decimal is refused where the rules keep none');
    d = G(d, { type: 'rollInit', values: { [named(d, 'Wolf').id]: 7 } });
    assert.equal(named(d, 'Wolf').ini, 3, 'Roll fills an empty box only');
    let g = begin(GURPS, [{ name: 'Bouncer', ini: null }]);
    g = G(g, { type: 'rollInit', values: { [named(g, 'Bouncer').id]: 5.75 } });
    assert.equal(named(g, 'Bouncer').ini, 5.75);
  });

  it('GURPS after Start: a typed Speed changes the figure, not the place; before Start it re-places', () => {
    let s = begin(GURPS, [{ name: 'Bouncer 1', ini: 5, speed: 5 }, { name: 'Kev', kind: 'pc', ini: 6, speed: 6 }, { name: 'Bouncer 2', ini: 5.5, speed: 5.5 }]);
    assert.deepEqual(order(s), ['Kev', 'Bouncer 2', 'Bouncer 1']);
    s = G(s, { type: 'setStat', row: named(s, 'Bouncer 1').id, key: 'speed', value: 7 });
    assert.deepEqual(order(s), ['Bouncer 1', 'Kev', 'Bouncer 2'], 'before Start it re-places');
    s = go(s);
    s = go(s);
    assert.equal(turnName(s), 'Kev');
    s = G(s, { type: 'setStat', row: named(s, 'Bouncer 2').id, key: 'speed', value: 8 });
    assert.equal(named(s, 'Bouncer 2').ini, 8);
    assert.deepEqual(order(s), ['Bouncer 1', 'Kev', 'Bouncer 2'], 'the order stays as it started (B363)');
    assert.equal(turnName(s), 'Kev');
    assert.ok(lines(s).includes('Bouncer 2: Speed 8; the order stays as it started.'), lines(s).join('\n'));
    s = G(s, { type: 'setInit', row: named(s, 'Bouncer 1').id, ini: 1 });
    assert.deepEqual(order(s), ['Bouncer 1', 'Kev', 'Bouncer 2'], 'a typed initiative is the same');
    // CoC keeps 6a's after-Start re-placing
    let c = begin(COC, [{ name: 'A', ini: 70, dex: 70 }, { name: 'B', ini: 50, dex: 50 }]);
    c = go(c);
    c = G(c, { type: 'setStat', row: named(c, 'B').id, key: 'dex', value: 80 });
    assert.deepEqual(order(c), ['B', 'A']);
    assert.equal(turnName(c), 'A');
  });

  it('a row added after Start takes its place when its first Speed arrives, then stays', () => {
    let s = begin(GURPS, [{ name: 'Kev', kind: 'pc', ini: 6, speed: 6 }, { name: 'Blank', ini: null }, { name: 'Slow', ini: 4, speed: 4 }]);
    assert.deepEqual(order(s), ['Kev', 'Slow', 'Blank']);
    s = go(s);
    const late = M.blankRow({ id: 'late', name: 'Late', ini: null });
    s = G(s, { type: 'fightJoin', rows: [late], label: 'Late' });
    assert.deepEqual(order(s), ['Kev', 'Slow', 'Blank', 'Late']);
    s = G(s, { type: 'setStat', row: 'late', key: 'speed', value: 5 });
    assert.deepEqual(order(s), ['Kev', 'Late', 'Slow', 'Blank'], 'its first Speed places it');
    s = G(s, { type: 'setStat', row: named(s, 'Blank').id, key: 'speed', value: 7 });
    assert.deepEqual(order(s), ['Blank', 'Kev', 'Late', 'Slow'], 'a row blank at Start takes its place too');
    assert.equal(turnName(s), 'Kev');
    s = G(s, { type: 'setStat', row: 'late', key: 'speed', value: 3 });
    assert.deepEqual(order(s), ['Blank', 'Kev', 'Late', 'Slow'], 'then it is fixed');
    // a row that joins with its Speed takes its place at once
    s = G(s, { type: 'fightJoin', rows: [M.blankRow({ id: 'quick', name: 'Quick', ini: 6.5, speed: 6.5 })], label: 'Quick' });
    assert.deepEqual(order(s), ['Blank', 'Quick', 'Kev', 'Late', 'Slow']);
  });

  it('Sort after Start re-sorts once, the turn kept', () => {
    let s = begin(GURPS, [{ name: 'Kev', kind: 'pc', ini: 6, speed: 6 }, { name: 'Slow', ini: 4, speed: 4 }]);
    s = go(s);
    s = go(s);
    assert.equal(turnName(s), 'Slow');
    s = G(s, { type: 'setStat', row: named(s, 'Slow').id, key: 'speed', value: 9 });
    assert.deepEqual(order(s), ['Kev', 'Slow']);
    s = G(s, { type: 'fightSort' });
    assert.deepEqual(order(s), ['Slow', 'Kev']);
    assert.equal(turnName(s), 'Slow');
    assert.ok(lines(s).includes('The order is sorted again: Slow 9, Kev 6.'), lines(s).join('\n'));
  });

  it('firearm adds 50 and re-places after Start', () => {
    let s = begin(COC, [{ name: 'Ann', kind: 'pc', ini: 60, dex: 60 }, { name: 'Cultist', ini: 50, dex: 50 }, { name: 'Brute', ini: 40, dex: 40 }]);
    s = go(s);
    s = G(s, { type: 'firearm', row: named(s, 'Brute').id, on: true });
    assert.deepEqual([named(s, 'Brute').gun, named(s, 'Brute').ini], [true, 90]);
    assert.deepEqual(order(s), ['Brute', 'Ann', 'Cultist']);
    assert.equal(turnName(s), 'Ann');
    s = G(s, { type: 'firearm', row: named(s, 'Brute').id, on: false });
    assert.equal(named(s, 'Brute').ini, 40);
    assert.deepEqual(order(s), ['Ann', 'Cultist', 'Brute']);
  });

  it('setStat ST 11 HT 10 DX 12 gives HP 11, FP 10, Speed 5.5, marked, and re-places', () => {
    let s = begin(GURPS, [{ name: 'Kev', kind: 'pc', ini: 5.25, speed: 5.25 }, { name: 'Bouncer', ini: null }]);
    const id = named(s, 'Bouncer').id;
    for (const [key, value] of [['st', 11], ['ht', 10], ['dx', 12]]) s = G(s, { type: 'setStat', row: id, key, value });
    const b = named(s, 'Bouncer');
    assert.deepEqual([b.st, b.ht, b.dx, b.max, b.hp, b.fpMax, b.fp, b.speed, b.ini], [11, 10, 12, 11, 11, 10, 10, 5.5, 5.5]);
    // step 6b Task 14 changed this on purpose: Dodge is worked out from the worked-out Speed too, and marked
    assert.deepEqual(b.from, { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT', dodge: 'from Speed' });
    assert.equal(b.dodge, 8);
    assert.deepEqual(order(s), ['Bouncer', 'Kev']);
    assert.ok(lines(s).includes('Bouncer: initiative 5.5 from the typed stats.'), lines(s).join('\n'));
    // a stat typed later works the figures out again
    s = G(s, { type: 'setStat', row: id, key: 'st', value: 13 });
    assert.deepEqual([named(s, 'Bouncer').max, named(s, 'Bouncer').hp], [13, 13]);
  });

  it('setStat takes the CoC panel\'s combat figures: DB as words, Build below 0; a negative Fighting is refused', () => {
    let c = begin(COC, [{ name: 'Cultist', ini: 50, dex: 50 }]);
    const id = named(c, 'Cultist').id;
    for (const [key, value] of [['fighting', 55], ['firearms', 40], ['dodge', 30], ['db', '+1D4'], ['armour', 1], ['build', -1], ['attacks', 2]]) {
      c = G(c, { type: 'setStat', row: id, key, value });
    }
    const r = named(c, 'Cultist');
    assert.deepEqual([r.fighting, r.firearms, r.dodge, r.db, r.armour, r.build, r.attacks], [55, 40, 30, '+1D4', 1, -1, 2]);
    assert.deepEqual(r.typedKeys, { fighting: true, firearms: true, dodge: true, db: true, armour: true, build: true, attacks: true });
    c = G(c, { type: 'setStat', row: id, key: 'fighting', value: -5 });
    assert.equal(named(c, 'Cultist').fighting, 55);
    // GURPS has none of them
    let g = begin(GURPS, [{ name: 'Guard', ini: 5, speed: 5 }]);
    g = G(g, { type: 'setStat', row: named(g, 'Guard').id, key: 'fighting', value: 50 });
    assert.equal(named(g, 'Guard').fighting, null);
  });

  it('a typed Speed is not replaced by a later DX; a blank result never clears a typed initiative', () => {
    let s = begin(GURPS, [{ name: 'Bouncer', ini: null, ht: 10 }]);
    const id = named(s, 'Bouncer').id;
    s = G(s, { type: 'setStat', row: id, key: 'speed', value: 6 });
    s = G(s, { type: 'setStat', row: id, key: 'dx', value: 14 });
    assert.deepEqual([named(s, 'Bouncer').speed, named(s, 'Bouncer').ini], [6, 6]);
    assert.equal(named(s, 'Bouncer').from.speed, undefined);
    let t = begin(GURPS, [{ name: 'Guard', ini: null }]);
    const g = named(t, 'Guard').id;
    t = G(t, { type: 'setInit', row: g, ini: 5.75 });
    t = G(t, { type: 'setStat', row: g, key: 'dx', value: 12 });
    assert.equal(named(t, 'Guard').ini, 5.75, 'no HT, no Speed: the typed initiative stays');
    let c = begin(COC, [{ name: 'Cultist', ini: 50, dex: 50 }]);
    c = G(c, { type: 'setStat', row: named(c, 'Cultist').id, key: 'dex', value: null });
    assert.equal(named(c, 'Cultist').ini, 50);
  });

  it('setInit and setStat with hold set the number without moving the row; placeHeld moves them, the turn kept', () => {
    let s = begin(GURPS, [{ name: 'A', ini: 6, speed: 6 }, { name: 'B', ini: 5, speed: 5 }, { name: 'C', ini: 4, speed: 4 }]);
    s = G(s, { type: 'setInit', row: named(s, 'C').id, ini: 9, hold: true });
    s = G(s, { type: 'setStat', row: named(s, 'B').id, key: 'speed', value: 8, hold: true });
    assert.deepEqual(order(s), ['A', 'B', 'C']);
    assert.deepEqual([named(s, 'C').ini, named(s, 'B').ini], [9, 8]);
    s = G(s, { type: 'placeHeld' });
    assert.deepEqual(order(s), ['C', 'B', 'A']);
    assert.ok(s.fight.rows.every((r) => !r.held));
    // after Start in CoC, the turn kept
    let c = begin(COC, [{ name: 'A', ini: 70, dex: 70 }, { name: 'B', ini: 50, dex: 50 }, { name: 'C', ini: 40, dex: 40 }]);
    c = go(c);
    c = go(c);
    c = G(c, { type: 'setInit', row: named(c, 'C').id, ini: 90, hold: true });
    assert.deepEqual(order(c), ['A', 'B', 'C']);
    c = G(c, { type: 'placeHeld' });
    assert.deepEqual(order(c), ['C', 'A', 'B']);
    assert.equal(turnName(c), 'B');
    // Start sorts held rows with the rest
    let h = begin(COC, [{ name: 'A', ini: 70 }, { name: 'B', ini: 50 }]);
    h = G(h, { type: 'setInit', row: named(h, 'B').id, ini: 80, hold: true });
    h = go(h);
    assert.deepEqual(order(h), ['B', 'A']);
    assert.equal(named(h, 'B').held, false);
  });

  it('setInit, setMax, setAc and setStat each record their typedKeys field; setStat hp sets max, speed sets speed and ini', () => {
    let s = begin(GURPS, [{ name: 'R', ini: null }]);
    const id = 'r1';
    s = G(s, { type: 'setInit', row: id, ini: 5 });
    s = G(s, { type: 'setMax', row: id, max: 14 });
    s = G(s, { type: 'setAc', row: id, ac: 3 });
    assert.deepEqual(named(s, 'R').typedKeys, { ini: true, max: true, ac: true });
    s = G(s, { type: 'setStat', row: id, key: 'hp', value: 15 });
    assert.deepEqual([named(s, 'R').max, named(s, 'R').hp], [15, 15]);
    s = G(s, { type: 'setStat', row: id, key: 'speed', value: 6.25 });
    s = G(s, { type: 'setStat', row: id, key: 'fp', value: 11 });
    s = G(s, { type: 'setStat', row: id, key: 'dodge', value: 9 });
    const r = named(s, 'R');
    assert.deepEqual(r.typedKeys, { ini: true, max: true, ac: true, speed: true, fpMax: true, dodge: true });
    assert.deepEqual([r.speed, r.ini, r.fpMax, r.fp, r.dodge, r.typed], [6.25, 6.25, 11, 11, 9, true]);
    let c = begin(COC, [{ name: 'Q', ini: null }]);
    for (const [key, value] of [['dex', 55], ['mp', 8], ['san', 45]]) c = G(c, { type: 'setStat', row: 'r1', key, value });
    const q = named(c, 'Q');
    assert.deepEqual(q.typedKeys, { dex: true, ini: true, mpMax: true, san: true, sanMax: true });
    assert.deepEqual([q.dex, q.ini, q.mpMax, q.mp, q.san, q.sanMax], [55, 55, 8, 8, 45, 45]);
    c = G(c, { type: 'setStat', row: 'r1', key: 'nonsense', value: 3 });
    c = G(c, { type: 'setStat', row: 'r1', key: 'dex', value: 'abc' });
    assert.equal(named(c, 'Q').dex, 55);
  });

  it('an old saved fight with no rules runs as D&D', () => {
    let s = begin(null, [{ name: 'Wolf', ini: null, hp: 11, max: 11 }, { name: 'Ada', kind: 'pc', ini: 12, hp: 5, max: 5 }]);
    assert.deepEqual(order(s), ['Wolf', 'Ada'], 'not sorted at Fight');
    s = G(s, { type: 'setInit', row: named(s, 'Wolf').id, ini: 15 });
    assert.deepEqual(order(s), ['Wolf', 'Ada']);
    s = go(s);
    s = typeIn(s, 'Ada', '-6');
    assert.deepEqual(named(s, 'Ada').conds, ['Down']);
    assert.equal(named(s, 'Ada').hp, 0);
  });
});

describe('fight maths by system: a typed initiative and other stats (step 6b Task 6)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const GURPS = systemFor('gurps-4e').describe().fight;
  it('an ST typed never undoes a typed initiative; a new Speed does', () => {
    let s = RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', rules: GURPS, rows: [M.blankRow({ id: 'r1', name: 'Guard', ini: 5.5, speed: 5.5, dx: 12, ht: 10 })] }, now());
    const G = (a) => { s = RS.reduce(s, { id: nextId(), fight: 'f1', row: 'r1', ...a }, now()); return s.fight.rows[0]; };
    G({ type: 'setInit', ini: 6 });
    assert.equal(G({ type: 'setStat', key: 'st', value: 13 }).ini, 6);
    assert.equal(G({ type: 'setStat', key: 'ht', value: 12 }).ini, 6, 'a block-stated Speed is not worked out again');
    assert.equal(G({ type: 'setStat', key: 'speed', value: 5.75 }).ini, 5.75);
  });
});

describe('fight maths by system: fix round 1 (step 6b Task 6)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const COC = systemFor('coc-7e').describe().fight;
  const GURPS = systemFor('gurps-4e').describe().fight;
  const begin = (rules, list) => RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', ...(rules ? { rules } : {}), rows: list.map((o, i) => M.blankRow({ id: `r${i + 1}`, ...o })) }, now());
  const G = (s, a) => RS.reduce(s, { id: nextId(), fight: 'f1', ...a }, now());
  const named = (s, name) => s.fight.rows.find((r) => r.name === name);
  const order = (s) => s.fight.rows.filter((r) => r.in).map((r) => r.name);
  const go = (s) => G(s, { type: 'fightNext', from: s.fight.turn, round: s.fight.round });
  const turnName = (s) => s.fight.rows.find((r) => r.id === s.fight.turn).name;
  const lines = (s) => s.events.filter((e) => e.fight).map((e) => e.text);

  it('a GURPS row benched at Start and ticked in after it takes its place, then holds it', () => {
    let s = begin(GURPS, [{ name: 'A', ini: 6, speed: 6 }, { name: 'B', ini: 5, speed: 5 }, { name: 'Late', ini: 7, speed: 7, in: false }]);
    s = go(s);
    assert.equal(named(s, 'Late').fixed, false, 'a benched row has no place at Start');
    s = G(s, { type: 'fightTick', row: named(s, 'Late').id, in: true });
    assert.deepEqual(order(s), ['Late', 'A', 'B']);
    assert.equal(turnName(s), 'A', 'the turn is kept');
    s = G(s, { type: 'setStat', row: named(s, 'Late').id, key: 'speed', value: 4 });
    assert.deepEqual(order(s), ['Late', 'A', 'B'], 'then it is fixed');
    assert.ok(lines(s).includes('Late: Speed 4; the order stays as it started.'));
    // ticked in through a join's tick too
    let j = begin(GURPS, [{ name: 'A', ini: 6, speed: 6 }, { name: 'B', ini: 5, speed: 5 }, { name: 'Mid', ini: 5.5, speed: 5.5, in: false }]);
    j = go(j);
    j = G(j, { type: 'fightJoin', rows: [], tick: [named(j, 'Mid').id], label: 'Mid' });
    assert.deepEqual(order(j), ['A', 'Mid', 'B']);
    assert.equal(named(j, 'Mid').fixed, true);
  });

  it('a GURPS row blank and benched at Start, ticked in, waits last for its first Speed', () => {
    let s = begin(GURPS, [{ name: 'A', ini: 6, speed: 6 }, { name: 'B', ini: 5, speed: 5 }, { name: 'Blank', ini: null, in: false }]);
    s = go(s);
    s = G(s, { type: 'fightTick', row: named(s, 'Blank').id, in: true });
    assert.deepEqual(order(s), ['A', 'B', 'Blank']);
    s = G(s, { type: 'setStat', row: named(s, 'Blank').id, key: 'speed', value: 5.5 });
    assert.deepEqual(order(s), ['A', 'Blank', 'B']);
    assert.equal(turnName(s), 'A');
  });

  it('a SAN gain stops at the lower of 99 and the row\'s own max', () => {
    let s = begin(COC, [{ name: 'Ann', kind: 'pc', san: 50, sanMax: 80 }, { name: 'Bo', kind: 'pc', san: 50, sanMax: null }]);
    s = G(s, { type: 'hp', row: named(s, 'Ann').id, entry: 's+40' });
    s = G(s, { type: 'hp', row: named(s, 'Bo').id, entry: 's+60' });
    assert.deepEqual([named(s, 'Ann').san, named(s, 'Bo').san], [80, 99]);
  });

  it('typedKeys.ini: DEX or Speed typed records it even at the same figure; a worked-out Speed that replaces it clears it', () => {
    let c = begin(COC, [{ name: 'Q', ini: 50, dex: 50 }]);
    c = G(c, { type: 'setStat', row: 'r1', key: 'dex', value: 50 });
    assert.equal(named(c, 'Q').typedKeys.ini, true);
    let g = begin(GURPS, [{ name: 'R', ini: null }]);
    for (const [key, value] of [['dx', 12], ['ht', 10]]) g = G(g, { type: 'setStat', row: 'r1', key, value });
    assert.equal(named(g, 'R').ini, 5.5);
    g = G(g, { type: 'setInit', row: 'r1', ini: 7 });
    assert.equal(named(g, 'R').typedKeys.ini, true);
    g = G(g, { type: 'setStat', row: 'r1', key: 'dx', value: 14 });
    assert.deepEqual([named(g, 'R').ini, named(g, 'R').typedKeys.ini], [6, undefined]);
  });

  it('setStat takes only the system\'s keys: D&D refuses hp, GURPS refuses dex, CoC refuses st', () => {
    for (const [rules, key] of [[null, 'hp'], [GURPS, 'dex'], [COC, 'st']]) {
      const s = begin(rules, [{ name: 'X', ini: 4, hp: 5, max: 5 }]);
      const t = G(s, { type: 'setStat', row: 'r1', key, value: 9 });
      assert.deepEqual(t.fight.rows, s.fight.rows, `${key} refused`);
      assert.equal(t.events.length, s.events.length);
    }
  });
});

describe('GURPS magic: the GM picks the pool (step 6b Task 10)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const GURPS = systemFor('gurps-4e').describe().fight;
  const begin = (list) => RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', rules: GURPS, rows: list.map((o, i) => M.blankRow({ id: `r${i + 1}`, ...o })) }, now());
  const G = (s, a) => RS.reduce(s, { id: nextId(), fight: 'f1', ...a }, now());
  const named = (s, name) => s.fight.rows.find((r) => r.name === name);
  const typeIn = (s, name, entry) => G(s, { type: 'hp', row: named(s, name).id, entry });
  const lines = (s) => s.events.filter((e) => e.fight).map((e) => e.text);

  it('e-3 spends the reserve, not FP; f-3 spends FP', () => {
    let s = begin([{ name: 'Wenna', kind: 'pc', hp: 10, max: 10, fp: 11, fpMax: 14, er: 4, erMax: 4, caster: true }]);
    s = typeIn(s, 'Wenna', 'e-3');
    assert.deepEqual([named(s, 'Wenna').er, named(s, 'Wenna').fp], [1, 11]);
    s = typeIn(s, 'Wenna', 'f-3');
    assert.deepEqual([named(s, 'Wenna').er, named(s, 'Wenna').fp], [1, 8]);
    s = typeIn(s, 'Wenna', 'e-3');
    assert.equal(named(s, 'Wenna').er, 0, 'never below 0');
    assert.ok(lines(s).includes('Wenna: Energy Reserve 0.'), lines(s).join('\n'));
    s = typeIn(s, 'Wenna', 'e+9');
    assert.equal(named(s, 'Wenna').er, 4, 'e+9 stops at its max');
    assert.deepEqual([named(s, 'Wenna').fp, named(s, 'Wenna').hp], [8, 10]);
  });

  it('e-3 on a row with no reserve changes nothing', () => {
    const s = begin([{ name: 'Kev', kind: 'pc', hp: 10, max: 10, fp: 10, fpMax: 10 }]);
    const t = typeIn(s, 'Kev', 'e-3');
    assert.deepEqual(t.fight.rows, s.fight.rows);
    assert.equal(t.events.length, s.events.length);
  });

  it('rows from the GURPS vault carry the reserve and whether each one casts', () => {
    assert.equal(M.blankRow({}).caster, false);
    const GFIX = path.join(__dirname, 'fixtures', 'run-sheet-gurps');
    const GPLAN = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Crates - Plan.md';
    const gm = readRunSheet(GFIX, GPLAN, { party: ['Characters/PCs/Lysa Venn.md', 'Characters/PCs/Orrin Tate.md'] });
    const st = RS.emptyState({ stateId: 's', session: 'x', plan: GPLAN });
    const stair = gm.beats.find((b) => /Tower Stair/.test(b.title));
    const b = M.rowsForFight({ model: gm, derived: RS.derive(gm, st), state: st, beatKey: stair.key, idBase: 'g1' });
    const by = (name) => b.rows.find((r) => r.name === name);
    const got = (name) => [by(name).er, by(name).erMax, by(name).caster];
    assert.deepEqual(got('Bram Holt'), [4, 4, false]);
    assert.deepEqual(got('Ilse Verrin'), [4, 4, true], 'a trait Energy Reserve 4');
    assert.deepEqual(got('Dova Lang'), [null, null, false]);
    assert.deepEqual(got('Lysa Venn'), [6, 6, true]);
    assert.deepEqual(got('Orrin Tate'), [null, null, false]);
    assert.equal(gm.pcs.find((p) => p.name === 'Orrin Tate').spells, undefined, 'an empty Spells table gives no fold');
    assert.match(gm.pcs.find((p) => p.name === 'Lysa Venn').spells, /\| Create Fire \| Fire \| 13 \|/);
    let s = begin([{ name: 'Bram', hp: 12, max: 12, fp: 11, fpMax: 11, er: 2, erMax: 4 }]);
    s = typeIn(s, 'Bram', 'e+1');
    assert.equal(named(s, 'Bram').er, 3);
  });
});

describe('GURPS hits on the row (step 6b Task 12)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const GURPS = systemFor('gurps-4e').describe().fight;
  const begin = (list) => RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', rules: GURPS, rows: list.map((o, i) => M.blankRow({ id: `r${i + 1}`, ...o })) }, now());
  const G = (s, a) => RS.reduce(s, { id: nextId(), fight: 'f1', ...a }, now());
  const named = (s, name) => s.fight.rows.find((r) => r.name === name);
  const typeIn = (s, name, entry, extra) => G(s, { type: 'hp', row: named(s, name).id, entry, ...(extra || {}) });
  const lines = (s) => s.events.filter((e) => e.fight).map((e) => e.text);

  it('9 imp vitals on DR 1 takes 24, the working on the row and in the log', () => {
    let s = begin([{ name: 'Vex', hp: 13, max: 13, dr: 1 }]);
    s = typeIn(s, 'Vex', '9 imp vitals');
    const v = named(s, 'Vex');
    assert.equal(v.hp, -11);
    assert.deepEqual(v.hit, { line: '9 imp − DR 1 = 8 × 3 = 24', injury: 24, location: 'vitals', side: null, type: 'imp' });
    assert.ok(lines(s).includes('Vex, vitals: 9 imp − DR 1 = 8 × 3 = 24.'), lines(s).join('\n'));
    // the marks follow as any damage (Task 6)
    assert.deepEqual(v.marks, ['Reeling', '0 or less']);
  });

  it('the players\' screen never sees the working, even an ally\'s', () => {
    // a GURPS fight at the Gate as the page builds it, its wolf made an ally and hit
    const gm = { ...model, rules: { ...model.rules, fight: GURPS } };
    let p = move(fresh(), ADA, GATE);
    const fid = nextId();
    const b = M.rowsForFight({ model: gm, derived: RS.derive(gm, p), state: p, beatKey: GATE.key, idBase: fid });
    p = RS.reduce(p, { id: fid, type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds, rules: GURPS }, now());
    const wolf = row(p, WOLF);
    p = F(p, { type: 'setSide', row: wolf.id, side: 'ally' });
    p = F(p, { type: 'hp', row: wolf.id, entry: '9 imp vitals' });
    p = next(p);
    assert.ok(row(p, WOLF).hit.line.startsWith('9 imp'));
    const seen = JSON.stringify(require('../lib/run-sheet/players').forPlayers(model, p, { withheldWords: model.withheldWords, picId: () => null }));
    assert.ok(seen.includes(`"hp":"${row(p, WOLF).hp}/`), `the ally's HP is there: ${seen}`);
    assert.ok(!/DR \d|× \d|vitals|imp/.test(seen), seen);
  });

  it('a bare 9 and -10 stay raw injury, even right after a hit; the last working goes', () => {
    let s = begin([{ name: 'Vex', hp: 40, max: 40, dr: 1 }]);
    s = typeIn(s, 'Vex', '9 imp vitals');
    s = typeIn(s, 'Vex', '9');
    assert.deepEqual([named(s, 'Vex').hp, named(s, 'Vex').hit], [7, null]);
    s = typeIn(s, 'Vex', '-10');
    assert.equal(named(s, 'Vex').hp, -3);
    s = typeIn(s, 'Vex', '+3');
    assert.equal(named(s, 'Vex').hp, 0);
  });

  it('9i is impaling to the torso', () => {
    let s = begin([{ name: 'Vex', hp: 20, max: 20, dr: 1 }]);
    s = typeIn(s, 'Vex', '9i');
    assert.deepEqual([named(s, 'Vex').hp, named(s, 'Vex').hit.line, named(s, 'Vex').hit.location], [4, '9 imp − DR 1 = 8 × 2 = 16', 'torso']);
  });

  it('4 cr torso on DR 5 is 0: nothing changes and nothing follows', () => {
    let s = begin([{ name: 'Knight', hp: 12, max: 12, dr: 5 }]);
    const before = lines(s).length;
    s = typeIn(s, 'Knight', '4 cr torso');
    const k = named(s, 'Knight');
    assert.deepEqual([k.hp, k.marks, k.crippled, k.hit.injury], [12, [], [], 0]);
    assert.deepEqual(lines(s).slice(before), ['Knight, torso: 4 cr − DR 5 = 0.']);
  });

  it('9 cut left arm on DR 1 at 12 HP takes 7, crippled (left arm) logged once and kept through +20', () => {
    let s = begin([{ name: 'Vex', hp: 12, max: 12, dr: 1 }]);
    s = typeIn(s, 'Vex', '9 cut left arm');
    let v = named(s, 'Vex');
    assert.deepEqual([v.hp, v.crippled, v.hit.injury], [5, ['left arm'], 7]);
    assert.ok(lines(s).includes('Vex: crippled (left arm).'));
    s = typeIn(s, 'Vex', '9 cut left arm');
    assert.equal(lines(s).filter((t) => t === 'Vex: crippled (left arm).').length, 1);
    s = typeIn(s, 'Vex', '+20');
    v = named(s, 'Vex');
    assert.deepEqual([v.hp, v.crippled], [12, ['left arm']]);
  });

  it('7 pi+ arm on DR 1 takes 6', () => {
    let s = begin([{ name: 'Vex', hp: 30, max: 30, dr: 1 }]);
    s = typeIn(s, 'Vex', '7 pi+ arm');
    assert.deepEqual([named(s, 'Vex').hp, named(s, 'Vex').hit.line], [24, '7 pi+ − DR 1 = 6']);
  });

  it('face open: a toggle on the row, a foe\'s face hit then takes no DR', () => {
    let s = begin([{ name: 'Vex', hp: 30, max: 30, dr: 3 }]);
    s = typeIn(s, 'Vex', '9 cr face');
    assert.equal(named(s, 'Vex').hp, 24);
    s = G(s, { type: 'faceOpen', row: named(s, 'Vex').id, on: true });
    assert.equal(named(s, 'Vex').faceOpen, true);
    s = typeIn(s, 'Vex', '9 cr face');
    assert.deepEqual([named(s, 'Vex').hp, named(s, 'Vex').hit.line], [15, '9 cr − DR 0 (face open) = 9']);
    s = typeIn(s, 'Vex', '9 cr torso');
    assert.equal(named(s, 'Vex').hp, 9, 'the torso keeps its DR');
  });

  it('dice: the server\'s roll is sent with the entry, and the working starts with it', () => {
    let s = begin([{ name: 'Vex', hp: 13, max: 13, dr: 1 }]);
    s = typeIn(s, 'Vex', '2d+1 imp vitals', { rolled: 9 });
    assert.deepEqual([named(s, 'Vex').hp, named(s, 'Vex').hit.line], [-11, '2d+1 = 9 imp − DR 1 = 8 × 3 = 24']);
    // a bare roll is raw injury, logged with its dice
    s = typeIn(s, 'Vex', '2d+1', { rolled: 6 });
    assert.equal(named(s, 'Vex').hp, -17);
    assert.ok(lines(s).includes('Vex: 2d+1 = 6.'), lines(s).join('\n'));
    // dice with no roll, or a roll that is no whole number, change nothing
    for (const rolled of [undefined, null, 'x', 2.5, -1]) {
      const t = typeIn(s, 'Vex', '2d+1 imp', rolled === undefined ? {} : { rolled });
      assert.equal(named(t, 'Vex').hp, -17, String(rolled));
    }
  });

  it('5 fat on DR 1 takes 4 FP, 12 fat skull 11 FP; a PC uses its sheet\'s DR by place', () => {
    let s = begin([{ name: 'Mage', hp: 10, max: 10, fp: 10, fpMax: 10, dr: 1 },
      { name: 'Sela', kind: 'pc', hp: 12, max: 12, drByLocation: { torso: 3, arm: 2, skull: 4 } }]);
    s = typeIn(s, 'Mage', '5 fat');
    assert.deepEqual([named(s, 'Mage').fp, named(s, 'Mage').hp], [6, 10]);
    s = typeIn(s, 'Mage', '12 fat skull');
    assert.deepEqual([named(s, 'Mage').fp, named(s, 'Mage').hp, named(s, 'Mage').crippled], [-5, 10, []]);
    assert.equal(named(s, 'Mage').hit.line, '12 fat skull − DR 1 = 11 (fatigue: no location effects)');
    s = typeIn(s, 'Sela', '9 cr');
    assert.equal(named(s, 'Sela').hp, 6, 'torso DR 3');
    s = typeIn(s, 'Sela', '4 cr arm');
    assert.equal(named(s, 'Sela').hp, 4, 'arm DR 2');
  });

  it('a DR typed in the panel wins over the sheet\'s by place for that row', () => {
    let s = begin([{ name: 'Sela', kind: 'pc', hp: 30, max: 30, drByLocation: { torso: 3, arm: 2 } }]);
    s = G(s, { type: 'setStat', row: named(s, 'Sela').id, key: 'dr', value: 6 });
    s = typeIn(s, 'Sela', '9 cr arm');
    assert.deepEqual([named(s, 'Sela').hp, named(s, 'Sela').hit.line], [27, '9 cr − DR 6 = 3']);
  });

  it('a PC row from the fixture sheet carries its DR by place', () => {
    const dir = require('./helpers/systems-fixture').copyFixture('run-sheet-gurps');
    try {
      const m = readRunSheet(dir, 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Crates - Plan.md', { party: ['Characters/PCs/Sela Drake.md'] });
      const sela = m.pcs.find((p) => p.name === 'Sela Drake');
      assert.deepEqual(sela.drByLocation, { skull: 4, face: 0, neck: 2, torso: 3, arm: 2, hand: 1, leg: 2, foot: 1 });
      // the beat's fight row for her, as Fight builds it
      const st = RS.emptyState({ stateId: 's', session: 'x', plan: 'p' });
      const beat = m.beats.find((x) => /Tower Stair/.test(x.title));
      const b = M.rowsForFight({ model: m, derived: RS.derive(m, st), state: st, beatKey: beat.key, idBase: 'f1' });
      assert.deepEqual(b.rows.find((r) => r.name === 'Sela Drake').drByLocation, sela.drByLocation);
    } finally { require('./helpers/systems-fixture').removeFixture(dir); }
  });

  it('D&D and CoC take no hit: the words change nothing', () => {
    let s = RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', rows: [M.blankRow({ id: 'r1', name: 'Wolf', hp: 11, max: 11 })] }, now());
    s = typeIn(s, 'Wolf', '9 imp vitals');
    assert.deepEqual([named(s, 'Wolf').hp, named(s, 'Wolf').hit], [11, null]);
  });
});

describe('GURPS consequence cards and turn upkeep (step 6b Task 13)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const GURPS = systemFor('gurps-4e').describe().fight;
  const begin = (list, rules = GURPS) => RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', ...(rules ? { rules } : {}), rows: list.map((o, i) => M.blankRow({ id: `r${i + 1}`, ...o })) }, now());
  const G = (s, a) => RS.reduce(s, { id: nextId(), fight: 'f1', ...a }, now());
  const named = (s, name) => s.fight.rows.find((r) => r.name === name);
  const typeIn = (s, name, entry) => G(s, { type: 'hp', row: named(s, name).id, entry });
  const go = (s) => G(s, { type: 'fightNext', from: s.fight.turn, round: s.fight.round });
  const lines = (s) => s.events.filter((e) => e.fight).map((e) => e.text);
  const turnName = (s) => s.fight.rows.find((r) => r.id === s.fight.turn).name;
  const cards = (s, name) => named(s, name).cards || [];
  // a roll result as the server gives it
  const rolled = (total, target, crit) => ({ dice: [4, 4, 4], total, target, margin: target - total, outcome: crit || (total <= target ? 'success' : 'failure') });
  const roll = (s, name, total, target, crit) => {
    const c = cards(s, name)[0];
    const i = require('../lib/run-sheet/web/gurps-math').nextLine(c, GURPS.consequences);
    return G(s, { type: 'cardRolled', row: named(s, name).id, card: c.id, line: i, result: rolled(total, target, crit) });
  };
  const take = (s, name, line, what) => G(s, { type: 'card', row: named(s, name).id, card: cards(s, name)[0].id, ...(line === null ? {} : { line }), take: what });
  const twoRows = () => [{ name: 'Kev', kind: 'pc', ini: 6, speed: 6, hp: 12, max: 12, ht: 11 }, { name: 'Guard', ini: 5, speed: 5, hp: 11, max: 11, ht: 10, dr: 1 }];

  it('an injury of 4 on a 12 HP row gives Shock −4; it clears at the end of the row\'s next turn, not before', () => {
    let s = begin(twoRows());
    s = go(s); // Kev acts
    s = typeIn(s, 'Kev', '-4');
    assert.equal(named(s, 'Kev').shock, 4);
    assert.deepEqual(cards(s, 'Kev'), [], 'a plain hit: no card');
    s = go(s); // Kev's turn ends: the hit came in it, so the shock stays for the next one
    assert.equal(named(s, 'Kev').shock, 4);
    s = go(s); // Kev's next turn starts
    assert.equal(named(s, 'Kev').shock, 4);
    s = go(s); // and ends
    assert.equal(named(s, 'Kev').shock, 0);
    // Guard acts now: a hit in its own turn lasts through that turn's end and the whole of its next one
    assert.equal(turnName(s), 'Guard');
    s = typeIn(s, 'Guard', '-3');
    s = go(s);
    assert.equal(named(s, 'Guard').shock, 3);
    s = go(s);
    s = go(s);
    assert.equal(named(s, 'Guard').shock, 0);
    s = typeIn(s, 'Kev', '-2');
    s = typeIn(s, 'Kev', '-3');
    assert.equal(named(s, 'Kev').shock, 4, 'two hits add, capped');
  });

  it('a hit on Guard in Kev\'s turn keeps its shock past Kev\'s turn end and clears at the end of Guard\'s next turn', () => {
    let s = begin(twoRows());
    s = go(s); // Kev acts
    s = typeIn(s, 'Guard', '-3');
    assert.equal(named(s, 'Guard').shock, 3);
    s = go(s); // Kev's turn ends; Guard's starts
    assert.equal(named(s, 'Guard').shock, 3);
    s = go(s); // Guard's turn ends
    assert.equal(named(s, 'Guard').shock, 0);
  });

  it('a tap on the chip sets Shock −2; 0 clears it; 5 is refused', () => {
    let s = begin(twoRows());
    s = G(s, { type: 'setShock', row: named(s, 'Guard').id, n: 2 });
    assert.equal(named(s, 'Guard').shock, 2);
    s = G(s, { type: 'setShock', row: named(s, 'Guard').id, n: 5 });
    assert.equal(named(s, 'Guard').shock, 2);
    s = G(s, { type: 'setShock', row: named(s, 'Guard').id, n: 0 });
    assert.equal(named(s, 'Guard').shock, 0);
  });

  it('12 imp vitals on an 11 HP, DR 1, HT 10 guard: one card, its lines death check, death check, knockdown, in that order; Roll settles them one at a time and stops at an Out', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '12 imp vitals');
    assert.equal(named(s, 'Guard').hp, -22);
    assert.equal(named(s, 'Guard').shock, 4);
    assert.equal(cards(s, 'Guard').length, 1);
    const c = cards(s, 'Guard')[0];
    assert.deepEqual(c.lines.map((l) => [l.kind, l.times || null, l.mod]), [['death', 1, 0], ['death', 2, 0], ['knockdown', null, -5]]);
    const before = lines(s).length;
    // the first death check missed by 2: Mortal wound offered, and the next line rolls
    s = roll(s, 'Guard', 12, 10);
    assert.deepEqual(cards(s, 'Guard')[0].lines[0].offers, ['mortal']);
    // a roll for a line that is not the next is dropped
    const stale = G(s, { type: 'cardRolled', row: named(s, 'Guard').id, card: c.id, line: 0, result: rolled(3, 10) });
    assert.deepEqual(stale.fight.rows, s.fight.rows);
    // line 1 missed by 1 after line 0 offered Mortal wound: Out (dead); the knockdown is not rolled
    s = roll(s, 'Guard', 11, 10);
    assert.deepEqual(cards(s, 'Guard')[0].lines[1].offers, ['dead']);
    assert.equal(require('../lib/run-sheet/web/gurps-math').nextLine(cards(s, 'Guard')[0], GURPS.consequences), -1);
    assert.deepEqual(lines(s).slice(before), ['Guard: death check (−1×HP), HT 10, rolled 12, failed by 2.', 'Guard: death check (−2×HP), HT 10, rolled 11, failed by 1.']);
    // nothing is Out until the tap
    assert.equal(named(s, 'Guard').out, false);
    s = take(s, 'Guard', 1, 'dead');
    assert.equal(named(s, 'Guard').out, true);
    assert.equal(lines(s).at(-1), 'Guard: death check (−2×HP): Out (dead).');
    // Out: the card goes, the Mortal wound line 0 offered with it
    assert.deepEqual(cards(s, 'Guard'), []);
    assert.deepEqual(named(s, 'Guard').conds, []);
  });

  it('a major wound to the vitals: a knockdown failed by 7 then Unconscious, failed by 2 then Stunned and Prone, a success settles it', () => {
    for (const [total, want] of [[12, ['Unconscious']], [7, ['Stunned', 'Prone']], [5, []]]) {
      let s = begin(twoRows());
      s = typeIn(s, 'Guard', '4 imp vitals'); // 3 x 3 = 9: a major wound, above 0
      assert.deepEqual(cards(s, 'Guard')[0].lines.map((l) => [l.kind, l.mod]), [['knockdown', -5]]);
      s = roll(s, 'Guard', total, 5);
      if (want.length) {
        assert.equal(named(s, 'Guard').conds.length, 0, 'nothing until the tap');
        s = take(s, 'Guard', 0, cards(s, 'Guard')[0].lines[0].offers[0]);
      }
      assert.deepEqual(named(s, 'Guard').conds, want);
      assert.deepEqual(cards(s, 'Guard'), [], `${total}: the card is settled`);
      if (total === 12) assert.equal(lines(s).slice(-2).join(' | '), 'Guard: knockdown, HT 10 −5 = 5, rolled 12, failed by 7. | Guard: knockdown: Unconscious.');
    }
  });

  it('a skull hit with shock that is not a major wound: one knockdown line at HT unmodified; a torso hit that is not a major wound: no card, a shock chip only', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '2 cr skull'); // 2 - DR 3 = 0: nothing
    assert.deepEqual([named(s, 'Guard').shock || 0, cards(s, 'Guard')], [0, []]);
    s = typeIn(s, 'Kev', '3 cr skull'); // Kev has DR 0, the skull 2: 1 x 4 = 4
    assert.deepEqual(cards(s, 'Kev')[0].lines.map((l) => [l.kind, l.mod]), [['knockdown', 0]]);
    s = typeIn(s, 'Guard', '4 cr torso');
    assert.deepEqual([named(s, 'Guard').shock, cards(s, 'Guard')], [3, []]);
  });

  it('a fatigue hit raises no shock and no card', () => {
    let s = begin([{ name: 'Guard', hp: 11, max: 11, ht: 10, fp: 10, fpMax: 10 }]);
    s = typeIn(s, 'Guard', '9 fat vitals');
    assert.deepEqual([named(s, 'Guard').fp, named(s, 'Guard').shock || 0, cards(s, 'Guard')], [1, 0, []]);
  });

  it('raw injury −9 on 11 HP at 5: shock, one death check and an unmodified knockdown', () => {
    let s = begin([{ name: 'Guard', hp: 5, max: 11, ht: 10 }]);
    s = typeIn(s, 'Guard', '-19');
    assert.equal(named(s, 'Guard').shock, 4);
    assert.deepEqual(cards(s, 'Guard')[0].lines.map((l) => [l.kind, l.mod]), [['death', 0], ['knockdown', 0]]);
  });

  it('a declined Mortal wound line writes no log line, and line 1 missed by 1 is then offered Mortal wound, not Out (dead)', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '12 imp vitals');
    s = roll(s, 'Guard', 12, 10);
    s = roll(s, 'Guard', 11, 10);
    assert.deepEqual(cards(s, 'Guard')[0].lines[1].offers, ['dead']);
    const n = lines(s).length;
    s = take(s, 'Guard', 0, 'dismiss');
    const c = cards(s, 'Guard')[0];
    assert.deepEqual([c.lines[0].offers, c.lines[1].offers, lines(s).length], [[], ['mortal'], n]);
    assert.deepEqual(named(s, 'Guard').conds, []);
    // the knockdown rolls now: nothing ends the card
    s = roll(s, 'Guard', 12, 5);
    assert.deepEqual(cards(s, 'Guard')[0].lines[2].offers, ['unconscious']);
  });

  it('a declined Mortal wound before line 1 is rolled: line 1 missed by 1 offers Mortal wound', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '12 imp vitals');
    s = roll(s, 'Guard', 12, 10);
    s = take(s, 'Guard', 0, 'dismiss');
    s = roll(s, 'Guard', 11, 10);
    assert.deepEqual(cards(s, 'Guard')[0].lines[1].offers, ['mortal']);
  });

  it('a row put Out by its Out button loses its other cards, with no line for them', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '4 imp vitals');
    s = typeIn(s, 'Guard', '4 imp vitals');
    assert.equal(cards(s, 'Guard').length, 2);
    const n = lines(s).length;
    s = G(s, { type: 'out', row: named(s, 'Guard').id, on: true });
    assert.deepEqual([cards(s, 'Guard'), lines(s).slice(n)], [[], ['Guard is out of the fight.']]);
    // and by a card's Out (dead): the other card goes too
    let d = begin(twoRows());
    d = typeIn(d, 'Guard', '4 imp vitals');
    d = typeIn(d, 'Guard', '-60');
    const dead = cards(d, 'Guard').find((x) => x.lines[0].kind === 'dead');
    d = G(d, { type: 'card', row: named(d, 'Guard').id, card: dead.id, line: 0, take: 'dead' });
    assert.deepEqual(cards(d, 'Guard'), []);
  });

  it('the card\'s standing Out puts the row Out with one log line', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '12 imp vitals');
    const n = lines(s).length;
    s = take(s, 'Guard', null, 'out');
    assert.equal(named(s, 'Guard').out, true);
    assert.deepEqual(lines(s).slice(n), ['Guard is out of the fight.']);
    assert.deepEqual(cards(s, 'Guard'), []);
  });

  it('a dismissed card writes no log line', () => {
    let s = begin(twoRows());
    s = typeIn(s, 'Guard', '12 imp vitals');
    const n = lines(s).length;
    s = take(s, 'Guard', null, 'dismiss');
    assert.deepEqual([cards(s, 'Guard'), lines(s).length, named(s, 'Guard').out], [[], n, false]);
  });

  it('a death check missed by 4 offers Out (dead); a Mortal wound row missing by 1 is offered Out (dead); −5×HP: "dead" with Out', () => {
    let s = begin([{ name: 'Guard', hp: 1, max: 11, ht: 10 }]);
    s = typeIn(s, 'Guard', '-13');
    s = roll(s, 'Guard', 14, 10);
    assert.deepEqual(cards(s, 'Guard')[0].lines[0].offers, ['dead']);
    let m = begin([{ name: 'Guard', hp: 1, max: 11, ht: 10, conds: ['Mortal wound'] }]);
    m = typeIn(m, 'Guard', '-13');
    m = roll(m, 'Guard', 11, 10);
    assert.deepEqual(cards(m, 'Guard')[0].lines[0].offers, ['dead']);
    let d = begin([{ name: 'Guard', hp: 1, max: 11, ht: 10 }]);
    d = typeIn(d, 'Guard', '-60');
    assert.deepEqual(cards(d, 'Guard')[0].lines.map((l) => [l.kind, l.offers]), [['dead', ['dead']]]);
    assert.equal(named(d, 'Guard').out, false, 'nothing is Out until the tap');
    d = take(d, 'Guard', 0, 'dead');
    assert.equal(named(d, 'Guard').out, true);
    assert.equal(lines(d).at(-1), 'Guard: −5×HP: Out (dead).');
  });

  it('turn start at −13/12 brings HT −1 to stay conscious; a failure offers Unconscious', () => {
    let s = begin([{ name: 'Kev', kind: 'pc', ini: 6, speed: 6, hp: -13, max: 12, ht: 11 }, { name: 'Guard', ini: 5, speed: 5, hp: 11, max: 11, ht: 10 }]);
    s = go(s);
    assert.equal(turnName(s), 'Kev');
    const [c] = cards(s, 'Kev');
    assert.deepEqual([c.kind, c.lines[0].mod], ['conscious', -1]);
    s = roll(s, 'Kev', 12, 10);
    assert.deepEqual(cards(s, 'Kev')[0].lines[0].offers, ['unconscious']);
    s = take(s, 'Kev', 0, 'unconscious');
    assert.ok(named(s, 'Kev').conds.includes('Unconscious'));
    // Unconscious: not asked again
    s = go(s);
    s = go(s);
    assert.deepEqual(cards(s, 'Kev'), []);
  });

  it('a Do Nothing row that made no defence roll is not asked', () => {
    let s = begin([{ name: 'Kev', kind: 'pc', ini: 6, speed: 6, hp: -3, max: 12, ht: 11, manoeuvre: 'do nothing', defended: false }, { name: 'Guard', ini: 5, speed: 5, hp: 11, max: 11 }]);
    s = go(s);
    assert.deepEqual(cards(s, 'Kev'), []);
  });

  it('turn end while Stunned brings HT to recover; success clears Stunned', () => {
    let s = begin([{ name: 'Kev', kind: 'pc', ini: 6, speed: 6, hp: 10, max: 12, ht: 11, conds: ['Stunned', 'Prone'] }, { name: 'Guard', ini: 5, speed: 5, hp: 11, max: 11 }]);
    s = go(s);
    assert.deepEqual(cards(s, 'Kev'), [], 'not at the start');
    s = go(s);
    const [c] = cards(s, 'Kev');
    assert.equal(c.kind, 'recover');
    s = roll(s, 'Kev', 9, 11);
    assert.deepEqual(named(s, 'Kev').conds, ['Stunned', 'Prone'], 'nothing until the tap');
    s = take(s, 'Kev', 0, 'recover');
    assert.deepEqual(named(s, 'Kev').conds, ['Prone']);
    assert.equal(lines(s).at(-1), 'Kev: HT to recover: clear Stunned.');
    assert.deepEqual(cards(s, 'Kev'), []);
  });

  it('no HT on the row: the card waits for HT; a roll made before it is dropped', () => {
    let s = begin([{ name: 'Guard', hp: 11, max: 11 }]);
    s = typeIn(s, 'Guard', '4 imp vitals');
    const c = cards(s, 'Guard')[0];
    const was = s.fight.rows;
    s = G(s, { type: 'cardRolled', row: named(s, 'Guard').id, card: c.id, line: 0, result: rolled(9, 5) });
    assert.deepEqual(s.fight.rows, was);
    s = G(s, { type: 'setStat', row: named(s, 'Guard').id, key: 'ht', value: 10 });
    s = roll(s, 'Guard', 9, 5);
    assert.deepEqual(cards(s, 'Guard')[0].lines[0].offers, ['stunned']);
  });

  it('D&D takes no shock and no card', () => {
    let s = begin([{ name: 'Wolf', hp: 11, max: 11 }], null);
    s = typeIn(s, 'Wolf', '-20');
    assert.deepEqual([named(s, 'Wolf').shock, named(s, 'Wolf').cards], [undefined, undefined]);
  });
});

describe('GURPS defences as they stand this turn (step 6b Task 14)', () => {
  const { systemFor } = require('../lib/run-sheet/systems');
  const GURPS = systemFor('gurps-4e').describe().fight;
  const GM = require('../lib/run-sheet/web/gurps-math');
  const begin = (list, rules = GURPS) => RS.reduce(fresh(), { id: 'f1', type: 'fightStart', title: 'T', ...(rules ? { rules } : {}), rows: list.map((o, i) => M.blankRow({ id: `r${i + 1}`, ...o })) }, now());
  const G = (s, a) => RS.reduce(s, { id: nextId(), fight: 'f1', ...a }, now());
  const named = (s, name) => s.fight.rows.find((r) => r.name === name);
  const go = (s) => G(s, { type: 'fightNext', from: s.fight.turn, round: s.fight.round });
  const lines = (s) => s.events.filter((e) => e.fight).map((e) => e.text);
  const rolled = (total, target) => ({ dice: [4, 4, 4], total, target, margin: target - total, outcome: total <= target ? 'success' : 'failure' });
  const live = (s, name) => GM.liveDefences(named(s, name), GURPS.defences);
  // a defence rolled as the page does: against the figure as it stands, the server's total
  const defend = (s, name, defence, total = 12, more) => G(s, { type: 'defendRolled', row: named(s, name).id, defence, result: rolled(total, live(s, name)[defence].value), ...(more || {}) });
  const rows = () => [
    { name: 'Bouncer 1', ini: 6, speed: 6, hp: 11, max: 11, ht: 10, dodge: 9, parry: 9, block: 8 },
    { name: 'Bouncer 2', ini: 5, speed: 5, hp: 11, max: 11, ht: 10, dodge: 8, parry: 9, block: 8 },
    { name: 'Kev', kind: 'pc', ini: 4, speed: 4, hp: 12, max: 12, ht: 11, dodge: 8, parry: 10, block: 9 },
  ];

  it('two parries in a round: the second at −4; the count resets on the row\'s turn', () => {
    let s = begin(rows());
    s = go(s); // Bouncer 1 acts
    s = defend(s, 'Bouncer 2', 'parry', 12);
    assert.equal(named(s, 'Bouncer 2').parries, 1);
    assert.equal(live(s, 'Bouncer 2').parry.value, 5);
    s = defend(s, 'Bouncer 2', 'parry', 4);
    assert.equal(named(s, 'Bouncer 2').parries, 2);
    assert.equal(live(s, 'Bouncer 2').parry.value, 1);
    assert.deepEqual(lines(s).slice(-2), [
      'Bouncer 2: Parry 9, rolled 12, failed by 3.',
      'Bouncer 2: Parry 9 → 5 (parry 2 −4), rolled 4, made it by 1.',
    ]);
    s = go(s); // Bouncer 2's turn
    assert.deepEqual([named(s, 'Bouncer 2').parries, named(s, 'Bouncer 2').defended], [0, 0]);
    assert.equal(live(s, 'Bouncer 2').parry.value, 9);
  });

  it('a roll against a stale figure is dropped', () => {
    let s = begin(rows());
    s = go(s);
    s = defend(s, 'Bouncer 2', 'parry');
    const was = s.fight.rows;
    s = G(s, { type: 'defendRolled', row: named(s, 'Bouncer 2').id, defence: 'parry', result: rolled(12, 9) });
    assert.deepEqual(s.fight.rows, was, 'Parry is 5 now, not 9');
  });

  it('a second Block in a turn asks first: dropped without again, taken with it', () => {
    let s = begin(rows());
    s = go(s);
    s = defend(s, 'Bouncer 2', 'block');
    assert.equal(named(s, 'Bouncer 2').blocks, 1);
    assert.equal(live(s, 'Bouncer 2').block.used, true);
    const n = lines(s).length;
    s = defend(s, 'Bouncer 2', 'block');
    assert.deepEqual([named(s, 'Bouncer 2').blocks, lines(s).length], [1, n], 'no again: nothing');
    s = defend(s, 'Bouncer 2', 'block', 12, { again: true });
    assert.equal(named(s, 'Bouncer 2').blocks, 2);
    assert.equal(lines(s).at(-1), 'Bouncer 2: Block 8, again, rolled 12, failed by 4.');
    s = go(s);
    assert.equal(live(s, 'Bouncer 2').block.used, false, 'its turn: Block again');
  });

  it('Stunned: Retreat refused; on otherwise, then off at the row\'s turn', () => {
    let s = begin(rows());
    s = G(s, { type: 'status', row: named(s, 'Bouncer 2').id, add: 'Stunned' });
    s = G(s, { type: 'retreat', row: named(s, 'Bouncer 2').id, on: true });
    assert.equal(named(s, 'Bouncer 2').retreat, undefined);
    assert.equal(live(s, 'Bouncer 2').dodge.value, 4);
    s = G(s, { type: 'status', row: named(s, 'Bouncer 2').id, remove: 'Stunned' });
    s = G(s, { type: 'retreat', row: named(s, 'Bouncer 2').id, on: true });
    assert.equal(named(s, 'Bouncer 2').retreat, true);
    assert.equal(live(s, 'Bouncer 2').dodge.value, 11);
    s = go(s);
    s = go(s); // Bouncer 2's turn
    assert.equal(named(s, 'Bouncer 2').retreat, false);
  });

  it('Move and Attack: a Parry roll is dropped, a Dodge taken; the manoeuvre ends at the row\'s next turn', () => {
    let s = begin(rows().map((r) => (r.name === 'Bouncer 2' ? { ...r, manoeuvre: 'move and attack' } : r)));
    s = go(s);
    s = G(s, { type: 'defendRolled', row: named(s, 'Bouncer 2').id, defence: 'parry', result: rolled(5, 9) });
    assert.equal(named(s, 'Bouncer 2').parries, undefined);
    s = defend(s, 'Bouncer 2', 'dodge', 5);
    assert.equal(lines(s).at(-1), 'Bouncer 2: Dodge 8, rolled 5, made it by 3.');
    s = go(s);
    assert.equal(named(s, 'Bouncer 2').manoeuvre, null);
    assert.equal(live(s, 'Bouncer 2').parry.value, 9);
  });

  it('All-Out Attack: every defence roll is dropped until its next turn', () => {
    let s = begin(rows().map((r) => (r.name === 'Bouncer 2' ? { ...r, manoeuvre: 'all-out attack' } : r)));
    s = go(s);
    for (const k of ['dodge', 'parry', 'block']) s = G(s, { type: 'defendRolled', row: named(s, 'Bouncer 2').id, defence: k, result: rolled(5, 8) });
    assert.equal(named(s, 'Bouncer 2').defended, 0);
  });

  it('a PC shows the sheet\'s defences and has no Defend: its roll is dropped, its retreat refused', () => {
    let s = begin(rows());
    s = go(s);
    assert.deepEqual([named(s, 'Kev').dodge, named(s, 'Kev').parry, named(s, 'Kev').block], [8, 10, 9]);
    const was = s.fight.rows;
    s = G(s, { type: 'defendRolled', row: named(s, 'Kev').id, defence: 'dodge', result: rolled(5, 8) });
    s = G(s, { type: 'retreat', row: named(s, 'Kev').id, on: true });
    assert.deepEqual(s.fight.rows, was);
  });

  it('a Do Nothing row at 0 HP that defended is asked HT to stay conscious; one that did not is not (Task 13\'s link)', () => {
    const list = () => [
      { name: 'Bouncer 1', ini: 6, speed: 6, hp: 11, max: 11, ht: 10 },
      { name: 'Bouncer 2', ini: 5, speed: 5, hp: -2, max: 11, ht: 10, dodge: 8, manoeuvre: 'do nothing' },
    ];
    let s = begin(list());
    s = go(s); // Bouncer 1 acts
    s = defend(s, 'Bouncer 2', 'dodge');
    assert.equal(named(s, 'Bouncer 2').defended, 1);
    s = go(s); // Bouncer 2's turn: it defended, so it is asked
    assert.deepEqual((named(s, 'Bouncer 2').cards || []).map((c) => c.kind), ['conscious']);
    assert.equal(named(s, 'Bouncer 2').defended, 0, 'reset on its turn');
    let t = begin(list());
    t = go(t);
    t = go(t);
    assert.deepEqual(named(t, 'Bouncer 2').cards || [], [], 'no defence roll: not asked');
  });

  it('Same for all copies Dodge, Parry, Block and DR; a typed Dodge is kept through a new Speed', () => {
    let s = begin([{ name: 'Bouncer 1', ini: null, hp: null, max: null, group: 'g', note: 'n', copy: 1 }, { name: 'Bouncer 2', ini: null, hp: null, max: null, group: 'g', note: 'n', copy: 2 }]);
    const id = named(s, 'Bouncer 1').id;
    s = G(s, { type: 'setStat', row: id, key: 'speed', value: 5.5 });
    assert.deepEqual([named(s, 'Bouncer 1').dodge, named(s, 'Bouncer 1').from.dodge], [8, 'from Speed']);
    s = G(s, { type: 'setStat', row: id, key: 'dodge', value: 9 });
    s = G(s, { type: 'setStat', row: id, key: 'speed', value: 7 });
    assert.deepEqual([named(s, 'Bouncer 1').dodge, named(s, 'Bouncer 1').from.dodge, named(s, 'Bouncer 1').typedKeys.dodge], [9, undefined, true]);
    for (const [key, value] of [['parry', 10], ['block', 9], ['dr', 2], ['hp', 12]]) s = G(s, { type: 'setStat', row: id, key, value });
    assert.deepEqual(['parry', 'block', 'dr'].map((k) => named(s, 'Bouncer 1').typedKeys[k]), [true, true, true]);
    s = G(s, { type: 'sameForAll', row: id });
    const b2 = named(s, 'Bouncer 2');
    assert.deepEqual([b2.dodge, b2.parry, b2.block, b2.dr, b2.speed], [9, 10, 9, 2, 7]);
  });

  it('D&D and CoC take no defence roll and no retreat', () => {
    for (const rules of [null, systemFor('coc-7e').describe().fight]) {
      let s = begin([{ name: 'Wolf', hp: 11, max: 11, dodge: 9 }], rules);
      const was = s.fight.rows;
      s = G(s, { type: 'defendRolled', row: named(s, 'Wolf').id, defence: 'dodge', result: rolled(5, 9) });
      s = G(s, { type: 'retreat', row: named(s, 'Wolf').id, on: true });
      assert.deepEqual(s.fight.rows, was);
    }
  });
});
