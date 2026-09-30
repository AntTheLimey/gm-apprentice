const path = require('path');
const { extractSections, parseWikiRef, resolveWikiLinks, publishedSource } = require('./processor');
const { slugify } = require('./scanner');
const { canonicalNfc } = require('./unicode');
const { isLinkedWrapUp, WRAP_UP_TYPES } = require('./session-hub');
const { isSessionHub } = require('./processor');

const RECAP_TITLES = ['narrative recap', 'recap'];

// The gm-only/excluded-stripped view if present (set by build.js), else raw markdown.
const publishedOf = publishedSource;

// Find the recap section of a page. Returns { title, html } or null.
// Heading match is a case-insensitive CONTAINS, because real vaults decorate the title
// (e.g. "What Happened — Narrative Recap"). "narrative recap" is tried before the looser
// "recap" so the more specific heading wins when both are present.
function findRecap(page, resolve) {
  const text = publishedOf(page);
  const sections = extractSections(resolve ? resolve(text) : text);
  for (const wanted of RECAP_TITLES) {
    const hit = sections.find(s => s.title.trim().toLowerCase().includes(wanted));
    if (hit && hit.html && hit.html.trim()) return { title: hit.title, html: hit.html };
  }
  return null;
}

// Every `session:`/`chapter:` ref in this file is author-typed and is compared against a
// filename-derived title through a Map key or `===`. Canonicalizing here (#139) covers the
// write side of both indexes and the ref in chapterMatchesSession; the reads below
// canonicalize the title they look up with. A Map is not a plain object, so nfcLookupTable
// cannot carry this — it has to be done at the call sites.
function refTarget(value) {
  if (!value) return '';
  return canonicalNfc(String(value).replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim());
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
function resolveUnitRecap(unitPage, wrapUpPage, resolve) {
  if (wrapUpPage) {
    const r = findRecap(wrapUpPage, resolve);
    if (r) return { ...r, sourcePage: wrapUpPage };
  }
  const own = findRecap(unitPage, resolve);
  if (own) return { ...own, sourcePage: unitPage };
  return null;
}

function chapterMatchesSession(chapterPage, sessionPage) {
  const ref = refTarget(sessionPage.frontmatter.chapter);
  if (!ref) return false;
  const title = canonicalNfc(chapterPage.title);
  if (ref === title) return true;
  if (ref === title.replace(/_/g, ' ')) return true;
  const norm = canonicalNfc(chapterPage.displayTitle || chapterPage.title).toLowerCase();
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

// The wrap-up for a unit (chapter or session). For a session it is the Wrap-Up the build
// paired with it (`pairs`, session-hub.js pairHubs — the one rule that also decides
// whether the hub body is withheld, so the Saga and the session page tell the same
// story); the Saga never pairs a session on its own. For a chapter, a Wrap-Up whose
// chapter: ref names it. The same-folder fallback (chapter wrap-up in the chapter folder;
// session wrap-up in the session's subfolder) only applies when that folder holds exactly
// ONE wrap-up — in flat vaults every session shares one Sessions/ folder, and a
// first-match grab there would hand the same wrap-up to every session — and, for a
// session, only when that Wrap-Up is linked to no session at all (isLinkedWrapUp): a
// Wrap-Up linked to one session never stands in for another.
function wrapUpForUnit(unitPage, wrapUps, idx, pairs) {
  const title = canonicalNfc(unitPage.title);
  const hub = isSessionHub(unitPage);
  const byRef = hub
    ? (pairs && pairs.get(unitPage)) || null
    : idx.bySession.get(title)
      || idx.byChapter.get(title)
      || idx.byChapter.get(title.replace(/_/g, ' '));
  if (byRef) return byRef;
  const dir = folderOf(unitPage);
  if (dir) {
    const sameFolder = wrapUps.filter(w => folderOf(w) === dir);
    if (sameFolder.length === 1 && !(hub && isLinkedWrapUp(sameFolder[0], pairs))) return sameFolder[0];
  }
  return null;
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

function sortedChapters(pages) {
  return pages
    .filter(p => p.frontmatter && p.frontmatter.type === 'chapter')
    .sort((a, b) => (a.frontmatter.sort_order || 0) - (b.frontmatter.sort_order || 0)
      || String(a.title).localeCompare(String(b.title)));
}

function bySessionNumber(a, b) {
  return (a.frontmatter.session_number || 0) - (b.frontmatter.session_number || 0)
    || (new Date(a.frontmatter.play_date || 0)) - (new Date(b.frontmatter.play_date || 0));
}

// The prev/next order sessions always had: sort_order, else session_number, stable.
function sessionNavKey(p) {
  return p.frontmatter.sort_order || p.frontmatter.session_number || 0;
}

// Every session page in prev/next order. The old order (sessionNavKey across the whole
// vault) interleaved chapters, because numbering restarts per chapter: Ch1 S1, Ch2 S1,
// Ch1 S2… So the sessions a chapter owns are regrouped chapter by chapter (chapters by
// sort_order, each chapter's sessions by sessionNavKey), and put back into the slots
// chaptered sessions held in the old order. A session no chapter owns keeps its old slot
// — a "Session 0" prologue stays first — and a vault with no chapters keeps exactly the
// order it had. Cached per `pages` array.
const sessionOrders = new WeakMap();
function orderedSessions(pages) {
  let order = sessionOrders.get(pages);
  if (order) return order;
  const old = pages.filter(p => p.frontmatter && p.frontmatter.type === 'session')
    .sort((a, b) => sessionNavKey(a) - sessionNavKey(b));
  const seen = new Set();
  const chaptered = [];
  for (const chapter of sortedChapters(pages)) {
    for (const s of old.filter(x => !seen.has(x) && chapterOwnsSession(chapter, x))) {
      seen.add(s);
      chaptered.push(s);
    }
  }
  let next = 0;
  order = old.map(s => (seen.has(s) ? chaptered[next++] : s));
  sessionOrders.set(pages, order);
  return order;
}

// `pairs` is the build's hub -> Wrap-Up map (session-hub.js pairHubs), computed once on
// the unreduced frontmatter; without it no session pairs with a Wrap-Up.
function buildStorySpine(pages, linkMap, pairs) {
  // Recap markdown renders to HTML inside findRecap, so wiki-links must resolve here —
  // downstream has no markdown left to work with. Resolution is relative to the unit's
  // own output path under story/. Without a linkMap (the hasStory probe), skip it.
  const resolverFor = linkMap
    ? (outputPath) => (md) => resolveWikiLinks(md, linkMap, outputPath)
    : () => undefined;
  const chapters = sortedChapters(pages);
  const sessions = pages.filter(p => p.frontmatter && p.frontmatter.type === 'session');
  const wrapUps = pages.filter(p => p.frontmatter && WRAP_UP_TYPES.has(p.frontmatter.type));
  const idx = buildWrapUpIndex(pages);

  const units = [];
  for (const chapter of chapters) {
    // Namespace unit ids by chapter so non-unique session titles (e.g. a plain "Session 1"
    // in two chapters) can't collide on the same story/<id>.html output path.
    const chSlug = slugify(chapter.displayTitle || chapter.title);
    const chapterWrap = wrapUpForUnit(chapter, wrapUps, idx, pairs);
    // The chapter recap lands on either story/<chSlug>-intro.html or story/<chSlug>.html;
    // both live in story/, so either path yields the same relative link resolution.
    const chapterRecap = resolveUnitRecap(chapter, chapterWrap, resolverFor(unitOutputPath(chSlug)));

    const chapterSessions = sessions
      .filter(s => chapterOwnsSession(chapter, s))
      .sort(bySessionNumber);

    const sessionUnits = [];
    for (const s of chapterSessions) {
      const id = `${chSlug}-${slugify(s.title)}`;
      const recap = resolveUnitRecap(s, wrapUpForUnit(s, wrapUps, idx, pairs), resolverFor(unitOutputPath(id)));
      if (!recap) continue;
      sessionUnits.push({
        kind: 'session', id, outputPath: unitOutputPath(id),
        title: s.displayTitle || s.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        // recap TEXT can come from a wrap-up, but ref metadata (participants/location) is
        // read from the unit's OWN page — the wrap-up typically doesn't carry those fields.
        recapHtml: recap.html, sourcePage: s,
      });
    }

    if (sessionUnits.length > 0) {
      if (chapterRecap) {
        const id = `${chSlug}-intro`;
        units.push({
          kind: 'chapter-intro', id, outputPath: unitOutputPath(id),
          title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
          chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
          recapHtml: chapterRecap.html, sourcePage: chapter,
        });
      }
      units.push(...sessionUnits);
    } else if (chapterRecap) {
      const id = chSlug;
      units.push({
        kind: 'chapter', id, outputPath: unitOutputPath(id),
        title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        recapHtml: chapterRecap.html, sourcePage: chapter,
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

module.exports = { findRecap, publishedOf, RECAP_TITLES, buildWrapUpIndex, refTarget, WRAP_UP_TYPES, resolveUnitRecap, chapterMatchesSession, chapterOwnsSession, wrapUpForUnit, folderOf, isUnder, buildStorySpine, orderedSessions, unitRefs, characterStoryGroup };
