'use strict';
// Showing things to the players (plan 5b Task 6): show.js's groups and its handlers, through state.js's one
// `reduce`. What the players' window gets from this is run-sheet-players.test.js.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const RS = require('../lib/run-sheet/web/state');
const M = require('../lib/run-sheet/web/fight-math');
const Show = require('../lib/run-sheet/web/show');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const GILT = 'Characters/NPCs/Masked Gilt.md';
const QUIET = 'Characters/NPCs/Quiet Dead.md';
const GATE = 'Locations/The Gate.md';
const model = readRunSheet(FIXTURE, PLAN, { party: [ADA, BEN] });
const FIGHT = model.beats.find((b) => b.title === 'Ashfall Reckoning');
const HUB = model.beats.find((b) => b.spots.length > 1);
const [SPOT1, SPOT2] = HUB.spots.map((s) => s.key);

let n = 0;
const T0 = Date.parse('2026-11-20T19:00:00.000Z');
const now = () => new Date(T0 + (++n) * 60000).toISOString();
const fresh = () => RS.emptyState({ stateId: 's', session: 'x', plan: PLAN });
const act = (s, a) => RS.reduce(s, { id: `a${++n}`, ...a }, now());
const move = (s, pc, beat, spot) => act(s, { type: 'move', pc, to: { beat: beat.key, spot: spot || null, title: beat.title } });
const fightAt = (s, beat) => {
  const id = `f${++n}`;
  const b = M.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: beat.key, idBase: id });
  return RS.reduce(s, { id, type: 'fightStart', beat: beat.key, title: beat.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, now());
};

describe('showing things to the players', () => {
  it('groups follow the run order; hub spots are separate groups; off-screen has none', () => {
    let s = move(fresh(), ADA, HUB, SPOT2);
    s = move(s, BEN, FIGHT);
    assert.deepEqual(Show.groupsOf(model, s), [
      { key: FIGHT.key, beat: FIGHT.key, spot: null, pcs: [BEN] },
      { key: SPOT2, beat: HUB.key, spot: SPOT2, pcs: [ADA] },
    ]);
    s = move(s, BEN, HUB, SPOT1);
    assert.deepEqual(Show.groupsOf(model, s).map((g) => [g.key, g.pcs]), [[SPOT1, [BEN]], [SPOT2, [ADA]]], 'spot order, not PC order');
    s = move(s, BEN, HUB, SPOT2);
    assert.deepEqual(Show.groupsOf(model, s).map((g) => [g.key, g.pcs]), [[SPOT2, [ADA, BEN]]]);
    s = act(s, { type: 'move', pc: BEN, to: 'off' });
    assert.deepEqual(Show.groupsOf(model, s).map((g) => g.pcs), [[ADA]]);
    assert.deepEqual(Show.groupsOf(model, fresh()), [], 'unplaced PCs make no group');
    // an improvised beat follows the Plan's beats
    let t = act(fresh(), { type: 'improvise', title: 'Roadside' });
    const key = t.improvised[0].key;
    t = act(t, { type: 'move', pc: ADA, to: { beat: key, spot: null, title: 'Roadside' } });
    t = move(t, BEN, FIGHT);
    assert.deepEqual(Show.groupsOf(model, t).map((g) => g.key), [FIGHT.key, key]);
    // a beat the Plan lost makes no group
    t = act(t, { type: 'move', pc: ADA, to: { beat: 'b-gone', spot: null, title: 'Gone' } });
    assert.deepEqual(Show.groupsOf(model, t).map((g) => g.key), [FIGHT.key]);
  });

  it('show puts a person on the group\'s panel and marks them seen in the fight', () => {
    let s = fightAt(move(fresh(), BEN, FIGHT), FIGHT);
    const gilt = () => s.fight.rows.find((r) => r.note === GILT);
    assert.equal(gilt().seen, false);
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    assert.deepEqual(s.panels[FIGHT.key].people, [GILT]);
    assert.ok(s.shownEver[GILT]);
    assert.equal(gilt().seen, true);
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    assert.deepEqual(s.panels[FIGHT.key].people, [GILT], 'once');
    s = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: false });
    assert.deepEqual(s.panels[FIGHT.key].people, []);
    assert.equal(gilt().seen, true, 'taken off, still seen');
    assert.ok(s.shownEver[GILT]);
  });

  it('showBeat puts up the beat\'s people with notes and its place', () => {
    let s = act(fresh(), { type: 'show', group: FIGHT.key, note: QUIET, on: true });
    s = act(s, { type: 'showBeat', group: FIGHT.key, people: [GILT, QUIET], place: GATE });
    assert.deepEqual(s.panels[FIGHT.key].people, [QUIET, GILT]);
    assert.equal(s.panels[FIGHT.key].backdrop, GATE);
    assert.ok(s.shownEver[GILT] && s.shownEver[QUIET]);
  });

  it('place off and back; a backdrop and back to the default', () => {
    let s = act(fresh(), { type: 'placeOff', group: SPOT1, on: true });
    assert.deepEqual(s.panels[SPOT1], { people: [], backdrop: null, placeOff: true });
    s = act(s, { type: 'placeOff', group: SPOT1, on: false });
    assert.equal(s.panels[SPOT1].placeOff, false);
    s = act(s, { type: 'backdrop', group: SPOT1, note: GATE });
    assert.equal(s.panels[SPOT1].backdrop, GATE);
    s = act(s, { type: 'backdrop', group: SPOT1, note: null });
    assert.equal(s.panels[SPOT1].backdrop, null);
  });

  it('an action naming no group changes nothing', () => {
    const s = fresh();
    for (const a of [{ type: 'show', note: GILT, on: true }, { type: 'showBeat', people: [GILT] }, { type: 'backdrop', note: GATE }, { type: 'placeOff', on: true }]) {
      assert.deepEqual(act(s, a).panels, {});
    }
  });

  it('a state with no panels yet (a 5a file) takes a show', () => {
    const s = fresh();
    delete s.panels;
    delete s.shownEver;
    const t = act(s, { type: 'show', group: FIGHT.key, note: GILT, on: true });
    assert.deepEqual(t.panels[FIGHT.key].people, [GILT]);
  });

  it('attach carries the panels', () => {
    let s = act(fresh(), { type: 'placeOff', group: SPOT1, on: true });
    s = act(s, { type: 'show', group: HUB.key, note: GILT, on: true });
    s = act(s, { type: 'attach', from: HUB.key, to: 'b-moved' });
    const moved = `b-moved${SPOT1.slice(HUB.key.length)}`;
    assert.equal(s.panels[moved].placeOff, true);
    assert.deepEqual(s.panels['b-moved'].people, [GILT]);
    assert.equal(s.panels[SPOT1], undefined);
    // an action built before the attach still lands on the moved panel
    s = act(s, { type: 'placeOff', group: SPOT1, on: false });
    assert.equal(s.panels[moved].placeOff, false);
    assert.equal(s.panels[SPOT1], undefined);
  });
});
