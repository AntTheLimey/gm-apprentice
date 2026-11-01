const path = require('path');
const { refTarget } = require('./wikilink');
const { extractSections, resolveWikiLinks, resolveImageEmbeds, publishedSource, renderMarkdown, stripLeadingH1, stripLeadingH1Marked } = require('./processor');
const { withoutMarked } = require('./gm-marks');
const { slugify } = require('./scanner');
const { canonicalNfc } = require('./unicode');
const { parseWikilink } = require('./wikilink');
const { isLinkedWrapUp, WRAP_UP_TYPES } = require('./session-hub');
const { isSessionHub } = require('./processor');
const { storySections } = require('./story-sections');

const RECAP_TITLES = ['narrative recap', 'recap'];

// The gm-only/excluded-stripped view if present (set by build.js), else raw markdown.
const publishedOf = publishedSource;

// The marked view of a page (the GM site's: every hidden part kept, marked), or null when the build made none.
const markedOf = (page) => (page && typeof page.gmMarkedPublished === 'string' ? page.gmMarkedPublished : null);

// Find the recap section of a page. Returns { title, html } or null.
// Heading match is a case-insensitive CONTAINS, because real vaults decorate the title
// (e.g. "What Happened — Narrative Recap"). "narrative recap" is tried before the looser
// "recap" so the more specific heading wins when both are present.
// With `marked` (the GM site) the page's marked view is resolved, so the Story page's sections later read the same
// text from the same resolver, and its missing pictures are reported once; the recap is still found in that text as
// players see it (each marked span dropped), so both sites find the same one.
function findRecap(page, resolve, { marked = false } = {}) {
  const fromMarks = marked ? markedOf(page) : null;
  const text = fromMarks === null ? publishedOf(page) : fromMarks;
  const resolved = resolve ? resolve(text) : text;
  const sections = extractSections(fromMarks === null ? resolved : withoutMarked(resolved));
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
// `wrapResolve` reads the wrap-up's text (by default `resolve`).
function resolveUnitRecap(unitPage, wrapUpPage, resolve, wrapResolve = resolve, { marked = false } = {}) {
  if (wrapUpPage) {
    const r = findRecap(wrapUpPage, wrapResolve, { marked });
    if (r) return { ...r, sourcePage: wrapUpPage };
  }
  const own = findRecap(unitPage, resolve, { marked });
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

// The chapter a session belongs to, or null: the one rule for the Saga, the prev/next
// regrouping and the session page's "Chapter:" line. The session's own `chapter:` ref
// decides first (an exact title match over a display-title substring; ties go to the
// first chapter in sort order). A session whose ref names no chapter falls back to the
// chapter whose folder holds it, the deepest one; two chapter pages in that same folder
// say nothing about which, so none. Folder-first would give every session to Ch1
// wherever all chapter pages share a folder.
function chapterOfSession(session, pages) {
  const chapters = sortedChapters(pages);
  const byRef = chapters.filter(c => chapterMatchesSession(c, session));
  if (byRef.length > 0) {
    const ref = refTarget(session.frontmatter.chapter);
    const exact = byRef.find(c => {
      const title = canonicalNfc(c.title);
      return ref === title || ref === title.replace(/_/g, ' ');
    });
    return exact || byRef[0];
  }
  const holders = chapters.filter(c => isUnder(session.sourcePath, folderOf(c)));
  if (holders.length === 0) return null;
  const depth = c => path.resolve(folderOf(c)).length;
  const deepest = Math.max(...holders.map(depth));
  const at = holders.filter(c => depth(c) === deepest);
  return at.length === 1 ? at[0] : null;
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

// A chapter has a recap only once it is complete (`status: complete`, any case); until then its Story page shows its
// introduction.
function isCompleteChapter(chapter) {
  return String(((chapter && chapter.frontmatter) || {}).status || '').trim().toLowerCase() === 'complete';
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
  const owner = new Map(old.map(s => [s, chapterOfSession(s, pages)]));
  const seen = new Set(old.filter(s => owner.get(s)));
  const chaptered = [];
  for (const chapter of sortedChapters(pages)) {
    chaptered.push(...old.filter(s => owner.get(s) === chapter));
  }
  let next = 0;
  order = old.map(s => (seen.has(s) ? chaptered[next++] : s));
  sessionOrders.set(pages, order);
  return order;
}

// The resolver, asked again of the text it was last given, answers from that answer: the recap and the Story page's
// sections read the same wrap-up text, and its missing pictures are reported once.
function once(resolve) {
  if (!resolve) return resolve;
  let lastIn;
  let lastOut;
  return (md) => {
    if (md !== lastIn) { lastIn = md; lastOut = resolve(md); }
    return lastOut;
  };
}

// `pairs` is the build's hub -> Wrap-Up map (session-hub.js pairHubs), computed once on
// the unreduced frontmatter; without it no session pairs with a Wrap-Up.
// Each unit carries its wrap-up's other sections (story-sections.js): `sections`, `moments`, `after`, cut from the
// wrap-up's published view, or with `marked` (the GM site) from its marked view.
function buildStorySpine(pages, linkMap, pairs, images = null, { marked = false } = {}) {
  // Recap markdown renders to HTML inside findRecap, so wiki-links must resolve here —
  // downstream has no markdown left to work with. Resolution is relative to the unit's
  // own output path under story/. Without a linkMap (the hasStory probe), skip it.
  // With `images` ({ imageMap, usedImages }) the recap's `![[x.png]]` embeds show too; the
  // recap text is the published view, so a picture only in a hidden part is never added.
  // A missing picture is reported by the page that shows the text. A wrap-up folded into this Story page
  // (story-fold.js) has no page of its own, so its text's missing pictures are reported here when `images.warn` asks
  // (the build's one image pass), and never for text another page shows too.
  const resolverFor = linkMap
    ? (outputPath, owns = false) => (md) => resolveWikiLinks(images
      ? resolveImageEmbeds(md, images.imageMap, outputPath, images.usedImages, { warn: !!(images.warn && owns) })
      : md, linkMap, outputPath)
    : () => undefined;
  const foldedInto = (wrapUp, ...outs) => !!(wrapUp && wrapUp.foldedInto && outs.includes(wrapUp.foldedInto.outputPath));
  // A session's Story page is its wrap-up, one to one: a wrap-up folded into another unit's Story page (a chapter that
  // falls back to its session's wrap-up) gives this unit nothing, no recap and no sections.
  const ownWrapUp = (wrapUp, ...outs) => (wrapUp && wrapUp.foldedInto && !foldedInto(wrapUp, ...outs) ? null : wrapUp);
  // The wrap-up's sections on its unit's Story page, less the recap the page leads with when it came from the wrap-up.
  // Its unreadable headings are reported on the build's one warning pass.
  const bodyOf = (wrapUp, recap, resolve) => {
    if (!wrapUp) return { sections: [], moments: null, after: [] };
    const text = (marked ? markedOf(wrapUp) : null) ?? publishedOf(wrapUp);
    const recapTitle = recap && recap.sourcePage === wrapUp ? recap.title : null;
    const warn = images && images.warn ? (msg) => console.warn(`story: ${msg}`) : null;
    const name = wrapUp.sourcePath ? path.basename(wrapUp.sourcePath) : wrapUp.title;
    const { sections, moments, after, recap: shown } = storySections(text, { resolve, marks: marked || null, recapTitle, warn, name });
    return { sections, moments, after, ...(shown ? { recapHtml: shown.html } : {}) };
  };
  // On the GM site, a recap from the unit's own page (no wrap-up gave one) is shown from its marked view, as the
  // wrap-up's is: the same section, its GM-only parts in place.
  const ownRecapHtml = (recap, resolve) => {
    const text = marked && recap && recap.sourcePage ? markedOf(recap.sourcePage) : null;
    if (text === null) return recap.html;
    const shown = storySections(text, { resolve, marks: true, recapTitle: recap.title }).recap;
    return shown ? shown.html : recap.html;
  };
  // The chapter note's introduction: its published body under the page's own title, or null when that is empty.
  // On the GM site the body shown is its marked view: its GM-only parts in place, marked. Whether it is empty is
  // decided as players see it, so both sites give the chapter the same page.
  const chapterIntro = (chapter, resolve) => {
    const text = stripLeadingH1(publishedOf(chapter));
    if (!text.trim()) return null;
    const fromMarks = marked ? markedOf(chapter) : null;
    const shown = fromMarks === null ? text : stripLeadingH1Marked(fromMarks);
    return { title: null, html: renderMarkdown(resolve ? resolve(shown) : shown), sourcePage: chapter };
  };
  const chapters = sortedChapters(pages);
  const sessions = pages.filter(p => p.frontmatter && p.frontmatter.type === 'session');
  const wrapUps = pages.filter(p => p.frontmatter && WRAP_UP_TYPES.has(p.frontmatter.type));
  const idx = buildWrapUpIndex(pages);

  const units = [];
  for (const chapter of chapters) {
    // Namespace unit ids by chapter so non-unique session titles (e.g. a plain "Session 1"
    // in two chapters) can't collide on the same story/<id>.html output path.
    const chSlug = slugify(chapter.displayTitle || chapter.title);
    // A chapter's Story page takes recap, sections and moments only from its own chapter wrap-up (never a session's,
    // which is that session's Story page), and only once the chapter is complete. Otherwise it shows the chapter
    // note's introduction, its own published body, and claims no wrap-up, so that wrap-up keeps its own page.
    const found = ownWrapUp(wrapUpForUnit(chapter, wrapUps, idx, pairs), unitOutputPath(chSlug), unitOutputPath(`${chSlug}-intro`));
    const chapterWrap = found && isCompleteChapter(chapter) && !isLinkedWrapUp(found, pairs) ? found : null;
    // The chapter's Story page is either story/<chSlug>-intro.html or story/<chSlug>.html;
    // both live in story/, so either path yields the same relative link resolution.
    const chapterWrapResolve = once(resolverFor(unitOutputPath(chSlug), foldedInto(chapterWrap, unitOutputPath(chSlug), unitOutputPath(`${chSlug}-intro`))));
    const fromWrap = chapterWrap ? findRecap(chapterWrap, chapterWrapResolve, { marked }) : null;
    const chapterRecap = fromWrap ? { ...fromWrap, sourcePage: chapterWrap } : chapterIntro(chapter, resolverFor(unitOutputPath(chSlug)));

    const chapterSessions = sessions
      .filter(s => chapterOfSession(s, pages) === chapter)
      .sort(bySessionNumber);

    const sessionUnits = [];
    for (const s of chapterSessions) {
      const id = `${chSlug}-${slugify(s.title)}`;
      const wrapUp = ownWrapUp(wrapUpForUnit(s, wrapUps, idx, pairs), unitOutputPath(id));
      const wrapResolve = once(resolverFor(unitOutputPath(id), foldedInto(wrapUp, unitOutputPath(id))));
      const ownResolve = resolverFor(unitOutputPath(id));
      const recap = resolveUnitRecap(s, wrapUp, ownResolve, wrapResolve, { marked });
      if (!recap) continue;
      sessionUnits.push({
        kind: 'session', id, outputPath: unitOutputPath(id),
        title: s.displayTitle || s.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        // The recap text can come from the wrap-up; sourcePage is always the unit's own page.
        recapHtml: recap.sourcePage === wrapUp ? recap.html : ownRecapHtml(recap, ownResolve), sourcePage: s, wrapUpPage: wrapUp || null,
        ...bodyOf(wrapUp, recap, wrapResolve),
      });
    }

    if (sessionUnits.length > 0) {
      if (chapterRecap) {
        const id = `${chSlug}-intro`;
        units.push({
          kind: 'chapter-intro', id, outputPath: unitOutputPath(id),
          title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
          chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
          recapHtml: chapterRecap.html, sourcePage: chapter, wrapUpPage: chapterWrap || null,
          ...bodyOf(chapterWrap, chapterRecap, chapterWrapResolve),
        });
      }
      units.push(...sessionUnits);
    } else if (chapterRecap && isCompleteChapter(chapter)) {
      // A chapter with no session on the Story yet gets a page of its own only once it is complete.
      const id = chSlug;
      units.push({
        kind: 'chapter', id, outputPath: unitOutputPath(id),
        title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        recapHtml: chapterRecap.html, sourcePage: chapter, wrapUpPage: chapterWrap || null,
        ...bodyOf(chapterWrap, chapterRecap, chapterWrapResolve),
      });
    }
  }

  for (let i = 0; i < units.length; i++) {
    units[i].prevHref = i > 0 ? units[i - 1].outputPath : null;
    units[i].nextHref = i < units.length - 1 ? units[i + 1].outputPath : null;
  }
  return units;
}

// The Story page that tells each page's part of the saga: a Map from a session or chapter page, and from the
// wrap-up its Story page was made from, to that Story page's outputPath. Built once from the spine and handed to
// whatever links "the session" (the landing page's Read full session, #541). A session's own Story page wins over
// a chapter's when one wrap-up feeds both.
function storyPagesFor(spine) {
  const out = new Map();
  for (const unit of spine || []) {
    out.set(unit.sourcePage, unit.outputPath);
    if (unit.wrapUpPage && (unit.kind === 'session' || !out.has(unit.wrapUpPage))) {
      out.set(unit.wrapUpPage, unit.outputPath);
    }
  }
  return out;
}

// `fallen` is `vault.statuses.fallen` (config.js); a missing list throws rather than meaning "nobody".
function characterStoryGroup(frontmatter, fallen) {
  const s = String((frontmatter || {}).status || '').trim().toLowerCase();
  if (s === 'retired') return 'retired';
  if (fallen.has(s)) return 'fallen';
  return 'current';
}

module.exports = { findRecap, publishedOf, RECAP_TITLES, buildWrapUpIndex, refTarget, WRAP_UP_TYPES, resolveUnitRecap, chapterMatchesSession, chapterOfSession, wrapUpForUnit, folderOf, isUnder, buildStorySpine, storyPagesFor, orderedSessions, characterStoryGroup };
