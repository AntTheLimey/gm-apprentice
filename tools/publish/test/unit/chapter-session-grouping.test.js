const { describe, it } = require('node:test');
const assert = require('node:assert');
const { indexTemplate } = require('../../lib/templates/index-page');

const navFor = () => '';
const cfg = { siteTitle: 'S', footer: '' };

// #156 filed these two clauses as unreachable dead code. They are not: the index
// page is built from every page under `chapters/`, including per-chapter
// subfolders, so a session sitting in one chapter's folder while its `chapter:`
// ref names another reaches both the ref test and the folder test. What made
// them look dead is that deleting them leaves the whole suite green.
function chapterPages(sessionFrontmatter) {
  return [
    { title: 'Vienna', displayTitle: 'Vienna', outputPath: 'chapters/vienna/vienna.html',
      frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '' },
    { title: 'Calcutta', displayTitle: 'Calcutta', outputPath: 'chapters/calcutta/calcutta.html',
      frontmatter: { type: 'chapter', sort_order: 2 }, markdown: '' },
    { title: 'Session 04', displayTitle: 'Session 04', outputPath: 'chapters/calcutta/session-04.html',
      frontmatter: Object.assign({ type: 'session', session_number: 4, status: 'played' }, sessionFrontmatter),
      markdown: '' },
  ];
}

const countSession = (html) => (html.match(/Session 04/g) || []).length;

describe('chapter/session grouping', () => {
  it('files a session by its chapter ref, not also by the folder it sits in', () => {
    const html = indexTemplate('chapters', 'Chapters', chapterPages({ chapter: '[[Vienna]]' }), navFor, cfg, {}, {});
    assert.strictEqual(countSession(html), 1, 'listed under exactly one chapter');
  });

  it('still groups by folder when the session carries no chapter ref', () => {
    const html = indexTemplate('chapters', 'Chapters', chapterPages({}), navFor, cfg, {}, {});
    assert.strictEqual(countSession(html), 1, 'the folder clause still places it');
  });

  it('still groups by folder when the ref names no chapter on the page', () => {
    const html = indexTemplate('chapters', 'Chapters', chapterPages({ chapter: '[[Nowhere]]' }), navFor, cfg, {}, {});
    assert.strictEqual(countSession(html), 1, 'an unmatched ref falls back to the folder');
  });
});

// #161 review: the ref test compared `chapterTitle.includes(ref)` — the opposite
// direction from both sibling copies of this matcher (story-spine.js, build.js),
// which test whether the chapter's title appears in the ref. That backwards
// direction is what lets one ref claim two chapters.
describe('chapter reference matching is unambiguous', () => {
  const twoChapters = (chapterRef) => [
    { title: 'Vienna', displayTitle: 'Vienna', outputPath: 'chapters/vienna/vienna.html',
      frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '' },
    { title: 'The Vienna Files', displayTitle: 'The Vienna Files', outputPath: 'chapters/files/files.html',
      frontmatter: { type: 'chapter', sort_order: 2 }, markdown: '' },
    { title: 'Session 04', displayTitle: 'Session 04', outputPath: 'chapters/vienna/session-04.html',
      frontmatter: { type: 'session', session_number: 4, status: 'played', chapter: chapterRef }, markdown: '' },
  ];

  it('does not let one ref claim two chapters by substring', () => {
    const html = indexTemplate('chapters', 'Chapters', twoChapters('[[Vienna]]'), navFor, cfg, {}, {});
    assert.strictEqual((html.match(/Session 04/g) || []).length, 1, 'listed under exactly one chapter');
  });

  it('files it under the chapter the ref actually names', () => {
    const html = indexTemplate('chapters', 'Chapters', twoChapters('[[The Vienna Files]]'), navFor, cfg, {}, {});
    const idx = html.indexOf('Session 04');
    assert.ok(idx > html.indexOf('The Vienna Files'), 'sits under The Vienna Files, not Vienna');
    assert.strictEqual((html.match(/Session 04/g) || []).length, 1);
  });

  // Capability that must survive: a long descriptive ref naming a short chapter.
  // This is the direction the two sibling matchers implement.
  it('still matches a long ref that contains the chapter title', () => {
    const pages = [
      { title: 'London', displayTitle: 'London', outputPath: 'chapters/london/london.html',
        frontmatter: { type: 'chapter', title: 'London', sort_order: 1 }, markdown: '' },
      { title: 'Session 09', displayTitle: 'Session 09', outputPath: 'chapters/misfiled/session-09.html',
        frontmatter: { type: 'session', session_number: 9, status: 'played',
          chapter: '[[Chapter 1 — London: The Orphean Society]]' }, markdown: '' },
    ];
    const html = indexTemplate('chapters', 'Chapters', pages, navFor, cfg, {}, {});
    assert.strictEqual((html.match(/Session 09/g) || []).length, 1, 'the long ref still finds London');
  });
});
