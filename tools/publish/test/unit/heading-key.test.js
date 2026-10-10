const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { playerSafeMarkdown } = require('../../lib/processor');
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
  it('reads a decorated heading as the name: wide-space entities, and a zero-width character for the space', () => {
    assert.ok(titleNamedIn('GM&ensp;Notes', ['GM Notes']));
    assert.ok(titleNamedIn('GM&emsp;Notes', ['GM Notes']));
    assert.ok(titleNamedIn('GM&shy; Notes', ['GM Notes']));
    assert.ok(titleNamedIn('GM\u200bNotes', ['GM Notes']));
    assert.ok(titleNamedIn('GM&#8203;Notes', ['GM Notes']));
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

describe('a decorated hidden heading is not published', () => {
  it('whatever stands in for the space', () => {
    for (const h of ['GM&ensp;Notes', 'GM&emsp;Notes', 'GM\u200bNotes', '**GM&shy; Notes**']) {
      const got = playerSafeMarkdown('## Pub\nok\n## ' + h + '\nsecret\n## End\nx', { excludeSections: ['GM Notes'] }).text;
      assert.strictEqual(got, '## Pub\nok\n## End\nx', h);
    }
  });
});
