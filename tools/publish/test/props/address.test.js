const { test } = require('node:test');
const assert = require('node:assert');
const { defaultPropAddress, addressShapeProblem, takenAddresses, addressKey } = require('../../lib/props/address');

test('default address', () => {
  assert.strictEqual(defaultPropAddress('Chapters/Ch 4/Props/Ashworth Invitation.md', '.HTM'), 'props/ashworth-invitation.html');
  assert.strictEqual(defaultPropAddress('Documents/Café_Note.md', '.pdf'), 'props/cafe-note.pdf');
});

test('address shape', () => {
  for (const a of ['/props/a.html', 'props/../a.html', 'props\\a.html', 'https://x/a.html', 'props//a.html']) {
    assert.strictEqual(addressShapeProblem(a, '.html'), 'is not a relative site path', a);
  }
  assert.strictEqual(addressShapeProblem('gazetteer/papers/a.html', '.html'), null);
  assert.strictEqual(addressShapeProblem('a.htm', '.html'), null);
  assert.strictEqual(addressShapeProblem('props/a.pdf', '.html'), 'must end in .html');
});

test('addressKey folds case and normal form', () => {
  assert.strictEqual(addressKey('Café.HTML'), 'café.html');
});

test('taken addresses', () => {
  const t = takenAddresses({ pageOutputs: ['documents/letter.html'], keptDirs: [] });
  assert.ok(t.has('documents/letter.html'));
  assert.ok(t.has('CSS/x.css'));
  assert.ok(t.has('props/index.html'));
  assert.ok(t.has('NOTICE.txt'));
  assert.ok(t.has('characters/pcs/index.html'));
  assert.strictEqual(t.has('gazetteer/papers/a.html'), null);
});

test('a default address inside a kept folder is refused', () => {
  const t = takenAddresses({ pageOutputs: [], keptDirs: ['gazetteer'] });
  assert.match(t.has('gazetteer/papers/a.html'), /gazetteer/);
});

test('an explicit address inside a kept folder replaces the kept file and says so', () => {
  const t = takenAddresses({ pageOutputs: ['documents/letter.html'], keptDirs: ['gazetteer'] });
  assert.strictEqual(t.has('gazetteer/papers/a.html', { explicit: true }), null);
  assert.ok(t.has('index.html', { explicit: true }));
  assert.ok(t.has('css/x.css', { explicit: true }));
  assert.ok(t.has('documents/letter.html', { explicit: true }));
});
