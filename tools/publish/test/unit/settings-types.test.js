'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TYPES, readSwitch } = require('../../lib/settings/types');

test('a switch takes the six words, any case, quoted or padded', () => {
  for (const w of [true, 'true', 'TRUE', ' yes ', 'On']) assert.equal(readSwitch(w), true, String(w));
  for (const w of [false, 'false', 'No', ' OFF ']) assert.equal(readSwitch(w), false, String(w));
  assert.equal(readSwitch(undefined), undefined);
  for (const w of [null, 'maybe', 1, 0, [], {}]) assert.equal(readSwitch(w), null, JSON.stringify(w));
});

test('a choice trims and lower-cases, and maps its aliases', () => {
  const entry = { values: ['tree', 'web', 'cards', 'off'], aliases: { true: 'tree', on: 'tree', yes: 'tree', false: 'off', no: 'off' } };
  assert.deepEqual(TYPES.choice.read(' Web ', entry), { ok: true, value: 'web' });
  assert.deepEqual(TYPES.choice.read(true, entry), { ok: true, value: 'tree' });
  assert.deepEqual(TYPES.choice.read('no', entry), { ok: true, value: 'off' });
  assert.deepEqual(TYPES.choice.read('graph', entry), { ok: false });
  assert.equal(TYPES.choice.takes(entry), 'tree, web, cards or off');
});

test('a number reads digits written as text and refuses the rest', () => {
  const entry = { integer: true, min: 0 };
  assert.deepEqual(TYPES.number.read(0, entry), { ok: true, value: 0 });
  assert.deepEqual(TYPES.number.read('3', entry), { ok: true, value: 3 });
  for (const bad of ['lots', -1, 2.5, null, true, '']) assert.deepEqual(TYPES.number.read(bad, entry), { ok: false }, JSON.stringify(bad));
  assert.equal(TYPES.number.takes(entry), 'a whole number, 0 or more');
});

test('a list takes a list of plain entries, read as text', () => {
  assert.deepEqual(TYPES.list.read(['a', 'b'], {}), { ok: true, value: ['a', 'b'] });
  assert.deepEqual(TYPES.list.read([], {}), { ok: true, value: [] });
  assert.deepEqual(TYPES.list.read(['a', 1, true], {}), { ok: true, value: ['a', '1', 'true'] });
  for (const bad of ['a', null, { a: 1 }, ['a', null], ['a', ['b']], ['a', {}]]) assert.deepEqual(TYPES.list.read(bad, {}), { ok: false }, JSON.stringify(bad));
});

test('switchOrList is a switch or a list of names', () => {
  assert.deepEqual(TYPES.switchOrList.read('yes', {}), { ok: true, value: true });
  assert.deepEqual(TYPES.switchOrList.read(['Note', 'tip'], {}), { ok: true, value: ['Note', 'tip'] });
  assert.deepEqual(TYPES.switchOrList.read('some', {}), { ok: false });
  assert.deepEqual(TYPES.switchOrList.read(['note', 2], {}), { ok: true, value: ['note', '2'] });
  assert.deepEqual(TYPES.switchOrList.read(['note', null], {}), { ok: false });
});

test('a map takes a plain map; text and any take what they say', () => {
  assert.deepEqual(TYPES.map.read({ a: 1 }, {}), { ok: true, value: { a: 1 } });
  for (const bad of [[], 'x', null]) assert.deepEqual(TYPES.map.read(bad, {}), { ok: false });
  assert.deepEqual(TYPES.text.read(' Title ', {}), { ok: true, value: ' Title ' });
  assert.deepEqual(TYPES.text.read(1925, {}), { ok: true, value: 1925 });
  assert.deepEqual(TYPES.text.read(['x'], {}), { ok: false });
  assert.deepEqual(TYPES.any.read(['x'], {}), { ok: true, value: ['x'] });
});
