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
