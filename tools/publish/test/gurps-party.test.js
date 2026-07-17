// tools/publish/test/gurps-party.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const gp = require('../js/gurps-party.js');

test('groupLatestByPc picks the max-updatedAt state per pcSlug', () => {
  const states = {
    'loadout:c:six:d1': { v: 'v1', hp: { cur: 9, max: 13 }, updatedAt: 100 },
    'loadout:c:six:d2': { v: 'v1', hp: { cur: 4, max: 13 }, updatedAt: 300 },  // newest
    'loadout:c:six:CODE': { v: 'v1', hp: { cur: 7, max: 13 }, updatedAt: 200 },
    'loadout:c:rock:d1': { v: 'v1', hp: { cur: 3, max: 10 }, updatedAt: 50 },
  };
  const out = gp.groupLatestByPc(states);
  assert.deepEqual(Object.keys(out).sort(), ['rock', 'six']);
  assert.equal(out.six.hp.cur, 4);      // d2 wins (updatedAt 300)
  assert.equal(out.rock.hp.cur, 3);
});

test('groupLatestByPc treats a missing updatedAt as oldest (0)', () => {
  const states = {
    'loadout:c:six:d1': { v: 'v1', hp: { cur: 9, max: 13 } },                 // no updatedAt → 0
    'loadout:c:six:d2': { v: 'v1', hp: { cur: 4, max: 13 }, updatedAt: 1 },   // wins
  };
  assert.equal(gp.groupLatestByPc(states).six.hp.cur, 4);
});

test('rowCells: healthy view → Ready status, no reeling/tired class, plain stats', () => {
  const view = { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, encLevel: 0, encName: 'None',
    move: { base: 6, enc: 6, cur: 6 }, dodge: { enc: 10, cur: 10 }, st: { base: 13, cur: 13 }, reeling: false, tired: false };
  const c = gp.rowCells(view);
  assert.equal(c.rowClass, '');
  assert.match(c.status, /Ready/);
  assert.match(c.move, /6/);
  assert.doesNotMatch(c.move, /→|gl-was/);   // no strikethrough arrow
  assert.match(c.hp, /13/);
});

test('rowCells: reeling+tired → both class, badges, Move current/basic, ST arrow', () => {
  const view = { hp: { cur: 3, max: 10 }, fp: { cur: 3, max: 12 }, encLevel: 0, encName: 'None',
    move: { base: 6, enc: 5, cur: 2 }, dodge: { enc: 8, cur: 2 }, st: { base: 10, cur: 5 }, reeling: true, tired: true };
  const c = gp.rowCells(view);
  assert.equal(c.rowClass, 'both');
  assert.match(c.status, /Reeling/);
  assert.match(c.status, /Tired/);
  assert.match(c.move, /2/);         // current present
  assert.match(c.move, /gl-of/);     // shown as current/basic
  assert.match(c.move, /6/);         // basic present
  assert.match(c.st, /10/);          // ST arrow shown (tired)
  assert.match(c.st, /5/);
});

test('rowCells: reeling only → reeling class, no ST arrow', () => {
  const view = { hp: { cur: 3, max: 10 }, fp: { cur: 11, max: 11 }, encLevel: 0, encName: 'None',
    move: { base: 6, enc: 6, cur: 3 }, dodge: { enc: 10, cur: 5 }, st: { base: 10, cur: 10 }, reeling: true, tired: false };
  const c = gp.rowCells(view);
  assert.equal(c.rowClass, 'reeling');
  assert.doesNotMatch(c.status, /Tired/);
  assert.doesNotMatch(c.st, /→|base/);   // ST unchanged under reeling → plain
});
