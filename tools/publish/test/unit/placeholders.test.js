'use strict';
// #720: the one reading of "an unfilled template placeholder", shared by the excerpts, the sheet readers and the page.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isPlaceholder, withoutPlaceholderLines } = require('../../lib/placeholders');
const { excerptFromMarkdown } = require('../../lib/excerpt');

describe('isPlaceholder', () => {
  it('reads a whole braced line as one, and braces inside a sentence as not', () => {
    assert.equal(isPlaceholder(' {To flesh out for colour.} '), true);
    assert.equal(isPlaceholder('She said {sic} twice'), false);
    assert.equal(isPlaceholder('{a} and {b}'), false);
    assert.equal(isPlaceholder(''), false);
  });
});

describe('withoutPlaceholderLines', () => {
  it('drops lone placeholder lines and bullets, keeps the rest', () => {
    assert.equal(withoutPlaceholderLines('{Fill me}\n- {Fill me too}\nKept {as is}.\n'), 'Kept {as is}.\n');
  });
});

describe('excerptFromMarkdown', () => {
  it('skips a placeholder line and keeps braces mid-sentence', () => {
    assert.equal(excerptFromMarkdown('{To flesh out.}\n\nHe wrote {x} on it.\n'), 'He wrote {x} on it.');
  });
});
