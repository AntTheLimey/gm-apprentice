const { describe, it } = require('node:test');
const assert = require('node:assert');
const { strippedLines, playerSafeMarkdown } = require('../../lib/processor');
const { gluedBefore, percentStrays, percentFields } = require('../../lib/frontmatter');

const facts = (text) => strippedLines(text, false);

describe('strippedLines reports a stray %% from the strip it already runs', () => {
  it('a clean comment is no stray', () => {
    assert.deepStrictEqual(facts('a %% note %% b\n\nmore').strays, []);
    assert.deepStrictEqual(facts('%%\nblock\n%%\nafter').strays, []);
  });
  it('an opener never closed is UNCLOSED, on the line of the original note', () => {
    const got = facts('one\ntwo\ntext %% open\nhidden\nmore');
    assert.deepStrictEqual(got.strays, [{ line: 2, kind: 'UNCLOSED' }]);
  });
  it('a pair whose opener is glued to the word before it is GLUED', () => {
    const got = facts('We were 100%% done and 50%% off.\n');
    assert.deepStrictEqual(got.strays, [{ line: 0, kind: 'GLUED' }]);
  });
  it('a glued opener that never closes is UNCLOSED (the worse reading)', () => {
    assert.deepStrictEqual(facts('x\nabout 50%% off\ny').strays, [{ line: 1, kind: 'UNCLOSED' }]);
  });
  it('a comment after a gm-only block still reports the original line', () => {
    const got = facts('<!-- gm-only -->\nsecret\n<!-- /gm-only -->\nlate 9%% x\nend');
    assert.deepStrictEqual(got.strays, [{ line: 3, kind: 'UNCLOSED' }]);
  });
  it('a %% inside a gm-only block, a code fence, a code span or an html comment is no stray', () => {
    assert.deepStrictEqual(facts('<!-- gm-only -->\n50%% x\n<!-- /gm-only -->\nok').strays, []);
    assert.deepStrictEqual(facts('```\n50%% x\n```\nok').strays, []);
    assert.deepStrictEqual(facts('use `50%%` here\nok').strays, []);
    assert.deepStrictEqual(facts('<!-- 50%% -->\nok').strays, []);
  });
  it('a glued opener inside a comment that closes normally later is judged by its own opener', () => {
    assert.deepStrictEqual(facts('%% a 50%% b\nok').strays, []);
  });
  it('playerSafeMarkdown hands the same facts back', () => {
    assert.deepStrictEqual(playerSafeMarkdown('a 50%% b').strays, [{ line: 0, kind: 'UNCLOSED' }]);
  });
});

describe('strippedLines reports an unclosed fence with a hidden marker below it', () => {
  it('a closed fence is nothing', () => {
    assert.strictEqual(facts('```\ncode\n```\n<!-- gm-only -->\nx\n<!-- /gm-only -->').openFence, null);
  });
  it('an unclosed fence with nothing hidden below it is nothing to report', () => {
    assert.strictEqual(facts('```\ncode\nmore').openFence, null);
  });
  it('names the fence line and the first hidden marker below it', () => {
    const got = facts('intro\n```\ncode\n<!-- gm-only -->\nsecret\n<!-- /gm-only -->\n');
    assert.deepStrictEqual(got.openFence, { line: 1, marker: 'gm-only', markerLine: 3 });
  });
  it('knows each marker kind: %%, spoiler and a plain html comment', () => {
    assert.strictEqual(facts('~~~\na\n%% c %%').openFence.marker, '%%');
    assert.strictEqual(facts('```\na\n<!-- spoiler -->\nb\n<!-- /spoiler -->').openFence.marker, 'spoiler');
    assert.strictEqual(facts('```\na\n<!-- a note -->').openFence.marker, '<!--');
  });
  it('the hidden text really is published as code', () => {
    const got = playerSafeMarkdown('```\ncode\n<!-- gm-only -->\nsecretword\n<!-- /gm-only -->\n');
    assert.ok(got.text.includes('secretword'));
    assert.ok(got.openFence);
  });
  it('a tilde fence in a note whose backtick fence closed is nothing', () => {
    assert.strictEqual(facts('```\na\n```\n\n~~~\nb\n~~~\n%% c %%').openFence, null);
  });
});

describe('percent strays in a frontmatter value', () => {
  it('gluedBefore: a letter or number just before the position', () => {
    assert.strictEqual(gluedBefore('100%% x', 3), true);
    assert.strictEqual(gluedBefore('a %% x', 2), false);
    assert.strictEqual(gluedBefore('%% x', 0), false);
    assert.strictEqual(gluedBefore('é%%', 1), true);
    assert.strictEqual(gluedBefore('_%%', 1), false);
  });
  it('a clean comment and a plain value are nothing', () => {
    assert.deepStrictEqual(percentStrays('Hello %% note %% there'), []);
    assert.deepStrictEqual(percentStrays('no marker'), []);
  });
  it('names the kind for a string, and finds one in a list or a nested value', () => {
    assert.deepStrictEqual(percentStrays('50%% off'), ['UNCLOSED']);
    assert.deepStrictEqual(percentStrays('100%% done and 50%% off'), ['GLUED']);
  });
  it('percentFields lists the string leaves that hold a %%, with a path to each', () => {
    assert.deepStrictEqual(
      percentFields({ title: 'a', note: 'x%%y', list: ['ok', 'p%%q'], deep: { k: '%% z' }, n: 3 }),
      [{ field: 'note', value: 'x%%y' }, { field: 'list[1]', value: 'p%%q' }, { field: 'deep.k', value: '%% z' }]);
  });
});
