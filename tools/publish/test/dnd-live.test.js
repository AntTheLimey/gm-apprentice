const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../js/dnd-live.js');

const DATA = () => ({
  hpMax: 44,
  defaults: { hp: 38, temp: 0, exhaustion: 0, inspiration: true, concentrating: false, conditions: [],
    used: { 'hd:hit dice': 1, 'slot:1st': 1, 'slot:pact (3rd)': 1, 'class:channel divinity': 1, 'class:second wind': 2, 'item:wand': 2, 'ds:s': 0, 'ds:f': 0 } },
  tracks: [
    { key: 'hd:hit dice', label: 'Hit Dice', max: 5, used: 1, rest: 'long' },
    { key: 'slot:1st', label: '1st', max: 4, used: 1, rest: 'long' },
    { key: 'slot:pact (3rd)', label: 'Pact (3rd)', max: 2, used: 1, rest: 'short' },
    { key: 'class:channel divinity', label: 'Channel Divinity', max: 2, used: 1, rest: 'short1' },
    { key: 'class:second wind', label: 'Second Wind', max: 2, used: 2, rest: 'short1' },
    { key: 'item:wand', label: 'Wand', max: 7, used: 2, rest: 'none' },
    { key: 'ds:s', label: 'Death saves made', max: 3, used: 0, rest: 'reset', fill: 'made' },
    { key: 'ds:f', label: 'Death saves failed', max: 3, used: 0, rest: 'reset', fill: 'made' },
  ],
});
const fresh = () => L.fit(null, DATA());
const T = key => DATA().tracks.find(t => t.key === key);

test('fit: nothing saved gives the note\'s values', () => {
  const s = fresh();
  assert.equal(s.v, 1);
  assert.equal(s.hp, 38);
  assert.equal(s.used['slot:1st'], 1);
  assert.equal(s.inspiration, true);
});

test('fit: a saved count over a new maximum is cut to it; an unknown key is dropped; a new track starts from the note', () => {
  const s = L.fit({ hp: 99, temp: 3, used: { 'slot:1st': 9, 'class:gone': 1 } }, DATA());
  assert.equal(s.hp, 44);
  assert.equal(s.temp, 3);
  assert.equal(s.used['slot:1st'], 4);
  assert.equal('class:gone' in s.used, false);
  assert.equal(s.used['class:channel divinity'], 1);
});

test('fit: rubbish in the store cannot break the page', () => {
  const s = L.fit({ hp: 'lots', temp: -4, exhaustion: 40, conditions: 'Prone', inspiration: 'yes', used: null }, DATA());
  assert.equal(s.hp, 38);
  assert.equal(s.temp, 0);
  assert.equal(s.exhaustion, 6);
  assert.deepEqual(s.conditions, []);
  assert.equal(s.inspiration, true);
  assert.equal(s.used['hd:hit dice'], 1);
});

test('fit: no hit point maximum means no hit points', () => {
  const d = DATA(); d.hpMax = null; d.defaults.hp = null;
  assert.equal(L.fit({ hp: 12 }, d).hp, null);
});

test('damage comes off temporary hit points first', () => {
  const s = Object.assign(fresh(), { temp: 5 });
  const r = L.damage(s, 7);
  assert.deepEqual([r.state.temp, r.state.hp, r.fromTemp, r.fromHp], [0, 36, 5, 2]);
  assert.equal(s.temp, 5, 'the argument is not changed');
});

test('damage larger than everything stops at 0', () => {
  const r = L.damage(Object.assign(fresh(), { temp: 5, hp: 12 }), 40);
  assert.deepEqual([r.state.temp, r.state.hp, r.fromHp], [0, 0, 12]);
});

test('damage of nothing, or of rubbish, changes nothing', () => {
  assert.equal(L.damage(fresh(), 0).state.hp, 38);
  assert.equal(L.damage(fresh(), -3).state.hp, 38);
  assert.equal(L.damage(fresh(), NaN).state.hp, 38);
});

test('heal stops at the maximum', () => {
  const r = L.heal(fresh(), 100, DATA());
  assert.deepEqual([r.state.hp, r.gained, r.clearedDeath], [44, 6, false]);
});

test('healing from 0 clears death saves', () => {
  const s = fresh(); s.hp = 0; s.used['ds:s'] = 1; s.used['ds:f'] = 2;
  const r = L.heal(s, 5, DATA());
  assert.deepEqual([r.state.hp, r.state.used['ds:s'], r.state.used['ds:f'], r.clearedDeath], [5, 0, 0, true]);
});

test('setTemp sets, and never below 0', () => {
  assert.equal(L.setTemp(fresh(), 8).temp, 8);
  assert.equal(L.setTemp(fresh(), -2).temp, 0);
});

test('toggleMark spends an available mark and takes back a spent one', () => {
  const t = T('slot:1st');
  assert.equal(L.toggleMark(fresh(), t, true).used['slot:1st'], 2);   // a filled (available) mark was tapped
  assert.equal(L.toggleMark(fresh(), t, false).used['slot:1st'], 0);  // a hollow (spent) mark was tapped
});

test('toggleMark on death saves counts up from a hollow mark', () => {
  const t = T('ds:f');
  const one = L.toggleMark(fresh(), t, false);
  assert.equal(one.used['ds:f'], 1);
  assert.equal(L.toggleMark(one, t, true).used['ds:f'], 0);
});

test('toggleMark never leaves the range', () => {
  const t = T('class:second wind');
  assert.equal(L.toggleMark(fresh(), t, true).used['class:second wind'], 2);
});

test('filledMarks: what is left, or what is made', () => {
  assert.equal(L.filledMarks(T('slot:1st'), 1), 3);
  assert.equal(L.filledMarks(T('ds:s'), 2), 2);
});

test('setUsed clamps to the track', () => {
  assert.equal(L.setUsed(fresh(), T('item:wand'), 99).used['item:wand'], 7);
  assert.equal(L.setUsed(fresh(), T('item:wand'), -1).used['item:wand'], 0);
});

test('short rest: dice spent, hit points added, short things back, one-back things by one, the rest untouched', () => {
  const s = L.shortRest(fresh(), DATA(), { 'hd:hit dice': 2 }, 5);
  assert.equal(s.used['hd:hit dice'], 3);
  assert.equal(s.hp, 43);
  assert.equal(s.used['slot:pact (3rd)'], 0);
  assert.equal(s.used['class:channel divinity'], 0);
  assert.equal(s.used['class:second wind'], 1);
  assert.equal(s.used['slot:1st'], 1);
  assert.equal(s.used['item:wand'], 2);
});

test('short rest: cannot spend more dice than are left', () => {
  assert.equal(L.shortRest(fresh(), DATA(), { 'hd:hit dice': 99 }, 0).used['hd:hit dice'], 5);
});

test('long rest: everything the rules bring back, and nothing else', () => {
  const s0 = Object.assign(fresh(), { hp: 3, temp: 6, exhaustion: 2, concentrating: true, conditions: ['Poisoned'] });
  s0.used['ds:f'] = 1;
  const s = L.longRest(s0, DATA());
  assert.equal(s.hp, 44);
  assert.equal(s.temp, 0);
  assert.equal(s.exhaustion, 1);
  assert.equal(s.concentrating, false);
  assert.deepEqual(s.conditions, ['Poisoned']);
  assert.equal(s.inspiration, true);
  for (const k of ['hd:hit dice', 'slot:1st', 'slot:pact (3rd)', 'class:channel divinity', 'class:second wind', 'ds:f']) assert.equal(s.used[k], 0, k);
  assert.equal(s.used['item:wand'], 2);
});

test('comesBack names only what is spent and would return', () => {
  assert.deepEqual(L.comesBack(fresh(), DATA(), 'short'), ['Pact (3rd)', 'Channel Divinity', 'Second Wind']);
  assert.deepEqual(L.comesBack(fresh(), DATA(), 'long'), ['Hit Dice', '1st', 'Pact (3rd)', 'Channel Divinity', 'Second Wind']);
  assert.deepEqual(L.leftAlone(DATA()), ['Wand']);
});

test('comesBack: a long rest names marked death saves, a short rest does not', () => {
  const s = fresh();
  s.used['ds:f'] = 2;
  assert.deepEqual(L.comesBack(s, DATA(), 'long'), ['Hit Dice', '1st', 'Pact (3rd)', 'Channel Divinity', 'Second Wind', 'Death saves failed']);
  assert.deepEqual(L.comesBack(s, DATA(), 'short'), ['Pact (3rd)', 'Channel Divinity', 'Second Wind']);
});

test('fit: one of each condition whatever its capitals, the first spelling kept', () => {
  const s = L.fit({ conditions: ['Poisoned', 'poisoned', ' PRONE ', 'Prone', 'Hexed'] }, DATA());
  assert.deepEqual(s.conditions, ['Poisoned', 'PRONE', 'Hexed']);
  const d = DATA(); d.defaults.conditions = ['hexed', 'Hexed'];
  assert.deepEqual(L.fit(null, d).conditions, ['hexed']);
});

test('fit and setTemp: temporary hit points stop at 9999', () => {
  assert.equal(L.fit({ temp: 1e21 }, DATA()).temp, 9999);
  assert.equal(L.setTemp(fresh(), 1e21).temp, 9999);
  assert.equal(L.setTemp(fresh(), 9999).temp, 9999);
});

test('fit: temporary hit points or exhaustion the note wrote in words hold no number', () => {
  const d = Object.assign(DATA(), { tempLive: false, exhaustionLive: false });
  const s = L.fit({ temp: 7, exhaustion: 3 }, d);
  assert.equal(s.temp, 0);
  assert.equal(s.exhaustion, 0);
  assert.deepEqual(L.damage(Object.assign(s, { hp: 20 }), 5), { state: Object.assign(L.fit({ hp: 15 }, d)), fromTemp: 0, fromHp: 5 });
  // Missing flags mean live, as before.
  assert.equal(L.fit({ temp: 7, exhaustion: 3 }, DATA()).temp, 7);
  assert.equal(L.fit({ temp: 7, exhaustion: 3 }, DATA()).exhaustion, 3);
});

test('no hit point maximum: heal and a long rest leave hit points alone', () => {
  const d = Object.assign(DATA(), { hpMax: null });
  const s = L.fit({ temp: 4 }, d);
  const h = L.heal(s, 9, d);
  assert.equal(h.state.hp, null);
  assert.equal(h.gained, 0);
  assert.equal(h.clearedDeath, false);
  const r = L.longRest(s, d);
  assert.equal(r.hp, null);
  assert.equal(r.temp, 0);
  assert.equal(r.used['slot:1st'], 0);
});

test('short rest: hit points rolled from 0 clear death saves; none rolled leaves them', () => {
  const s = Object.assign(fresh(), { hp: 0 });
  s.used['ds:s'] = 1; s.used['ds:f'] = 2;
  const up = L.shortRest(s, DATA(), {}, 6);
  assert.equal(up.hp, 6);
  assert.equal(up.used['ds:s'], 0);
  assert.equal(up.used['ds:f'], 0);
  const still = L.shortRest(s, DATA(), {}, 0);
  assert.equal(still.hp, 0);
  assert.equal(still.used['ds:f'], 2);
});

test('statusBits: dying first, then conditions, exhaustion, concentrating, inspired', () => {
  const s = Object.assign(fresh(), { hp: 0, exhaustion: 1, concentrating: true, conditions: ['Prone'] });
  s.used['ds:s'] = 1; s.used['ds:f'] = 2;
  assert.deepEqual(L.statusBits(s), [
    { text: 'Dying: 1 saved, 2 failed', kind: 'dying' },
    { text: 'Prone', kind: 'bad' },
    { text: 'Exhaustion 1', kind: 'bad' },
    { text: 'Concentrating', kind: 'conc' },
    { text: 'Inspired', kind: 'good' },
  ]);
  assert.deepEqual(L.statusBits(Object.assign(fresh(), { inspiration: false })), []);
});

// One rule for what a condition may be, used by the page, the party board and flush
// (lib/flush/dnd-writeback.js): a saved record is public, and a name ends up in a GM's note.
test('fitConditions: strings only, trimmed, one of each, nothing that could break out of a table cell', () => {
  assert.deepEqual(L.fitConditions([' Prone ', 'prone', 7, null, {}, '', 'Hexed']), ['Prone', 'Hexed']);
  assert.deepEqual(L.fitConditions(['a|b', 'x\ny', 'x\ry', 'tab\there', 'Poisoned']), ['Poisoned']);
  assert.deepEqual(L.fitConditions(['[click](http://evil.example)', '<b>bold</b>', '[[Note]]', '`code`', 'back\\slash', 'one, two', 'Stunned']), ['Stunned']);
  assert.deepEqual(L.fitConditions(['x'.repeat(60), 'y'.repeat(61)]), ['x'.repeat(60)]);
  assert.deepEqual(L.fitConditions('Prone'), []);
  assert.deepEqual(L.fitConditions(null), []);
  // A name a GM might type is kept as typed.
  assert.deepEqual(L.fitConditions(['Poisoned (until dawn)', 'Cursed by the well', 'constructor']), ['Poisoned (until dawn)', 'Cursed by the well', 'constructor']);
});

test('fitConditions: no more than 20', () => {
  const many = Array.from({ length: 30 }, (_, i) => 'Condition ' + i);
  assert.deepEqual(L.fitConditions(many), many.slice(0, 20));
});

test('fit: conditions from the store and from the note pass the one rule', () => {
  assert.deepEqual(L.fit({ conditions: ['Prone |', 'x\n\n## Injected', 'Stunned'] }, DATA()).conditions, ['Stunned']);
  const d = DATA(); d.defaults.conditions = ['Hexed', 'a|b'];
  assert.deepEqual(L.fit(null, d).conditions, ['Hexed']);
});

test('tookText: a part that is 0 is left out', () => {
  assert.equal(L.tookText(9, 0, 9), 'Took 9.');
  assert.equal(L.tookText(3, 3, 0), 'Took 3 from temporary hit points.');
  assert.equal(L.tookText(9, 5, 4), 'Took 9: 5 from temporary hit points, 4 from hit points.');
});

test('typed: an empty field is not a 0', () => {
  assert.equal(L.typed(''), null);
  assert.equal(L.typed('   '), null);
  assert.equal(L.typed(undefined), null);
  assert.equal(L.typed('0'), 0);
  assert.equal(L.typed('7'), 7);
  assert.equal(L.typed('-4'), 0);
  assert.equal(L.typed('1e21'), 9999);
});
