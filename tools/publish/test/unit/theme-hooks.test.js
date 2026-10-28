'use strict';
// The hooks the tool adds for a theme (#360), function by function: the section key, the first paragraph and the
// title and title block of a page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sectionKey, markFirstParagraph, markPage, HOOKS } = require('../../lib/theme-hooks');

test('a section key is the heading\'s words, lower case, joined by hyphens', () => {
  assert.equal(sectionKey('Current Status'), 'current-status');
  assert.equal(sectionKey('<strong>GM</strong> Notes:'), 'gm-notes');
  assert.equal(sectionKey('Friends &amp; Rivals'), 'friends-rivals');
  assert.equal(sectionKey('Investigator Skills <span class="rule"></span><span class="hint">tick on a roll</span>'), 'investigator-skills');
  assert.equal(sectionKey('<a href="x.html">Église Saint-Rémy</a>'), 'église-saint-rémy');
  assert.equal(sectionKey('<span>only a span</span>'), 'only-a-span');
  assert.equal(sectionKey('  '), '');
});

test('the first paragraph is the first one not inside a list, a quote, a callout or a table', () => {
  assert.equal(markFirstParagraph('<p>One.</p><p>Two.</p>'), '<p data-first-paragraph>One.</p><p>Two.</p>');
  assert.equal(markFirstParagraph('<div class="callout"><p>In it.</p></div>\n<ul><li><p>Item.</p></li></ul><h2>A</h2><p class="x">Body.</p>'),
    '<div class="callout"><p>In it.</p></div>\n<ul><li><p>Item.</p></li></ul><h2>A</h2><p class="x" data-first-paragraph>Body.</p>');
  assert.equal(markFirstParagraph('<blockquote><p>Q</p></blockquote>'), '<blockquote><p>Q</p></blockquote>');
  assert.equal(markFirstParagraph(''), '');
  assert.equal(markFirstParagraph('<pre>x</pre><picture></picture><p>Y</p>'), '<pre>x</pre><picture></picture><p data-first-paragraph>Y</p>');
});

test('a title inside a header block marks the block; a title on its own is the block', () => {
  const card = '<div class="char-header">\n  <img class="portrait">\n  <h1>Mara</h1>\n  <div class="meta">x</div>\n</div>\n<p>Body</p>';
  assert.equal(markPage(card), '<div class="char-header" data-title-block>\n  <img class="portrait">\n  <h1 data-page-title>Mara</h1>\n  <div class="meta">x</div>\n</div>\n<p>Body</p>');
  const nested = '<div class="hero-cinematic"><div class="pc-portrait"></div><div class="hero-cinematic-overlay"><h1>Ash</h1></div></div>';
  assert.equal(markPage(nested), '<div class="hero-cinematic" data-title-block><div class="pc-portrait"></div><div class="hero-cinematic-overlay"><h1 data-page-title>Ash</h1></div></div>');
  assert.equal(markPage('<h1 class="page-title">Story</h1>'), '<h1 class="page-title" data-page-title data-title-block>Story</h1>');
  // A header block that closed before the title does not hold it.
  assert.equal(markPage('<div class="char-header">x</div><h1>T</h1>'), '<div class="char-header">x</div><h1 data-page-title data-title-block>T</h1>');
  // Only the first title is the page's.
  assert.equal(markPage('<h1>A</h1><h1>B</h1>'), '<h1 data-page-title data-title-block>A</h1><h1>B</h1>');
});

test('each section heading carries its key; a heading with no words, or one already keyed, is left as it is', () => {
  assert.equal(markPage('<h2>Background</h2><h2 class="section">Weapons <span class="rule"></span></h2><h2> </h2><h2 data-section="x">Y</h2>'),
    '<h2 data-section="background">Background</h2><h2 class="section" data-section="weapons">Weapons <span class="rule"></span></h2><h2> </h2><h2 data-section="x">Y</h2>');
});

test('every hook is a selector with what it marks, an example and when it is written', () => {
  for (const h of HOOKS) {
    assert.ok(h.selector && h.marks && h.example, JSON.stringify(h));
    assert.ok(['always', 'switch'].includes(h.when), h.selector);
  }
  assert.equal(new Set(HOOKS.map((h) => h.selector)).size, HOOKS.length);
});
