'use strict';
// tools/publish/test/leak-gate/text.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, wordsOf, piecesOfMarkdown, piecesOfValue, commentsOf, MIN_WORDS } = require('../../lib/leak-gate/text');

describe('leak gate: text', () => {
  it('folds quotes, dashes, case, spacing and Unicode form', () => {
    assert.equal(normalize('Don’t  tell—the DUKE'), "don't tell-the duke");
    assert.equal(normalize('Café'), normalize('Café'));
  });
  it('drops a note\'s own private-use characters and U+FFFD without splitting the word', () => {
    assert.deepEqual(wordsOf('Forged 0HIDFORGE'), ['forged', '0hidforge']);
    assert.deepEqual(wordsOf('Forged 0�HIDFORGE'), ['forged', '0hidforge']);
  });
  it('splits a block into sentences, list items and table cells of four words or more', () => {
    const md = [
      'The duke poisoned the well. He fled north.',
      '',
      '- the cult meets on Fridays',
      '- short item',
      '',
      '| Who | What |',
      '|---|---|',
      '| Vex | sold the map to the cult |',
      '',
      '## A heading is not a piece',
      '',
      '> [!secret] Keeper',
      '> The vicar knows the truth.',
    ].join('\n');
    assert.deepEqual(piecesOfMarkdown(md), [
      'The duke poisoned the well.',
      'the cult meets on Fridays',
      'sold the map to the cult',
      'The vicar knows the truth.',
    ]);
    assert.equal(MIN_WORDS, 4);
  });
  it('reads a link by its label and drops emphasis', () => {
    assert.deepEqual(piecesOfMarkdown('She met [[Lord Vane|the old lord]] at **the** quay.'), ['She met the old lord at the quay.']);
  });
  it('reads a sentence as the page prints it: an inline picture embed is not words, an entity is its character (M10)', () => {
    assert.deepEqual(piecesOfMarkdown('The ![[seal.png]] lies under the old altar.').map(wordsOf), [['the', 'lies', 'under', 'the', 'old', 'altar']]);
    assert.deepEqual(piecesOfMarkdown('The vicar&apos;s key opens the crypt.').map(wordsOf), [["the", "vicar's", 'key', 'opens', 'the', 'crypt']]);
  });
  // Words that never print must not join a hidden piece: a comment's words glued into the sentence around it would make
  // a piece no page holds, and a leak of the sentence alone would go unfound. Each comment is read three ways: gone, as
  // the page reads it (the sentence around it joined); as an edge (the text on each side its own piece); and as its own
  // text. The note as written is still read too, so no piece it gave before is lost.
  describe('comments are no words of the text around them', () => {
    const pieces = (md) => piecesOfMarkdown(md).map((p) => wordsOf(p).join(' '));
    const has = (md, ...want) => { const got = pieces(md); for (const w of want) assert.ok(got.includes(w), `${JSON.stringify(w)} in ${JSON.stringify(got)}`); };
    it('a gm-only fence written tight to its text', () => {
      has('<!-- gm-only -->\nThe cook poisoned the soup\n<!-- /gm-only -->\nThe wake went on all night', 'the cook poisoned the soup', 'the wake went on all night');
      has('<!-- gm-only -->\r\nThe cook poisoned the soup\r\n<!-- /gm-only -->\r\nThe wake went on all night', 'the cook poisoned the soup');
    });
    it('a line that is one HTML comment: the sentence around it joined, as the page prints it', () => {
      has('The vicar met the cook\n<!-- check name -->\nat the old mill.', 'the vicar met the cook at the old mill');
      has('The cook did it\n<!-- -->\nat the mill tonight.', 'the cook did it at the mill tonight');
    });
    it('a line that is one %% comment', () => {
      has('The vicar met the cook\n%% check %%\nat the old mill.', 'the vicar met the cook at the old mill');
    });
    it('a comment in the middle of a line, either kind', () => {
      has('The vicar met <!-- check --> the cook at the mill.', 'the vicar met the cook at the mill');
      has('The vicar met %%check%% the cook at the mill.', 'the vicar met the cook at the mill');
    });
    it('a comment over several lines whose first line carries text', () => {
      has('The vicar met the cook\n<!-- keeper: check\nthe name twice -->\nat the old mill.', 'the vicar met the cook at the old mill', 'keeper check the name twice');
      has('The vicar met the cook\n%% keeper: check\nthe name twice %%\nat the old mill.', 'the vicar met the cook at the old mill', 'keeper check the name twice');
    });
    it('a comment\'s own text is a piece of its own', () => {
      has('Before the wake began\n<!-- the cook keeps a second ledger -->', 'before the wake began', 'the cook keeps a second ledger');
    });
    it('the note as written is still read: no piece it gave before is lost', () => {
      has('The cook\n%% did %%\nit at noon', 'the cook did it at noon');
    });
    it('one comment is one <!-- to the next -->: two on a line are two', () => {
      assert.deepEqual(commentsOf('<!-- the baker poisoned the mayor --> and the text between them <!-- the vicar keeps a ledger -->').texts,
        [' the baker poisoned the mayor ', ' the vicar keeps a ledger ']);
    });
    it('a comment never closed runs to the end of the note', () => {
      assert.deepEqual(commentsOf('Open text here <!-- the baker poisoned\nthe mayor').texts, [' the baker poisoned\nthe mayor']);
      assert.deepEqual(commentsOf('Open text here %% the baker poisoned\nthe mayor').texts, [' the baker poisoned\nthe mayor']);
    });
  });
  it('an underscore parts words, as on the page: a link to Edmund_Courtney prints two words', () => {
    assert.deepEqual(piecesOfMarkdown('She met [[Edmund_Courtney]] at the _old_ snake_case quay.').map(wordsOf),
      [['she', 'met', 'edmund', 'courtney', 'at', 'the', 'old', 'snake', 'case', 'quay']]);
  });
  it('takes every string of a frontmatter value', () => {
    assert.deepEqual(piecesOfValue({ target: '[[Vex]]', description: 'pays the harbourmaster every week' }), ['pays the harbourmaster every week']);
  });
});
