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

test('an inverse name is its predicate seen from the other end', () => {
  assert.strictEqual(groupLabel('served_by', 'out'), 'Served by');
  assert.strictEqual(groupLabel('served_by', 'in'), 'Serves');
  assert.strictEqual(groupLabel('has_member', 'out'), 'Has member');
  assert.strictEqual(groupLabel('has_member', 'in'), 'Member of');
});

test('every kinship inverse reads Family both ways', () => {
  const { predicates } = require('../../lib/ontology.json');
  const inverses = predicates.filter((p) => p.category === 'kinship').map((p) => p.inverse);
  assert.ok(inverses.includes('child_of') && inverses.includes('descendant_of'));
  for (const name of inverses) {
    assert.strictEqual(groupLabel(name, 'out'), 'Family', name);
    assert.strictEqual(groupLabel(name, 'in'), 'Family', name);
  }
});

test('a symmetric kind and a name that is both a type and an inverse read as the type', () => {
  assert.strictEqual(groupLabel('friend_of', 'in'), 'Friend of');
  const { predicates } = require('../../lib/ontology.json');
  const types = new Set(predicates.map((p) => p.type));
  for (const p of predicates) {
    if (types.has(p.inverse) && p.inverse !== p.type) {
      const q = predicates.find((x) => x.type === p.inverse);
      assert.strictEqual(groupLabel(p.inverse, 'out'), groupLabel(q.type, 'out'));
    }
  }
});
