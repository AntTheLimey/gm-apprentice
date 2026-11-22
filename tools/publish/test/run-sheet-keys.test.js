'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../lib/run-sheet/keys');

test('renumbering a scene keeps its key', () => {
  const a = k.beatKeys([{ title: 'Scene 1: The Gate', contingency: false }]);
  const b = k.beatKeys([{ title: 'Scene 7: The Gate (hub)', contingency: false }]);
  assert.deepEqual(a, b);
  assert.match(a[0], /^b-[0-9a-f]{10}$/);
});

test('a contingency beat starts c-', () => {
  assert.match(k.beatKeys([{ title: 'If they flee', contingency: true }])[0], /^c-[0-9a-f]{10}$/);
});

test('two beats with one title get distinct keys', () => {
  const [a, b, c] = k.beatKeys([
    { title: 'Scene 1: The Gate' }, { title: 'Scene 2: Other' }, { title: 'Scene 4: The Gate' },
  ]);
  assert.notEqual(a, b);
  assert.equal(c, a + '~2');
});

test('markup and spacing do not change a key', () => {
  assert.equal(k.textHash('**Find the  KEY**'), k.textHash('find the key'));
  assert.equal(k.textHash('_find_ `the` key '), k.textHash('Find the key'));
});

test('a link and its label give the same key', () => {
  assert.equal(k.textHash('Meet [[Mara Vell|the smith]]'), k.textHash('Meet [[Mara Vell]]'));
});

test('ticking a checkbox keeps the key', () => {
  assert.equal(k.textHash('- [ ] Open the door'), k.textHash('- [x] Open the door'));
  assert.equal(k.textHash('- [ ] Open the door'), k.textHash('Open the door'));
});

test('NFC and NFD give one key', () => {
  assert.equal(k.textHash('González'), k.textHash('González'));
});

test('reordering keeps each item\'s key', () => {
  const ab = k.itemKeys('b-1', 'pt', ['a', 'b']);
  const ba = k.itemKeys('b-1', 'pt', ['b', 'a']);
  assert.equal(ab[0], ba[1]);
  assert.equal(ab[1], ba[0]);
});

test('same text, different kinds, different keys', () => {
  assert.notEqual(k.itemKeys('b-1', 'pt', ['x'])[0], k.itemKeys('b-1', 'if', ['x'])[0]);
});

test('duplicate text in one kind gets ~2', () => {
  const [a, b, c] = k.itemKeys('b-1', 'loot', ['gold', 'gold', 'gold']);
  assert.equal(b, a + '~2');
  assert.equal(c, a + '~3');
});

test('a foe count above one numbers the foes, and raising it keeps the first key', () => {
  assert.equal(k.itemKeys('b', 'foe', ['x'])[0], k.itemKeys('b', 'foe', ['x', 'x'])[0]);
  assert.equal(k.itemKeys('b', 'foe', ['x', 'x'])[1], k.itemKeys('b', 'foe', ['x'])[0] + '~2');
});

test('renaming a beat changes item keys but not their textHash', () => {
  const [a] = k.itemKeys('b-aaaaaaaaaa', 'pt', ['do it']);
  const [b] = k.itemKeys('b-bbbbbbbbbb', 'pt', ['do it']);
  assert.notEqual(a, b);
  assert.equal(a.split('.').pop(), b.split('.').pop());
  assert.equal(a.split('.').pop(), k.textHash('do it'));
});

test('personKey', () => {
  assert.equal(k.personKey('NPCs/Mara.md'), 'p-' + k.textHash('NPCs/Mara.md'));
});

test('odd input never throws; an empty title still gets a key', () => {
  assert.match(k.beatKeys([{ title: '' }, {}, null])[0], /^b-[0-9a-f]{10}$/);
  assert.equal(new Set(k.beatKeys([{ title: '' }, {}])).size, 2);
  assert.equal(k.textHash(undefined), k.textHash(''));
  assert.deepEqual(k.itemKeys('b', 'pt', null), []);
  assert.equal(k.itemKeys('b', 'pt', [null])[0], 'b.pt.' + k.textHash(''));
  assert.deepEqual(k.beatKeys(null), []);
  assert.match(k.personKey(undefined), /^p-/);
});

// plan 6a Task 7 / review P2: a place beat's key holds no dot, so the key grammar (beat key, then `.item`) holds
test('a place note with a dot in its stem keys and remaps', () => {
  const RS = require('../lib/run-sheet/web/state');
  const ST_MARY = "Locations/St. Mary's Yard.v2.md";
  const key = k.placeKey(ST_MARY);
  assert.match(key, /^pl-[0-9a-f]{8}$/);
  assert.equal(key, k.placeKey(ST_MARY), 'the same note, the same key');
  assert.notEqual(key, k.placeKey('Locations/St Marys Yard.md'));
  let n = 0;
  const go = (s, a) => RS.reduce(s, { id: `k-${++n}`, ...a }, '2026-11-20T19:00:00.000Z');
  let s = RS.emptyState({});
  s = go(s, { type: 'improvise', key, title: "St. Mary's Yard", place: ST_MARY });
  s = go(s, { type: 'move', pc: 'Ada.md', to: { beat: key, spot: null, title: "St. Mary's Yard" } });
  s = go(s, { type: 'jot', beat: key, text: 'a bell rings' });
  s = go(s, { type: 'mark', point: `${key}.pt.abc`, mark: 'landed', beat: key });
  // attach the place beat to another key: everything under it follows, and a later action on the old key too
  s = go(s, { type: 'attach', from: key, to: 'b-0000000000' });
  assert.equal(s.positions['Ada.md'].beat, 'b-0000000000');
  assert.equal(s.jots[0].beat, 'b-0000000000');
  assert.ok(s.points['b-0000000000.pt.abc']);
  s = go(s, { type: 'mark', point: `${key}.pt.def`, mark: 'missed', beat: key });
  assert.ok(s.points['b-0000000000.pt.def'], 'a queued action on the old key is remapped');
  assert.equal(s.points['b-0000000000.pt.def'].beat, 'b-0000000000');
});
