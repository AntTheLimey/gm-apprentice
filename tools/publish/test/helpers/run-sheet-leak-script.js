'use strict';
// The leak test's scripted session (plan 5b Task 8), on the players' fixture: a GM evening as the GM page
// would send it, one step at a time. Each step's `run(t)` sends actions built with the fight and show
// helpers (fight-math's rowsForFight and joinRows, the SHOW_HANDLERS' action shapes) through the server's
// own `POST /api/actions`, and dice through `/api/roll`. The leak test collects what the players' half
// answers after each step and checks it.
//
// A step's `allow` names the strings that may reach the players from that step on (a person just shown, a
// true name just unmasked); `revoke` takes strings back (a Seen tick cleared). `pics` names the picture files
// the players' view may hold from then on.
// `t` is the test's handle on the running server: { model, send, state, roll, view, vault, ... }.

const M = require('../../lib/run-sheet/web/fight-math');
const RS = require('../../lib/run-sheet/web/state');

const SESSION = 'Session 03 - Next';
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const PARTY = [ADA, BEN];
const GILT = 'Characters/NPCs/Masked Gilt.md';
const ABBOT = 'Characters/NPCs/Hidden Abbot.md';
const WYRM = 'Creatures/Glacier Wyrm.md';
const MEPHIT = 'Creatures/Ice Mephit.md';
const WOLF = 'Creatures/Frost Wolf.md';
const MAP = 'Documents/Map of the Gate.md';
const GM_MAP = 'Documents/Map of the Gate (GM).md';
const MISSING = 'Characters/NPCs/Nobody Here Either.md';
const GATE_PICTURE = '_attachments/gate-place.png';

const gate = (t) => t.model.beats.find((b) => b.title === 'Ashfall Reckoning');
const hub = (t) => t.model.beats.find((b) => /^Lanternlight Crossing/.test(b.title));
const gateHouse = (t) => hub(t).spots.find((x) => x.note === 'Locations/The Gate House.md');
const rowOf = (s, note, copy = 1) => s.fight.rows.find((r) => r.note === note && (r.kind === 'pc' || r.copy === copy));

// Rolls every ticked foe and ally whose box is empty through /api/roll, as the page's Roll does; the PCs'
// own rolls are typed in. Then Sort.
async function rollAndSort(t, pcIni) {
  let { state: s } = await t.state();
  const f = s.fight;
  const want = f.rows.filter((r) => r.in && (r.kind === 'foe' || r.kind === 'ally') && r.ini == null);
  const results = await t.roll(want.map((r) => ({ sides: 20, mod: r.mod })));
  const values = Object.fromEntries(want.map((r, i) => [r.id, results[i].total]));
  const typed = Object.entries(pcIni).map(([note, ini]) => ({ type: 'setInit', fight: f.id, row: rowOf(s, note).id, ini }))
    .filter((a) => a.row);
  await t.send([{ type: 'rollInit', fight: f.id, values }, ...typed, { type: 'fightSort', fight: f.id }]);
  ({ state: s } = await t.state());
  return s;
}

async function next(t) {
  const { state: s } = await t.state();
  await t.send([{ type: 'fightNext', fight: s.fight.id, from: s.fight.turn, round: s.fight.round }]);
  return (await t.state()).state;
}

async function fightAt(t, beat, edit) {
  const { state: s } = await t.state();
  const id = t.id();
  const b = M.rowsForFight({ model: t.model, derived: RS.derive(t.model, s), state: s, beatKey: beat.key, idBase: id });
  const rows = edit ? edit(b.rows) : b.rows;
  await t.send([{ id, type: 'fightStart', beat: beat.key, title: beat.title, groups: b.groups, rows, thresholds: b.thresholds }]);
  return (await t.state()).state;
}

const STEPS = [
  {
    name: '1 two groups, one at the withheld Gate House',
    pics: ['ada.png', 'gate-place.png', 'gatehouse-room.png'],
    run: async (t) => {
      await t.send([
        { type: 'move', pc: ADA, to: { beat: gate(t).key, spot: null, title: gate(t).title } },
        { type: 'move', pc: BEN, to: { beat: hub(t).key, spot: gateHouse(t).key, title: hub(t).title } },
      ]);
    },
  },
  {
    name: '2a show Masked Gilt',
    allow: ['Masked Gilt'],
    pics: ['gilt-face.png'],
    run: async (t) => { await t.send([{ type: 'show', group: gate(t).key, note: GILT, on: true }]); },
  },
  {
    name: '2b unmask him',
    allow: ['Lucan Truename'],
    pics: ['truename-face.png'],
    run: async (t) => {
      await t.send([{ type: 'unmask', note: GILT, on: true, name: 'Lucan Truename', was: 'Masked Gilt', beat: gate(t).key, title: gate(t).title }]);
    },
  },
  {
    name: '3 show Hidden Abbot',
    run: async (t) => { await t.send([{ type: 'show', group: gate(t).key, note: ABBOT, on: true }]); },
  },
  {
    name: '4a show the player map',
    allow: ['Map of the Gate'],
    pics: ['gate-map.png'],
    run: async (t) => { await t.send([{ type: 'backdrop', group: gate(t).key, note: MAP }]); },
  },
  {
    name: '4b a backdrop naming the GM map',
    run: async (t) => { await t.send([{ type: 'backdrop', group: gate(t).key, note: GM_MAP }]); },
  },
  {
    name: '5 fight at the Gate',
    allow: ['Brother Venn'],
    run: async (t) => {
      await t.send([{ type: 'backdrop', group: gate(t).key, note: null }]);
      await fightAt(t, gate(t));
    },
  },
  {
    name: '6 roll, sort, a round with damage, Bloodied and a threshold',
    run: async (t) => {
      let s = await rollAndSort(t, { [ADA]: 15 });
      const f = s.fight.id;
      s = await next(t);
      // the wyrm to just under half: Bloodied, and the Plan's `3671 HP or less` line lights
      await t.send([
        { type: 'hp', fight: f, row: rowOf(s, WYRM).id, entry: '-3672' },
        { type: 'hp', fight: f, row: rowOf(s, ADA).id, entry: '-5' },
        { type: 'status', fight: f, row: rowOf(s, ADA).id, add: 'Prone' },
      ]);
      const live = s.fight.rows.filter((r) => r.in && !r.out).length;
      for (let i = 0; i < live; i++) s = await next(t);
    },
  },
  {
    name: '7 area damage, Pause, Resume',
    run: async (t) => {
      let { state: s } = await t.state();
      const f = s.fight.id;
      await t.send([{
        type: 'area', fight: f, amount: 2, spend: { row: rowOf(s, WYRM).id, name: 'Cold Breath' },
        hits: [{ row: rowOf(s, MEPHIT, 1).id }, { row: rowOf(s, MEPHIT, 2).id }, { row: rowOf(s, ADA).id, half: true }],
      }]);
      const [d6] = await t.roll([{ sides: 6, mod: 0 }]);
      ({ state: s } = await t.state());
      await t.send([{ type: 'rechargeRoll', fight: f, row: rowOf(s, WYRM).id, name: 'Cold Breath', roll: d6.die, round: s.fight.round }]);
      await t.send([{ type: 'fightPause', fight: f, on: true }]);
      await t.checkpoint('paused');
      await t.send([{ type: 'fightPause', fight: f, on: false }]);
    },
  },
  {
    name: '8 one mephit ticked seen',
    allow: ['Ice Mephit', 'Ice Mephit 1'],
    run: async (t) => {
      const { state: s } = await t.state();
      await t.send([{ type: 'seen', fight: s.fight.id, row: rowOf(s, MEPHIT, 1).id, on: true }]);
    },
  },
  {
    name: '8b the mephit\'s Seen tick cleared',
    revoke: ['Ice Mephit', 'Ice Mephit 1'],
    run: async (t) => {
      const { state: s } = await t.state();
      await t.send([{ type: 'seen', fight: s.fight.id, row: rowOf(s, MEPHIT, 1).id, on: false }]);
    },
  },
  {
    name: '9 the second group joins',
    run: async (t) => {
      const { state: s } = await t.state();
      const id = t.id();
      const j = M.joinRows({ model: t.model, derived: RS.derive(t.model, s), state: s, fight: s.fight, add: { group: gateHouse(t).key }, idBase: id });
      if (j.refused) throw new Error(j.refused);
      await t.send([{ id, type: 'fightJoin', fight: s.fight.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: '' }]);
      await rollAndSort(t, { [BEN]: 8 });
    },
  },
  {
    name: '10 End fight',
    run: async (t) => {
      const { state: s } = await t.state();
      await t.send([{ type: 'fightEnd', fight: s.fight.id }]);
    },
  },
  {
    name: '11 the players\' stream reconnects',
    run: async (t) => { await t.reconnect(); },
  },
  {
    name: '12 hostile state',
    run: async (t) => {
      const bad = [GM_MAP, PLAN, MISSING];
      await t.send([
        ...bad.map((note) => ({ type: 'show', group: gate(t).key, note, on: true })),
        { type: 'showBeat', group: gate(t).key, people: bad, place: GM_MAP },
        { type: 'backdrop', group: gateHouse(t).key, note: GILT },
      ]);
      // a hand-made fight (Review L1): the wyrm's row sent as an ally, a mephit's with a word of the GM's
      const s = await fightAt(t, gate(t), (rows) => rows.map((r) => {
        if (r.note === WYRM) return { ...r, kind: 'ally' };
        if (r.note === MEPHIT && r.copy === 1) return { ...r, word: 'The white dragon from the Plan' };
        return r;
      }));
      await t.checkpoint('hostile fight');
      await t.send([{ type: 'fightEnd', fight: s.fight.id }]);
    },
  },
  {
    name: '13 a second fight; Hidden Abbot ticked seen',
    run: async (t) => {
      await t.send([{ type: 'backdrop', group: gate(t).key, note: null }, { type: 'backdrop', group: gateHouse(t).key, note: null }]);
      // Frost Wolf "arrives in round three": the GM leaves it unticked when the fight starts
      const s = await fightAt(t, gate(t), (rows) => rows.map((r) => (r.note === WOLF ? { ...r, in: false } : r)));
      await t.send([{ type: 'seen', fight: s.fight.id, row: rowOf(s, ABBOT).id, on: true }]);
    },
  },
  {
    name: '14 the later creature stays unticked',
    run: async (t) => {
      await rollAndSort(t, { [ADA]: 12 });
      await next(t);
    },
  },
  {
    name: '15 errors',
    run: async (t) => {
      await t.missingPicture(GATE_PICTURE);
      const { state: s } = await t.state();
      await t.throwOnce([{ type: 'show', group: gate(t).key, note: GILT, on: false }]);
      await t.send([{ type: 'fightNext', fight: s.fight.id, from: s.fight.turn, round: s.fight.round }]);
    },
  },
];

module.exports = {
  STEPS, SESSION, PLAN, PARTY,
  NOTES: { ADA, BEN, GILT, ABBOT, WYRM, MEPHIT, WOLF, MAP, GM_MAP, MISSING },
  gate, hub, gateHouse, rowOf,
};
