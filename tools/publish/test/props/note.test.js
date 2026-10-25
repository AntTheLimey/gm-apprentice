const { test } = require('node:test');
const assert = require('node:assert');
const { isPropNote, propKindOf, propFileOf, propAddressOf } = require('../../lib/props/note');

test('isPropNote', () => {
  assert.strictEqual(isPropNote({ type: 'prop' }), true);
  assert.strictEqual(isPropNote({ type: 'document', prop_file: 'a.html' }), true);
  assert.strictEqual(isPropNote({ type: 'handout', prop_file: '  ' }), false);
  assert.strictEqual(isPropNote({ type: 'reference', prop: 'x.html', prop_look: 'form' }), false);
  assert.strictEqual(isPropNote({ type: 'document' }), false);
});

test('propKindOf', () => {
  assert.strictEqual(propKindOf({ type: 'prop' }), 'document');
  assert.strictEqual(propKindOf({ type: 'prop', prop_kind: 'Container' }), 'container');
  assert.strictEqual(propKindOf({ type: 'prop', prop_kind: 'scroll' }), 'document');
  assert.strictEqual(propKindOf({ type: 'handout', prop_file: 'a.pdf', prop_kind: 'object' }), 'document');
});

test('propFileOf and propAddressOf trim and null out empties', () => {
  assert.strictEqual(propFileOf({ prop_file: ' a.html ' }), 'a.html');
  assert.strictEqual(propFileOf({ prop_file: '' }), null);
  assert.strictEqual(propFileOf({ prop_file: 3 }), null);
  assert.strictEqual(propAddressOf({ prop_address: ' x/y.html ' }), 'x/y.html');
  assert.strictEqual(propAddressOf({}), null);
});

test('propKindOf knows all five kinds, and only a prop type chooses one', () => {
  assert.strictEqual(propKindOf({ type: 'prop', prop_kind: 'object' }), 'object');
  assert.strictEqual(propKindOf({ type: 'prop', prop_kind: 'diagram' }), 'diagram');
  assert.strictEqual(propKindOf({ type: 'prop', prop_kind: 'supplied' }), 'supplied');
  assert.strictEqual(propKindOf({ type: 'document', prop_file: 'a.html', prop_kind: 'container' }), 'document');
});
