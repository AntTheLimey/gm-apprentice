const { describe, it } = require('node:test');
const assert = require('node:assert');
const { strippedLines, playerSafeMarkdown } = require('../../lib/processor');
const { gluedBefore, valueStrays, commentFields } = require('../../lib/frontmatter');

const facts = (text) => strippedLines(text, false);
// The facts that show on a page: what playerSafeMarkdown hands back (noteFacts).
const shown = (text, options = {}) => playerSafeMarkdown(text, options);

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

describe('a hidden marker a page prints because a fence above it never closed', () => {
  it('a closed fence is nothing', () => {
    assert.strictEqual(shown('```\ncode\n```\n<!-- gm-only -->\nx\n<!-- /gm-only -->').openFence, null);
  });
  it('an unclosed fence with nothing hidden below it is nothing to report', () => {
    assert.strictEqual(shown('```\ncode\nmore').openFence, null);
  });
  it('names the fence line and the first hidden marker below it', () => {
    const got = shown('intro\n```\ncode\n<!-- gm-only -->\nsecret\n<!-- /gm-only -->\n');
    assert.deepStrictEqual(got.openFence, { line: 1, marker: 'gm-only', markerLine: 3 });
  });
  it('knows each marker kind: %%, spoiler and a plain html comment', () => {
    assert.strictEqual(shown('~~~\na\n%% c %%').openFence.marker, '%%');
    assert.strictEqual(shown('```\na\n<!-- spoiler -->\nb\n<!-- /spoiler -->').openFence.marker, 'spoiler');
    assert.strictEqual(shown('```\na\n<!-- a note -->').openFence.marker, '<!--');
  });
  it('the hidden text really is published as code', () => {
    const got = playerSafeMarkdown('```\ncode\n<!-- gm-only -->\nsecretword\n<!-- /gm-only -->\n');
    assert.ok(got.text.includes('secretword'));
    assert.ok(got.openFence);
  });
  it('a tilde fence in a note whose backtick fence closed is nothing', () => {
    assert.strictEqual(shown('```\na\n```\n\n~~~\nb\n~~~\n%% c %%').openFence, null);
  });
});

describe('percent strays in a frontmatter value', () => {
  it('gluedBefore: a digit just before the position', () => {
    assert.strictEqual(gluedBefore('100%% x', 3), true);
    assert.strictEqual(gluedBefore('a %% x', 2), false);
    assert.strictEqual(gluedBefore('%% x', 0), false);
    // A comment typed straight after a word is a comment, not a percent sign.
    assert.strictEqual(gluedBefore('é%%', 1), false);
    assert.strictEqual(gluedBefore('text%%', 4), false);
    assert.strictEqual(gluedBefore('_%%', 1), false);
  });
  it('a clean comment and a plain value are nothing', () => {
    assert.deepStrictEqual(valueStrays('Hello %% note %% there'), []);
    assert.deepStrictEqual(valueStrays('no marker'), []);
  });
  it('names the kind for a string, and finds one in a list or a nested value', () => {
    assert.deepStrictEqual(valueStrays('50%% off'), [{ kind: 'UNCLOSED', mark: '%%' }]);
    assert.deepStrictEqual(valueStrays('100%% done and 50%% off'), [{ kind: 'GLUED', mark: '%%' }]);
    assert.deepStrictEqual(valueStrays(['fine', { deep: '50%% off' }]), [{ kind: 'UNCLOSED', mark: '%%' }]);
  });
  it('commentFields lists the string leaves that hold a %% or a <!--, with a path to each', () => {
    assert.deepStrictEqual(
      commentFields({ title: 'a', note: 'x%%y', list: ['ok', 'p%%q'], deep: { k: '%% z' }, n: 3, html: 'a <!-- b' }),
      [{ field: 'note', value: 'x%%y' }, { field: 'list[1]', value: 'p%%q' }, { field: 'deep.k', value: '%% z' }, { field: 'html', value: 'a <!-- b' }]);
  });
});

describe('an HTML comment or a hidden block never closed in a frontmatter value', () => {
  it('a closed one is nothing', () => {
    assert.deepStrictEqual(valueStrays('Clerk <!-- note --> of works'), []);
    assert.deepStrictEqual(valueStrays('Clerk <!-- gm-only -->spy<!-- /gm-only --> of works'), []);
    assert.deepStrictEqual(valueStrays('Clerk <!-- SPOILER -->spy<!-- /spoiler -->'), []);
  });
  it('an unclosed one is named by its mark', () => {
    assert.deepStrictEqual(valueStrays('Clerk <!-- note'), [{ kind: 'UNCLOSED', mark: '<!--' }]);
    assert.deepStrictEqual(valueStrays('Clerk <!-- GM-Only --> spy'), [{ kind: 'UNCLOSED', mark: '<!-- gm-only -->' }]);
    assert.deepStrictEqual(valueStrays('Clerk <!-- spoiler --> spy <!-- /gm-only -->'), [{ kind: 'UNCLOSED', mark: '<!-- spoiler -->' }]);
  });
  it('one in backticks is literal', () => {
    assert.deepStrictEqual(valueStrays('write `<!--` to open one'), []);
  });
});
