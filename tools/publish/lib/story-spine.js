const { extractSections } = require('./processor');

const RECAP_TITLES = ['narrative recap', 'recap'];

// The gm-only/excluded-stripped view if present (set by build.js), else raw markdown.
function publishedOf(page) {
  if (!page) return '';
  return page.publishedMarkdown != null ? page.publishedMarkdown : (page.markdown || '');
}

// Find the recap section of a page. Returns { title, html } or null.
function findRecap(page) {
  const sections = extractSections(publishedOf(page));
  for (const wanted of RECAP_TITLES) {
    const hit = sections.find(s => s.title.trim().toLowerCase() === wanted);
    if (hit && hit.html && hit.html.trim()) return { title: hit.title, html: hit.html };
  }
  return null;
}

module.exports = { findRecap, publishedOf, RECAP_TITLES };
