const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { deriveGurpsMax } = require('../../lib/flush/gurps-max');

test('derives max HP/FP from a real GURPS sheet (Karl Brenner)', () => {
  const p = path.join(__dirname, '../fixtures/with-gurps-pc/Characters/PCs/Karl Brenner.md');
  const raw = fs.readFileSync(p, 'utf8');
  const { data } = matter(raw);
  assert.deepStrictEqual(deriveGurpsMax(raw, data), { maxHp: 11, maxFp: 11 });
});

test('returns nulls when the sheet has no attributes to resolve', () => {
  const raw = ['---', 'type: pc', '---', '## Current Status', '', '**Condition:** Fine.'].join('\n');
  assert.deepStrictEqual(deriveGurpsMax(raw, { type: 'pc' }), { maxHp: null, maxFp: null });
});

test('never throws on garbage input', () => {
  assert.deepStrictEqual(deriveGurpsMax(null, null), { maxHp: null, maxFp: null });
});
