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

  it('improvised beats get i- keys and log a line', () => {
    const s = run([{ type: 'improvise', title: 'A stranger at the well' }, { type: 'improvise', title: 'The well again' }]);
    assert.deepStrictEqual(s.improvised.map((i) => i.key), ['i-1', 'i-2']);
    const d = RS.derive(model, s);
    assert.ok(d.beats.some((b) => b.key === 'i-1' && b.impro && b.title === 'A stranger at the well'));
    assert.ok(d.log.some((l) => /Improvised beat/.test(l.text) && /stranger/.test(l.beatTitle)));
    const s2 = run([{ type: 'unimprovise', key: 'i-1' }], s);
    assert.deepStrictEqual(s2.improvised.map((i) => i.key), ['i-2']);
    // the next one never reuses a live key
    assert.strictEqual(run([{ type: 'improvise', title: 'x' }], s2).improvised[1].key, 'i-3');
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
    assert.strictEqual(d.vitalsRecorded.length, d.vitals.length);
    assert.deepStrictEqual(d.vitalsRecorded.map((v) => v.hp), d.vitalsRecorded.map((v) => v.max));
    assert.strictEqual(d.vitals.find((v) => v.rowId === ADA).hp, 30);
    // an edit after a long rest wins
    const d2 = RS.derive(model, run([{ type: 'endSet', vitals: { [ADA]: { hp: 12 } } }], s));
    assert.strictEqual(d2.vitalsRecorded.find((v) => v.rowId === ADA).hp, 12);
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
