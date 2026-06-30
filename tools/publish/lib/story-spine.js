const path = require('path');
const { extractSections, parseWikiRef } = require('./processor');
const { slugify } = require('./scanner');

const RECAP_TITLES = ['narrative recap', 'recap'];

// The gm-only/excluded-stripped view if present (set by build.js), else raw markdown.
function publishedOf(page) {
  if (!page) return '';
  return page.publishedMarkdown != null ? page.publishedMarkdown : (page.markdown || '');
}

// Find the recap section of a page. Returns { title, html } or null.
// Heading match is a case-insensitive CONTAINS, because real vaults decorate the title
// (e.g. "What Happened — Narrative Recap"). "narrative recap" is tried before the looser
// "recap" so the more specific heading wins when both are present.
function findRecap(page) {
  const sections = extractSections(publishedOf(page));
  for (const wanted of RECAP_TITLES) {
    const hit = sections.find(s => s.title.trim().toLowerCase().includes(wanted));
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

// Recap for a unit: try its wrap-up first (the deliberate post-session/chapter recap),
// then the unit's own file. Returns { title, html, sourcePage } or null.
function resolveUnitRecap(unitPage, wrapUpPage) {
  if (wrapUpPage) {
    const r = findRecap(wrapUpPage);
    if (r) return { ...r, sourcePage: wrapUpPage };
  }
  const own = findRecap(unitPage);
  if (own) return { ...own, sourcePage: unitPage };
  return null;
}

function chapterMatchesSession(chapterPage, sessionPage) {
  const ref = refTarget(sessionPage.frontmatter.chapter);
  if (!ref) return false;
  if (ref === chapterPage.title) return true;
  if (ref === chapterPage.title.replace(/_/g, ' ')) return true;
  const norm = String(chapterPage.displayTitle || chapterPage.title).toLowerCase();
  return norm.length > 0 && ref.toLowerCase().includes(norm);
}

function folderOf(page) {
  return page && page.sourcePath ? path.dirname(page.sourcePath) : null;
}
function isUnder(childPath, dir) {
  if (!childPath || !dir) return false;
  const c = path.resolve(childPath);
  const a = path.resolve(dir);
  return c === a || c.startsWith(a + path.sep);
}

// A session belongs to a chapter if its file lives under the chapter's folder,
// falling back to the title/ref match for flat-structured vaults.
function chapterOwnsSession(chapter, session) {
  if (isUnder(session.sourcePath, folderOf(chapter))) return true;
  return chapterMatchesSession(chapter, session);
}

// The wrap-up for a unit (chapter or session): a wrap-up page in the SAME folder
// as the unit's own page (chapter wrap-up sits in the chapter folder; a session
// wrap-up sits in the session's subfolder). Falls back to the ref index.
function wrapUpForUnit(unitPage, wrapUps, idx) {
  const dir = folderOf(unitPage);
  if (dir) {
    const sameFolder = wrapUps.find(w => folderOf(w) === dir);
    if (sameFolder) return sameFolder;
  }
  return idx.bySession.get(unitPage.title)
    || idx.byChapter.get(unitPage.title)
    || idx.byChapter.get(unitPage.title.replace(/_/g, ' '))
    || null;
}

function unitOutputPath(id) { return `story/${id}.html`; }

function asList(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

// Reference metadata for a unit, parsed from its source page frontmatter.
function unitRefs(unit) {
  const fm = (unit.sourcePage && unit.sourcePage.frontmatter) || {};
  return {
    participants: asList(fm.participants).map(parseWikiRef).filter(r => r.target),
    location: fm.location ? parseWikiRef(fm.location) : null,
  };
}

function buildStorySpine(pages) {
  const chapters = pages
    .filter(p => p.frontmatter && p.frontmatter.type === 'chapter')
    .sort((a, b) => (a.frontmatter.sort_order || 0) - (b.frontmatter.sort_order || 0)
      || String(a.title).localeCompare(String(b.title)));
  const sessions = pages.filter(p => p.frontmatter && p.frontmatter.type === 'session');
  const wrapUps = pages.filter(p => p.frontmatter && WRAP_UP_TYPES.has(p.frontmatter.type));
  const idx = buildWrapUpIndex(pages);

  const units = [];
  for (const chapter of chapters) {
    const chapterWrap = wrapUpForUnit(chapter, wrapUps, idx);
    const chapterRecap = resolveUnitRecap(chapter, chapterWrap);
    // Namespace unit ids by chapter so non-unique session titles (e.g. a plain "Session 1"
    // in two chapters) can't collide on the same story/<id>.html output path.
    const chSlug = slugify(chapter.displayTitle || chapter.title);

    const chapterSessions = sessions
      .filter(s => chapterOwnsSession(chapter, s))
      .sort((a, b) => (a.frontmatter.session_number || 0) - (b.frontmatter.session_number || 0)
        || (new Date(a.frontmatter.play_date || 0)) - (new Date(b.frontmatter.play_date || 0)));

    const sessionUnits = [];
    for (const s of chapterSessions) {
      const recap = resolveUnitRecap(s, wrapUpForUnit(s, wrapUps, idx));
      if (!recap) continue;
      const id = `${chSlug}-${slugify(s.title)}`;
      sessionUnits.push({
        kind: 'session', id, outputPath: unitOutputPath(id),
        title: s.displayTitle || s.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        recapHtml: recap.html, sourcePage: recap.sourcePage,
      });
    }

    if (sessionUnits.length > 0) {
      if (chapterRecap) {
        const id = `${chSlug}-intro`;
        units.push({
          kind: 'chapter-intro', id, outputPath: unitOutputPath(id),
          title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
          chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
          recapHtml: chapterRecap.html, sourcePage: chapterRecap.sourcePage,
        });
      }
      units.push(...sessionUnits);
    } else if (chapterRecap) {
      const id = chSlug;
      units.push({
        kind: 'chapter', id, outputPath: unitOutputPath(id),
        title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        recapHtml: chapterRecap.html, sourcePage: chapterRecap.sourcePage,
      });
    }
  }

  for (let i = 0; i < units.length; i++) {
    units[i].prevHref = i > 0 ? units[i - 1].outputPath : null;
    units[i].nextHref = i < units.length - 1 ? units[i + 1].outputPath : null;
  }
  return units;
}

const FALLEN_STATUSES = new Set(['dead', 'deceased', 'kia', 'missing', 'unknown']);
function characterStoryGroup(frontmatter) {
  const s = String((frontmatter || {}).status || '').toLowerCase();
  if (s === 'retired') return 'retired';
  if (FALLEN_STATUSES.has(s)) return 'fallen';
  return 'current';
}

module.exports = { findRecap, publishedOf, RECAP_TITLES, buildWrapUpIndex, refTarget, WRAP_UP_TYPES, resolveUnitRecap, chapterMatchesSession, chapterOwnsSession, wrapUpForUnit, folderOf, isUnder, buildStorySpine, unitRefs, characterStoryGroup };
