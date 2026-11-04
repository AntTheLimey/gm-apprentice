const path = require('path');
const { refTarget } = require('./wikilink');
const { extractSections, resolveWikiLinks, resolveImageEmbeds, publishedSource, stripLeadingH1, valueText } = require('./processor');
const { withoutMarked } = require('./gm-marks');
const { slugify } = require('./scanner');
const { canonicalNfc } = require('./unicode');
const { parseWikilink } = require('./wikilink');
const { isLinkedWrapUp, WRAP_UP_TYPES } = require('./session-hub');
const { isSessionHub } = require('./processor');
const { storySections } = require('./story-sections');
const { withFigures } = require('./story-figures');

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
// players see it (each marked span dropped, or the words players see in its place where `marks`, the build's marks,
// says), so both sites find the same one.
function findRecap(page, resolve, { marked = false, marks = null } = {}) {
  return findSection(page, resolve, RECAP_TITLES, { marked, marks });
}

// The first section of a page whose heading contains one of `titles` (tried in order, case-insensitive) and has
// something in it as players see it: { title, html } or null. Read as findRecap reads (above).
function findSection(page, resolve, titles, { marked = false, marks = null } = {}) {
  const fromMarks = marked ? markedOf(page) : null;
  const text = fromMarks === null ? publishedOf(page) : fromMarks;
  const resolved = resolve ? resolve(text) : text;
  const sections = extractSections(fromMarks === null ? resolved : withoutMarked(resolved, marks));
  for (const wanted of titles) {
    const hit = sections.find(s => s.title.trim().toLowerCase().includes(wanted));
    if (hit && hit.html && hit.html.trim()) return { title: hit.title, html: hit.html };
  }
  return null;
}

const TEASER_TITLES = ['teaser'];

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
function resolveUnitRecap(unitPage, wrapUpPage, resolve, wrapResolve = resolve, { marked = false, marks = null } = {}) {
  if (wrapUpPage) {
    const r = findRecap(wrapUpPage, wrapResolve, { marked, marks });
    if (r) return { ...r, sourcePage: wrapUpPage };
  }
  const own = findRecap(unitPage, resolve, { marked, marks });
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

// A chapter note's `status:` as the Story reads it: 'planned', 'active' or 'complete' (any case, trimmed), else
// 'unknown' (missing, or any other value, such as an old `in_progress`). A planned chapter shows nowhere on the Story.
const CHAPTER_STATUSES = new Set(['planned', 'active', 'complete']);
function chapterStatus(chapter) {
  const s = String(((chapter && chapter.frontmatter) || {}).status || '').trim().toLowerCase();
  return CHAPTER_STATUSES.has(s) ? s : 'unknown';
}

// A chapter has a recap only once it is complete; until then its Story page shows its introduction.
function isCompleteChapter(chapter) {
  return chapterStatus(chapter) === 'complete';
}

// A chapter's label from its `sort_order`: a whole number from one is "Chapter " and the number in words (One to
// Twenty), or in digits above twenty; any other (0, 0.5, none) has no label, its title stands alone.
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
function chapterLabel(sortOrder) {
  if (sortOrder == null || (typeof sortOrder === 'string' && !sortOrder.trim())) return null;
  const n = Number(sortOrder);
  if (!Number.isInteger(n) || n < 1) return null;
  return `Chapter ${n <= 20 ? NUMBER_WORDS[n] : n}`;
}

// A date field as a page prints it: a list (a range) reads "from – to"; empty is null.
function dateFieldText(value) {
  if (value == null) return null;
  const text = Array.isArray(value) ? value.map(valueText).filter(Boolean).join(' – ') : valueText(value);
  return text.trim() ? text.trim() : null;
}

// A session's `session_number` as a whole number, or null.
function sessionNumberOf(session) {
  const n = Number(((session && session.frontmatter) || {}).session_number);
  return Number.isInteger(n) && n >= 0 ? n : null;
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
// `players` (the GM site): `has(outputPath)`, whether the player site has a Story page at that address, and
// `shows(page)`, whether it publishes that page, and `wrapUpAt(outputPath)`, the wrap-up its Story page there is made
// from (or null), whose recap a held-back unit's page leads with. A unit whose wrap-up players do not see, on a page they do have (made
// from the session's own recap, or the chapter's introduction), carries `heldBack`: { recapHtml, wrapRecapTitle }, the
// players' own recap and the title of the wrap-up's, for the build to show the wrap-up's parts apart, marked.
// `figures` ({ candidates, blockers, scenesFor(unit) }, story-figures.js figureCandidates, nameHolders and
// sceneCandidates) pictures the people and places each recap names beside the paragraph that first names them, and
// the scenes played that session beside the paragraph naming the most of their places and people (placeFigures), each
// page at most once a chapter (the scenes each time they are played), in
// the recap the player page shows (on the GM site, the players' own recap of a
// held-back unit). Each placed picture is added to `images.usedImages`; the build's two spine calls place the same
// pictures, so the image pass copies exactly the files the pages use.
function buildStorySpine(pages, linkMap, pairs, images = null, { marked = false, marks = null, players = null, figures = null } = {}) {
  // Recap markdown renders to HTML inside findRecap, so wiki-links must resolve here —
  // downstream has no markdown left to work with. Resolution is relative to the unit's
  // own output path under story/. Without a linkMap (the hasStory probe), skip it.
  // With `images` ({ imageMap, usedImages }) the recap's `![[x.png]]` embeds show too; the
  // recap text is the published view, so a picture only in a hidden part is never added.
  // A missing picture is reported by the page that shows the text. A wrap-up folded into this Story page
  // (story-fold.js) has no page of its own, so its text's missing pictures are reported here when `images.warn` asks
  // (the build's one image pass), and never for text another page shows too.
  // The probe (no link map) given `images` resolves the pictures alone, so a recap that is only a picture the vault lacks
  // is no recap there either: the fold it plans and the Story pages the build makes agree (probeSpine).
  const resolverFor = linkMap
    ? (outputPath, owns = false) => (md) => resolveWikiLinks(images
      ? resolveImageEmbeds(md, images.imageMap, outputPath, images.usedImages, { warn: !!(images.warn && owns) })
      : md, linkMap, outputPath)
    : images
      ? (outputPath) => (md) => resolveImageEmbeds(md, images.imageMap, outputPath, null, { warn: false })
      : () => undefined;
  const foldedInto = (wrapUp, ...outs) => !!(wrapUp && wrapUp.foldedInto && outs.includes(wrapUp.foldedInto.outputPath));
  // A session's Story page is its wrap-up, one to one: a wrap-up folded into another unit's Story page (a chapter that
  // falls back to its session's wrap-up) gives this unit nothing, no recap and no sections.
  const ownWrapUp = (wrapUp, ...outs) => (wrapUp && wrapUp.foldedInto && !foldedInto(wrapUp, ...outs) ? null : wrapUp);
  // The wrap-up's sections on its unit's Story page, less the recap the page leads with when it came from the wrap-up.
  // Its unreadable headings are reported on the build's one warning pass.
  const bodyOf = (wrapUp, recap, resolve) => {
    if (!wrapUp) return { preambleHtml: null, sections: [], moments: null, after: [] };
    const text = (marked ? markedOf(wrapUp) : null) ?? publishedOf(wrapUp);
    const recapTitle = recap && recap.sourcePage === wrapUp ? recap.title : null;
    const warn = images && images.warn ? (msg) => console.warn(`story: ${msg}`) : null;
    const name = wrapUp.sourcePath ? path.basename(wrapUp.sourcePath) : wrapUp.title;
    const { preamble, sections, moments, after, recap: shown } = storySections(text, { resolve, marks: marked || null, recapTitle, warn, name });
    return { preambleHtml: preamble ? preamble.html : null, sections, moments, after, ...(shown ? { recapHtml: shown.html } : {}) };
  };
  // On the GM site, a recap from the unit's own page (no wrap-up gave one) is shown from its marked view, as the
  // wrap-up's is: the same section, its GM-only parts in place.
  const ownRecapHtml = (recap, resolve) => {
    const text = marked && recap && recap.sourcePage ? markedOf(recap.sourcePage) : null;
    if (text === null) return recap.html;
    const shown = storySections(text, { resolve, marks: true, recapTitle: recap.title }).recap;
    return shown ? shown.html : recap.html;
  };
  // A chapter note's part, found as players see it (findSection): on the GM site shown from its marked view, its
  // GM-only parts in place, marked (ownRecapHtml). Nothing else of the note is ever read for the Story.
  const chapterPart = (chapter, titles, resolve) => {
    const found = findSection(chapter, resolve, titles, { marked, marks });
    return found ? { ...found, html: ownRecapHtml({ ...found, sourcePage: chapter }, resolve), sourcePage: chapter } : null;
  };
  // What the players' own Story page at `outputPath` leads with, when the unit's wrap-up is one they do not see: the
  // recap of the wrap-up their page is made from (`players.wrapUpAt`, a wrap-up they see), else `playersRecap()`,
  // the unit's own recap or introduction (#569).
  const heldBackOf = (outputPath, wrapUp, recap, playersRecap) => {
    if (!players || !wrapUp || players.shows(wrapUp) || !players.has(outputPath)) return {};
    const theirs = players.wrapUpAt ? players.wrapUpAt(outputPath) : null;
    const resolve = theirs ? resolverFor(outputPath) : null;
    const found = theirs ? findRecap(theirs, resolve, { marked, marks }) : null;
    const shown = found ? ownRecapHtml({ ...found, sourcePage: theirs }, resolve) : playersRecap();
    if (!shown) return {};
    // The unit's recap is the wrap-up's own only when it came from the wrap-up; otherwise it is the players' (the
    // fallback), already shown once.
    const own = !!recap && recap.sourcePage === wrapUp;
    // Where players' page is made from another wrap-up, the unit's own recap or introduction (which the GM page
    // showed in their place before) stays on the GM page, inside the mark: players do not see it here.
    const unitOwn = found ? playersRecap() : null;
    return { heldBack: { recapHtml: shown, wrapHasRecap: own, wrapRecapTitle: own ? recap.title : null, ...(found ? { wrapUp: theirs } : {}), ...(unitOwn ? { ownHtml: unitOwn } : {}) } };
  };
  const chapters = sortedChapters(pages);
  const sessions = pages.filter(p => p.frontmatter && p.frontmatter.type === 'session');
  const wrapUps = pages.filter(p => p.frontmatter && WRAP_UP_TYPES.has(p.frontmatter.type));
  const idx = buildWrapUpIndex(pages);

  const units = [];
  const chapterOf = new Map();   // unit -> its chapter page: the Story pages pictured together (withFigures)
  const heldBackSessions = [];   // { chapter, sessions }: a planned chapter's sessions that would have had a Story page
  for (const chapter of chapters) {
    const before = units.length;
    // A planned chapter shows nowhere, and nor do its sessions; the ones that would have had a Story page (a recap)
    // are recorded, for the build to name.
    if (chapterStatus(chapter) === 'planned') {
      const held = sessions
        .filter(s => chapterOfSession(s, pages) === chapter)
        .sort(bySessionNumber)
        .filter(s => resolveUnitRecap(s, wrapUpForUnit(s, wrapUps, idx, pairs), null));
      if (held.length) heldBackSessions.push({ chapter, sessions: held });
      continue;
    }
    // Namespace unit ids by chapter so non-unique session titles (e.g. a plain "Session 1"
    // in two chapters) can't collide on the same story/<id>.html output path.
    const chSlug = slugify(chapter.displayTitle || chapter.title);
    const chOut = unitOutputPath(chSlug);
    const status = chapterStatus(chapter);
    // The chapter's Story page takes recap, sections and moments only from its own chapter wrap-up (never a session's,
    // which is that session's Story page), and only once the chapter is complete; until then it claims no wrap-up, so
    // that wrap-up keeps its own page.
    const found = ownWrapUp(wrapUpForUnit(chapter, wrapUps, idx, pairs), chOut);
    const chapterWrap = found && status === 'complete' && !isLinkedWrapUp(found, pairs) ? found : null;
    const chapterWrapResolve = once(resolverFor(chOut, foldedInto(chapterWrap, chOut)));
    const ownResolveCh = resolverFor(chOut);
    const fromWrap = chapterWrap ? findRecap(chapterWrap, chapterWrapResolve, { marked, marks }) : null;
    // What of the note shows: an active chapter its Teaser; a complete one its recap (the wrap-up's, else the note's
    // own Recap section) and its `overview:`; any other status nothing.
    const noteRecap = () => (status === 'complete' ? chapterPart(chapter, RECAP_TITLES, ownResolveCh) : null);
    const chapterRecap = status !== 'complete' ? null : fromWrap ? { ...fromWrap, sourcePage: chapterWrap } : noteRecap();
    const teaser = status === 'active' ? chapterPart(chapter, TEASER_TITLES, ownResolveCh) : null;
    const fm = chapter.frontmatter || {};
    const overview = status === 'complete' ? dateFieldText(fm.overview) : null;

    const chapterSessions = sessions
      .filter(s => chapterOfSession(s, pages) === chapter)
      .sort(bySessionNumber);

    const sessionUnits = [];
    for (const s of chapterSessions) {
      const id = `${chSlug}-${slugify(s.title)}`;
      const wrapUp = ownWrapUp(wrapUpForUnit(s, wrapUps, idx, pairs), unitOutputPath(id));
      const wrapResolve = once(resolverFor(unitOutputPath(id), foldedInto(wrapUp, unitOutputPath(id))));
      const ownResolve = resolverFor(unitOutputPath(id));
      const recap = resolveUnitRecap(s, wrapUp, ownResolve, wrapResolve, { marked, marks });
      if (!recap) continue;
      sessionUnits.push({
        kind: 'session', id, outputPath: unitOutputPath(id),
        title: s.displayTitle || s.title.replace(/_/g, ' '),
        chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
        chapterOutputPath: chOut,
        // The recap text can come from the wrap-up; sourcePage is always the unit's own page.
        recapHtml: recap.sourcePage === wrapUp ? recap.html : ownRecapHtml(recap, ownResolve), sourcePage: s, wrapUpPage: wrapUp || null,
        ...bodyOf(wrapUp, recap, wrapResolve),
        ...heldBackOf(unitOutputPath(id), wrapUp, recap, () => {
          const own = findRecap(s, ownResolve, { marked, marks });
          return own ? ownRecapHtml({ ...own, sourcePage: s }, ownResolve) : null;
        }),
      });
    }

    // Every shown chapter has one Story page, before its sessions: the chapter break. Before, a chapter with sessions
    // had story/<chSlug>-intro.html, made from its wrap-up's recap (complete) or the note's whole body; that address
    // redirects here (the build), where it was written.
    const hadIntro = sessionUnits.length > 0 && (!!(isCompleteChapter(chapter) && fromWrap) || !!stripLeadingH1(publishedOf(chapter)).trim());
    units.push({
      kind: 'chapter', id: chSlug, outputPath: chOut,
      title: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
      chapterTitle: chapter.displayTitle || chapter.title.replace(/_/g, ' '),
      status, label: chapterLabel(fm.sort_order), dates: dateFieldText(fm.date_range),
      teaserHtml: teaser ? teaser.html : null, overview,
      recapHtml: chapterRecap ? chapterRecap.html : null,
      sessions: sessionUnits.map(u => ({ title: u.title, outputPath: u.outputPath, inGameDate: dateFieldText(u.sourcePage.frontmatter.in_game_date), number: sessionNumberOf(u.sourcePage) })),
      sourcePage: chapter, wrapUpPage: chapterWrap || null,
      ...bodyOf(chapterWrap, chapterRecap, chapterWrapResolve),
      ...heldBackOf(chOut, chapterWrap, chapterRecap, () => (noteRecap() || {}).html || null),
      oldOutputPath: hadIntro ? unitOutputPath(`${chSlug}-intro`) : null,
    });
    units.push(...sessionUnits);
    for (const unit of units.slice(before)) chapterOf.set(unit, chapter);
  }

  if (figures && images) {
    // A page is pictured once per chapter: on the chapter's first Story page, in reading order, that pictures it (or
    // shows its picture where the GM placed it). On the GM site only the Story pages the player site has count
    // towards that, so a GM page never pictures less than the player page at its address; a GM page players do not
    // have still leaves out what was pictured before it. The chapter's own page ('chapter') pictures
    // on its own: by the same rules, from nothing pictured, and adding nothing to the chapter's set, so its session
    // pages choose as if it were not there (a complete chapter's recap names nearly everyone).
    const shownIn = new Map();   // chapter -> the keys pictured so far on its session pages
    for (const unit of units) {
      const chapter = chapterOf.get(unit);
      if (!shownIn.has(chapter)) shownIn.set(chapter, new Set());
      const own = unit.kind === 'chapter';
      const shown = own ? new Set() : shownIn.get(chapter);
      const counts = !own && (!players || players.has(unit.outputPath));
      // A GM unit whose banner says players see another Story page here, with no heldBack, has no player page at this
      // address to equal; its pictures still come from player-site pages only.
      const target = unit.heldBack || unit;
      // An active chapter's page is pictured in its Teaser; every other page in its recap.
      const field = target === unit && unit.kind === 'chapter' && unit.status === 'active' ? 'teaserHtml' : 'recapHtml';
      if (target[field] == null) continue;
      target[field] = withFigures(target[field], {
        candidates: figures.candidates, scenes: figures.scenesFor ? figures.scenesFor(unit) : [], blockers: figures.blockers || [],
        exclude: new Set([unit.sourcePage, unit.wrapUpPage, unit.heldBack && unit.heldBack.wrapUp].filter(Boolean)),
        fromPath: unit.outputPath, imageMap: images.imageMap, usedImages: images.usedImages, marks,
        shown: new Set(shown), pictured: counts ? shown : null,
      });
    }
  }

  // An old introduction address that a page of this spine now has (a session whose title makes the same address) is
  // that page's: no redirect over it.
  const written = new Set(units.map(u => u.outputPath));
  for (const u of units) if (u.oldOutputPath && written.has(u.oldOutputPath)) u.oldOutputPath = null;
  for (let i = 0; i < units.length; i++) {
    units[i].prevHref = i > 0 ? units[i - 1].outputPath : null;
    units[i].nextHref = i < units.length - 1 ? units[i + 1].outputPath : null;
  }
  units.heldBackSessions = heldBackSessions;
  // { ref, sessions }: each `chapter:` ref that sessions with a recap name but no chapter page here heads (the chapter
  // note does not publish: `publish: false`, a planned status, left out; or the ref names no chapter), once each, in
  // session order, with those sessions: the build says so, never silent.
  const unpublished = new Map();
  for (const s of orderedSessions(pages)) {
    const ref = refTarget(s.frontmatter.chapter);
    if (!ref || chapterOfSession(s, pages)) continue;
    if (!resolveUnitRecap(s, wrapUpForUnit(s, wrapUps, idx, pairs), null)) continue;
    if (!unpublished.has(ref)) unpublished.set(ref, []);
    unpublished.get(ref).push(s);
  }
  units.unpublishedChapters = [...unpublished].map(([ref, held]) => ({ ref, sessions: held }));
  return units;
}

// The spine the fold is planned from, before the link map is folded (story-fold.js): no links resolved, pictures
// resolved against `imageMap` as the build's Story pages resolve them, nothing recorded and nothing said. The build,
// explain and the leak gate plan with it.
function probeSpine(pages, pairs, imageMap, options = {}) {
  return buildStorySpine(pages, null, pairs, imageMap ? { imageMap, usedImages: null } : null, options);
}

// What the GM site marks on a Story page, from the player site's side: `banner`, the reason players have no Story
// page here (the page-level banner), or null; `held`, the unit's `heldBack` when its wrap-up is shown in one mark
// after the players' recap, or null. `playerHas`: the player site has a Story page at this address; `shows(page)`:
// it publishes that page; `folded`: the wrap-up folded into this page. A wrap-up players do not see on a page they
// have, with no recap of theirs to lead it, gets the banner: held-back text is never shown unmarked.
function gmStoryNotes(unit, { playerHas, shows, folded = null }) {
  const held = unit.heldBack && unit.heldBack.recapHtml ? unit.heldBack : null;
  if (!playerHas) {
    if (folded && shows(folded)) return { banner: `players see this wrap-up on its own page (${folded.foldedFrom}), not here`, held: null };
    return { banner: (folded && folded.gmHiddenBecause) || (unit.sourcePage && unit.sourcePage.gmHiddenBecause) || 'the player site has no Story page here', held: null };
  }
  if (!held && unit.wrapUpPage && !shows(unit.wrapUpPage)) {
    return { banner: `players see another Story page here; this wrap-up is held back: ${unit.wrapUpPage.gmHiddenBecause || 'the player site leaves it out'}`, held: null };
  }
  return { banner: null, held };
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

module.exports = { chapterStatus, isCompleteChapter, chapterLabel, findSection, gmStoryNotes, findRecap, publishedOf, RECAP_TITLES, buildWrapUpIndex, refTarget, WRAP_UP_TYPES, resolveUnitRecap, chapterMatchesSession, chapterOfSession, wrapUpForUnit, folderOf, isUnder, buildStorySpine, probeSpine, storyPagesFor, orderedSessions, characterStoryGroup };
