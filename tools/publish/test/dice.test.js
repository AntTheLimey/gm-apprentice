'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SIDES, roll, rollMany, rollAgainst, rollDamage, maxDamage, rollPercent, rollSpec, rollSpecs } = require('../lib/dice');

describe('dice', () => {
  it('every die stays in range', () => {
    for (const sides of SIDES) {
      for (let i = 0; i < 10000; i++) {
        const r = roll({ sides, mod: 3 });
        assert.ok(r.die >= 1 && r.die <= sides, `${sides}: ${r.die}`);
        assert.strictEqual(r.total, r.die + 3);
        assert.strictEqual(r.sides, sides);
        assert.strictEqual(r.mod, 3);
      }
    }
  });

  it('the sizes are the seven', () => {
    assert.deepStrictEqual(SIDES, [4, 6, 8, 10, 12, 20, 100]);
  });

  it('a d20 is fair enough', () => {
    const n = 20000;
    const seen = new Array(20).fill(0);
    for (let i = 0; i < n; i++) seen[roll({ sides: 20 }).die - 1]++;
    const expected = n / 20;
    const chi = seen.reduce((sum, c) => sum + ((c - expected) ** 2) / expected, 0);
    assert.ok(chi < 64, `chi-square ${chi}`);
  });

  it('no smoothing', () => {
    const always20 = () => 20;
    const twenty = Array.from({ length: 20 }, () => roll({ sides: 19 + 1 }, { randomInt: always20 }));
    // randomInt(1, 21) is injected as 20 every time: twenty 20s, no correction
    assert.ok(twenty.every((r) => r.die === 20));
    const a = rollMany([{ sides: 6 }, { sides: 6 }], { randomInt: () => 4 });
    const b = rollMany([{ sides: 6 }, { sides: 6 }], { randomInt: () => 4 });
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(a.map((r) => r.die), [4, 4]);
  });

  it('asks randomInt for 1 to sides + 1', () => {
    const asked = [];
    roll({ sides: 12 }, { randomInt: (lo, hi) => { asked.push([lo, hi]); return lo; } });
    assert.deepStrictEqual(asked, [[1, 13]]);
  });

  it('bad sides and mods throw RangeError', () => {
    for (const bad of [{ sides: 7 }, { sides: 0 }, { sides: 1.5 }, { sides: 100.5 }, { sides: 20, mod: 100 }, { sides: 20, mod: -100 }, { sides: 20, mod: 1.5 }, { sides: '20' }]) {
      assert.throws(() => roll(bad), RangeError, JSON.stringify(bad));
    }
    assert.throws(() => roll(null), RangeError);
    assert.strictEqual(roll({ sides: 20, mod: -99 }, { randomInt: () => 1 }).total, -98);
    assert.strictEqual(roll({ sides: 20, mod: 99 }, { randomInt: () => 1 }).total, 100);
  });

  it('the dice module uses crypto', () => {
    const dir = path.join(__dirname, '..', 'lib', 'dice');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js'));
    assert.ok(files.length);
    const all = files.map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n');
    assert.match(all, /require\('node:crypto'\)/);
    assert.ok(!/Math\.random/.test(all));
  });
});

// randomInt feeding a fixed list of faces, in the order asked
const feed = (...vals) => { const q = [...vals]; return () => q.shift(); };
// three d6 summing to `total` (3-18)
const sum3 = (total) => { const a = Math.min(6, total - 2); const b = Math.min(6, total - a - 1); return feed(a, b, total - a - b); };

describe('dice: 3d6 against a target', () => {
  const outcomeAt = (target, total) => rollAgainst({ target }, { randomInt: sum3(total) }).outcome;
  const expect = (target, table) => {
    for (let total = 3; total <= 18; total++) assert.strictEqual(outcomeAt(target, total), table(total), `target ${target}, total ${total}`);
  };
  it('target 10', () => expect(10, (t) => (t <= 4 ? 'critical success' : t <= 10 ? 'success' : t >= 17 ? 'critical failure' : 'failure')));
  it('target 14', () => expect(14, (t) => (t <= 4 ? 'critical success' : t <= 14 ? 'success' : t >= 17 ? 'critical failure' : 'failure')));
  it('target 15', () => expect(15, (t) => (t <= 5 ? 'critical success' : t <= 15 ? 'success' : t >= 17 ? 'critical failure' : 'failure')));
  it('target 16', () => expect(16, (t) => (t <= 6 ? 'critical success' : t <= 16 ? 'success' : t === 18 ? 'critical failure' : 'failure')));
  it('target 17', () => expect(17, (t) => (t <= 6 ? 'critical success' : t <= 17 ? 'success' : 'critical failure')));
  it('a miss by 10 or more is a critical failure, and a target under 3 still rolls', () => {
    assert.strictEqual(outcomeAt(3, 13), 'critical failure');
    assert.strictEqual(outcomeAt(3, 12), 'failure');
    const r = rollAgainst({ target: -5 }, { randomInt: sum3(9) });
    assert.deepStrictEqual([r.total, r.margin, r.outcome], [9, -14, 'critical failure']);
    assert.strictEqual(outcomeAt(-5, 3), 'critical success');
  });
  it('shows the dice, the total and the margin', () => {
    const r = rollAgainst({ target: 12 }, { randomInt: feed(2, 3, 4) });
    assert.deepStrictEqual(r, { dice: [2, 3, 4], total: 9, target: 12, margin: 3, outcome: 'success' });
  });
  it('refuses a bad target', () => {
    for (const t of [100, -100, 1.5, '12', undefined]) assert.throws(() => rollAgainst({ target: t }), RangeError);
  });
});

describe('dice: damage dice', () => {
  it('2d+1, 3d and 1d-1 with their floors', () => {
    assert.deepStrictEqual(rollDamage('2d+1', { type: 'imp', randomInt: feed(3, 4) }), { notation: '2d+1', type: 'imp', dice: [3, 4], mod: 1, total: 8 });
    assert.strictEqual(rollDamage('3d', { randomInt: feed(1, 2, 3) }).total, 6);
    assert.strictEqual(rollDamage('1d-1', { type: 'cr', randomInt: feed(1) }).total, 0);
    assert.strictEqual(rollDamage('1d-1', { type: 'cut', randomInt: feed(1) }).total, 1);
    assert.strictEqual(rollDamage('1d-1', { randomInt: feed(1) }).total, 0, 'no type: the crushing floor');
  });
  it('CoC sums of standard dice, any case, floor 0', () => {
    const r = rollDamage('1D8+1D4', { randomInt: feed(5, 3) });
    assert.deepStrictEqual([r.dice, r.mod, r.total], [[5, 3], 0, 8]);
    assert.strictEqual(rollDamage('1d6+2', { randomInt: feed(4) }).total, 6);
    assert.strictEqual(rollDamage('2D6', { randomInt: feed(2, 6) }).total, 8);
    assert.strictEqual(rollDamage('1D3-1', { floor: 0, randomInt: feed(1) }).total, 0);
    assert.strictEqual(rollDamage('1D3-3', { floor: 0, randomInt: feed(1) }).total, 0, 'a negative damage bonus floors at 0');
  });
  it('maxDamage', () => {
    assert.strictEqual(maxDamage('1D8+1D4'), 12);
    assert.strictEqual(maxDamage('2d+1'), 13);
    assert.strictEqual(maxDamage('1d-9'), 0);
  });
  it('refuses what is not dice', () => {
    for (const bad of ['d', '', '0d6', 'd1', 'd1001', '51d6', '2d6+100', '4d6kh3', '2d6+', 'banana', '2x+1', '3', '3-1', '3d%x', 'd%%', null, 7]) assert.throws(() => rollDamage(bad), RangeError, String(bad));
    assert.throws(() => rollDamage('2d', { type: 7 }), RangeError);
  });
  it('a well-shaped entry over a limit says which limit; ill-shaped text names the forms', () => {
    const limit = 'damage is at most 50 dice, with a number from \u221299 to +99';
    for (const over of ['51d6', '30d6+21d4', '2d6+100', '2d6-100', '100+d6']) assert.throws(() => rollDamage(over), { message: limit }, over);
    for (const ill of ['d', '0d6', 'd1', 'd1001', '2d6+', 'banana', '4d6kh3', '3']) assert.throws(() => rollDamage(ill), { message: /^damage is dice like 2d6\+1,/ }, ill);
  });
  it('the refusal names the accepted forms', () => {
    assert.throws(() => rollDamage('banana'), { message: "damage is dice like 2d6+1, d8, 1D8+1D4, 2d6-1d4, d% or GURPS's 2d+1" });
  });
  it('a missing count is one, in either case', () => {
    assert.deepStrictEqual(rollDamage('d6', { randomInt: feed(4) }), { notation: 'd6', type: null, dice: [4], mod: 0, total: 4 });
    assert.strictEqual(rollDamage('D20', { randomInt: feed(17) }).total, 17);
    assert.strictEqual(rollDamage('d6+2', { type: 'cr', randomInt: feed(4) }).total, 6);
  });
  it('any number of sides from 2 to 1000', () => {
    assert.strictEqual(rollDamage('d3', { randomInt: feed(2) }).total, 2);
    assert.strictEqual(rollDamage('2d7', { randomInt: feed(7, 5) }).total, 12);
    assert.strictEqual(rollDamage('d30', { randomInt: feed(30) }).total, 30);
    assert.strictEqual(rollDamage('d2', { randomInt: feed(1) }).total, 1);
    const seen = [];
    rollDamage('d1000', { randomInt: (lo, hi) => { seen.push([lo, hi]); return hi - 1; } });
    assert.deepStrictEqual(seen, [[1, 1001]]);
    assert.strictEqual(maxDamage('d1000'), 1000);
  });
  it('d% is d100, with a count too', () => {
    const seen = [];
    const r = rollDamage('d%', { randomInt: (lo, hi) => { seen.push([lo, hi]); return 57; } });
    assert.deepStrictEqual([seen, r.total], [[[1, 101]], 57]);
    assert.strictEqual(rollDamage('3D%', { randomInt: feed(10, 20, 30) }).total, 60);
    assert.strictEqual(maxDamage('3d%'), 300);
    for (let i = 0; i < 2000; i++) { const t = rollDamage('d%').total; assert.ok(t >= 1 && t <= 100, String(t)); }
  });
  it('groups and numbers add and subtract in any order', () => {
    assert.strictEqual(rollDamage('2d6+1d8', { randomInt: feed(3, 4, 5) }).total, 12);
    assert.deepStrictEqual(rollDamage('2d6-1d4', { randomInt: feed(3, 4, 2) }), { notation: '2d6-1d4', type: null, dice: [3, 4, -2], mod: 0, total: 5 });
    assert.strictEqual(rollDamage('1d8+1d4+2', { randomInt: feed(5, 3) }).total, 10);
    assert.strictEqual(rollDamage('1D8+1D4', { randomInt: feed(5, 3) }).total, 8);
    assert.strictEqual(rollDamage('2 + d6', { randomInt: feed(3) }).total, 5, 'spaces are ignored');
  });
  it('a leading number is allowed beside a die, and the floor applies', () => {
    assert.strictEqual(rollDamage('3-1d4', { randomInt: feed(1) }).total, 2);
    assert.strictEqual(rollDamage('3-1d4', { type: 'cr', randomInt: feed(4) }).total, 0);
    assert.strictEqual(rollDamage('3-1d4', { type: 'cut', randomInt: feed(4) }).total, 1);
    assert.strictEqual(rollDamage('3-1d4', { floor: 0, randomInt: feed(4) }).total, 0);
    assert.strictEqual(maxDamage('3-1d4'), 2);
  });
  it('an empty type counts as no type: floor 0', () => {
    assert.strictEqual(rollDamage('1d-1', { type: '', randomInt: feed(1) }).total, 0);
    assert.strictEqual(maxDamage('1d-9', { type: '' }), 0);
  });
  it('maxDamage takes subtracted dice at their bottom', () => {
    assert.strictEqual(maxDamage('2d6-1d4'), 11);
    assert.strictEqual(maxDamage('2d6-3d4'), 9);
    assert.strictEqual(maxDamage('d6+d8+2'), 16);
  });
  it('{ damage, max: true } answers the faces at the top in rollDamage\'s shape, with its floor', () => {
    assert.deepStrictEqual(rollSpec({ damage: '1D6+1D4', floor: 0, max: true }), { notation: '1D6+1D4', type: null, dice: [6, 4], mod: 0, total: 10, max: true });
    assert.deepStrictEqual(rollSpec({ damage: '1D3-1D4-3', floor: 0, max: true }), { notation: '1D3-1D4-3', type: null, dice: [3, -1], mod: -3, total: 0, max: true });
    assert.throws(() => rollSpec({ damage: '1D6', floor: 0.5, max: true }), RangeError);
    assert.throws(() => rollSpec({ damage: '1D6', type: 7, max: true }), /a damage type is a short word/);
    assert.throws(() => maxDamage('1D6', { type: 'a-very-long-damage-type' }), /a damage type is a short word/);
  });
});

describe('dice: the CoC d100', () => {
  // a roll of `n` with one tens die: tens digit then units digit
  const at = (n, spec, extraTens = []) => {
    const v = n === 100 ? 0 : n;
    return rollPercent(spec, { randomInt: feed(Math.floor(v / 10), ...extraTens, v % 10) });
  };
  const level = (target, n, difficulty) => at(n, { target, difficulty }).level;
  it('levels by the fractions, rounded down, at 49 and 50', () => {
    // 49: half 24, fifth 9, fumble from 96
    assert.deepStrictEqual([1, 9, 10, 24, 25, 49, 50, 95, 96, 100].map((n) => level(49, n)),
      ['critical', 'extreme', 'hard', 'hard', 'regular', 'regular', 'fail', 'fail', 'fumble', 'fumble']);
    // 50: half 25, fifth 10, fumble 100 only
    assert.deepStrictEqual([1, 10, 11, 25, 26, 50, 51, 96, 99, 100].map((n) => level(50, n)),
      ['critical', 'extreme', 'hard', 'hard', 'regular', 'regular', 'fail', 'fail', 'fail', 'fumble']);
  });
  it('the fumble range goes by what the difficulty needs', () => {
    assert.strictEqual(at(96, { target: 55, difficulty: 'hard' }).level, 'fumble');
    assert.strictEqual(at(96, { target: 55, difficulty: 'regular' }).level, 'fail');
    assert.strictEqual(at(96, { target: 55, difficulty: 'hard' }).fumbleFrom, 96);
    assert.strictEqual(at(96, { target: 55, difficulty: 'regular' }).fumbleFrom, 100);
  });
  it('needed and passed', () => {
    const r = at(30, { target: 55, difficulty: 'hard' });
    assert.deepStrictEqual([r.needed, r.level, r.passed], [27, 'regular', false]);
    assert.strictEqual(at(27, { target: 55, difficulty: 'hard' }).passed, true);
    assert.strictEqual(at(5, { target: 55, difficulty: 'extreme' }).passed, true);
    assert.strictEqual(at(12, { target: 55, difficulty: 'extreme' }).passed, false);
    assert.strictEqual(at(1, { target: 55, difficulty: 'extreme' }).passed, true);
    assert.strictEqual(at(100, { target: 55 }).passed, false);
  });
  it('one bonus and one penalty cancel', () => {
    const r = at(40, { target: 55, bonus: 1, penalty: 1 });
    assert.deepStrictEqual([r.tens, r.bonus, r.penalty, r.asked], [[40], 0, 0, { bonus: 1, penalty: 1 }]);
  });
  it('two bonus dice keep the best tens, all shown', () => {
    const r = rollPercent({ target: 55, bonus: 2 }, { randomInt: feed(7, 2, 5, 3) });
    assert.deepStrictEqual([r.tens, r.units, r.kept, r.bonus], [[70, 20, 50], 3, 23, 2]);
  });
  it('a penalty keeps the worst tens; 00 and 0 is 100', () => {
    const r = rollPercent({ target: 55, penalty: 1 }, { randomInt: feed(2, 7, 4) });
    assert.deepStrictEqual([r.tens, r.kept, r.penalty], [[20, 70], 74, 1]);
    const z = rollPercent({ target: 55, bonus: 1 }, { randomInt: feed(0, 5, 0) });
    assert.strictEqual(z.kept, 50, 'a bonus die: 100 is the worst, so 50 is kept');
    assert.strictEqual(rollPercent({ target: 55, penalty: 1 }, { randomInt: feed(0, 5, 0) }).kept, 100);
  });
  it('three penalty dice asked: two rolled, and the result says so', () => {
    const r = rollPercent({ target: 55, penalty: 3 }, { randomInt: feed(1, 2, 3, 4) });
    assert.deepStrictEqual([r.tens.length, r.penalty, r.asked], [3, 2, { bonus: 0, penalty: 3 }]);
    const b = rollPercent({ target: 55, bonus: 4, penalty: 1 }, { randomInt: feed(1, 2, 3, 4) });
    assert.deepStrictEqual([b.tens.length, b.bonus, b.asked], [3, 2, { bonus: 4, penalty: 1 }]);
  });
  it('refuses bad input', () => {
    for (const bad of [{ target: -1 }, { target: 1.5 }, {}, { target: 50, difficulty: 'easy' }, { target: 50, bonus: -1 }, { target: 50, penalty: 1.5 }]) assert.throws(() => rollPercent(bad), RangeError, JSON.stringify(bad));
  });
});

describe('dice: the dispatcher', () => {
  it('rolls by kind', () => {
    const out = rollSpecs([{ sides: 6, mod: 1 }, { against: 10 }, { d100: { target: 50 } }, { damage: '2d+1', type: 'imp' }]);
    assert.deepStrictEqual(out.map((r) => Object.keys(r).includes('die') || Object.keys(r).includes('margin') || Object.keys(r).includes('kept') || Object.keys(r).includes('notation')), [true, true, true, true]);
    assert.strictEqual(rollSpec({ against: 10 }, { randomInt: feed(1, 1, 1) }).outcome, 'critical success');
    assert.strictEqual(rollSpec({ damage: '1d-1', type: 'cut' }, { randomInt: feed(1) }).total, 1);
    assert.strictEqual(rollSpec({ damage: '1d-1', floor: 0, type: 'cut' }, { randomInt: feed(1) }).total, 0);
  });
  it('rollMany on the old specs is as before', () => {
    assert.deepStrictEqual(rollSpecs([{ sides: 6 }, { sides: 20, mod: 2 }], { randomInt: () => 4 }), rollMany([{ sides: 6 }, { sides: 20, mod: 2 }], { randomInt: () => 4 }));
  });
  it('a bad item is refused with a sentence naming the kinds', () => {
    for (const bad of [{}, null, 'x', [], { foo: 1 }]) assert.throws(() => rollSpec(bad), /against.*d100.*damage/);
  });
});
