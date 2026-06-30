const { describe, it } = require('node:test');
const assert = require('node:assert');
const { findRecap, publishedOf, buildWrapUpIndex, resolveUnitRecap, buildStorySpine } = require('../../lib/story-spine');

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

describe('resolveUnitRecap', () => {
  const session = { title: 'Session_01', frontmatter: { type: 'session' }, markdown: '## Narrative Recap\nIN SESSION FILE' };
  const wrapUp = { title: 'Session_01_Wrap_Up', frontmatter: { type: 'session-wrap-up', session: '[[Session_01]]' }, markdown: '## Narrative Recap\nIN WRAP UP' };

  it('prefers the wrap-up recap over the unit file', () => {
    const idx = buildWrapUpIndex([session, wrapUp]);
    const r = resolveUnitRecap(session, idx.bySession.get('Session_01'));
    assert.match(r.html, /IN WRAP UP/);
  });

  it('falls back to the unit file when there is no wrap-up recap', () => {
    const r = resolveUnitRecap(session, null);
    assert.match(r.html, /IN SESSION FILE/);
  });

  it('returns null when neither has a recap', () => {
    const bare = { title: 'X', frontmatter: {}, markdown: '## Overview\nx' };
    assert.strictEqual(resolveUnitRecap(bare, null), null);
  });
});

function ch(title, sort) { return { title, displayTitle: title.replace(/_/g, ' '), frontmatter: { type: 'chapter', sort_order: sort } }; }
function sess(title, chapterRef, n, recap) {
  return { title, displayTitle: title.replace(/_/g, ' '), frontmatter: { type: 'session', chapter: `[[${chapterRef}]]`, session_number: n }, markdown: recap ? `## Narrative Recap\n${recap}` : '## Overview\nx' };
}

describe('buildStorySpine', () => {
  it('is adaptive: chapter-only, per-session, and both→intro+sessions; omits no-recap', () => {
    const pages = [
      ch('Chapter_1', 1),
      { title: 'Chapter_1_Wrap_Up', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_1]]' }, markdown: '## Narrative Recap\nCh1 whole' },
      ch('Chapter_2', 2),
      { title: 'Chapter_2_Wrap_Up', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_2]]' }, markdown: '## Narrative Recap\nCh2 intro' },
      sess('Chapter_2_S1', 'Chapter_2', 1, 'C2S1 recap'),
      sess('Chapter_2_S2', 'Chapter_2', 2, 'C2S2 recap'),
      ch('Chapter_3', 3),
      sess('Chapter_3_S1', 'Chapter_3', 1, null),
    ];
    const spine = buildStorySpine(pages);
    assert.deepStrictEqual(
      spine.map(u => u.kind + ':' + u.title),
      ['chapter:Chapter 1', 'chapter-intro:Chapter 2', 'session:Chapter 2 S1', 'session:Chapter 2 S2'],
    );
  });

  it('chains prev/next across the whole spine', () => {
    const pages = [
      ch('Chapter_1', 1),
      { title: 'C1WU', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_1]]' }, markdown: '## Recap\na' },
      ch('Chapter_2', 2),
      { title: 'C2WU', frontmatter: { type: 'session-wrap-up', chapter: '[[Chapter_2]]' }, markdown: '## Recap\nb' },
    ];
    const spine = buildStorySpine(pages);
    assert.strictEqual(spine[0].prevHref, null);
    assert.strictEqual(spine[0].nextHref, spine[1].outputPath);
    assert.strictEqual(spine[1].prevHref, spine[0].outputPath);
    assert.strictEqual(spine[1].nextHref, null);
  });
});
