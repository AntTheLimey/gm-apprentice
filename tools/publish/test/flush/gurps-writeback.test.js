const { test } = require('node:test');
const assert = require('node:assert');
const { applyGURPSFlush } = require('../../lib/flush/gurps-writeback');

const MAX = { maxHp: 11, maxFp: 11 };

function block(bodyLines) {
  return ['# Karl', '', '## Current Status', '', ...bodyLines, '', '---', '', '## Equipment', ''].join('\n');
}

test('updates an existing HP line in place, preserving /max and note', () => {
  const md = block(['**HP:** 12/12 (bruised)', '**Condition:** Unharmed.']);
  const { markdown, changes } = applyGURPSFlush(md, { hp: 7, updatedAt: 1 }, MAX);
  assert.match(markdown, /\*\*HP:\*\* 7\/12 \(bruised\)/);
  assert.deepStrictEqual(changes, [{ field: 'HP', from: '12', to: '7' }]);
});

test('injects HP and FP before the first label line when absent', () => {
  const md = block(['**Condition:** Unharmed.', '**Location:** The market.']);
  const { markdown, changes } = applyGURPSFlush(md, { hp: 7, fp: 9, updatedAt: 1 }, MAX);
  const lines = markdown.split('\n');
  const cIdx = lines.indexOf('**Condition:** Unharmed.');
  assert.strictEqual(lines[cIdx - 2], '**HP:** 7/11');
  assert.strictEqual(lines[cIdx - 1], '**FP:** 9/11');
  assert.deepStrictEqual(changes, [
    { field: 'HP', from: null, to: '7' },
    { field: 'FP', from: null, to: '9' },
  ]);
});

test('injects before first non-blank prose when block has no label line', () => {
  const md = block(['He is fine.']);
  const { markdown } = applyGURPSFlush(md, { hp: 7, fp: 9, updatedAt: 1 }, MAX);
  const lines = markdown.split('\n');
  const pIdx = lines.indexOf('He is fine.');
  assert.strictEqual(lines[pIdx - 2], '**HP:** 7/11');
  assert.strictEqual(lines[pIdx - 1], '**FP:** 9/11');
});

test('is idempotent: re-running with the same current value makes no change', () => {
  const md = block(['**HP:** 7/11', '**FP:** 9/11', '**Condition:** Unharmed.']);
  const { markdown, changes } = applyGURPSFlush(md, { hp: 7, fp: 9, updatedAt: 1 }, MAX);
  assert.strictEqual(markdown, md);
  assert.deepStrictEqual(changes, []);
});

test('no max + absent line → update-in-place only, never injects', () => {
  const md = block(['**Condition:** Unharmed.']);
  const { markdown, changes } = applyGURPSFlush(md, { hp: 7, fp: 9, updatedAt: 1 }, { maxHp: null, maxFp: null });
  assert.strictEqual(markdown, md);
  assert.deepStrictEqual(changes, []);
});

test('no-op on absent/malformed blob or non-numeric vitals', () => {
  const md = block(['**HP:** 12/12']);
  assert.deepStrictEqual(applyGURPSFlush(md, null, MAX).changes, []);
  assert.deepStrictEqual(applyGURPSFlush(md, { hp: 'x' }, MAX).changes, []);
  assert.strictEqual(applyGURPSFlush(md, {}, MAX).markdown, md);
});

test('no Current Status heading → returns markdown unchanged', () => {
  const md = ['# Karl', '', '## Equipment', ''].join('\n');
  const { markdown, changes } = applyGURPSFlush(md, { hp: 7 }, MAX);
  assert.strictEqual(markdown, md);
  assert.deepStrictEqual(changes, []);
});
