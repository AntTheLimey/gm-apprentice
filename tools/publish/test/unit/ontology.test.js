'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { toneFamily, groupLabel } = require('../../lib/ontology');

test('a tone word gives its family', () => {
  assert.strictEqual(toneFamily('devoted'), 'warm');
  assert.strictEqual(toneFamily(' Hostile '), 'hostile');
  assert.strictEqual(toneFamily('professional'), 'neutral');
});

test('a word off the list is neutral; no tone is none', () => {
  assert.strictEqual(toneFamily('cordial'), 'neutral');
  assert.strictEqual(toneFamily(5), 'neutral');
  assert.strictEqual(toneFamily('constructor'), 'neutral');
  for (const none of [undefined, null, '', '  ']) assert.strictEqual(toneFamily(none), null);
});

test('a kind is worded by its direction', () => {
  assert.strictEqual(groupLabel('serves', 'out'), 'Serves');
  assert.strictEqual(groupLabel('serves', 'in'), 'Served by');
  assert.strictEqual(groupLabel('member_of', 'in'), 'Has member');
});

test('kinship is Family both ways; a symmetric kind has one wording', () => {
  assert.strictEqual(groupLabel('parent_of', 'out'), 'Family');
  assert.strictEqual(groupLabel('parent_of', 'in'), 'Family');
  assert.strictEqual(groupLabel('knows', 'in'), 'Knows');
});

test('a kind the ontology lacks is read as written', () => {
  assert.strictEqual(groupLabel('owes_money_to', 'out'), 'Owes money to');
  assert.strictEqual(groupLabel('owes_money_to', 'in'), 'Owes money to (named by)');
  assert.strictEqual(groupLabel('', 'out'), 'Connected');
  assert.strictEqual(groupLabel(undefined, 'in'), 'Connected');
  assert.strictEqual(groupLabel('__proto__', 'out'), 'Proto');
});
