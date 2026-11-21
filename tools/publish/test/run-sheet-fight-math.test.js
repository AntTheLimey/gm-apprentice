'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/run-sheet/web/fight-math');

const row = (o) => ({
  id: 'x', kind: 'foe', note: 'n', name: 'N', copy: 1, in: true, ini: null, mod: 0, hp: 10, max: 20, out: false, unseenN: null, ...o,
});

test('entries: -37, 37, +8, t5, T5, spaces; nonsense and 10000 give null', () => {
  assert.deepEqual(M.parseEntry('-37'), { kind: 'damage', n: 37 });
  assert.deepEqual(M.parseEntry('37'), { kind: 'damage', n: 37 });
  assert.deepEqual(M.parseEntry('+8'), { kind: 'heal', n: 8 });
  assert.deepEqual(M.parseEntry('t5'), { kind: 'temp', n: 5 });
  assert.deepEqual(M.parseEntry('T5'), { kind: 'temp', n: 5 });
  assert.deepEqual(M.parseEntry('  -37 '), { kind: 'damage', n: 37 });
  assert.deepEqual(M.parseEntry('9999'), { kind: 'damage', n: 9999 });
  for (const bad of ['', 'abc', '10000', '1.5', '--3', 't', '+', 'tt5', '3d6', null, undefined]) assert.equal(M.parseEntry(bad), null, String(bad));
});

test('half then resisted, rounding down each', () => {
  assert.equal(M.damageTaken(27, { half: true }), 13);
  assert.equal(M.damageTaken(27, { half: true, resisted: true }), 6);
  assert.equal(M.damageTaken(1, { half: true }), 0);
  assert.equal(M.damageTaken(27, { resisted: true }), 13);
  assert.equal(M.damageTaken(27, {}), 27);
  assert.equal(M.damageTaken(27), 27);
});

test('temp takes damage first', () => {
  assert.deepEqual(M.afterDamage({ hp: 10, temp: 5 }, 8), { hp: 7, temp: 0 });
  assert.deepEqual(M.afterDamage({ hp: 10, temp: 5 }, 3), { hp: 10, temp: 2 });
});

test('heal stops at max; damage at 0', () => {
  assert.equal(M.afterHeal({ hp: 35, max: 40 }, 8), 40);
  assert.equal(M.afterHeal({ hp: 5, max: 40 }, 8), 13);
  assert.deepEqual(M.afterDamage({ hp: 4, temp: 0 }, 30), { hp: 0, temp: 0 });
  assert.deepEqual(M.afterDamage({ hp: null, temp: 5 }, 3), { hp: null, temp: 2 }, 'no HP: the temp HP still soaks');
});

test('Bloodied at exactly half, not at 0, not without a max', () => {
  assert.equal(M.isBloodied({ kind: 'foe', hp: 91, max: 183 }), true);
  assert.equal(M.isBloodied({ kind: 'foe', hp: 92, max: 183 }), false);
  assert.equal(M.isBloodied({ kind: 'foe', hp: 0, max: 183 }), false);
  assert.equal(M.isBloodied({ kind: 'foe', hp: 5, max: null }), false);
  assert.equal(M.isBloodied({ kind: 'foe', hp: null, max: 10 }), false);
  assert.equal(M.isBloodied({ kind: 'lair', hp: 1, max: 10 }), false);
});

test('thresholds read N HP or less before Bloodied', () => {
  assert.deepEqual(M.thresholdOf('Bloodied (91 HP or less): it bargains'), { hp: 91 });
  assert.deepEqual(M.thresholdOf('Bloodied: it flees'), { bloodied: true });
  assert.deepEqual(M.thresholdOf('at 3671 HP or less'), { hp: 3671 });
  assert.equal(M.thresholdOf('nothing here'), null);
  assert.equal(M.thresholdOf(''), null);
});

// A beat with a boss, a minion and two mephits, as the fixture will hold them.
const model = {
  pcs: [{ note: 'Characters/Kael.md', name: 'Kael', hpMax: 40, hpNow: 40, ac: 17, init: 2 }, { note: 'Characters/Nim.md', name: 'Nim', hpMax: 30, hpNow: 30, ac: 14, init: 3 }],
  cast: [
    { note: 'Creatures/Wyrm.md', name: 'Glacier Wyrm', type: 'creature', foe: null },
    { note: 'Creatures/Mephit.md', name: 'Ice Mephit', type: 'creature', foe: { key: 'cast.mephit', note: 'Creatures/Mephit.md', name: 'Ice Mephit', ally: false, ac: 6173, hp: 7341, init: 97, recharge: ['Frost Breath'], rechargeAt: { 'Frost Breath': 6 } } },
    { note: 'NPCs/Gilt.md', name: 'Masked Gilt', type: 'npc', foe: { key: 'cast.gilt', note: 'NPCs/Gilt.md', name: 'Masked Gilt', ally: false, ac: 12, hp: 50, init: 1 } },
    { note: 'NPCs/Plain.md', name: 'Plain Person', type: 'npc', foe: null },
    { note: 'Characters/Kael.md', name: 'Kael', type: 'pc', foe: null },
    { note: 'Characters/Nim.md', name: 'Nim', type: 'pc', foe: null },
  ],
};
const wyrm = { key: 'b1.foe.wyrm', note: 'Creatures/Wyrm.md', name: 'Glacier Wyrm', ally: false, ac: 6174, hp: 7342, init: 3, legendaryResistance: 3, legendaryActions: 3, recharge: ['Cold Breath'], rechargeAt: { 'Cold Breath': 5 }, lair: true };
const imp = { key: 'b1.foe.imp', note: 'Creatures/Imp.md', name: 'Rime Imp', ally: false, ac: 6175, hp: 21, init: 1 };
const meph = (i) => ({ key: `b1.foe.mephit${i}`, note: 'Creatures/Mephit.md', name: `Ice Mephit ${i}`, ally: false, ac: 6173, hp: 7341, init: 97, recharge: ['Frost Breath'], rechargeAt: { 'Frost Breath': 6 } });
const venn = { key: 'b1.foe.venn', note: 'NPCs/Venn.md', name: 'Brother Venn', ally: true, ac: 13, hp: 30, init: 0 };
const gilt = { key: 'b1.foe.gilt', note: 'NPCs/Gilt.md', name: 'Masked Gilt', ally: false, ac: 12, hp: 50, init: 1 };
const gate = {
  key: 'b1', title: 'Ashfall Reckoning', spots: [], foes: [wyrm, imp, meph(1), meph(2), venn, gilt],
  points: [{ key: 'b1.pt.a', text: 'Bloodied (3671 HP or less): it bargains' }, { key: 'b1.pt.b', text: 'Watch the door' }],
  ifs: [{ key: 'b1.if.a', do: 'Wyrm Bloodied', then: 'it flees' }],
};
const hub = { key: 'b2', title: 'The Crossing', spots: [{ key: 'b2.spot.a', name: 'Gate House' }, { key: 'b2.spot.b', name: 'Yard' }], foes: [] };
model.cast.find((c) => c.note === 'Creatures/Wyrm.md').foe = wyrm;
model.cast.push({ note: 'NPCs/Venn.md', name: 'Brother Venn', type: 'npc', foe: venn }, { note: 'Creatures/Imp.md', name: 'Rime Imp', type: 'creature', foe: imp });
const derivedOf = (extra = {}) => ({ beats: [gate, hub], vitals: [], ...extra });
const kael = 'Characters/Kael.md';
const nim = 'Characters/Nim.md';
const here = { positions: { [kael]: { beat: 'b1', spot: null }, [nim]: { beat: 'b2', spot: 'b2.spot.a' } }, fights: [], brought: {}, shownEver: {} };

test('a minion never lights the boss line', () => {
  const r = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a1' });
  const line = r.thresholds.find((t) => t.key === 'b1.pt.a');
  // the line names no foe: only the biggest whose max is over it, never the mephits beside it (Review L4)
  assert.deepEqual(line.foes, ['Creatures/Wyrm.md']);
  assert.ok(!line.foes.includes('Creatures/Imp.md'));
  const impRow = { ...r.rows.find((x) => x.note === 'Creatures/Imp.md'), hp: 9 };
  assert.equal(M.isLit(line, impRow), false);
  assert.equal(M.isLit(line, { ...r.rows.find((x) => x.note === 'Creatures/Wyrm.md'), hp: 3000 }), true);
});

test('a bare Bloodied line lights for the named foe, else the biggest', () => {
  const r = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a1' });
  const named = r.thresholds.find((t) => t.key === 'b1.if.a');
  assert.deepEqual(named.foes, ['Creatures/Wyrm.md']);
  assert.equal(named.bloodied, true);
  const plain = M.rowsForFight({ model: { ...model }, derived: derivedOf({ beats: [{ ...gate, ifs: [{ key: 'b1.if.z', do: 'Bloodied', then: 'x' }], points: [] }, hub] }), state: here, beatKey: 'b1', idBase: 'a1' });
  // no foe is named: the one with the highest max (the Wyrm, 7342, over the Mephits, 7341)
  assert.deepEqual(plain.thresholds[0].foes, ['Creatures/Wyrm.md']);
});

test('a bare Bloodied If-row lights for the foe its Then names, Do first', () => {
  const run = (row) => M.rowsForFight({ model, derived: derivedOf({ beats: [{ ...gate, ifs: [row], points: [] }, hub] }), state: here, beatKey: 'b1', idBase: 'a1' }).thresholds[0].foes;
  // the Then names Masked Gilt, who is not the biggest foe
  assert.deepEqual(run({ key: 'b1.if.t', do: 'Bloodied', then: 'Masked Gilt stops fighting' }), ['NPCs/Gilt.md']);
  // a name in Do wins over a name in Then
  assert.deepEqual(run({ key: 'b1.if.d', do: 'Gilt Bloodied', then: 'the Glacier Wyrm laughs' }), ['NPCs/Gilt.md']);
});

test('a cue names whole foes: a Rat is not named by "Pirate"', () => {
  const rat = { key: 'b1.foe.rat', note: 'Creatures/Rat.md', name: 'Rat', ally: false, ac: 10, hp: 30, init: 1 };
  const pirate = { key: 'b1.foe.pirate', note: 'Creatures/Pirate.md', name: 'Pirate', ally: false, ac: 12, hp: 30, init: 2 };
  const beat = { ...gate, foes: [rat, pirate], ifs: [], points: [{ key: 'b1.pt.p', text: 'Pirate at 10 HP or less: it flees' }] };
  const r = M.rowsForFight({ model, derived: derivedOf({ beats: [beat, hub] }), state: here, beatKey: 'b1', idBase: 'a1' });
  assert.deepEqual(r.thresholds[0].foes, ['Creatures/Pirate.md']);
});

test('not lit at 0 or Out', () => {
  const t = { key: 'k', foes: ['n'], hp: 10, bloodied: false };
  assert.equal(M.isLit(t, row({ hp: 10 })), true);
  assert.equal(M.isLit(t, row({ hp: 0 })), false);
  assert.equal(M.isLit(t, row({ hp: 5, out: true })), false);
  assert.equal(M.isLit(t, row({ hp: 11 })), false);
  const b = { key: 'k', foes: ['n'], hp: null, bloodied: true };
  assert.equal(M.isLit(b, row({ hp: 10, max: 20 })), true);
  assert.equal(M.isLit(b, row({ hp: 11, max: 20 })), false);
  assert.equal(M.isLit(b, row({ hp: 0, max: 20 })), false);
  assert.equal(M.isLit(b, row({ hp: 5, max: 20, kind: 'ally' })), false);
});

test('sort: ties go to the higher modifier, then PCs; the Lair row loses ties at 20; empty boxes last; unticked last', () => {
  const rows = [
    row({ id: 'unticked', in: false, ini: 30 }),
    row({ id: 'empty', ini: null }),
    row({ id: 'foe-lo', ini: 15, mod: 1 }),
    row({ id: 'foe-hi', ini: 15, mod: 4 }),
    row({ id: 'pc-lo', kind: 'pc', ini: 15, mod: 1 }),
    row({ id: 'lair', kind: 'lair', ini: 20, mod: -99 }),
    row({ id: 'twenty', ini: 20, mod: 0 }),
    row({ id: 'zero', ini: 0 }),
  ];
  assert.deepEqual(M.sortRows(rows).map((r) => r.id), ['twenty', 'lair', 'foe-hi', 'pc-lo', 'foe-lo', 'zero', 'empty', 'unticked']);
});

test('sort is stable for equal rows', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => row({ id, ini: 10, mod: 2 }));
  const before = rows.map((r) => r.id);
  assert.deepEqual(M.sortRows(rows).map((r) => r.id), before);
  assert.deepEqual(rows.map((r) => r.id), before, 'the input is not reordered');
});

test('next skips out and unticked rows and wraps', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b', out: true }), row({ id: 'c', in: false }), row({ id: 'd' }), row({ id: 'l', kind: 'lair' })];
  assert.equal(M.nextLive(rows, 'a').row.id, 'd');
  assert.equal(M.nextLive(rows, 'a').wrapped, false);
  assert.equal(M.nextLive(rows, 'd').row.id, 'l');
  const w = M.nextLive(rows, 'l');
  assert.equal(w.row.id, 'a');
  assert.equal(w.wrapped, true);
  assert.equal(M.nextLive(rows, null).row.id, 'a');
  assert.equal(M.nextLive(rows, null).wrapped, false);
  assert.deepEqual(M.nextLive([row({ id: 'z', out: true })], 'z'), { row: null, wrapped: true });
  assert.equal(M.nextLive([row({ id: 'only' })], 'only').row.id, 'only');
});

test('the Lair row has no turn once every owner is out', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b', out: true }), row({ id: 'l', kind: 'lair', of: ['b'] })];
  assert.equal(M.nextLive(rows, 'a').row.id, 'a', 'only a is left');
  assert.equal(M.nextLive(rows, 'a').wrapped, true);
  rows[1].out = false;
  assert.equal(M.nextLive(rows, 'a').row.id, 'b');
  assert.equal(M.nextLive(rows, 'b').row.id, 'l');
});

test('acting: the current foe; on a PC turn the last foe; before any foe has acted the next foe due; a pin wins', () => {
  const rows = [row({ id: 'pc1', kind: 'pc' }), row({ id: 'f1' }), row({ id: 'pc2', kind: 'pc' }), row({ id: 'f2' })];
  assert.deepEqual(M.actingRow({ rows, turn: 'f1', lastFoe: 'f1' }, null), { row: rows[1], why: 'acting' });
  assert.deepEqual(M.actingRow({ rows, turn: 'pc2', lastFoe: 'f1' }, null), { row: rows[1], why: 'last-foe' });
  assert.deepEqual(M.actingRow({ rows, turn: 'pc2', lastFoe: null }, null), { row: rows[3], why: 'next-foe' });
  assert.deepEqual(M.actingRow({ rows, turn: 'pc1', lastFoe: null }, null), { row: rows[1], why: 'next-foe' });
  assert.deepEqual(M.actingRow({ rows, turn: 'f1', lastFoe: 'f1' }, 'f2'), { row: rows[3], why: 'picked' });
  assert.deepEqual(M.actingRow({ rows, turn: null, lastFoe: null }, null), { row: rows[1], why: 'first-foe' });
  assert.deepEqual(M.actingRow({ rows, turn: 'f1', lastFoe: 'f1' }, 'gone'), { row: rows[1], why: 'acting' });
  assert.deepEqual(M.actingRow({ rows: [row({ id: 'p', kind: 'pc' })], turn: 'p', lastFoe: null }, null), { row: null, why: null });
});

test('unseen labels', () => {
  const word = (r) => (r.word !== undefined ? r.word : 'a mephit');
  // two mephits number; a stranger and a lone brother do not
  let rows = [row({ id: 'm1' }), row({ id: 'm2' }), row({ id: 'lone', word: 'someone' })];
  let l = M.unseenLabels(rows, word);
  assert.equal(l.get('m1'), 'Mephit 1');
  assert.equal(l.get('m2'), 'Mephit 2');
  assert.equal(l.get('lone'), 'Someone');
  // showing one keeps the other numbered (the number is stored on the row)
  rows = [row({ id: 'm1', unseenN: 1, seen: true }), row({ id: 'm2', unseenN: 2 })];
  assert.equal(M.unseenLabels(rows, word).get('m2'), 'Mephit 2');
  // an unticked row gets no number and is not counted
  rows = [row({ id: 'm1' }), row({ id: 'm2', in: false })];
  l = M.unseenLabels(rows, word);
  assert.equal(l.get('m1'), 'A mephit');
  assert.equal(l.get('m2'), 'A mephit');
  // first ticked in: takes the next number
  rows = [row({ id: 'm1', unseenN: 1 }), row({ id: 'm2', in: true })];
  assert.equal(M.unseenLabels(rows, word).get('m2'), 'Mephit 2');
  assert.equal(M.unseenNumbers(rows, word).get('m2'), 2);
  // a stranger, numbered
  rows = [row({ id: 's1' }), row({ id: 's2' })];
  assert.equal(M.unseenLabels(rows, () => 'a stranger').get('s1'), 'Stranger 1');
  // a word that already has a number is not reused by a later one
  rows = [row({ id: 'a', unseenN: 3 }), row({ id: 'b' })];
  assert.equal(M.unseenNumbers(rows, word).get('b'), 4);
  // other kinds are left out
  assert.equal(M.unseenLabels([row({ id: 'p', kind: 'pc' })], word).size, 0);
  // `a guard` and `the guard` both show `Guard N`: one run of numbers, even for numbers kept apart before
  const guard = (r) => r.word;
  rows = [row({ id: 'g1', word: 'a guard' }), row({ id: 'g2', word: 'a guard' }), row({ id: 'g3', word: 'the guard' }), row({ id: 'g4', word: 'the guard' })];
  l = M.unseenLabels(rows, guard);
  assert.deepEqual(['g1', 'g2', 'g3', 'g4'].map((id) => l.get(id)), ['Guard 1', 'Guard 2', 'Guard 3', 'Guard 4']);
  rows = rows.map((r, i) => ({ ...r, unseenN: (i % 2) + 1 }));
  l = M.unseenLabels(rows, guard);
  assert.equal(new Set(['g1', 'g2', 'g3', 'g4'].map((id) => l.get(id))).size, 4, [...l.values()].join(', '));
  // a lone one keeps its own words
  assert.equal(M.unseenLabels([row({ id: 'x', word: 'the guard' })], guard).get('x'), 'The guard');
});

test('gm names: unmasked, with the copy number once there are two', () => {
  const unmaskOf = (n) => (n === 'NPCs/Gilt.md' ? 'Lucan Truename' : null);
  assert.equal(M.gmName(row({ note: 'NPCs/Gilt.md', name: 'Masked Gilt', copy: 1 }), unmaskOf, 1), 'Lucan Truename');
  assert.equal(M.gmName(row({ note: 'Creatures/Mephit.md', name: 'Ice Mephit', copy: 2 }), unmaskOf, 2), 'Ice Mephit 2');
  assert.equal(M.gmName(row({ note: 'Creatures/Mephit.md', name: 'Ice Mephit', copy: 1 }), unmaskOf, 1), 'Ice Mephit');
  assert.equal(M.gmName(row({ kind: 'lair', note: null }), unmaskOf, 1), 'Lair action');
  assert.equal(M.gmName(row({ kind: 'pc', note: kael, name: 'Kael', copy: null }), unmaskOf, 1), 'Kael');
});

test('rows for a fight: who is ticked, ids, the Lair row, groups, thresholds', () => {
  const r = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'act1' });
  const by = (note) => r.rows.filter((x) => x.note === note);
  assert.equal(by(kael)[0].in, true, 'a PC at the beat is ticked');
  assert.equal(by(nim)[0].in, false, 'a PC elsewhere is listed unticked');
  assert.equal(by(nim)[0].group, 'b2.spot.a');
  assert.deepEqual(r.groups, ['b1']);
  assert.ok(r.rows.filter((x) => x.kind === 'foe' || x.kind === 'ally').every((x) => x.in), 'foes and allies are ticked');
  assert.equal(by('NPCs/Venn.md')[0].kind, 'ally');
  assert.equal(by('NPCs/Venn.md')[0].seen, true);
  assert.equal(by('Creatures/Wyrm.md')[0].seen, false);
  const lair = r.rows.find((x) => x.kind === 'lair');
  assert.deepEqual(lair.of, [by('Creatures/Wyrm.md')[0].id]);
  assert.equal(lair.ini, 20);
  r.rows.forEach((x, i) => assert.equal(x.id, `act1-r${i + 1}`));
  assert.equal(new Set(r.rows.map((x) => x.id)).size, r.rows.length);
  const mephits = by('Creatures/Mephit.md');
  assert.deepEqual(mephits.map((x) => x.copy), [1, 2]);
  assert.equal(mephits[0].name, 'Ice Mephit');
  assert.deepEqual(mephits[0].recharge, [{ name: 'Frost Breath', at: 6, ready: true, rolled: null }]);
  assert.equal(by('Creatures/Wyrm.md')[0].recharge[0].at, 5);
  assert.equal(by('Creatures/Wyrm.md')[0].lrMax, 3);
  assert.equal(by('Creatures/Wyrm.md')[0].laMax, 3);
  assert.deepEqual(r.thresholds.map((t) => t.key).sort(), ['b1.if.a', 'b1.pt.a']);
  // the page's input is untouched
  assert.equal(gate.foes.length, 6);
});

test('with no PC there, all are ticked', () => {
  const r = M.rowsForFight({ model, derived: derivedOf(), state: { ...here, positions: {} }, beatKey: 'b1', idBase: 'a' });
  assert.ok(r.rows.filter((x) => x.kind === 'pc').every((x) => x.in));
  assert.deepEqual(r.groups, ['b1']);
});

test('Fight from a contingency takes the focused group', () => {
  const cont = { key: 'c1', title: 'If it all goes wrong', contingency: true, spots: [], foes: [imp] };
  const r = M.rowsForFight({ model, derived: derivedOf({ beats: [gate, hub, cont] }), state: here, beatKey: 'c1', groups: ['b1'], idBase: 'a' });
  assert.deepEqual(r.groups, ['b1']);
  assert.equal(r.rows.find((x) => x.note === kael).in, true);
  assert.equal(r.rows.find((x) => x.note === nim).in, false);
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Imp.md').group, 'b1');
});

test('a second fight starts from the first figures (PCs and allies: the vitals; temp and concentration empty)', () => {
  const derived = derivedOf({ vitals: [
    { rowId: kael, hp: 12, max: 40, conditions: 'Prone, Exhaustion 1, Concentrating' },
    { rowId: 'NPCs/Venn.md', hp: 7, max: 30, conditions: 'Down' },
  ] });
  const r = M.rowsForFight({ model, derived, state: here, beatKey: 'b1', idBase: 'a' });
  const k = r.rows.find((x) => x.note === kael);
  assert.equal(k.hp, 12);
  assert.equal(k.max, 40);
  assert.deepEqual(k.conds, ['Prone']);
  assert.equal(k.exhaustion, 1);
  assert.equal(k.temp, 0);
  assert.equal(k.conc, false);
  assert.deepEqual(k.ds, { s: 0, f: 0 });
  assert.deepEqual(k.start, { hp: 12, max: 40, conds: ['Prone'], exhaustion: 1, conc: false });
  const v = r.rows.find((x) => x.note === 'NPCs/Venn.md');
  assert.equal(v.hp, 7);
  assert.deepEqual(v.conds, ['Down']);
  assert.equal(r.rows.find((x) => x.note === nim).hp, 30, 'no vitals row: the note');
});

test('a named NPC starts where the last fight left him; a creature starts fresh', () => {
  const state = { ...here, fights: [{ id: 'f1', rows: [
    { note: 'NPCs/Gilt.md', hp: 20, max: 50, conds: ['Prone'], exhaustion: 2, temp: 9, conc: true },
    { note: 'Creatures/Wyrm.md', hp: 1, max: 7342, conds: ['Prone'], exhaustion: 0 },
  ] }] };
  const r = M.rowsForFight({ model, derived: derivedOf(), state, beatKey: 'b1', idBase: 'a' });
  const g = r.rows.find((x) => x.note === 'NPCs/Gilt.md');
  assert.equal(g.hp, 20);
  assert.deepEqual(g.conds, ['Prone']);
  assert.equal(g.exhaustion, 2);
  assert.equal(g.temp, 0);
  assert.equal(g.conc, false);
  const w = r.rows.find((x) => x.note === 'Creatures/Wyrm.md');
  assert.equal(w.hp, 7342);
  assert.deepEqual(w.conds, []);
});

test('shownEver starts a row seen', () => {
  const r = M.rowsForFight({ model, derived: derivedOf(), state: { ...here, shownEver: { 'Creatures/Wyrm.md': '2026-11-20T20:00:00Z' } }, beatKey: 'b1', idBase: 'a' });
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Wyrm.md').seen, true);
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Imp.md').seen, false);
});

test('Fight on an improvised beat brings the people brought in; on a Plan beat they are unticked', () => {
  const brought = { b1: [{ note: 'NPCs/Gilt.md' }, { note: 'NPCs/Plain.md' }], i1: [{ note: 'Creatures/Mephit.md' }, { note: 'Creatures/Mephit.md' }] };
  const impro = { key: 'i1', title: 'Ambush', impro: true, spots: [], foes: [] };
  const lone = { ...gate, foes: [wyrm] };
  const r = M.rowsForFight({ model, derived: derivedOf({ beats: [lone, hub, impro] }), state: { ...here, brought }, beatKey: 'b1', idBase: 'a' });
  const g = r.rows.find((x) => x.note === 'NPCs/Gilt.md');
  assert.equal(g.in, false, 'brought in on a Plan beat: listed unticked');
  assert.equal(r.rows.some((x) => x.note === 'NPCs/Plain.md'), false, 'no stats: no row');
  const i = M.rowsForFight({ model, derived: derivedOf({ beats: [gate, hub, impro] }), state: { ...here, brought }, beatKey: 'i1', groups: ['b1'], idBase: 'a' });
  const m = i.rows.filter((x) => x.note === 'Creatures/Mephit.md');
  assert.equal(m.length, 1, 'one note brought in is one row; a count is Add');
  assert.equal(m[0].in, true);
});

test('join: a creature with a count numbers on', () => {
  const fight = { groups: ['b1'], rows: [], thresholds: [] };
  const a = M.joinRows({ model, derived: derivedOf(), state: here, fight, add: { cast: 'Creatures/Mephit.md', count: 2 }, idBase: 'j1' });
  assert.deepEqual(a.rows.map((r) => [r.id, r.copy, r.name]), [['j1-r1', 1, 'Ice Mephit'], ['j1-r2', 2, 'Ice Mephit']]);
  assert.equal(a.rows[0].group, 'b1');
  const b = M.joinRows({ model, derived: derivedOf(), state: here, fight: { ...fight, rows: a.rows }, add: { cast: 'Creatures/Mephit.md' }, idBase: 'j2' });
  assert.deepEqual(b.rows.map((r) => r.copy), [3]);
});

test('join refuses a named NPC already in', () => {
  const fight = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a' });
  const r = M.joinRows({ model, derived: derivedOf(), state: here, fight: { groups: fight.groups, rows: fight.rows, thresholds: fight.thresholds }, add: { cast: 'NPCs/Gilt.md' }, idBase: 'j' });
  assert.equal(r.refused, 'Masked Gilt is already in this fight.');
  assert.deepEqual(r.rows, []);
});

test('join ticks a benched one in', () => {
  const f = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a' });
  const rows = f.rows.map((r) => (r.note === 'NPCs/Gilt.md' ? { ...r, in: false } : r));
  const r = M.joinRows({ model, derived: derivedOf(), state: here, fight: { groups: f.groups, rows, thresholds: [] }, add: { cast: 'NPCs/Gilt.md' }, idBase: 'j' });
  assert.equal(r.refused, null);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.tick, [rows.find((x) => x.note === 'NPCs/Gilt.md').id]);
  const pc = M.joinRows({ model, derived: derivedOf(), state: here, fight: { groups: f.groups, rows, thresholds: [] }, add: { cast: nim }, idBase: 'j' });
  assert.deepEqual(pc.tick, [rows.find((x) => x.note === nim).id]);
});

test('a benched lair owner added by name brings the Lair row', () => {
  const f = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a' });
  const rows = f.rows.filter((r) => r.kind !== 'lair').map((r) => (r.note === 'Creatures/Wyrm.md' ? { ...r, in: false } : r));
  const r = M.joinRows({ model, derived: derivedOf(), state: here, fight: { groups: f.groups, rows, thresholds: [] }, add: { cast: 'Creatures/Wyrm.md' }, idBase: 'j' });
  assert.deepEqual(r.tick, [rows.find((x) => x.note === 'Creatures/Wyrm.md').id]);
  assert.equal(r.rows.filter((x) => x.kind === 'lair').length, 1);
  // and never a second
  const again = M.joinRows({ model, derived: derivedOf(), state: here, fight: { groups: f.groups, rows: f.rows.map((x) => (x.note === 'Creatures/Wyrm.md' ? { ...x, in: false } : x)), thresholds: [] }, add: { cast: 'Creatures/Wyrm.md' }, idBase: 'k' });
  assert.equal(again.rows.length, 0);
});

test('join a group brings its PCs and its beat foes', () => {
  const start = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a' });
  const hubFoe = { key: 'b2.foe.imp', note: 'Creatures/Imp.md', name: 'Rime Imp', ally: false, ac: 5, hp: 21, init: 1 };
  const derived = derivedOf({ beats: [gate, { ...hub, foes: [hubFoe] }] });
  const r = M.joinRows({ model, derived, state: here, fight: { groups: start.groups, rows: start.rows, thresholds: start.thresholds }, add: { group: 'b2.spot.a' }, idBase: 'j' });
  assert.deepEqual(r.groups, ['b2.spot.a']);
  assert.deepEqual(r.tick, [start.rows.find((x) => x.note === nim).id]);
  assert.deepEqual(r.rows.map((x) => x.note), ['Creatures/Imp.md']);
  // a beat's foes already in the fight (by key) are not made twice
  const again = M.joinRows({ model, derived, state: here, fight: { groups: start.groups, rows: start.rows.concat(r.rows), thresholds: [] }, add: { group: 'b2.spot.a' }, idBase: 'k' });
  assert.deepEqual(again.rows, []);
  // a beat: new thresholds only
  const withBeat = M.joinRows({ model, derived, state: here, fight: { groups: [], rows: [], thresholds: start.thresholds }, add: { beat: 'b1' }, idBase: 'm' });
  assert.deepEqual(withBeat.thresholds, []);
  assert.ok(withBeat.rows.find((x) => x.kind === 'lair'), 'a fight with no Lair row gets one');
});

test('join a note with no stats gives a row with no numbers', () => {
  const r = M.joinRows({ model, derived: derivedOf(), state: here, fight: { groups: ['b1'], rows: [], thresholds: [] }, add: { cast: 'NPCs/Plain.md' }, idBase: 'j' });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].hp, null);
  assert.equal(r.rows[0].max, null);
  assert.equal(r.rows[0].ac, null);
  assert.equal(r.rows[0].name, 'Plain Person');
  assert.equal(r.rows[0].kind, 'foe');
  assert.deepEqual(r.rows[0].start, { hp: null, max: null, conds: [], exhaustion: 0, conc: false });
});

test('join: unknown cast and an empty add are refused, a pc not in the fight is made', () => {
  const f = { groups: ['b1'], rows: [], thresholds: [] };
  assert.ok(M.joinRows({ model, derived: derivedOf(), state: here, fight: f, add: { cast: 'Nobody.md' }, idBase: 'j' }).refused);
  assert.ok(M.joinRows({ model, derived: derivedOf(), state: here, fight: f, add: {}, idBase: 'j' }).refused);
  assert.equal(M.joinRows({ model, derived: derivedOf(), state: here, fight: f, add: { cast: nim }, idBase: 'j' }).rows[0].kind, 'pc');
});

test('pure: nothing here reads a clock, a die or the page', () => {
  const src = require('node:fs').readFileSync(require.resolve('../lib/run-sheet/web/fight-math'), 'utf8');
  for (const bad of ['Math.random', 'Date.now', 'new Date', 'randomInt', 'getRandomValues', 'document.', 'fetch(']) assert.ok(!src.includes(bad), bad);
  assert.equal(M.EXHAUSTION_MAX, 6);
  assert.ok(M.DND_STATUSES.includes('Prone') && !M.DND_STATUSES.includes('Exhaustion') && !M.DND_STATUSES.includes('Bloodied'));
});

test('an N HP or less line lights for the foe it names, else the biggest (Review L4)', () => {
  const ogre = { key: 'b1.foe.ogre', note: 'Creatures/Ogre.md', name: 'Ogre', ally: false, ac: 11, hp: 70, init: 0 };
  const dragon = { key: 'b1.foe.dragon', note: 'Creatures/Dragon.md', name: 'White Dragon', ally: false, ac: 17, hp: 200, init: 0 };
  const run = (text) => M.rowsForFight({ model, derived: derivedOf({ beats: [{ ...gate, foes: [ogre, dragon], ifs: [], points: [{ key: 'b1.pt.x', text }] }, hub] }), state: here, beatKey: 'b1', idBase: 'a' }).thresholds[0].foes;
  assert.deepEqual(run('60 HP or less: it flees'), ['Creatures/Dragon.md'], 'names none: the biggest only, never the ogre');
  assert.deepEqual(run('The Ogre at 60 HP or less: it flees'), ['Creatures/Ogre.md']);
  assert.deepEqual(run('The Ogre at 90 HP or less: it flees'), ['Creatures/Dragon.md'], 'a named foe whose max is under the line cannot cross it');
});

test('people an arrivals cue names join benched (proof M1)', () => {
  const b = { ...gate, arrivals: [{ key: 'b1.arrive.a', when: 'Arriving, start of round 3', text: 'Venn and an imp', people: ['NPCs/Venn.md', 'Creatures/Imp.md'] }] };
  const r = M.rowsForFight({ model, derived: derivedOf({ beats: [b, hub] }), state: here, beatKey: 'b1', idBase: 'a' });
  assert.equal(r.rows.find((x) => x.note === 'NPCs/Venn.md').in, false);
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Imp.md').in, false);
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Wyrm.md').in, true);
});

test('the fight\'s groups hold every ticked PC (proof M2)', () => {
  const apart = { ...here, positions: { [kael]: { beat: 'b2', spot: 'b2.spot.a' }, [nim]: { beat: 'b2', spot: 'b2.spot.b' } } };
  const r = M.rowsForFight({ model, derived: derivedOf(), state: apart, beatKey: 'b1', idBase: 'a' });
  assert.ok(r.rows.filter((x) => x.kind === 'pc').every((x) => x.in), 'no PC at the beat: all ticked');
  assert.deepEqual(r.groups, ['b2.spot.a', 'b2.spot.b']);
  // a PC ticked in later brings the group he stands in
  const fight = { groups: ['b1'], rows: [{ kind: 'pc', note: kael, in: true }, { kind: 'pc', note: nim, in: false }] };
  const gs = [{ key: 'b1', pcs: [] }, { key: 'b2.spot.a', pcs: [kael] }, { key: 'b2.spot.b', pcs: [nim] }];
  assert.deepEqual(M.fightGroupKeys(fight, gs), ['b1', 'b2.spot.a']);
  assert.deepEqual(M.fightGroupKeys(null, gs), []);
});

test('a foe already seen when it joins takes no unseen number', () => {
  const word = () => 'a mephit';
  const rows = [row({ id: 'm0', seen: true }), row({ id: 'm1' }), row({ id: 'm2' })];
  const n = M.unseenNumbers(rows, word);
  assert.equal(n.has('m0'), false);
  assert.equal(n.get('m1'), 1);
  assert.equal(n.get('m2'), 2);
});

// ---- plan 6a Task 5: sides ----

test('the switch cycles foe, ally, neutral, foe; a row\'s side is its kind and neutral flag', () => {
  assert.equal(M.nextSide('foe'), 'ally');
  assert.equal(M.nextSide('ally'), 'neutral');
  assert.equal(M.nextSide('neutral'), 'foe');
  assert.equal(M.sideOfRow(row({ kind: 'foe' })), 'foe');
  assert.equal(M.sideOfRow(row({ kind: 'foe', neutral: true })), 'neutral');
  assert.equal(M.sideOfRow(row({ kind: 'ally' })), 'ally');
  assert.equal(M.sideOfRow(row({ kind: 'pc' })), null);
  assert.equal(M.sideOfRow(row({ kind: 'lair' })), null);
});

test('actingRow skips a neutral', () => {
  const rows = [row({ id: 'pc1', kind: 'pc' }), row({ id: 'n1', neutral: true }), row({ id: 'f1' })];
  assert.deepEqual(M.actingRow({ rows, turn: null, lastFoe: null }, null), { row: rows[2], why: 'first-foe' });
  assert.deepEqual(M.actingRow({ rows, turn: 'pc1', lastFoe: null }, null), { row: rows[2], why: 'next-foe' });
  const onlyNeutral = [row({ id: 'pc1', kind: 'pc' }), row({ id: 'n1', neutral: true })];
  assert.deepEqual(M.actingRow({ rows: onlyNeutral, turn: 'pc1', lastFoe: null }, null), { row: null, why: null });
  assert.deepEqual(M.actingRow({ rows: onlyNeutral, turn: null, lastFoe: null }, null), { row: null, why: null });
  // the neutral's own turn still shows its own panel
  assert.deepEqual(M.actingRow({ rows, turn: 'n1', lastFoe: null }, null), { row: rows[1], why: 'acting' });
});

test('the starting side: the side set tonight, then the one carried, then the reader\'s', () => {
  const by = (r, note) => r.rows.find((x) => x.note === note);
  const r = M.rowsForFight({ model: { ...model, sidesCarried: { 'NPCs/Gilt.md': 'neutral', 'Creatures/Imp.md': 'ally' } },
    derived: derivedOf(), state: { ...here, sides: { 'NPCs/Gilt.md': 'ally', 'NPCs/Venn.md': 'foe' } }, beatKey: 'b1', idBase: 'a' });
  assert.deepEqual([by(r, 'NPCs/Gilt.md').kind, by(r, 'NPCs/Gilt.md').neutral, by(r, 'NPCs/Gilt.md').sideFrom], ['ally', false, 'you set it'], 'tonight wins over the carried side');
  assert.deepEqual([by(r, 'Creatures/Imp.md').kind, by(r, 'Creatures/Imp.md').sideFrom], ['ally', 'you set it'], 'a carried side');
  assert.deepEqual([by(r, 'NPCs/Venn.md').kind, by(r, 'NPCs/Venn.md').neutral], ['foe', false], 'a reader-ally set to foe');
  assert.equal(by(r, 'Creatures/Wyrm.md').kind, 'foe', 'nothing set: the reader\'s side');
  // a side set by the GM is the GM's word: an ally from it starts seen
  assert.equal(by(r, 'NPCs/Gilt.md').seen, true);
  assert.equal(by(r, 'Creatures/Imp.md').seen, true);
  assert.equal(by(r, 'NPCs/Venn.md').seen, false, 'a reader-ally set to foe starts as a foe does');
  const n = M.rowsForFight({ model, derived: derivedOf(), state: { ...here, sides: { 'NPCs/Gilt.md': 'neutral' } }, beatKey: 'b1', idBase: 'a' });
  assert.deepEqual([by(n, 'NPCs/Gilt.md').kind, by(n, 'NPCs/Gilt.md').neutral, by(n, 'NPCs/Gilt.md').seen], ['foe', true, false]);
  // a value that is no side is passed over
  const odd = M.rowsForFight({ model: { ...model, sidesCarried: { 'NPCs/Gilt.md': 'friend' } }, derived: derivedOf(), state: { ...here, sides: { 'NPCs/Venn.md': 7 } }, beatKey: 'b1', idBase: 'a' });
  assert.equal(by(odd, 'NPCs/Gilt.md').kind, 'foe');
  assert.equal(by(odd, 'NPCs/Venn.md').kind, 'ally');
});

test('seenFrom starts a row seen, and the row carries it', () => {
  const r = M.rowsForFight({ model: { ...model, seenFrom: { 'Creatures/Wyrm.md': 'on the player site' } }, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a' });
  const w = r.rows.find((x) => x.note === 'Creatures/Wyrm.md');
  assert.equal(w.seen, true);
  assert.equal(w.seenFrom, 'on the player site');
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Imp.md').seen, false);
  assert.equal(r.rows.find((x) => x.note === 'Creatures/Imp.md').seenFrom, null);
});

test('an inferred ally starts unseen; one from the GM\'s own words starts seen', () => {
  const ally = (allyBy) => ({ ...venn, allyBy, allyFrom: `why: ${allyBy}` });
  const run = (allyBy, extra = {}) => {
    const g = { ...gate, foes: [ally(allyBy)] };
    const r = M.rowsForFight({ model: { ...model, ...extra }, derived: derivedOf({ beats: [g, hub] }), state: here, beatKey: 'b1', idBase: 'a' });
    return r.rows.find((x) => x.note === 'NPCs/Venn.md');
  };
  for (const by of ['relationships', 'affiliation', 'quickRef']) {
    const v = run(by);
    assert.deepEqual([v.kind, v.seen], ['ally', false], by);
    assert.equal(v.sideFrom, `why: ${by}`);
    assert.equal(v.word, '', 'an unseen ally keeps a word for its label (the fixture has no withheld word)');
    assert.equal(run(by, { seenFrom: { 'NPCs/Venn.md': 'named in Session 2' } }).seen, true, `${by} with seenFrom`);
  }
  for (const by of ['plan', 'stats']) assert.equal(run(by).seen, true, by);
  assert.equal(run('nonsense').seen, false, 'an allyBy the sheet does not know is not the GM\'s word');
});
