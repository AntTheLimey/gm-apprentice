const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { headingKey, headingKeys, titleNamedIn } = require('../../lib/heading-key');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'heading-key-vectors.json'), 'utf8'));

describe('heading-key (shared vectors; vault_check._bare_section_title must agree)', () => {
  for (const v of VECTORS.cases) {
    it(JSON.stringify(v.title), () => {
      assert.strictEqual(headingKey(v.title), v.key);
      assert.deepStrictEqual(headingKeys(v.title), v.keys);
    });
  }
});

describe('titleNamedIn', () => {
  it('reads both sides the same way, and a link by its label and its target', () => {
    assert.ok(titleNamedIn('**GM Notes**:', [' gm notes ']));
    assert.ok(titleNamedIn('[[Secrets|Overview]]', ['Secrets']));
    assert.ok(titleNamedIn('GM Notes', ['_GM Notes_']));
  });
  it('different words are not the name', () => {
    assert.ok(!titleNamedIn('GM Notes on travel', ['GM Notes']));
    assert.ok(!titleNamedIn('GM Notes -', ['GM Notes']));
  });
  it('an empty reading names nothing', () => {
    assert.ok(!titleNamedIn('**', ['']));
    assert.ok(!titleNamedIn('GM Notes', []));
  });
});
