const { describe, it } = require('node:test');
const assert = require('node:assert');
const { findRecap, publishedOf, buildWrapUpIndex } = require('../../lib/story-spine');

describe('findRecap', () => {
  it('extracts the Narrative Recap H2 section as HTML', () => {
    const page = { markdown: '## Overview\nstuff\n\n## Narrative Recap\nThe party arrived in **London**.\n\n## GM Notes\nsecret' };
    const r = findRecap(page);
    assert.ok(r, 'should find a recap');
    assert.match(r.html, /The party arrived/);
    assert.match(r.html, /<strong>London<\/strong>/);
    assert.ok(!/GM Notes/.test(r.html), 'must not bleed into the next section');
  });

  it('falls back to a plain "Recap" heading', () => {
    const page = { markdown: '## Recap\nShort recap text.' };
    assert.match(findRecap(page).html, /Short recap text/);
  });

  it('returns null when there is no recap section', () => {
    assert.strictEqual(findRecap({ markdown: '## Overview\nno recap here' }), null);
  });

  it('prefers publishedMarkdown over raw markdown', () => {
    const page = { markdown: '## Narrative Recap\nRAW', publishedMarkdown: '## Narrative Recap\nPUBLISHED' };
    assert.match(findRecap(page).html, /PUBLISHED/);
    assert.ok(!/RAW/.test(findRecap(page).html));
  });
});

describe('buildWrapUpIndex', () => {
  const pages = [
    { title: 'Session_01', frontmatter: { type: 'session' } },
    { title: 'Session_01_Wrap_Up', frontmatter: { type: 'session-wrap-up', session: '[[Session_01]]' }, markdown: '## Narrative Recap\nS1 recap' },
    { title: 'Chapter_1_Wrap_Up', frontmatter: { type: 'session_wrap', chapter: '[[Chapter_1_Overview]]' }, markdown: '## Narrative Recap\nCh1 recap' },
  ];
  it('keys session wrap-ups by their session ref target', () => {
    const idx = buildWrapUpIndex(pages);
    assert.strictEqual(idx.bySession.get('Session_01').title, 'Session_01_Wrap_Up');
  });
  it('keys chapter wrap-ups (no session ref) by their chapter ref target', () => {
    const idx = buildWrapUpIndex(pages);
    assert.strictEqual(idx.byChapter.get('Chapter_1_Overview').title, 'Chapter_1_Wrap_Up');
  });
});
