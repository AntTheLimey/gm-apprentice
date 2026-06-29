const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  parseBasicLift,
  formatWeight,
  computeLiftingFeats,
  slamDiceString,
  computeSlamTable,
} = require('../../../lib/templates/gurps/derived');

// ===================================================================
// parseBasicLift
// ===================================================================
describe('parseBasicLift', () => {
  it('parses "29 lbs" → 29', () => assert.strictEqual(parseBasicLift('29 lbs'), 29));
  it('parses "80 lbs" → 80', () => assert.strictEqual(parseBasicLift('80 lbs'), 80));
  it('parses "29 lb"  → 29', () => assert.strictEqual(parseBasicLift('29 lb'), 29));
  it('parses "29"     → 29', () => assert.strictEqual(parseBasicLift('29'), 29));
  it('returns null for empty string', () => assert.strictEqual(parseBasicLift(''), null));
  it('returns null for null',        () => assert.strictEqual(parseBasicLift(null), null));
});

// ===================================================================
// formatWeight
// ===================================================================
describe('formatWeight', () => {
  it('formats 160 → "160 lb"',   () => assert.strictEqual(formatWeight(160), '160 lb'));
  it('formats 1450 → "1450 lb"', () => assert.strictEqual(formatWeight(1450), '1450 lb'));
  it('formats 4000 → "2 tn"',    () => assert.strictEqual(formatWeight(4000), '2 tn'));
  it('formats 2000 → "1 tn"',    () => assert.strictEqual(formatWeight(2000), '1 tn'));
});

// ===================================================================
// computeLiftingFeats — ORACLE BL 80
// ===================================================================
describe('computeLiftingFeats BL=80', () => {
  const feats = computeLiftingFeats(80);
  it('returns 5 feats', () => assert.strictEqual(feats.length, 5));
  it('One-Handed Lift = 160 lb',   () => assert.strictEqual(feats[0].value, '160 lb'));
  it('Two-Handed Lift = 640 lb',   () => assert.strictEqual(feats[1].value, '640 lb'));
  it('Shove & Knock Over = 960 lb',() => assert.strictEqual(feats[2].value, '960 lb'));
  it('Carry on Back = 1200 lb',    () => assert.strictEqual(feats[3].value, '1200 lb'));
  it('Shift Slightly = 2 tn',      () => assert.strictEqual(feats[4].value, '2 tn'));
});

// ===================================================================
// computeLiftingFeats — ORACLE BL 29 (Ronnie Vint)
// ===================================================================
describe('computeLiftingFeats BL=29', () => {
  const feats = computeLiftingFeats(29);
  it('One-Handed Lift = 58 lb',    () => assert.strictEqual(feats[0].value, '58 lb'));
  it('Two-Handed Lift = 232 lb',   () => assert.strictEqual(feats[1].value, '232 lb'));
  it('Shove & Knock Over = 348 lb',() => assert.strictEqual(feats[2].value, '348 lb'));
  it('Carry on Back = 435 lb',     () => assert.strictEqual(feats[3].value, '435 lb'));
  it('Shift Slightly = 1450 lb',   () => assert.strictEqual(feats[4].value, '1450 lb'));
});

// ===================================================================
// slamDiceString — ORACLE HP 20 bands
// ===================================================================
describe('slamDiceString — HP 20 oracle bands', () => {
  function raw(hp, v) { return (hp * v) / 100; }
  const HP = 20;
  it('v=1 → 1d-3',  () => assert.strictEqual(slamDiceString(raw(HP, 1)), '1d-3'));
  it('v=2 → 1d-2',  () => assert.strictEqual(slamDiceString(raw(HP, 2)), '1d-2'));
  it('v=3 → 1d-1',  () => assert.strictEqual(slamDiceString(raw(HP, 3)), '1d-1'));
  it('v=4 → 1d-1',  () => assert.strictEqual(slamDiceString(raw(HP, 4)), '1d-1'));
  it('v=5 → 1d',    () => assert.strictEqual(slamDiceString(raw(HP, 5)), '1d'));
  it('v=6 → 1d',    () => assert.strictEqual(slamDiceString(raw(HP, 6)), '1d'));
  it('v=7 → 1d',    () => assert.strictEqual(slamDiceString(raw(HP, 7)), '1d'));
  it('v=8 → 2d',    () => assert.strictEqual(slamDiceString(raw(HP, 8)), '2d'));
  it('v=12 → 2d',   () => assert.strictEqual(slamDiceString(raw(HP, 12)), '2d'));
});

// ===================================================================
// computeSlamTable — distinct bands, Ronnie (HP 12, Move 6)
// ===================================================================
describe('computeSlamTable HP=12 Move=6 (Ronnie Vint)', () => {
  const rows = computeSlamTable(12, 6);
  it('has at least one row', () => assert.ok(rows.length > 0));
  it('v=1 entry exists', () => assert.ok(rows.some(r => r.velocity === 1)));
  it('all velocities ≤ 6', () => rows.forEach(r => assert.ok(r.velocity <= 6)));
  // v=1: (12×1)/100 = 0.12 → 1d-3
  it('v=1 is 1d-3', () => {
    const r = rows.find(r => r.velocity === 1);
    assert.ok(r, 'v=1 row present');
    assert.strictEqual(r.damage, '1d-3');
  });
});

// ===================================================================
// computeLiftingFeats edge cases
// ===================================================================
describe('computeLiftingFeats edge cases', () => {
  it('returns [] for null BL',  () => assert.deepStrictEqual(computeLiftingFeats(null), []));
  it('returns [] for NaN BL',   () => assert.deepStrictEqual(computeLiftingFeats(NaN), []));
});
