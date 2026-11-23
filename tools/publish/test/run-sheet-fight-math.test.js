'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/run-sheet/web/fight-math');

const row = (o) => ({
  id: 'x', kind: 'foe', note: 'n', name: 'N', copy: 1, in: true, ini: null, mod: 0, hp: 10, max: 20, out: false, unseenN: null, ...o,
});

test('entries: -37, 37, +8, t5, T5, spaces; nonsense and 10000 give null', () => {
  // step 6b Task 6 changed this on purpose: the brief names parseEntry's `pool` key (`hp`, or `temp` for t5). The
  // kinds and numbers, and every refusal below, are as before.
  assert.deepEqual(M.parseEntry('-37'), { pool: 'hp', kind: 'damage', n: 37 });
  assert.deepEqual(M.parseEntry('37'), { pool: 'hp', kind: 'damage', n: 37 });
  assert.deepEqual(M.parseEntry('+8'), { pool: 'hp', kind: 'heal', n: 8 });
  assert.deepEqual(M.parseEntry('t5'), { pool: 'temp', kind: 'temp', n: 5 });
  assert.deepEqual(M.parseEntry('T5'), { pool: 'temp', kind: 'temp', n: 5 });
  assert.deepEqual(M.parseEntry('  -37 '), { pool: 'hp', kind: 'damage', n: 37 });
  assert.deepEqual(M.parseEntry('9999'), { pool: 'hp', kind: 'damage', n: 9999 });
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

test('add a typed name nobody has, by choosing New: blank unseen foes numbered Name 1..N', () => {
  const fight = { groups: ['b1'], rows: [], thresholds: [] };
  const a = M.joinRows({ model, derived: derivedOf(), state: here, fight, add: { name: 'Bouncer', count: 3 }, idBase: 'j1' });
  assert.equal(a.refused, null);
  assert.deepEqual(a.rows.map((r) => r.name), ['Bouncer 1', 'Bouncer 2', 'Bouncer 3']);
  for (const r of a.rows) {
    assert.equal(r.kind, 'foe');
    assert.equal(r.neutral, false);
    assert.equal(r.seen, false, 'a page-built row starts unseen');
    assert.equal(r.in, true);
    assert.equal(r.note, null, 'no note');
    assert.equal(r.hp, null);
    assert.equal(r.typed, false);
  }
  assert.equal(a.rows[0].group, 'b1');
  const one = M.joinRows({ model, derived: derivedOf(), state: here, fight, add: { name: '  Bouncer  ', count: 1 }, idBase: 'j2' });
  assert.deepEqual(one.rows.map((r) => r.name), ['Bouncer']);
  // a second add of the same name goes on from the highest number
  const more = M.joinRows({ model, derived: derivedOf(), state: here, fight: { ...fight, rows: a.rows }, add: { name: 'Bouncer', count: 2 }, idBase: 'j3' });
  assert.deepEqual(more.rows.map((r) => r.name), ['Bouncer 4', 'Bouncer 5']);
  assert.ok(M.joinRows({ model, derived: derivedOf(), state: here, fight, add: { name: '   ', count: 2 }, idBase: 'j4' }).refused);
  assert.equal(typeof M.blankRow, 'function', 'blankRow is exported');
});

test('a cast name still adds the note', () => {
  const fight = { groups: ['b1'], rows: [], thresholds: [] };
  const a = M.joinRows({ model, derived: derivedOf(), state: here, fight, add: { cast: 'Creatures/Mephit.md', count: 2 }, idBase: 'j1' });
  assert.deepEqual(a.rows.map((r) => r.note), ['Creatures/Mephit.md', 'Creatures/Mephit.md']);
  assert.ok(a.rows.every((r) => r.hp === 7341), 'the note\'s numbers come with it');
});

test('near match comes first: Petr Goodwin finds Peter Goodwin, and New is last', () => {
  const cast = [
    { note: 'N/Anna Goodwin.md', name: 'Anna Goodwin', type: 'npc' },
    { note: 'N/Petra.md', name: 'Petra Vane', type: 'npc' },
    { note: 'N/Peter Goodwin.md', name: 'Peter Goodwin', type: 'npc' },
    { note: 'N/Zed.md', name: 'Zed', type: 'npc' },
  ];
  const RS = require('../lib/run-sheet/web/state');
  const c = M.addChoices(cast, 'Petr Goodwin', RS.castSearch);
  assert.equal(c[0].note, 'N/Peter Goodwin.md', 'within two edits is the top hit');
  assert.ok(c.some((x) => x.note === 'N/Anna Goodwin.md'), 'the same surname is offered too');
  assert.ok(c.findIndex((x) => x.note === 'N/Anna Goodwin.md') > 0, 'but after the near spelling');
  assert.equal(c.at(-1).isNew, true);
  assert.equal(c.at(-1).name, 'Petr Goodwin');
  assert.equal(c.at(-1).label, '+ New: Petr Goodwin (no note)');
  assert.equal(c.filter((x) => x.isNew).length, 1);
  // a plain prefix still finds, and a stranger gets New alone
  assert.equal(M.addChoices(cast, 'Pet', RS.castSearch)[0].note, 'N/Peter Goodwin.md');
  assert.deepEqual(M.addChoices(cast, 'Bouncer', RS.castSearch).map((x) => x.isNew), [true]);
  assert.deepEqual(M.addChoices(cast, '   ', RS.castSearch), []);
  // two letters are not "within two edits" of everything
  assert.ok(!M.addChoices(cast, 'Ze', RS.castSearch).slice(0, -1).some((x) => x.note === 'N/Anna Goodwin.md'));
});

test('placeRow: one insert at the sorted place, the rest never re-sorted', () => {
  const r = (id, ini, o) => row({ id, ini, ...o });
  const rows = [r('a', 20), r('b', 5), r('c', 12), r('d', null), r('e', null)];
  const at = (list, id, ini) => list.map((x) => (x.id === id ? { ...x, ini } : x));
  const out = M.placeRow(at(rows, 'e', 15), 'e');
  assert.deepEqual(out.map((x) => x.id), ['a', 'e', 'b', 'c', 'd'], 'e goes above the first row it beats; b and c keep their odd order');
  assert.equal(out.find((x) => x.id === 'e').ini, 15);
  const tie = M.placeRow([r('a', 10), r('b', 10), r('c', 10)], 'c');
  assert.deepEqual(tie.map((x) => x.id), ['a', 'b', 'c'], 'a tie goes after the ones already there');
  assert.deepEqual(M.placeRow(rows, 'nope'), rows);
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

test('the switch\'s sides are foe, neutral, ally, ally last; a row\'s side is its kind and neutral flag', () => {
  assert.deepEqual(M.SIDES, ['foe', 'neutral', 'ally']);
  assert.equal(M.nextSide, undefined, 'no cycle');
  assert.equal(M.sideOfRow(row({ kind: 'foe' })), 'foe');
  assert.equal(M.sideOfRow(row({ kind: 'foe', neutral: true })), 'neutral');
  assert.equal(M.sideOfRow(row({ kind: 'ally' })), 'ally');
  assert.equal(M.sideOfRow(row({ kind: 'pc' })), null);
  assert.equal(M.sideOfRow(row({ kind: 'lair' })), null);
});

// final review O9: one side chain, for the rows a fight starts, Who's here and the players' screen
test('noteSide: tonight\'s side, then a carried one, then the reader\'s; a stored word that is no side is passed over', () => {
  const N = 'NPCs/A.md';
  assert.deepEqual(M.noteSide({ [N]: 'neutral' }, { [N]: 'ally' }, N, true), { side: 'neutral', set: true });
  assert.deepEqual(M.noteSide({}, { [N]: 'ally' }, N, false), { side: 'ally', set: true });
  assert.deepEqual(M.noteSide({ [N]: 'friend' }, { [N]: 'foe' }, N, true), { side: 'foe', set: true });
  assert.deepEqual(M.noteSide(null, undefined, N, true), { side: 'ally', set: false });
  assert.deepEqual(M.noteSide({}, {}, N, false), { side: 'foe', set: false });
  assert.deepEqual(M.noteSide({}, {}, 'toString', false), { side: 'foe', set: false }, 'an inherited key is no side');
  // the three users agree: a fight row, Who's here, and the players' view
  const src = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'run-sheet', ...f), 'utf8');
  assert.match(src(['web', 'state.js']), /FM\.noteSide\(/);
  assert.match(src(['players.js']), /FM\.noteSide\(/);
  assert.match(src(['web', 'fight-math.js']), /const n = noteSide\(ctx\.sides, ctx\.sidesCarried/);
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

// plan 6a fix round 1 / review M3, M4
test('a copy switched to ally still counts towards its word; an unseen ally is numbered', () => {
  const word = () => 'a mephit';
  const rows = [row({ id: 'm1', kind: 'ally', seen: true, unseenN: 1 }), row({ id: 'm2', unseenN: 2 })];
  assert.equal(M.unseenLabels(rows, word).get('m2'), 'Mephit 2');
  const n = M.unseenNumbers([row({ id: 'a', kind: 'ally', seen: false }), row({ id: 'f' })], word);
  assert.deepEqual([n.get('a'), n.get('f')], [1, 2]);
  assert.equal(M.unseenNumbers([row({ id: 'a', kind: 'ally', seen: true })], word).has('a'), false, 'a seen ally takes none');
});

// ---- plan 6a Task 7: Fight here at any place ----
{
  const path = require('node:path');
  const { readRunSheet } = require('../lib/run-sheet/read');
  const RS = require('../lib/run-sheet/web/state');
  const { forPlayers } = require('../lib/run-sheet/players');
  const FIX = path.join(__dirname, 'fixtures', 'run-sheet-app');
  const ADA = 'Characters/PCs/Ada Moss.md';
  const BEN = 'Characters/PCs/Ben Hart.md';
  const ASH = 'Characters/NPCs/Brother Ash.md';
  const FEN = 'Characters/NPCs/Sister Fen.md';
  const WOLF = 'Creatures/Frost Wolf.md';
  const STALKER = 'Creatures/Hollow Stalker.md';
  const YARD = 'Locations/The Chapel Yard.md';
  const base = readRunSheet(FIX, 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md', { party: [ADA, BEN] });
  const placeModel = () => { const m = JSON.parse(JSON.stringify(base)); m.placePeople = { ...m.placePeople, [YARD]: [ASH, FEN, WOLF, STALKER] }; return m; };
  let n = 0;
  const go = (s, a) => RS.reduce(s, { id: `pf-${++n}`, ...a }, new Date(Date.parse('2026-11-20T19:00:00Z') + n * 60000).toISOString());
  const to = (b) => ({ beat: b.key, spot: null, title: b.title });
  const atYard = (m, s) => go(s, { type: 'improvise', key: m.placeKeys[YARD], title: 'The Chapel Yard', place: YARD });

  test('a place beat\'s who comes from its people: NPCs benched, creatures ticked; no Points, no If-they', () => {
    const m = placeModel();
    const s = atYard(m, RS.emptyState({}));
    const b = RS.derive(m, s).beats.find((x) => x.key === m.placeKeys[YARD]);
    assert.deepEqual(b.who.map((w) => w.note), [ASH, FEN, WOLF, STALKER]);
    assert.deepEqual([b.points, b.ifs], [[], []]);
    const built = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: b.key, idBase: 'f1' });
    const rowOf = (note) => built.rows.find((r) => r.note === note);
    assert.deepEqual([ASH, FEN, WOLF, STALKER].map((x) => rowOf(x).in), [false, false, true, true]);
  });

  test('a place beat\'s statless person gets a blank row', () => {
    const m = placeModel();
    const s = atYard(m, RS.emptyState({}));
    const built = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: m.placeKeys[YARD], idBase: 'f2' });
    for (const [note, name] of [[FEN, 'Sister Fen'], [STALKER, 'Hollow Stalker']]) {
      const r = built.rows.find((x) => x.note === note);
      assert.ok(r, `${name} has a row`);
      assert.equal(r.name, name);
      assert.deepEqual([r.hp, r.max, r.ac], [null, null, null], 'blank: no numbers to fill in');
      assert.equal(M.sideOfRow(r), 'foe', 'its side as the reader starts it');
      assert.equal(r.seen, false, 'never seen by hand');
      assert.equal(r.word, base.withheldWords.person, 'it keeps an unseen word like any row');
      assert.ok(r.foeKey && !r.foeKey.startsWith('cast.'), 'keyed under the place beat');
    }
    // a statless person the GM set to ally starts as one, seen: the same starting rules as every row
    const s2 = { ...s, sides: { [FEN]: 'ally' } };
    const fen = M.rowsForFight({ model: m, derived: RS.derive(m, s2), state: s2, beatKey: m.placeKeys[YARD], idBase: 'f3' }).rows.find((x) => x.note === FEN);
    assert.deepEqual([fen.kind, fen.seen, fen.sideFrom], ['ally', true, 'you set it']);
    // a Plan beat's statless people stay as 5b has them: no row
    const plan = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: base.beats[0].key, idBase: 'f4' });
    assert.ok(!plan.rows.some((r) => r.note === FEN));
  });

  // Changed on purpose by final review P4.7: with nobody at the place, the fight is the place's (its groups are the
  // place alone), so the GM reads it by the place and the focused group is offered on Add; no panel shows the order
  // until a group is added.
  test('Fight here at an empty place with a split party ticks nobody, and the fight is the place\'s', () => {
    const m = placeModel();
    const [GATE, TOWER] = m.beats;
    let s = go(RS.emptyState({}), { type: 'move', pc: ADA, to: to(GATE) });
    s = go(s, { type: 'move', pc: BEN, to: to(TOWER) });
    s = atYard(m, s);
    const key = m.placeKeys[YARD];
    const built = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: key, idBase: 'f5' });
    assert.deepEqual(built.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [false, false], 'no PC stands there: nobody is ticked');
    assert.deepEqual(built.groups, [key]);
    s = RS.reduce(s, { id: 'f5', type: 'fightStart', beat: key, title: 'The Chapel Yard', groups: built.groups, rows: built.rows, thresholds: built.thresholds }, '2026-11-20T21:00:00Z');
    const v = forPlayers(m, s, { withheldWords: m.withheldWords, picId: () => '0'.repeat(20) });
    assert.equal(v.panels.length, 2);
    assert.deepEqual(v.panels.map((p) => p.order), [null, null], 'no group is in the fight yet');
    assert.deepEqual(M.fightGroupKeys(s.fight, require('../lib/run-sheet/web/show').groupsOf(m, s)), [key], 'the fight is the place\'s');
    // a PC who stands at the place is ticked, and only they
    const s2 = go(s, { type: 'move', pc: BEN, to: { beat: key, spot: null, title: 'The Chapel Yard' } });
    const b2 = M.rowsForFight({ model: m, derived: RS.derive(m, s2), state: { ...s2, fight: null }, beatKey: key, groups: [GATE.key], idBase: 'f6' });
    assert.deepEqual(b2.rows.filter((r) => r.kind === 'pc').map((r) => [r.note, r.in]), [[ADA, false], [BEN, true]]);
    assert.deepEqual(b2.groups, [key]);
  });

  // final review O2: Fight here takes the beat where a PC of the focused group stands; P4.7: with nobody there, nobody
  test('Fight here on a Plan place: the beat the group stands at, else the first unvisited with nobody ticked', () => {
    const m = placeModel();
    const GATE_NOTE = 'Locations/The Gate.md';
    const [GATE, TOWER, , GATE2] = m.beats;
    let s = go(RS.emptyState({}), { type: 'move', pc: ADA, to: to(GATE) });
    s = go(s, { type: 'move', pc: BEN, to: to(GATE) });
    assert.equal(RS.planTarget(m, s, GATE_NOTE).beat, GATE2.key, 'Move them still goes to the first unvisited');
    const t = RS.planTarget(m, s, GATE_NOTE, [ADA, BEN]);
    assert.equal(t.beat, GATE.key, 'Fight here: where Ada stands');
    const b = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: t.beat, at: t.spot || t.beat, idBase: 'o2' });
    assert.deepEqual(b.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [true, true]);
    assert.deepEqual(b.rows.filter((r) => r.kind !== 'pc' && r.kind !== 'lair').map((r) => r.name).sort(), ['Brother Ash', 'Frost Wolf', 'Frost Wolf', 'Frost Wolf', 'Lucan Grey']);
    // the party at the Bell Tower: nobody stands at The Gate
    s = go(s, { type: 'move', pc: ADA, to: to(TOWER) });
    s = go(s, { type: 'move', pc: BEN, to: to(TOWER) });
    const t2 = RS.planTarget(m, s, GATE_NOTE, [ADA, BEN]);
    assert.equal(t2.beat, GATE2.key);
    const b2 = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: t2.beat, at: t2.spot || t2.beat, idBase: 'o2b' });
    assert.deepEqual(b2.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [false, false], 'nobody is ticked');
    assert.deepEqual(b2.groups, [GATE2.key], 'the fight is the place\'s');
    // the same beat's own Fight (no `at`) still ticks everyone (proof M2)
    const b3 = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: GATE2.key, idBase: 'o2c' });
    assert.deepEqual(b3.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [true, true]);
  });

  test('"club" finds The Club', () => {
    const places = [
      { note: 'L/The Club.md', name: 'The Club', type: 'location' },
      { note: 'L/Clubhouse Row.md', name: 'Clubhouse Row', type: 'location' },
      { note: 'L/The Docks.md', name: 'The Docks', type: 'location' },
    ];
    const newPlace = (t) => `+ New place: ${t}`;
    for (const typed of ['club', 'Club', 'the club', 'THE CLUB']) {
      const c = M.addChoices(places, typed, RS.castSearch, 8, newPlace);
      assert.equal(c[0].note, 'L/The Club.md', `${typed}: The Club first`);
      assert.equal(c.at(-1).isNew, true);
      assert.equal(c.at(-1).label, `+ New place: ${typed}`, 'a new place is always the explicit last choice');
    }
    assert.equal(M.sameName('club', 'The Club'), true);
    assert.equal(M.sameName('The  club ', 'the Club'), true);
    assert.equal(M.sameName('Clubs', 'The Club'), false);
    assert.equal(M.sameName('Theatre', 'atre'), false, 'only a whole leading "the"');
    // a near spelling is offered before the new place, never made silently
    assert.equal(M.addChoices(places, 'the dcks', RS.castSearch, 8, newPlace)[0].note, 'L/The Docks.md');
  });
}

test('a foe whose block says it starts hurt (hpStart) starts there; a carried or last-fight figure wins', () => {
  const hurt = { ...imp, hpStart: 7 };
  const ally = { ...venn, hpStart: 5, hpNow: 12 };
  const npc = { ...gilt, hpStart: 9 };
  const beat = { ...gate, foes: [hurt, ally, npc], points: [], ifs: [] };
  const lastFight = (hp, max) => ({ ...here, fights: [{ id: 'old', ended: true, rows: [{ note: 'NPCs/Gilt.md', kind: 'foe', copy: 1, hp, max, conds: [] }] }] });
  const rows = (state) => M.rowsForFight({ model, derived: derivedOf({ beats: [beat, hub] }), state, beatKey: 'b1', idBase: 'a' }).rows;
  const by = (rs, note) => rs.find((x) => x.note === note);
  const r = rows(here);
  assert.deepEqual([by(r, 'Creatures/Imp.md').hp, by(r, 'Creatures/Imp.md').max], [7, 21], 'starts at its block\'s figure, max the block\'s');
  assert.equal(by(r, 'NPCs/Venn.md').hp, 12, 'the ally\'s carried figure wins');
  assert.equal(by(r, 'NPCs/Gilt.md').hp, 9, 'no last fight: the block\'s start');
  const noStart = M.rowsForFight({ model, derived: derivedOf(), state: here, beatKey: 'b1', idBase: 'a' }).rows;
  assert.equal(by(noStart, 'Creatures/Imp.md').hp, 21, 'no hpStart: full, as before');
  const last = by(rows(lastFight(4, 40)), 'NPCs/Gilt.md');
  assert.deepEqual([last.hp, last.max], [4, 40], 'an NPC with a last-fight row starts at its hp, max from the row, not hpStart');
});

test('hpStart is held to the block\'s HP when it has one, and taken as written when it has none', () => {
  const start = (foe) => {
    const beat = { ...gate, foes: [foe], points: [], ifs: [] };
    return M.rowsForFight({ model, derived: derivedOf({ beats: [beat, hub] }), state: here, beatKey: 'b1', idBase: 'a' }).rows.find((x) => x.note === foe.note);
  };
  const over = start({ ...imp, hp: 10, hpStart: 12 });
  assert.deepEqual([over.hp, over.max], [10, 10], 'HP 10 (currently 12) starts at 10');
  const open = start({ ...imp, hp: null, hpStart: 12 });
  assert.deepEqual([open.hp, open.max], [12, null], 'no HP figure: unclamped');
});

// ---- fight maths by system (step 6b Task 6) ----

const { systemFor } = require('../lib/run-sheet/systems');
const COC = systemFor('coc-7e').describe().fight;
const GURPS = systemFor('gurps-4e').describe().fight;

test('parseEntry by system', () => {
  assert.deepEqual(M.parseEntry('m-4', COC), { pool: 'mp', kind: 'damage', n: 4 });
  assert.deepEqual(M.parseEntry('M+2', COC), { pool: 'mp', kind: 'heal', n: 2 });
  assert.deepEqual(M.parseEntry('s-6', COC), { pool: 'san', kind: 'damage', n: 6 });
  assert.deepEqual(M.parseEntry('s+1', COC), { pool: 'san', kind: 'heal', n: 1 });
  assert.deepEqual(M.parseEntry('-7', COC), { pool: 'hp', kind: 'damage', n: 7 });
  assert.deepEqual(M.parseEntry('7', GURPS), { pool: 'hp', kind: 'damage', n: 7 });
  assert.deepEqual(M.parseEntry('+3', GURPS), { pool: 'hp', kind: 'heal', n: 3 });
  assert.deepEqual(M.parseEntry('f-8', GURPS), { pool: 'fp', kind: 'damage', n: 8 });
  assert.deepEqual(M.parseEntry('f+2', GURPS), { pool: 'fp', kind: 'heal', n: 2 });
  // a prefix the system lacks is invalid
  for (const bad of ['t5', 'f-8', 'e-3']) assert.equal(M.parseEntry(bad, COC), null, bad);
  for (const bad of ['t5', 'm-4', 's-6', 'e-3']) assert.equal(M.parseEntry(bad, GURPS), null, bad);
  for (const bad of ['m-4', 's-6', 'f-8']) assert.equal(M.parseEntry(bad), null, `${bad} in D&D`);
  assert.deepEqual(M.parseEntry('t5'), { pool: 'temp', kind: 'temp', n: 5 });
  const both = { ...GURPS, pools: GURPS.pools.concat(COC.pools) };
  for (const bad of ['m', 'm-', 'mm-4', 'f--8', 'f-1.5', 'f-10000', 'fm-2']) assert.equal(M.parseEntry(bad, both), null, bad);
  // a bare figure after a pool's letter is a loss, as a bare number is damage
  assert.deepEqual(M.parseEntry('f8', GURPS), { pool: 'fp', kind: 'damage', n: 8 });
});

test('afterDamage: a missing floor is 0; only an explicit null floor lets HP go below 0', () => {
  assert.deepEqual(M.afterDamage({ hp: 3, temp: 0 }, 10, {}), { hp: 0, temp: 0 });
  assert.deepEqual(M.afterDamage({ hp: 3, temp: 0 }, 10, { hpFloor: null }), { hp: -7, temp: 0 });
  assert.deepEqual(M.afterDamage({ hp: 3, temp: 0 }, 10, COC), { hp: 0, temp: 0 });
  assert.deepEqual(M.afterDamage({ hp: 3, temp: 0 }, 10, GURPS), { hp: -7, temp: 0 });
});

test('sort: GURPS ties by DX then PCs; CoC ties by the higher combat skill, then PCs; blanks last; D&D unchanged', () => {
  const ids = (rows, rules) => M.sortRows(rows, rules).map((r) => r.id);
  const g = [
    row({ id: 'blank', ini: null, dx: 15 }),
    row({ id: 'slow', ini: 5, dx: 10 }),
    row({ id: 'foeDx11', ini: 5.5, dx: 11 }),
    row({ id: 'pcDx11', kind: 'pc', ini: 5.5, dx: 11 }),
    row({ id: 'foeDx13', ini: 5.5, dx: 13 }),
    row({ id: 'fast', ini: 6.25, dx: 9 }),
    row({ id: 'off', in: false, ini: 9 }),
  ];
  assert.deepEqual(ids(g, GURPS), ['fast', 'foeDx13', 'pcDx11', 'foeDx11', 'slow', 'blank', 'off']);
  // fix round 1 changed this on purpose (coordinator's ruling): the combat skill or DX decides a tie only when both
  // rows have it; when either lacks it the tie goes to PCs first, so a PC with no figures never loses every tie
  const pcNoDx = [row({ id: 'foeDx14', ini: 5.5, dx: 14 }), row({ id: 'pcNoDx', kind: 'pc', ini: 5.5 })];
  assert.deepEqual(ids(pcNoDx, GURPS), ['pcNoDx', 'foeDx14']);
  const c = [
    row({ id: 'fighter', ini: 60, fighting: 55, firearms: 20 }),
    row({ id: 'gunman', ini: 60, fighting: 25, firearms: 70 }),
    // a PC takes its highest specialisation
    row({ id: 'pcSpec', kind: 'pc', ini: 60, fighting: { Brawl: 40, Sword: 65 }, firearms: { Handgun: 30 } }),
    row({ id: 'foeFig', ini: 50, fighting: 80 }),
    row({ id: 'pcNone', kind: 'pc', ini: 50 }),
    row({ id: 'foeA', ini: 40 }),
    row({ id: 'foeB', ini: 40, fighting: 30 }),
    row({ id: 'blank', ini: null, fighting: 90 }),
    row({ id: 'quick', ini: 75 }),
  ];
  assert.deepEqual(ids(c, COC), ['quick', 'gunman', 'pcSpec', 'fighter', 'pcNone', 'foeFig', 'foeA', 'foeB', 'blank']);
  // the combat skill is worked out on read: a figure typed since counts
  const typed = c.map((r) => (r.id === 'pcNone' ? { ...r, fighting: 70 } : r));
  assert.deepEqual(ids(typed, COC).slice(4, 6), ['foeFig', 'pcNone']);
  // D&D: the modifier, then PCs, as before; DX and combat skills mean nothing
  const d = [row({ id: 'a', ini: 12, mod: 1, dx: 18 }), row({ id: 'b', ini: 12, mod: 3 }), row({ id: 'p', kind: 'pc', ini: 12, mod: 1, fighting: 99 })];
  assert.deepEqual(ids(d), ['b', 'p', 'a']);
  assert.deepEqual(ids(d, M.DND_FIGHT_RULES), ['b', 'p', 'a']);
});

test('marksOf: Reeling and 0 or less as chips; the deepest negative line passed', () => {
  const at = (hp, max = 12) => M.marksOf({ hp, max }, GURPS);
  assert.deepEqual(at(12), { chips: [], deepest: null });
  assert.deepEqual(at(4).chips, [], 'exactly a third is not yet Reeling (B419)');
  assert.deepEqual(at(3).chips, ['Reeling']);
  assert.deepEqual(at(0).chips, ['Reeling', '0 or less']);
  assert.deepEqual(at(-11).deepest, null);
  assert.equal(at(-12).deepest.times, 1);
  assert.equal(at(-30).deepest.times, 2);
  const dead = at(-65);
  assert.equal(dead.deepest.times, 5);
  assert.equal(dead.deepest.name, '−5×HP');
  assert.deepEqual(dead.chips, ['Reeling', '0 or less']);
  // a row with no max still knows 0 or less; nothing for D&D or CoC
  assert.deepEqual(M.marksOf({ hp: -2, max: null }, GURPS), { chips: ['0 or less'], deepest: null });
  assert.deepEqual(M.marksOf({ hp: -2, max: 12 }), { chips: [], deepest: null });
  assert.deepEqual(M.marksOf({ hp: 0, max: 12 }, COC), { chips: [], deepest: null });
  assert.ok(GURPS.marks.every((m) => typeof m.name === 'string' && m.name.length <= 12), 'names and numbers only');
});

test('Reeling is not in the GURPS status list', () => {
  const d = systemFor('gurps-4e').describe();
  assert.deepEqual(d.statuses, ['Stunned', 'Prone', 'Kneeling', 'Unconscious', 'Mortal wound']);
  assert.ok(!d.statuses.includes('Reeling') && !d.statuses.includes('Shock'));
  assert.deepEqual(systemFor('coc-7e').describe().statuses, ['Major wound', 'Prone', 'Unconscious', 'Dying', 'Temporary insanity', 'Indefinite insanity']);
});

test('Tired at a third of FP', () => {
  assert.equal(M.tiredOf({ fp: 4, fpMax: 12 }, GURPS), false, 'exactly a third is not yet Tired (B426)');
  assert.equal(M.tiredOf({ fp: 3, fpMax: 12 }, GURPS), true);
  assert.equal(M.tiredOf({ fp: -3, fpMax: 12 }, GURPS), true);
  assert.equal(M.tiredOf({ fp: null, fpMax: 12 }, GURPS), false);
  assert.equal(M.tiredOf({ fp: 1, fpMax: 12 }), false, 'D&D has none');
  assert.equal(M.tiredOf({ fp: 1, fpMax: 12 }, COC), false);
});

test('the rows take the system\'s fields: initiative from DEX or Speed, the pools, the readers\' names mapped', () => {
  const build = (rules, pc, foe) => {
    const model = { rules: { fight: rules }, pcs: [pc], cast: [], beats: [{ key: 'b1', title: 'B', foes: [foe] }] };
    return M.rowsForFight({ model, derived: { beats: model.beats, vitals: [] }, state: {}, beatKey: 'b1', idBase: 'x' }).rows;
  };
  const [kev, bouncer] = build(GURPS,
    { note: 'P/Kev.md', name: 'Kev', hpNow: 10, hpMax: 12, fpNow: 9, fpMax: 11, speed: 5.25, dx: 11, ht: 10 },
    { key: 'b1.f1', note: 'N/Bouncer.md', name: 'Bouncer', hp: 12, hpStart: 10, init: 5.5, fp: 11, fpMax: 11, fpStart: 7, speed: 5.5, dx: 12, st: 12, ht: 10, dodge: 8, dr: '1', from: { fp: 'from HT' } });
  assert.deepEqual([kev.ini, kev.mod, kev.hp, kev.max, kev.fp, kev.fpMax, kev.speed, kev.dx, kev.ht], [5.25, 0, 10, 12, 9, 11, 5.25, 11, 10]);
  assert.deepEqual([bouncer.ini, bouncer.mod, bouncer.hp, bouncer.max, bouncer.fp, bouncer.fpMax, bouncer.speed, bouncer.dx, bouncer.st, bouncer.ht, bouncer.dodge, bouncer.dr],
    [5.5, 0, 10, 12, 7, 11, 5.5, 12, 12, 10, 8, '1']);
  assert.deepEqual(bouncer.from, { fp: 'from HT' });
  assert.deepEqual(bouncer.typedKeys, {});
  assert.deepEqual(bouncer.marks, []);
  const [ann, cultist] = build(COC,
    { note: 'P/Ann.md', name: 'Ann', hpNow: 9, hpMax: 11, mpNow: 10, mpMax: 12, sanNow: 55, sanMax: 60, luck: 45, dex: 70 },
    { key: 'b1.f1', note: 'N/Cultist.md', name: 'Cultist', hp: 12, init: 50, mp: 9, mpMax: 9, san: 40, sanMax: 40, dex: 50, armour: 'none', from: {} });
  assert.deepEqual([ann.ini, ann.hp, ann.max, ann.mp, ann.mpMax, ann.san, ann.sanMax, ann.luck, ann.dex], [70, 9, 11, 10, 12, 55, 60, 45, 70]);
  assert.deepEqual([cultist.ini, cultist.mod, cultist.mp, cultist.mpMax, cultist.san, cultist.sanMax, cultist.dex, cultist.armour, cultist.attacks, cultist.gun], [50, 0, 9, 9, 40, 40, 50, 0, 1, false]);
  // D&D rows keep today's numbers: no initiative until rolled, the block's modifier
  const [dpc, dfoe] = build(M.DND_FIGHT_RULES, { note: 'P/D.md', name: 'D', hpNow: 5, hpMax: 9, init: 2 }, { key: 'b1.f1', note: 'N/W.md', name: 'W', hp: 11, init: 3 });
  assert.deepEqual([dpc.ini, dpc.mod, dfoe.ini, dfoe.mod], [null, 2, null, 3]);
  assert.deepEqual(dfoe.start, { hp: 11, max: 11, conds: [], exhaustion: 0, conc: false }, 'a D&D row starts as before');
});
