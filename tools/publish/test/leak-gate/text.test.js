'use strict';
// tools/publish/test/leak-gate/text.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, wordsOf, piecesOfMarkdown, piecesOfValue, MIN_WORDS } = require('../../lib/leak-gate/text');

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
  it('takes every string of a frontmatter value', () => {
    assert.deepEqual(piecesOfValue({ target: '[[Vex]]', description: 'pays the harbourmaster every week' }), ['pays the harbourmaster every week']);
  });
});
