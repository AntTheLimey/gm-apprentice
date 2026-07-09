const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createRenderer } = require('../../lib/markdown');

const md = createRenderer();

describe('obsidian callouts (issue #86a)', () => {
  it('renders a titled callout as a styled div, not literal [!type] text', () => {
    const html = md.render('> [!info] Reconstruction Note\n> The record is partial.');
    assert.match(html, /<div class="callout callout-info">/);
    assert.match(html, /<div class="callout-title">Reconstruction Note<\/div>/);
    assert.match(html, /<p>The record is partial\.<\/p>/);
    assert.doesNotMatch(html, /\[!info\]/);
  });

  it('falls back to the callout type as title when none is given', () => {
    const html = md.render('> [!tip]\n> Only a body.');
    assert.match(html, /<div class="callout-title">Tip<\/div>/);
    assert.match(html, /<p>Only a body\.<\/p>/);
  });

  it('ignores the fold marker on the type', () => {
    const html = md.render('> [!note]- Folded\n> body');
    assert.match(html, /<div class="callout callout-note">/);
    assert.match(html, /<div class="callout-title">Folded<\/div>/);
  });

  it('keeps separate body paragraphs separate', () => {
    const html = md.render('> [!warning] Heads up\n>\n> One.\n>\n> Two.');
    assert.match(html, /<p>One\.<\/p>/);
    assert.match(html, /<p>Two\.<\/p>/);
  });

  it('leaves an ordinary blockquote alone', () => {
    const html = md.render('> Just an ordinary quote.');
    assert.match(html, /<blockquote>/);
    assert.doesNotMatch(html, /callout/);
  });

  it('lowercases the type for the class but keeps typographer on the title', () => {
    const html = md.render('> [!Warning] DRAFT -- player-side\n> body');
    assert.match(html, /class="callout callout-warning"/);
    assert.match(html, /<div class="callout-title">DRAFT – player-side<\/div>/);
  });

  it('still renders inline markup inside a callout title', () => {
    const html = md.render('> [!note] A **bold** title\n> body');
    assert.match(html, /<div class="callout-title">A <strong>bold<\/strong> title<\/div>/);
  });
});
