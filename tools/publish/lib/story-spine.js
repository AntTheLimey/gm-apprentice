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

const WRAP_UP_TYPES = new Set(['session-wrap-up', 'session_wrap', 'session-wrapup']);

function refTarget(value) {
  if (!value) return '';
  return String(value).replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
}

// Index wrap-up pages: bySession (keyed on the session ref target) and byChapter
// (keyed on the chapter ref target, for wrap-ups with no session ref).
function buildWrapUpIndex(pages) {
  const bySession = new Map();
  const byChapter = new Map();
  for (const w of pages) {
    const t = (w.frontmatter || {}).type;
    if (!WRAP_UP_TYPES.has(t)) continue;
    const sessionRef = refTarget(w.frontmatter.session);
    if (sessionRef) {
      if (!bySession.has(sessionRef)) bySession.set(sessionRef, w);
      continue;
    }
    const chapterRef = refTarget(w.frontmatter.chapter);
    if (chapterRef && !byChapter.has(chapterRef)) byChapter.set(chapterRef, w);
  }
  return { bySession, byChapter };
}

module.exports = { findRecap, publishedOf, RECAP_TITLES, buildWrapUpIndex, refTarget, WRAP_UP_TYPES };
