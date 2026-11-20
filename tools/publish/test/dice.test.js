'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SIDES, roll, rollMany } = require('../lib/dice');

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
