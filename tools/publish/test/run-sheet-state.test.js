'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const RS = require('../lib/run-sheet/web/state');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const LUCAN = 'Characters/NPCs/Lucan Grey.md';
const model = readRunSheet(FIXTURE, PLAN, { party: [ADA, BEN] });
const GATE = model.beats[0];
const TOWER = model.beats[1];
const HUB = model.beats[2];
const T0 = '2026-11-20T19:00:00.000Z';
const at = (n) => new Date(Date.parse(T0) + n * 60000).toISOString();

let n = 0;
const act = (a) => ({ id: `t-${++n}`, ...a });
const run = (actions, start) => actions.reduce((s, a, i) => RS.reduce(s, act(a), at(i)), start || fresh());
const fresh = () => RS.emptyState({ stateId: 'chapter-1--session-02', session: model.session.index, plan: PLAN });
const to = (b, spot) => ({ beat: b.key, spot: spot || null, title: b.title });
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
const clone = (o) => JSON.parse(JSON.stringify(o));

// a hand-made model with an ally that has two copies
const allyModel = () => {
  const m = clone(model);
  const foe = (name, key, hpNow) => ({ key, note: 'Characters/NPCs/Guard.md', name, ally: true, ac: 12, hp: 11, hpNow });
  m.beats[0].foes = [foe('Guard 1', 'k.foe.g', 8), foe('Guard 2', 'k.foe.g~2', null)];
  m.beats[2].foes = [foe('Guard 1', 'h.foe.g', null)];
  return m;
};

describe('run sheet state', () => {
  it('an untouched session derives an empty record', () => {
    const d = RS.derive(model, fresh());
    assert.strictEqual(d.reached.size, 0);
    assert.deepStrictEqual(d.whereEnded.map((w) => w.status), ['unplaced', 'unplaced']);
    assert.strictEqual(d.notReached.length, model.beats.filter((b) => !b.contingency).length);
    assert.deepStrictEqual(d.pointsBy, { landed: [], missed: [], overtaken: [], open: [] });
    assert.deepStrictEqual(d.vitals.map((v) => v.rowId), [ADA, BEN, LUCAN]);
    assert.strictEqual(d.vitals[0].hp, 22);
    assert.strictEqual(d.vitals[0].max, 30);
    assert.deepStrictEqual(d.vitalsRecorded, []);
    assert.deepStrictEqual(d.orphans, []);
    assert.deepStrictEqual(d.log, []);
  });

  it('a beat the party left without a mark is reached', () => {
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'move', pc: ADA, to: to(TOWER) }]);
    const d = RS.derive(model, s);
    assert.ok(d.reached.has(GATE.key));
    assert.ok(!d.notReached.some((b) => b.key === GATE.key));
    assert.deepStrictEqual(d.pointsBy.open.filter((p) => p.beat === GATE.key).map((p) => p.key), GATE.points.map((p) => p.key));
    assert.ok(d.notReached.some((b) => b.key === HUB.key));
  });

  it('only GM-set vitals are recorded', () => {
    let s = run([{ type: 'endSet', vitals: { [ADA]: { hp: 15 } } }]);
    let d = RS.derive(model, s);
    assert.strictEqual(d.vitalsRecorded.length, 1);
    assert.deepStrictEqual([d.vitalsRecorded[0].rowId, d.vitalsRecorded[0].hp, d.vitalsRecorded[0].max], [ADA, 15, 30]);
    // conditions only: a blank HP cell (Review R4)
    s = run([{ type: 'endSet', vitals: { [BEN]: { conditions: 'poisoned' } } }]);
    d = RS.derive(model, s);
    assert.strictEqual(d.vitalsRecorded.length, 1);
    assert.strictEqual(d.vitalsRecorded[0].hp, null);
    assert.strictEqual(d.vitalsRecorded[0].conditions, 'poisoned');
    assert.strictEqual(d.vitals.find((v) => v.rowId === BEN).hp, 20);
  });

  it("rowIds: a PC's path, an ally's path, #2 for its second copy", () => {
    const d = RS.derive(allyModel(), fresh());
    const G = 'Characters/NPCs/Guard.md';
    assert.deepStrictEqual(d.vitals.map((v) => v.rowId), [ADA, BEN, G, `${G}#2`]);
    assert.deepStrictEqual(d.vitals.map((v) => v.copy || 1), [1, 1, 1, 2]);
    assert.strictEqual(d.vitals[2].hp, 8);
    assert.strictEqual(d.vitals[3].hp, 11);
  });

  it('ally copies are numbered in vitals', () => {
    const d = RS.derive(allyModel(), fresh());
    assert.deepStrictEqual(d.vitals.filter((v) => v.ally).map((v) => v.name), ['Guard 1', 'Guard 2']);
  });

  it('reduce leaves rev and recordHash alone', () => {
    const s0 = { ...fresh(), rev: 7, recordHash: 'abc' };
    const s1 = RS.reduce(s0, act({ type: 'jot', beat: GATE.key, spot: null, text: 'hi' }), at(1));
    assert.strictEqual(s1.rev, 7);
    assert.strictEqual(s1.recordHash, 'abc');
    assert.strictEqual(s1.stateId, s0.stateId);
  });

  it('an action id already applied is dropped', () => {
    const a = act({ type: 'mark', point: GATE.points[0].key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: 'the tracks' });
    const s1 = RS.reduce(fresh(), a, at(1));
    const s2 = RS.reduce(s1, { ...a, mark: 'missed' }, at(2));
    assert.strictEqual(s2, s1);
    assert.strictEqual(s2.points[GATE.points[0].key].mark, 'landed');
  });

  it('applied keeps the last 500 ids', () => {
    let s = fresh();
    for (let i = 0; i < 510; i++) s = RS.reduce(s, { id: `x-${i}`, type: 'jot', beat: null, spot: null, text: String(i) }, at(0));
    assert.strictEqual(s.applied.length, 500);
    assert.strictEqual(s.applied[0], 'x-10');
    assert.strictEqual(s.applied[499], 'x-509');
  });

  it('re-applying pending actions on a newer state lands each once', () => {
    const a1 = act({ type: 'jot', beat: GATE.key, spot: null, text: 'one' });
    const a2 = act({ type: 'jot', beat: GATE.key, spot: null, text: 'two' });
    const serverState = RS.reduce(fresh(), a1, at(1));
    const merged = [a1, a2].reduce((s, a) => RS.reduce(s, a, at(2)), serverState);
    assert.deepStrictEqual(merged.jots.map((j) => j.text), ['one', 'two']);
  });

  it('cyclePoint goes landed, missed, overtaken, clear', () => {
    assert.strictEqual(RS.cyclePoint(''), 'landed');
    assert.strictEqual(RS.cyclePoint('landed'), 'missed');
    assert.strictEqual(RS.cyclePoint('missed'), 'overtaken');
    assert.strictEqual(RS.cyclePoint('overtaken'), '');
    assert.strictEqual(RS.cyclePoint(undefined), 'landed');
  });

  it('a marked point reaches its beat', () => {
    const p = TOWER.points[0] || GATE.points[1];
    const owner = TOWER.points[0] ? TOWER : GATE;
    const s = run([{ type: 'mark', point: p.key, mark: 'landed', beat: owner.key, beatTitle: owner.title, text: p.text }]);
    const d = RS.derive(model, s);
    assert.ok(d.reached.has(owner.key));
    assert.deepStrictEqual(d.pointsBy.landed.map((x) => [x.key, x.beatTitle, x.text]), [[p.key, owner.title, p.text]]);
    const cleared = run([{ type: 'mark', point: p.key, mark: '' , beat: owner.key, beatTitle: owner.title, text: p.text }], s);
    assert.ok(!(p.key in cleared.points));
  });

  it('stopped here is reached, never not reached', () => {
    const s = run([{ type: 'stop', beat: HUB.key, title: HUB.title }]);
    const d = RS.derive(model, s);
    assert.ok(d.reached.has(HUB.key));
    assert.ok(!d.notReached.some((b) => b.key === HUB.key));
    assert.strictEqual(d.stopped.beat, HUB.key);
    assert.ok(d.log.some((l) => /Stopped here/.test(l.text) && l.beatKey === HUB.key));
    assert.strictEqual(RS.derive(model, run([{ type: 'stop', beat: null }], s)).stopped, null);
  });

  it('moving a PC to a hub spot and off-screen', () => {
    const spot = HUB.spots[0];
    let s = run([{ type: 'move', pc: ADA, to: to(HUB, spot.key) }]);
    let w = RS.derive(model, s).whereEnded.find((x) => x.pc === ADA);
    assert.deepStrictEqual([w.status, w.beat.key, w.spot.key, w.place], ['spot', HUB.key, spot.key, spot.note]);
    // a spot with no note keeps its words
    const words = HUB.spots.find((x) => !x.note);
    s = run([{ type: 'move', pc: ADA, to: to(HUB, words.key) }]);
    w = RS.derive(model, s).whereEnded.find((x) => x.pc === ADA);
    assert.strictEqual(w.place, HUB.place);
    assert.strictEqual(w.spot.name, words.name);
    s = run([{ type: 'move', pc: ADA, to: 'off' }], s);
    assert.strictEqual(RS.derive(model, s).whereEnded.find((x) => x.pc === ADA).status, 'off');
    assert.deepStrictEqual(s.positions[ADA], { off: true });
    // moveAll places the named PCs together
    s = run([{ type: 'moveAll', to: to(GATE), pcs: [ADA, BEN] }]);
    assert.deepStrictEqual(RS.derive(model, s).whereEnded.map((x) => x.status), ['beat', 'beat']);
    assert.ok(s.visited[GATE.key]);
  });

  it('GM words for where a PC ended win over the position', () => {
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'endSet', where: { [ADA]: 'in the cellar' } }]);
    assert.strictEqual(RS.derive(model, s).whereEnded.find((x) => x.pc === ADA).text, 'in the cellar');
  });

  it('improvised beats are keyed from the action id and log a line', () => {
    const s = run([{ id: 'x1', type: 'improvise', title: 'A stranger at the well' }, { id: 'x2', type: 'improvise', title: 'The well again' }]);
    assert.deepStrictEqual(s.improvised.map((i) => i.key), ['i-x1', 'i-x2']);
    const d = RS.derive(model, s);
    assert.ok(d.beats.some((b) => b.key === 'i-x1' && b.impro && b.title === 'A stranger at the well'));
    assert.ok(d.log.some((l) => /Improvised beat/.test(l.text) && /stranger/.test(l.beatTitle)));
    const s2 = run([{ type: 'unimprovise', key: 'i-x1' }], s);
    assert.deepStrictEqual(s2.improvised.map((i) => i.key), ['i-x2']);
  });

  it('a stale re-apply keeps a move and a jot on the improvised beat they were made in', () => {
    const base = run([{ id: 'b1', type: 'improvise', title: 'Tavern brawl' }]);
    const queued = [{ id: 'a1', type: 'improvise', title: 'Ambush on road' },
      { id: 'a2', type: 'move', pc: ADA, to: { beat: 'i-a1', title: 'Ambush on road' } },
      { id: 'a3', type: 'jot', beat: 'i-a1', text: 'Ash got stabbed' }];
    const s = queued.reduce((st, a, i) => RS.reduce(st, a, at(i)), base);
    assert.strictEqual(s.positions[ADA].beat, 'i-a1');
    assert.deepStrictEqual(s.jots.map((j) => j.beat), ['i-a1']);
    assert.deepStrictEqual(s.improvised.map((i) => i.key), ['i-b1', 'i-a1']);
  });

  it('removing an improvised beat clears its stop, fire, points and loot, so a later one starts clean', () => {
    let s = run([{ id: 'q1', type: 'improvise', title: 'Q' }, { type: 'stop', beat: 'i-q1', title: 'Q' }, { type: 'fire', beat: 'i-q1', on: true },
      { type: 'mark', point: 'i-q1.pt.h', mark: 'landed', beat: 'i-q1' }, { type: 'loot', item: 'i-q1.loot.h', to: 'Ada', beat: 'i-q1' }]);
    s = run([{ type: 'unimprovise', key: 'i-q1' }], s);
    assert.deepStrictEqual([s.stopped, s.fired, s.points, s.loot], [null, {}, {}, {}]);
  });

  it("bring adds a cast entry to Who's here; unbring takes it off", () => {
    const s = run([{ type: 'bring', beat: TOWER.key, note: 'Characters/NPCs/Abbot Rime.md', name: 'Abbot Rime' }]);
    const who = RS.derive(model, s).beats.find((b) => b.key === TOWER.key).who;
    assert.ok(who.some((w) => w.note === 'Characters/NPCs/Abbot Rime.md' && w.brought));
    assert.strictEqual(who.length, TOWER.who.length + 1);
    // twice is once
    const twice = run([{ type: 'bring', beat: TOWER.key, note: 'Characters/NPCs/Abbot Rime.md', name: 'Abbot Rime' }], s);
    assert.strictEqual(twice.brought[TOWER.key].length, 1);
    const off = run([{ type: 'unbring', beat: TOWER.key, note: 'Characters/NPCs/Abbot Rime.md' }], s);
    assert.strictEqual(RS.derive(model, off).beats.find((b) => b.key === TOWER.key).who.length, TOWER.who.length);
  });

  it('unmask on and off, and the Log line', () => {
    const N = 'Characters/NPCs/Brother Ash.md';
    let s = run([{ type: 'unmask', note: N, on: true, name: 'Ashur', was: 'Brother Ash' }]);
    let d = RS.derive(model, s);
    assert.deepStrictEqual(d.unmaskedNow.map((u) => [u.note, u.name]), [[N, 'Ashur']]);
    assert.ok(d.log.some((l) => /Brother Ash unmasked as Ashur/.test(l.text)));
    s = run([{ type: 'unmask', note: N, on: false, name: 'Ashur', was: 'Brother Ash' }], s);
    d = RS.derive(model, s);
    assert.deepStrictEqual(d.unmaskedNow, []);
    assert.ok(d.log.some((l) => /masked again/.test(l.text)));
  });

  it('a carried unmasking starts on, and turning it off is recorded', () => {
    const N = 'Characters/NPCs/Brother Ash.md';
    const m = clone(model);
    m.notes[N] = { ...(m.notes[N] || {}), unmask: { name: 'Ashur', since: 'Log.md' } };
    assert.deepStrictEqual(RS.derive(m, fresh()).unmaskedNow.map((u) => u.note), [N]);
    const off = RS.derive(m, run([{ type: 'unmask', note: N, on: false, name: 'Ashur' }]));
    assert.deepStrictEqual(off.unmaskedNow, []);
    assert.deepStrictEqual(off.maskedAgain.map((u) => u.note), [N]);
  });

  it('loot to a PC and to the party', () => {
    const [a, b] = GATE.treasure;
    const s = run([
      { type: 'loot', item: a.key, to: ADA, text: a.text, note: null, beat: GATE.key, beatTitle: GATE.title },
      { type: 'loot', item: b.key, to: 'party', text: b.text, note: null, beat: GATE.key, beatTitle: GATE.title },
    ]);
    const d = RS.derive(model, s);
    assert.deepStrictEqual(d.loot.map((l) => [l.key, l.to]), [[a.key, ADA], [b.key, 'party']]);
    const un = run([{ type: 'loot', item: a.key, to: '' }], s);
    assert.strictEqual(RS.derive(model, un).loot.length, 1);
  });

  it('the handed-over Log line names the handout, never its Notes cell (proof defect 3)', () => {
    const h = model.handouts[0];
    assert.ok(h.text, 'the fixture row has a Notes cell');
    assert.strictEqual(RS.handoutName(h), "Ash's Note");
    assert.strictEqual(RS.handoutName({ note: null, name: '[[Gone Letter|the letter]] (water-stained)' }), 'the letter (water-stained)');
    assert.strictEqual(RS.handoutName({ note: null, name: 'A torn map' }), 'A torn map');
    const s = run([{ type: 'handOver', handout: h.key, on: true, text: h.text, name: RS.handoutName(h), note: h.note }]);
    const d = RS.derive(model, s);
    assert.deepStrictEqual(d.log.map((l) => l.text), ["Handed over: Ash's Note."]);
    assert.deepStrictEqual(d.handedOver.map((x) => x.name), ["Ash's Note"]);
    // a name that ends in a full stop or a quote gets no second one
    const q = run([{ type: 'handOver', handout: 'x', on: true, name: 'A note that says "Run."', note: null }]);
    assert.deepStrictEqual(RS.derive(model, q).log.map((l) => l.text), ['Handed over: A note that says "Run."']);
  });

  it('fired contingencies and handed-over handouts', () => {
    const c = model.beats.find((x) => x.contingency);
    const h = model.handouts[0];
    const s = run([{ type: 'fire', beat: c.key, on: true, title: c.title }, { type: 'handOver', handout: h.key, on: true, text: h.text, note: h.note }]);
    const d = RS.derive(model, s);
    assert.ok(d.fired.some((f) => f.beat === c.key));
    assert.ok(d.reached.has(c.key));
    assert.deepStrictEqual(d.handedOver.map((x) => x.key), [h.key]);
    assert.ok(d.log.some((l) => /Contingency fired/.test(l.text)) && d.log.some((l) => /handed over/i.test(l.text)));
    const off = run([{ type: 'fire', beat: c.key, on: false }, { type: 'handOver', handout: h.key, on: false }], s);
    assert.deepStrictEqual([RS.derive(model, off).fired, RS.derive(model, off).handedOver], [[], []]);
  });

  it('jots and events share one Log in time order', () => {
    const s = run([
      { type: 'jot', beat: GATE.key, spot: null, text: 'they knock', title: GATE.title },
      { type: 'fire', beat: model.beats.find((x) => x.contingency).key, on: true, title: 'Wolves' },
      { type: 'jot', beat: null, spot: null, text: 'a free note' },
    ]);
    const log = RS.derive(model, s).log;
    assert.deepStrictEqual(log.map((l) => l.text).length, 3);
    assert.strictEqual(log[0].text, 'they knock');
    assert.strictEqual(log[0].beatTitle, GATE.title);
    assert.strictEqual(log[2].beatKey, null);
    const un = run([{ type: 'unjot', jot: s.jots[0].id }], s);
    assert.strictEqual(un.jots.length, 1);
  });

  it('long rest sets every vitals row to max', () => {
    const s = run([{ type: 'endSet', vitals: { [ADA]: { hp: 3, conditions: 'prone' } } }, { type: 'longRest' }]);
    const d = RS.derive(model, s);
    // the party, and no ally from a beat nobody reached
    assert.deepStrictEqual(d.vitalsRecorded.map((v) => v.rowId), [ADA, BEN]);
    assert.deepStrictEqual(d.vitalsRecorded.map((v) => v.hp), d.vitalsRecorded.map((v) => v.max));
    assert.strictEqual(d.vitals.find((v) => v.rowId === ADA).hp, 30);
    // an edit after a long rest wins
    const d2 = RS.derive(model, run([{ type: 'endSet', vitals: { [ADA]: { hp: 12 } } }], s));
    assert.strictEqual(d2.vitalsRecorded.find((v) => v.rowId === ADA).hp, 12);
  });

  it('a long rest covers an ally in a reached beat, and can be undone with the figures kept', () => {
    const allyBeat = model.beats.find((b) => (b.foes || []).some((f) => f.ally));
    assert.ok(allyBeat, 'the fixture has an ally in a beat');
    const s = run([{ type: 'move', pc: ADA, to: to(allyBeat) }, { type: 'endSet', vitals: { [ADA]: { hp: 3 } } }, { type: 'longRest' }]);
    assert.ok(RS.derive(model, s).vitalsRecorded.some((v) => v.ally));
    const u = run([{ type: 'longRest', on: false }], s);
    assert.strictEqual(u.end.longRest, undefined);
    assert.strictEqual(RS.derive(model, u).vitals.find((v) => v.rowId === ADA).hp, 3);
    assert.deepStrictEqual(RS.derive(model, u).vitalsRecorded.map((v) => v.rowId), [ADA]);
  });

  it('an ally brought in gets a vitals row', () => {
    // an ally no beat lists as a foe, brought into a beat with none
    const c = model.cast.find((x) => x.foe && x.foe.ally && !model.beats.some((b) => (b.foes || []).some((f) => f.note === x.note)));
    assert.ok(c, 'the fixture has an ally in no beat');
    assert.ok(!(TOWER.foes || []).some((f) => f.note === c.note));
    assert.ok(!RS.derive(model, fresh()).vitals.some((v) => v.note === c.note), 'no row before');
    const brought = RS.derive(model, run([{ type: 'bring', beat: TOWER.key, note: c.note, name: c.name }]));
    assert.ok(brought.vitals.some((v) => v.note === c.note), 'a row after');
  });

  it('an ally not in play keeps its pre-rest figures, unless the GM sets them again after the rest', () => {
    const m = clone(model);
    const s = run([{ type: 'endSet', vitals: { [LUCAN]: { hp: 4, max: 20 } } }, { type: 'longRest' }], RS.emptyState({ stateId: 'x' }));
    const row = (st) => RS.derive(m, st).vitals.find((v) => v.rowId === LUCAN);
    assert.deepStrictEqual([row(s).hp, row(s).max], [4, 20], 'not in play: the rest does not cover it');
    const later = run([{ type: 'endSet', vitals: { [LUCAN]: { hp: 7 } } }], s);
    assert.deepStrictEqual([row(later).hp, row(later).max], [7, 20], 'the edit after the rest stands');
  });

  it('attach: the moved state wins a key collision, and later actions follow the attach', () => {
    let s = run([{ type: 'mark', point: 'b-old.pt.aaa', mark: 'landed', beat: 'b-old', text: 'old' },
      { type: 'mark', point: 'b-new.pt.aaa', mark: 'missed', beat: 'b-new', text: 'new' }]);
    s = run([{ type: 'attach', from: 'b-old', to: 'b-new' }], s);
    assert.strictEqual(s.points['b-new.pt.aaa'].mark, 'landed');
    s = run([{ type: 'mark', point: 'b-old.pt.bbb', mark: 'landed', beat: 'b-old' }], s);
    assert.ok(s.points['b-new.pt.bbb'] && !s.points['b-old.pt.bbb']);
  });

  it('a carried unmasking turned off and on again shows once; no name logs nothing', () => {
    const m = { ...model, notes: { ...model.notes, 'N.md': { unmask: { since: 'log', name: 'Hob' } } } };
    const s = run([{ type: 'unmask', note: 'N.md', on: false }, { type: 'unmask', note: 'N.md', on: true, name: 'Hob' }]);
    assert.deepStrictEqual(RS.derive(m, s).unmaskedNow, [{ note: 'N.md', name: 'Hob', carried: false }]);
    const none = run([{ type: 'unmask', note: 'N.md', on: true }]);
    assert.deepStrictEqual([none.events.length, Object.keys(none.unmask)], [0, []]);
  });

  it('advancement is stored as typed', () => {
    const s = run([{ type: 'endSet', advancement: 'level 6\nmilestone' }]);
    assert.strictEqual(s.end.advancement, 'level 6\nmilestone');
  });

  it('armClick fires only on a second click within 3000 ms', () => {
    let r = RS.armClick(null, 'x', 1000);
    assert.strictEqual(r.fire, false);
    assert.deepStrictEqual(r.armed, { id: 'x', at: 1000 });
    r = RS.armClick(r.armed, 'x', 4000);
    assert.strictEqual(r.fire, true);
    assert.strictEqual(r.armed, null);
    // too late: re-arms
    r = RS.armClick({ id: 'x', at: 0 }, 'x', 3001);
    assert.strictEqual(r.fire, false);
    assert.deepStrictEqual(r.armed, { id: 'x', at: 3001 });
    // another button: re-arms on that one
    r = RS.armClick({ id: 'x', at: 0 }, 'y', 100);
    assert.deepStrictEqual([r.fire, r.armed.id], [false, 'y']);
  });

  it('castSearch finds by alias and gm alias, any case and accent', () => {
    const cast = [
      { note: 'a.md', name: 'Hésta Vale', aliases: [], gmAliases: [] },
      { note: 'b.md', name: 'Brother Ash', aliases: ['the Warden'], gmAliases: ['Ashur'] },
      { note: 'c.md', name: 'Ashley Tanner', aliases: [], gmAliases: [] },
      { note: 'd.md', name: 'Old Hesta', aliases: [], gmAliases: [] },
    ];
    assert.deepStrictEqual(RS.castSearch(cast, 'hesta').map((c) => c.note), ['a.md', 'd.md']);
    assert.deepStrictEqual(RS.castSearch(cast, 'WARDEN').map((c) => c.note), ['b.md']);
    assert.deepStrictEqual(RS.castSearch(cast, 'ashur').map((c) => c.note), ['b.md']);
    assert.deepStrictEqual(RS.castSearch(cast, 'ash').map((c) => c.note), ['c.md', 'b.md']);
    assert.deepStrictEqual(RS.castSearch(cast, '  '), []);
    assert.strictEqual(RS.castSearch(cast, 'a', 2).length, 2);
  });

  it('a renamed point becomes an orphan with its text', () => {
    const p = GATE.points[0];
    const s = run([{ type: 'mark', point: p.key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: p.text }]);
    const m = clone(model);
    m.beats[0].points[0] = { ...p, key: `${p.key}-new`, text: 'the fresh tracks' };
    const d = RS.derive(m, s);
    assert.strictEqual(d.orphans.length, 1);
    assert.deepStrictEqual(
      [d.orphans[0].kind, d.orphans[0].key, d.orphans[0].text, d.orphans[0].beatTitle, d.orphans[0].value],
      ['point', p.key, p.text, GATE.title, 'landed'],
    );
    assert.deepStrictEqual(d.pointsBy.landed, []);
  });

  it('attach moves the state to the new key and the orphan goes', () => {
    const p = GATE.points[0];
    const s = run([{ type: 'mark', point: p.key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: p.text }]);
    const m = clone(model);
    m.beats[0].points[0] = { ...p, key: `${p.key}-new`, text: 'the fresh tracks' };
    const s2 = run([{ type: 'attach', from: p.key, to: `${p.key}-new` }], s);
    assert.ok(!(p.key in s2.points));
    assert.strictEqual(s2.points[`${p.key}-new`].mark, 'landed');
    assert.strictEqual(s2.attached[p.key], `${p.key}-new`);
    const d = RS.derive(m, s2);
    assert.deepStrictEqual(d.orphans, []);
    assert.deepStrictEqual(d.pointsBy.landed.map((x) => x.key), [`${p.key}-new`]);
  });

  it('a renamed beat: attaching the beat re-homes its points by text hash', () => {
    const [p0, p1] = GATE.points;
    const s = run([
      { type: 'mark', point: p0.key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: p0.text },
      { type: 'mark', point: p1.key, mark: 'missed', beat: GATE.key, beatTitle: GATE.title, text: p1.text },
      { type: 'move', pc: ADA, to: to(GATE) },
    ]);
    const NEW = 'b-renamed001';
    const m = clone(model);
    const b = m.beats[0];
    const re = (k) => k.replace(GATE.key, NEW);
    b.key = NEW;
    b.title = 'The Gate (renamed)';
    b.points = b.points.map((p, i) => (i === 1 ? { ...p, key: `${NEW}.pt.differenthash`, text: 'changed words' } : { ...p, key: re(p.key) }));
    const before = RS.derive(m, s);
    assert.ok(before.orphans.some((o) => o.kind === 'beat' && o.key === GATE.key));
    assert.ok(before.orphans.some((o) => o.kind === 'point' && o.key === p0.key));
    const s2 = run([{ type: 'attach', from: GATE.key, to: NEW }], s);
    const d = RS.derive(m, s2);
    assert.deepStrictEqual(d.pointsBy.landed.map((x) => x.key), [re(p0.key)]);
    assert.deepStrictEqual(d.orphans.map((o) => [o.kind, o.key, o.text]), [['point', re(p1.key), p1.text]]);
    assert.strictEqual(s2.positions[ADA].beat, NEW);
    assert.ok(s2.visited[NEW] && !s2.visited[GATE.key]);
  });

  it('a beat the Plan lost that only holds jots is listed, and attaching it moves the jots', () => {
    const renamed = clone(model);
    renamed.beats[1].key = 'b-tower-renamed';
    const s = run([{ type: 'jot', beat: TOWER.key, text: 'the bell cracked', title: TOWER.title }]);
    const o = RS.derive(renamed, s).orphans.find((x) => x.kind === 'beat' && x.key === TOWER.key);
    assert.ok(o, 'the lost beat is listed');
    assert.deepStrictEqual([o.text, o.value], [TOWER.title, ['jotted in']]);
    const moved = run([{ type: 'attach', from: TOWER.key, to: 'b-tower-renamed' }], s);
    assert.strictEqual(moved.jots[0].beat, 'b-tower-renamed');
    assert.deepStrictEqual(RS.derive(renamed, moved).orphans, []);
  });

  it('a renamed beat known only by a brought-in person, a jot and a point shows its title (proof defect 2)', () => {
    const p0 = GATE.points[0];
    const N = 'Characters/NPCs/Abbot Rime.md';
    const renamed = () => { const m = clone(model); m.beats[0].key = 'b-renamed002'; m.beats[0].title = 'The Gate (renamed)'; m.beats[0].points = []; return m; };
    // the bring action carries the beat's title
    const one = RS.derive(renamed(), run([{ type: 'bring', beat: GATE.key, note: N, name: 'Abbot Rime', title: GATE.title }]));
    const b = one.orphans.find((x) => x.kind === 'beat' && x.key === GATE.key);
    assert.deepStrictEqual([b.text, b.beatTitle, b.value], [GATE.title, GATE.title, ['brought']]);
    // brought with no title of its own (an old state): the title comes from a jot there, or from a point there
    const fromJot = run([{ type: 'jot', beat: GATE.key, text: 'snow', title: GATE.title }]);
    fromJot.brought[GATE.key] = [{ note: N, name: 'Abbot Rime', at: at(0) }];
    assert.strictEqual(RS.derive(renamed(), fromJot).orphans.find((x) => x.kind === 'beat').text, GATE.title);
    const fromPoint = run([{ type: 'mark', point: p0.key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: p0.text }]);
    fromPoint.brought[GATE.key] = [{ note: N, name: 'Abbot Rime', at: at(0) }];
    assert.strictEqual(RS.derive(renamed(), fromPoint).orphans.find((x) => x.kind === 'beat').text, GATE.title);
    // a PC standing in a beat the Plan lost (no visited record) gets the title from a jot there
    const st = run([{ type: 'jot', beat: GATE.key, text: 'snow', title: GATE.title }]);
    st.positions[ADA] = { beat: GATE.key, spot: null };
    assert.strictEqual(RS.derive(renamed(), st).orphans.find((x) => x.kind === 'beat').text, GATE.title);
  });

  it('taking a brought-in person off writes a Log line; bringing back does not double (proof defect 4)', () => {
    const N = 'Characters/NPCs/Abbot Rime.md';
    const s = run([
      { type: 'bring', beat: TOWER.key, note: N, name: 'Abbot Rime', title: TOWER.title },
      { type: 'unbring', beat: TOWER.key, note: N, title: TOWER.title },
      { type: 'unbring', beat: TOWER.key, note: N, title: TOWER.title },
      { type: 'bring', beat: TOWER.key, note: N, name: 'Abbot Rime', title: TOWER.title },
    ]);
    assert.deepStrictEqual(RS.derive(model, s).log.map((l) => [l.beatTitle, l.text]), [
      [TOWER.title, 'Abbot Rime brought in.'],
      [TOWER.title, 'Abbot Rime taken off.'],
      [TOWER.title, 'Abbot Rime brought in.'],
    ], 'a second Remove of someone not there writes nothing');
    assert.strictEqual(s.brought[TOWER.key].length, 1);
  });

  it('vitals set for someone no longer in the model are an orphan, not lost (PR review L2)', () => {
    const GONE = 'Characters/NPCs/Garrick Fell.md';
    const s = run([{ type: 'endSet', vitals: { [GONE]: { hp: 4, conditions: 'Exhaustion 1' }, [`${GONE}#2`]: { conditions: '' }, [ADA]: { hp: 9 } } }]);
    const d = RS.derive(model, s);
    assert.deepStrictEqual(d.vitalsRecorded.map((v) => v.rowId), [ADA]);
    const o = d.orphans.filter((x) => x.kind === 'vitals');
    assert.deepStrictEqual(o.map((x) => [x.key, x.note, x.copy, x.value]), [[GONE, GONE, 1, { hp: 4, max: null, conditions: 'Exhaustion 1' }]], 'an empty row is no orphan');
    const two = RS.derive(model, run([{ type: 'endSet', vitals: { [`${GONE}#2`]: { hp: 3 } } }]));
    assert.deepStrictEqual(two.orphans.map((x) => [x.kind, x.note, x.copy]), [['vitals', GONE, 2]]);
  });

  it('unknown keys and actions are left alone', () => {
    const s0 = { ...fresh(), fight: { round: 2 }, rolls: [1] };
    const s1 = RS.reduce(s0, act({ type: 'jot', beat: null, spot: null, text: 'x' }), at(1));
    assert.deepStrictEqual(s1.fight, { round: 2 });
    assert.deepStrictEqual(s1.rolls, [1]);
    assert.strictEqual(RS.reduce(s1, act({ type: 'dance' }), at(2)), s1);
    assert.strictEqual(RS.reduce(s1, null, at(2)), s1);
    assert.doesNotThrow(() => RS.derive(model, s1));
    assert.deepStrictEqual(RS.derive(model, s1).fightLog, []);
  });

  it('reduce never mutates its input', () => {
    let s = deepFreeze(fresh());
    const p = GATE.points[0];
    const as = [
      { type: 'move', pc: ADA, to: to(GATE) }, { type: 'moveAll', to: to(TOWER), pcs: [ADA, BEN] },
      { type: 'mark', point: p.key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: p.text },
      { type: 'jot', beat: GATE.key, spot: null, text: 'x' }, { type: 'fire', beat: 'c-1', on: true, title: 'C' },
      { type: 'stop', beat: GATE.key, title: GATE.title }, { type: 'improvise', title: 'I' },
      { type: 'bring', beat: GATE.key, note: 'n.md', name: 'N' }, { type: 'unmask', note: 'n.md', on: true, name: 'M' },
      { type: 'handOver', handout: 'h', on: true, text: 't', note: null }, { type: 'loot', item: 'l', to: 'party', text: 'l' },
      { type: 'endSet', vitals: { [ADA]: { hp: 1 } }, where: { [ADA]: 'x' }, advancement: 'a' },
      { type: 'longRest' }, { type: 'attach', from: GATE.key, to: 'b-z' }, { type: 'unbring', beat: 'b-z', note: 'n.md' },
    ];
    for (const a of as) s = deepFreeze(RS.reduce(s, act(a), at(1)));
    assert.ok(s.applied.length === as.length);
  });
});

describe('RS.upgrade (third review M3)', () => {
  it('fills every missing key, end.* too, so a partial state derives', () => {
    for (const partial of [{}, { rev: 3, stateId: 'x' }, (() => { const s = fresh(); delete s.visited; delete s.end.where; return s; })()]) {
      const up = RS.upgrade(partial, fresh());
      assert.deepStrictEqual(Object.keys(up).sort(), Object.keys(fresh()).sort());
      assert.deepStrictEqual(Object.keys(up.end).sort(), Object.keys(fresh().end).sort());
      assert.doesNotThrow(() => RS.derive(model, up));
    }
  });

  it('keeps what is there, and keys it does not know', () => {
    const s = run([{ type: 'mark', point: GATE.points[0].key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: GATE.points[0].text }]);
    s.later = { fights: true };
    const up = RS.upgrade(s, fresh());
    assert.deepStrictEqual(up, s);
    assert.notStrictEqual(up, s, 'a copy');
  });

  it('a key of the wrong kind is refused, code BAD_STATE', () => {
    for (const bad of [{ positions: [] }, { jots: {} }, { end: [] }, { end: { vitals: 'x' } }, { points: null }]) {
      assert.throws(() => RS.upgrade(bad, fresh()), (e) => e.code === 'BAD_STATE', JSON.stringify(bad));
    }
    assert.throws(() => RS.upgrade([], fresh()), (e) => e.code === 'BAD_STATE');
    assert.doesNotThrow(() => RS.upgrade({ stopped: { beat: 'b' }, startedAt: '2026-11-20T19:00:00.000Z' }, fresh()), 'a key left null takes a value');
  });

  it('an entry derive reads into that is not an object is refused, code BAD_STATE', () => {
    for (const bad of [{ jots: [null] }, { events: ['x'] }, { improvised: [1] }, { positions: { a: null } }, { points: { k: 1 } },
      { brought: { b: {} } }, { brought: { b: [null] } }, { stopped: 'b' }]) {
      assert.throws(() => RS.upgrade(bad, fresh()), (e) => e.code === 'BAD_STATE', JSON.stringify(bad));
    }
    // a valid older save still fills what is missing
    assert.doesNotThrow(() => RS.derive(model, RS.upgrade({ jots: [{ id: 'j1', beat: null, text: 'x', at: T0 }] }, fresh())));
  });
});

// plan 6a Task 5: the sides the GM sets live in the state
describe('the sides memory', () => {
  it('a new state holds no sides; an old saved state with no sides derives, and gets an empty memory', () => {
    assert.deepStrictEqual(fresh().sides, {});
    const old = fresh();
    delete old.sides;
    const d = RS.derive(model, old);
    assert.deepStrictEqual(d.sidesSet, []);
    assert.ok(d.vitals.some((v) => v.note === LUCAN), 'the reader-ally keeps its vitals row');
    assert.deepStrictEqual(RS.upgrade(old, fresh()).sides, {});
  });

  it('a side nobody can read in the memory is passed over', () => {
    const s = fresh();
    s.sides = { [LUCAN]: 'friendly', 'Characters/NPCs/Brother Ash.md': null };
    const d = RS.derive(model, s);
    assert.deepStrictEqual(d.sidesSet, []);
    assert.ok(d.vitals.some((v) => v.note === LUCAN));
  });
});

// plan 6a Task 7: Fight here at any place, and Move them
describe('place beats and Move them', () => {
  const { forPlayers } = require('../lib/run-sheet/players');
  const FM = require('../lib/run-sheet/web/fight-math');
  const YARD = 'Locations/The Chapel Yard.md';
  const view = (s, m = model) => forPlayers(m, s, { withheldWords: m.withheldWords, campaign: m.campaign, picId: () => '0'.repeat(20) });

  it('moveGroup to a known place, and its panel shows it', () => {
    const key = model.placeKeys[YARD];
    assert.match(key, /^pl-[0-9a-f]{8}$/);
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'move', pc: BEN, to: to(GATE) },
      { type: 'moveGroup', pcs: [ADA, BEN], place: YARD, key, title: 'The Chapel Yard', names: ['Ada', 'Ben'] }]);
    assert.deepStrictEqual([s.positions[ADA], s.positions[BEN]], [{ beat: key, spot: null }, { beat: key, spot: null }]);
    const d = RS.derive(model, s);
    const b = d.beats.find((x) => x.key === key);
    assert.ok(b && b.placeBeat && b.place === YARD && !b.newPlace, 'the place beat is made');
    assert.deepStrictEqual([b.points, b.ifs], [[], []], 'no Points, no If-they');
    assert.deepStrictEqual(d.log.map((l) => l.text), ['Ada, Ben move to The Chapel Yard.'], 'one log line, no Improvised beat line');
    const v = view(s);
    assert.strictEqual(v.panels.length, 1);
    assert.strictEqual(v.panels[0].caption, 'The Chapel Yard', 'the players see the place moved to');
    // moving there again makes no second beat
    const s2 = run([{ type: 'moveGroup', pcs: [ADA], place: YARD, key, title: 'The Chapel Yard', names: ['Ada'] }], s);
    assert.strictEqual(s2.improvised.filter((i) => i.key === key).length, 1);
  });

  it('moveGroup to a typed name makes a new place', () => {
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { id: 'mg1', type: 'moveGroup', pcs: [ADA], name: 'The Docks', names: ['Ada'] }]);
    assert.deepStrictEqual(s.improvised.map((i) => [i.key, i.title, i.newPlace]), [['pn-mg1', 'The Docks', true]]);
    assert.strictEqual(s.positions[ADA].beat, 'pn-mg1');
    let d = RS.derive(model, s);
    const b = d.beats.find((x) => x.key === 'pn-mg1');
    assert.ok(b.placeBeat && b.newPlace && b.place === null);
    assert.strictEqual(d.log.at(-1).text, 'Ada moves to The Docks (a new place).');
    // the same name typed again, any case and with or without "the", is the same place
    s = run([{ id: 'mg2', type: 'moveGroup', pcs: [BEN], name: 'docks', names: ['Ben'] }], s);
    assert.deepStrictEqual(s.improvised.map((i) => i.key), ['pn-mg1']);
    assert.strictEqual(s.positions[BEN].beat, 'pn-mg1');
    d = RS.derive(model, s);
    assert.ok(d.log.some((l) => l.text === 'Ben moves to The Docks (a new place).'));
    // nothing typed, or nobody to move, does nothing
    assert.deepStrictEqual(run([{ type: 'moveGroup', pcs: [ADA], name: '  ' }], s).improvised, s.improvised);
    assert.deepStrictEqual(run([{ type: 'moveGroup', pcs: [], name: 'Elsewhere' }], s).improvised, s.improvised);
  });

  it('unplace takes back a typed place', () => {
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { id: 'up1', type: 'moveGroup', pcs: [ADA], name: 'The Docks', names: ['Ada'] }]);
    // someone stands there: it stays
    let s2 = run([{ type: 'unplace', key: 'pn-up1' }], s);
    assert.deepStrictEqual(s2.improvised.map((i) => i.key), ['pn-up1']);
    s = run([{ type: 'move', pc: ADA, to: to(TOWER) }], s);
    s2 = run([{ type: 'unplace', key: 'pn-up1' }], s);
    assert.deepStrictEqual(s2.improvised, []);
    assert.ok(!RS.derive(model, s2).log.some((l) => /Docks/.test(l.text)), 'its move line goes with it');
    // only a typed place: a known place beat or an improvised beat is not taken back by unplace
    const k = model.placeKeys[YARD];
    const s3 = run([{ type: 'improvise', key: k, title: 'The Chapel Yard', place: YARD }, { id: 'ib', type: 'improvise', title: 'A beat' },
      { type: 'unplace', key: k }, { type: 'unplace', key: 'i-ib' }]);
    assert.deepStrictEqual(s3.improvised.map((i) => i.key), [k, 'i-ib']);
  });

  it('End fight returns the panel to the group\'s own place', () => {
    const key = model.placeKeys[YARD];
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'improvise', key, title: 'The Chapel Yard', place: YARD }]);
    const before = view(s).panels[0].caption;
    assert.strictEqual(before, 'The Gate');
    const id = 'fh1';
    const built = FM.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: key, groups: [GATE.key], idBase: id });
    s = RS.reduce(s, { id, type: 'fightStart', beat: key, title: 'The Chapel Yard', groups: built.groups, rows: built.rows, thresholds: built.thresholds, backdrop: { group: GATE.key, place: YARD } }, at(5));
    assert.strictEqual(s.panels[GATE.key].backdrop, YARD);
    assert.strictEqual(view(s).panels[0].caption, 'The Chapel Yard', 'Fight here puts the place behind the focused panel');
    // Fight here moves nobody
    assert.strictEqual(s.positions[ADA].beat, GATE.key);
    assert.strictEqual(RS.derive(model, s).whereEnded[0].title, GATE.title);
    s = RS.reduce(s, { id: 'fh2', type: 'fightEnd', fight: id }, at(6));
    assert.strictEqual(s.panels[GATE.key].backdrop, null);
    assert.strictEqual(view(s).panels[0].caption, 'The Gate', 'back to the group\'s own place');
  });

  it('End fight leaves a backdrop the GM changed during the fight', () => {
    const key = model.placeKeys[YARD];
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'improvise', key, title: 'The Chapel Yard', place: YARD }]);
    s = RS.reduce(s, { id: 'fh3', type: 'fightStart', beat: key, title: 'The Chapel Yard', groups: [GATE.key], rows: [], thresholds: [], backdrop: { group: GATE.key, place: YARD } }, at(5));
    s = run([{ type: 'backdrop', group: GATE.key, note: 'Locations/The Bell Tower Room.md' }], s);
    s = RS.reduce(s, { id: 'fh4', type: 'fightEnd', fight: 'fh3' }, at(6));
    assert.strictEqual(s.panels[GATE.key].backdrop, 'Locations/The Bell Tower Room.md');
  });
});

// Task 7 fix round 1
describe('place beats (fix round 1)', () => {
  const YARD = 'Locations/The Chapel Yard.md';
  it('review M2: unplace refuses while the running fight is at the place or has it behind a panel', () => {
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { id: 'm2', type: 'moveGroup', pcs: [ADA], name: 'The Docks', names: ['Ada'] },
      { type: 'move', pc: ADA, to: to(GATE) }]);
    assert.strictEqual(RS.placeInFight(s, 'pn-m2'), false);
    const at = run([{ id: 'f1', type: 'fightStart', beat: 'pn-m2', title: 'The Docks', groups: [GATE.key], rows: [], thresholds: [] }, { type: 'unplace', key: 'pn-m2' }], s);
    assert.deepStrictEqual(at.improvised.map((i) => i.key), ['pn-m2'], 'the fight is at it');
    const behind = run([{ id: 'f2', type: 'fightStart', beat: GATE.key, title: 'The Gate', groups: [GATE.key], rows: [], thresholds: [], backdrop: { group: GATE.key, place: 'pn-m2' } }, { type: 'unplace', key: 'pn-m2' }], s);
    assert.deepStrictEqual(behind.improvised.map((i) => i.key), ['pn-m2'], 'it is behind a panel');
    const ended = run([{ type: 'fightEnd', fight: 'f1' }, { type: 'unplace', key: 'pn-m2' }], at);
    assert.deepStrictEqual(ended.improvised, [], 'after End fight it can go');
  });

  it('review M3: a queued improvise, moveGroup or unplace names its key through an attach', () => {
    let s = run([{ id: 'q1', type: 'improvise', title: 'Old' }, { type: 'attach', from: 'i-q1', to: 'i-new' }]);
    s = run([{ type: 'jot', beat: 'i-q1', text: 'x' }, { type: 'improvise', key: 'i-q1', title: 'Old again' }], s);
    assert.strictEqual(s.jots[0].beat, 'i-new');
    assert.ok(s.improvised.some((i) => i.key === 'i-new'), 'the queued improvise lands on the new key');
    assert.ok(!s.improvised.some((i) => i.key === 'i-q1' && i.title === 'Old again'));
    s = run([{ type: 'moveGroup', pcs: [ADA], place: YARD, key: 'i-q1', title: 'The Chapel Yard', names: ['Ada'] }], s);
    assert.strictEqual(s.positions[ADA].beat, 'i-new');
  });

  it('review M4: Fight here\'s quiet improvise writes no Improvised beat line', () => {
    const key = model.placeKeys[YARD];
    const s = run([{ type: 'improvise', key, title: 'The Chapel Yard', place: YARD, quiet: true }]);
    assert.deepStrictEqual(s.events, []);
    assert.ok(RS.derive(model, s).beats.some((b) => b.key === key));
    assert.strictEqual(run([{ type: 'improvise', title: 'Loud' }]).events.length, 1, 'a plain improvise still logs');
  });
});

describe('fight figures by system (step 6b Task 6)', () => {
  it('fightFigures records fp, mp, san and luck by their row names', () => {
    const { systemFor } = require('../lib/run-sheet/systems');
    const M = require('../lib/run-sheet/web/fight-math');
    const COC = systemFor('coc-7e').describe().fight;
    const ada = model.pcs.find((p) => p.note === ADA);
    const pc = M.blankRow({ id: 'r1', kind: 'pc', note: ADA, name: ada.name, hp: 9, max: 11, mp: 10, mpMax: 12, san: 55, sanMax: 60, luck: 45 });
    const withStart = { ...pc, start: { hp: 9, max: 11, conds: [], exhaustion: 0, conc: false, mp: 10, san: 55, luck: 45 } };
    let s = run([{ type: 'fightStart', id: 'f1', title: 'T', rules: COC, rows: [withStart] }]);
    s = RS.reduce(s, act({ type: 'hp', fight: 'f1', row: 'r1', entry: 's-6' }), at(50));
    const figures = RS.fightFigures(model, s).figures.get(ADA);
    assert.ok(figures, 'a SAN loss alone is a change');
    const f = figures[figures.length - 1];
    assert.deepStrictEqual([f.hp, f.max, f.mp, f.mpMax, f.san, f.sanMax, f.luck], [9, 11, 10, 12, 49, 60, 45]);
    assert.strictEqual(f.fp, undefined, 'a pool the row lacks is not recorded');
  });
});

// Step 6b Task 20: the vitals rows hold the system's pools, each a figure of its own with its own time.
describe("vitals: each system's pools (Task 20)", () => {
  const COC = readRunSheet(path.join(__dirname, 'fixtures', 'run-sheet-coc'), 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Fog Bound - Plan.md', {});
  const GURPS = readRunSheet(path.join(__dirname, 'fixtures', 'run-sheet-gurps'), 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Crates - Plan.md', {});
  const IRIS = 'Characters/PCs/Iris Calder.md';
  const ORRIN = 'Characters/PCs/Orrin Tate.md';
  const empty = () => RS.emptyState({ stateId: 'x' });
  const at2 = (n) => at(n);
  const rowOf = (m, s, id) => RS.derive(m, s).vitals.find((v) => v.rowId === id);
  const recOf = (m, s, id) => RS.derive(m, s).vitalsRecorded.find((v) => v.rowId === id);
  // an ended fight whose row for `note` moved the pools named in `now` from `start`
  const fought = (s, note, start, now, when) => ({ ...s, fights: [...(s.fights || []), { beat: 'b', startedAt: when, endedAt: when,
    rows: [{ kind: 'pc', note, name: 'x', hp: start.hp, max: start.max, conds: [], exhaustion: 0, start: { conds: [], exhaustion: 0, ...start }, ...start, ...now, poolAt: when, at: when }] }] });

  it("a PC's row starts from the sheet's pools, and none is recorded untouched", () => {
    const r = rowOf(COC, empty(), IRIS);
    assert.deepStrictEqual([r.hp, r.max, r.mp, r.mpMax, r.san, r.sanMax, r.luck], [9, 11, 13, 13, 62, 99, 55]);
    assert.strictEqual(recOf(COC, empty(), IRIS), undefined);
    const g = rowOf(GURPS, empty(), ORRIN);
    assert.deepStrictEqual([g.hp, g.fp, g.fpMax], [12, 11, 11]);
  });

  it('an end-panel pool is recorded alone; HP stays out of the record', () => {
    const s = RS.reduce(empty(), act({ type: 'endSet', vitals: { [IRIS]: { san: 48 } } }), at2(1));
    const v = recOf(COC, s, IRIS);
    assert.deepStrictEqual([v.hp, v.san, v.sanMax, v.mp], [null, 48, 99, undefined]);
    assert.strictEqual(typeof s.end.vitals[IRIS].at.san, 'string');
  });

  it('each pool keeps its own time: a later fight wins over an earlier end-panel figure, and a later one over the fight', () => {
    let s = RS.reduce(empty(), act({ type: 'endSet', vitals: { [IRIS]: { mp: 5, san: 50 } } }), at2(1));
    s = fought(s, IRIS, { hp: 9, max: 11, mp: 5, mpMax: 13, san: 50, sanMax: 99 }, { mp: 2 }, at2(5));
    let r = rowOf(COC, s, IRIS);
    // the fight moved MP, not SAN: SAN stays the end panel's
    assert.deepStrictEqual([r.mp, r.mpSource, r.san, r.sanSource], [2, 'fight', 50, 'end']);
    s = RS.reduce(s, act({ type: 'endSet', vitals: { [IRIS]: { mp: 7 } } }), at2(9));
    r = rowOf(COC, s, IRIS);
    assert.deepStrictEqual([r.mp, r.mpSource, r.san], [7, 'end', 50]);
    // a conditions edit after the fight never makes the older MP look newer than it
    s = RS.reduce(fought(RS.reduce(empty(), act({ type: 'endSet', vitals: { [IRIS]: { mp: 5 } } }), at2(1)), IRIS, { hp: 9, max: 11, mp: 5, mpMax: 13 }, { mp: 1 }, at2(5)),
      act({ type: 'endSet', vitals: { [IRIS]: { conditions: 'Prone' } } }), at2(8));
    assert.strictEqual(rowOf(COC, s, IRIS).mp, 1);
  });

  it("one time per pool: the fight moves MP, the end panel then sets MP, the fight then moves SAN: the end panel's MP holds", () => {
    const FM = require('../lib/run-sheet/web/fight-math');
    let s = RS.reduce(empty(), act({ type: 'move', pc: IRIS, to: { beat: COC.beats[0].key, spot: null, title: COC.beats[0].title } }), at2(0));
    const built = FM.rowsForFight({ model: COC, derived: RS.derive(COC, s), state: s, beatKey: COC.beats[0].key, idBase: 'f1' });
    s = RS.reduce(s, act({ id: 'f1', type: 'fightStart', beat: COC.beats[0].key, title: 'T', rules: COC.rules.fight, groups: built.groups, rows: built.rows, thresholds: [] }), at2(1));
    const row = s.fight.rows.find((r) => r.note === IRIS);
    s = RS.reduce(s, act({ type: 'hp', fight: 'f1', row: row.id, entry: 'm-3' }), at2(2));
    s = RS.reduce(s, act({ type: 'endSet', vitals: { [IRIS]: { mp: 6 } } }), at2(3));
    s = RS.reduce(s, act({ type: 'hp', fight: 'f1', row: row.id, entry: 's-2' }), at2(4));
    const r = s.fight.rows.find((x) => x.note === IRIS);
    assert.deepStrictEqual(r.poolAt, { mp: at2(2), san: at2(4) }, 'fight.js stamps each pool at its own time');
    const v = rowOf(COC, s, IRIS);
    assert.deepStrictEqual([v.mp, v.mpSource, v.san, v.sanSource], [6, 'end', 60, 'fight']);
    // a row saved before 6b's fix round held one time for all its pools: still read, for every pool
    const old = JSON.parse(JSON.stringify(s));
    old.fight.rows.find((x) => x.note === IRIS).poolAt = at2(4);
    assert.deepStrictEqual([rowOf(COC, old, IRIS).mp, rowOf(COC, old, IRIS).mpSource], [10, 'fight']);
  });

  it('a GURPS fight that took FP below 0 is recorded with its max', () => {
    const s = fought(empty(), ORRIN, { hp: 12, max: 12, fp: 11, fpMax: 11 }, { hp: -3, fp: -2 }, at2(3));
    const v = recOf(GURPS, s, ORRIN);
    assert.deepStrictEqual([v.hp, v.max, v.fp, v.fpMax], [-3, 12, -2, 11]);
  });

  it('the next fight starts from the pools the night holds', () => {
    const s = RS.reduce(empty(), act({ type: 'endSet', vitals: { [IRIS]: { mp: 4, san: 47 } } }), at2(1));
    const d = RS.derive(COC, s);
    const FM = require('../lib/run-sheet/web/fight-math');
    const rows = FM.rowsForFight({ model: COC, derived: d, state: s, beatKey: COC.beats[0].key, idBase: 'f' }).rows;
    const iris = rows.find((r) => r.note === IRIS);
    assert.deepStrictEqual([iris.mp, iris.mpMax, iris.san], [4, 13, 47]);
  });

  it("an end-panel HP over the PC's max is refused and not saved; GURPS HP and FP may go below 0", () => {
    assert.match(RS.endFigureProblem(COC, IRIS, 'hp', 12), /over the sheet's max \(11\)/);
    assert.match(RS.endFigureProblem(COC, IRIS, 'mp', 14), /max \(13\)/);
    assert.match(RS.endFigureProblem(COC, IRIS, 'san', 100), /max \(99\)/);
    assert.match(RS.endFigureProblem(GURPS, ORRIN, 'fp', 12), /max \(11\)/);
    // Luck has no max on the sheet but a ceiling of its own (Task 31)
    assert.match(RS.endFigureProblem(COC, IRIS, 'luck', 100), /over Luck's ceiling \(99\): not saved/);
    assert.match(RS.endFigureProblem(COC, IRIS, 'luck', 5550), /ceiling \(99\)/);
    assert.strictEqual(RS.endFigureProblem(COC, IRIS, 'luck', 99), null);
    for (const [m, id, f, v] of [[COC, IRIS, 'hp', 11], [COC, IRIS, 'san', 0], [GURPS, ORRIN, 'hp', -3], [GURPS, ORRIN, 'fp', -1], [COC, IRIS, 'hp', 'fine'], [COC, IRIS, 'hp', undefined]]) {
      assert.strictEqual(RS.endFigureProblem(m, id, f, v), null, `${f} ${v}`);
    }
    assert.match(RS.endFigureProblem(COC, IRIS, 'hp', -1), /below 0/);
    // an ally is not held to a sheet; D&D is as before
    assert.strictEqual(RS.endFigureProblem(COC, 'Characters/NPCs/Edda Voss.md', 'hp', 99), null);
    assert.strictEqual(RS.endFigureProblem(model, ADA, 'hp', 999), null);
  });
});
