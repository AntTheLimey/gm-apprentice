const { test } = require('node:test');
const assert = require('node:assert');
const gc = require('../lib/templates/gurps/gurps-calc');

test('basicLift matches Python oracles (B15)', () => {
  assert.equal(gc.basicLift(10), 20);
  assert.equal(gc.basicLift(11), 24);   // 24.2 -> nearest
  assert.equal(gc.basicLift(12), 29);   // 28.8 -> nearest
  assert.equal(gc.basicLift(13), 34);   // 33.8 -> nearest
  assert.equal(gc.basicLift(7), 9.8);   // keeps fraction below 10
});

test('encMove / encDodge match Six at Light (B17)', () => {
  assert.equal(gc.encMove(6, 0), 6);
  assert.equal(gc.encMove(6, 1), 4);   // 6*0.8
  assert.equal(gc.encMove(6, 2), 3);   // 6*0.6
  assert.equal(gc.encDodge(6.5, 0, true), 10);
  assert.equal(gc.encDodge(6.5, 1, true), 9);
});

test('encMove never below 1', () => {
  assert.equal(gc.encMove(2, 4), 1);
});

test('parry follows 3 + floor(skill/2) + CR (B376)', () => {
  assert.equal(gc.parry(16, true), 12);   // 3 + 8 + 1
  assert.equal(gc.parry(14, false), 10);  // 3 + 7
});

test('block follows 3 + floor(skill/2) + CR (B376)', () => {
  assert.equal(gc.block(16, true), 12);   // 3 + 8 + 1
  assert.equal(gc.block(14, false), 10);  // 3 + 7
});

test('encMaxWeights returns 5 thresholds for BL 34', () => {
  const w = gc.encMaxWeights(34).map(x => x.max);
  assert.deepEqual(w, [34, 68, 102, 204, 340]);
});

test('ENC_PENALIZED_SKILLS includes fencing skills', () => {
  assert.deepEqual(gc.ENC_PENALIZED_SKILLS,
    ['climbing', 'stealth', 'swimming', 'judo', 'karate',
     'rapier', 'saber', 'smallsword', 'main-gauche']);
});

test('parseWeight handles authored formats', () => {
  assert.equal(gc.parseWeight('4 lbs'), 4);
  assert.equal(gc.parseWeight('56 lbs'), 56);
  assert.equal(gc.parseWeight('0.55 lbs'), 0.55);
  assert.equal(gc.parseWeight('~2.1 lbs'), 2.1);
  assert.equal(gc.parseWeight('1 lb'), 1);
  assert.equal(gc.parseWeight('1,000 lbs'), 1000);
  assert.equal(gc.parseWeight('—'), 0);
  assert.equal(gc.parseWeight(null), 0);
});
