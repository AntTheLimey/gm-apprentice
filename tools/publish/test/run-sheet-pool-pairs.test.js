'use strict';
// A foe's pool written current over maximum (`HP 4/12`), inline or in a table, and below 0 in GURPS: the maximum is
// the second figure and the fight starts at the first, both from the one declaration (CodeRabbit on #887).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { systemFor } = require('../lib/run-sheet/systems');

const index = { read: () => ({ fm: { type: 'npc' }, body: '' }) };
const read = (id, block) => {
  const r = systemFor(id).readFoe({ notePath: 'x.md', index, text: `## Stats\n\n${block}\n` });
  return { hp: r.nums.hp, hpStart: r.hpStart, fp: r.nums.fp === undefined ? null : r.nums.fp, fpStart: r.fpStart === undefined ? null : r.fpStart };
};

describe('pools written current over maximum', () => {
  it('CoC: `HP 4/12` inline and in a table is 12, starting at 4; `HP 12 (currently 4)` as before', () => {
    assert.deepEqual(read('coc-7e', '**HP** 4/12 · **DEX** 50'), { hp: 12, hpStart: 4, fp: null, fpStart: null });
    assert.deepEqual(read('coc-7e', '| Stat | Value |\n|---|---|\n| HP | 4/12 |\n| DEX | 50 |'), { hp: 12, hpStart: 4, fp: null, fpStart: null });
    assert.deepEqual(read('coc-7e', '**HP** 12 (currently 4) · **DEX** 50'), { hp: 12, hpStart: 4, fp: null, fpStart: null });
    assert.deepEqual(read('coc-7e', '**HP** 12 · **DEX** 50'), { hp: 12, hpStart: null, fp: null, fpStart: null });
  });
  it('GURPS: `| HP | 6/12 |` and `| FP | 4/10 |` start at 6 and 4; `HP -2/12` starts at -2; `FP 10 (currently 4)` as before', () => {
    assert.deepEqual(read('gurps-4e', '| Stat | Value |\n|---|---|\n| HP | 6/12 |\n| FP | 4/10 |'), { hp: 12, hpStart: 6, fp: 10, fpStart: 4 });
    assert.deepEqual(read('gurps-4e', '**HP** -2/12 · **FP** 10 (currently 4)'), { hp: 12, hpStart: -2, fp: 10, fpStart: 4 });
    assert.deepEqual(read('gurps-4e', '**HP** 12 · **FP** 10'), { hp: 12, hpStart: null, fp: 10, fpStart: null });
  });
});
