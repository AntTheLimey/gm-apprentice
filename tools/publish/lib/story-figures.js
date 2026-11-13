'use strict';
// Pictures beside a session recap: which pages may be pictured, where the recap mentions them, and which paragraph
// each picture goes beside. Pure: it reads pages and the recap's HTML and changes nothing, so no word of the recap
// is ever touched; the build adds a figure before the paragraph it chose.

const path = require('node:path');
const { portraitBasename, nameList, flagIsYes, isWebImageAddress, publishedFrontmatter, relativeHref, encodeImageUrl, strippedLines, fenceStep, IMAGE_EXT_REGEX } = require('./processor');
const { canonicalNfc } = require('./unicode');
const { withoutMarked } = require('./gm-marks');
const { decodeEntities } = require('./templates/gurps/tables');
const { parseWikilink, wikilinkRe } = require('./wikilink');
const { named, nearest, linkTarget } = require('./session-hub');
const { WRAP_UP_TYPES } = require('./shared-lists');

const PLACE_TYPES = new Set(['location', 'faction', 'item']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// A tag (quoted attribute values may hold a `>`) or a comment.
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

// A page's names as players read them: its published title and published `aliases` (a hidden field is not a name,
// and `gm_aliases` is never read), each read as players see it on the GM site (`marks`): a title or alias can hold a
// marked name (a withheld note's, kept for the GM), so a caption never prints the GM's name and the names match the
// words the player page has. An alias beginning with "The" ("The River", "the capital") is a description, not a name:
// it is not one of the names, so only a link counts for it. The title always is, "The" or not.
function namesOf(page, published, marks) {
  const title = withoutMarked(page.displayTitle || page.title || '', marks).trim();
  const seen = new Set();
  const terms = [];
  const aliases = nameList(published.aliases).map((raw) => canonicalNfc(withoutMarked(raw, marks)).trim()).filter((a) => !/^the\s/i.test(a));
  for (const term of [canonicalNfc(title), ...aliases]) {
    if (term && !seen.has(term.toLowerCase())) { seen.add(term.toLowerCase()); terms.push(term); }
  }
  return { title, terms };
}

// The pages that may be named for a picture, each with its published frontmatter: not a PC or a companion (an NPC
// marked `companion: true`, who travels with the party; read as `withheld` is) unless `pcs`, not one of `exclude`, and on the GM site
// (`onPlayerSite`, a Set of the pages the player site publishes) only those.
function* namedPages(pages, { onPlayerSite = null, exclude = new Set(), excludeFields = [], overridesOf = null, pcs = false } = {}) {
  for (const page of pages) {
    if (exclude.has(page) || (onPlayerSite && !onPlayerSite.has(page))) continue;
    const source = page.sourceFrontmatter || page.frontmatter || {};
    if ((source.type === 'pc' || flagIsYes(source.companion)) && !pcs) continue;
    yield { page, source, published: publishedFrontmatter(page.frontmatter || {}, excludeFields, (overridesOf && overridesOf(page)) || {}) };
  }
}

// The pages a recap may be pictured with, in `pages` order. `onPlayerSite` (the GM site: a Set of the pages the
// player site publishes) keeps only those; `exclude` is a Set of the unit's own pages. A page counts when it is not
// a PC or a companion and its portrait names an attachment the build has. Its names are namesOf's.
function figureCandidates(pages, { imageMap, marks = null, ...options } = {}) {
  const out = [];
  for (const { page, source, published } of namedPages(pages, options)) {
    const base = portraitBasename(published);
    if (!base || isWebImageAddress(published.portrait)) continue;
    const key = canonicalNfc(base);
    if (!imageMap || !(key in imageMap)) continue;
    const { title, terms } = namesOf(page, published, marks);
    out.push({ page, key, outputPath: page.outputPath, title, terms, place: PLACE_TYPES.has(source.type) });
  }
  return out;
}

// The names of every page a scene's places and people can be, portrait or not: a Map from a page's outputPath to its
// names (namesOf), with figureCandidates' rules for which pages count (so a PC or a companion names no scene).
function pageNames(pages, { marks = null, ...options } = {}) {
  const out = new Map();
  for (const { page, published } of namedPages(pages, options)) out.set(page.outputPath, namesOf(page, published, marks).terms);
  return out;
}

// The names of every page players see, PCs and companions too, portrait or not: [{ outputPath, terms }] in `pages` order, with
// namesOf's names and namedPages' rules otherwise. A name of a candidate inside a longer one of these is not a mention
// (mentionsOf): "Lady Anne Pelham" names Lady Anne, never James Pelham by his alias "Pelham".
function nameHolders(pages, { marks = null, ...options } = {}) {
  const out = [];
  for (const { page, published } of namedPages(pages, { ...options, pcs: true })) {
    out.push({ outputPath: page.outputPath, terms: namesOf(page, published, marks).terms });
  }
  return out;
}

// A scene's lines outside code, as { line, level, text }: a heading's level (and its words, `text`), 0 for any other
// line. Read with gm-only and spoiler fences, comments and callouts taken out. A setext heading's text lines become one
// heading when its underline is reached; an underline after a blank line is a rule.
function sceneLines(body) {
  const lines = strippedLines(String(body == null ? '' : body).replace(/\r\n?/g, '\n'), true).lines;
  const read = [];
  let para = [];   // where the paragraph so far starts in `read`, while it has lines
  let fence = null;
  for (const line of lines) {
    const step = fenceStep(line, fence);
    const inCode = fence !== null || step.isFenceLine;
    fence = step.fenceDelim;
    if (inCode) { para = []; continue; }
    const hashes = /^ {0,3}(#{1,6})(\s|$)/.exec(line);
    const tag = /^ {0,3}<h([1-6])[\s>]/i.exec(line);
    const atx = hashes ? hashes[1].length : tag ? Number(tag[1]) : 0;
    const under = /^ {0,3}(=+|-+)\s*$/.exec(line);
    if (under && para.length) {
      const text = read.splice(para[0]).map((x) => x.line.trim()).join(' ');
      read.push({ line: '', level: under[1][0] === '=' ? 1 : 2, text });
      para = [];
      continue;
    }
    if (atx || under || !line.trim()) {
      const text = hashes ? line.replace(/^ {0,3}#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '').trim() : tag ? line.replace(/<[^>]*>/g, '').trim() : '';
      read.push({ line, level: atx, text });
      para = [];
      continue;
    }
    if (!para.length) para = [read.length];
    read.push({ line, level: 0, text: '' });
  }
  return read;
}

// A scene's picture: the file name of the first image embed (`![[x.png]]` or `![](x.png)`) after its H1 (from the top
// when it has none) and before its next heading (`#`, an HTML `<h1>`-`<h6>` line, or text underlined with `===` or
// `---`), read as sceneLines reads; null when there is none. Any other picture in the scene is never used.
function scenePicture(body) {
  const read = sceneLines(body);
  let started = false;
  for (const { line, level } of read) {
    if (level) {
      if (!started && level === 1) { started = true; continue; }
      return null;
    }
    if (!started && !line.trim()) continue;
    started = true;
    const found = firstImage(line);
    if (found) return found;
  }
  return null;
}

// The file name of the first image embed on one line, or null.
function firstImage(line) {
  const embeds = [];
  for (const m of line.matchAll(new RegExp('!' + wikilinkRe().source, 'g'))) {
    embeds.push({ at: m.index, name: parseWikilink(m[1]).raw.trim() });
  }
  for (const m of line.matchAll(/!\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    if (isWebImageAddress(m[1])) continue;
    let name = m[1].split(/[?#]/)[0];
    try { name = decodeURIComponent(name); } catch { /* an address that is not encoded stays as written */ }
    embeds.push({ at: m.index, name });
  }
  embeds.sort((a, b) => a.at - b.at);
  const hit = embeds.find((e) => IMAGE_EXT_REGEX.test(e.name));
  return hit ? canonicalNfc(hit.name.split('/').pop()) : null;
}

// The words of a scene's title (its first H1, else its note's name) that say what its picture shows: lowercased, four
// letters or more, without the words every scene title carries. They only rank the paragraphs that name the scene's
// people and places (sceneSpots); they are never printed.
const TITLE_STOP = new Set(['scene', 'session', 'chapter', 'part', 'with', 'from', 'that', 'this', 'into', 'their', 'there', 'about']);
function titleWords(body, fallback) {
  const h1 = sceneLines(body).find((x) => x.level === 1 && x.text);
  const text = (h1 ? h1.text : String(fallback || '')).normalize('NFC');
  const words = (text.match(/[\p{L}]+/gu) || []).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !TITLE_STOP.has(w));
  return [...new Set(words)];
}

const NOT_PLAYED = new Set(['dropped', 'paused']);
const linksOf = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).map(linkTarget).filter(Boolean);
const folderOf = (note) => path.dirname(note.sourcePath || '');
const statusOf = (fm) => String(fm.status == null ? '' : fm.status).trim().toLowerCase();

// The session notes (index or wrap-up, by sourcePath) a scene counts for. `played_in` decides when it names
// anything. Otherwise only a scene marked `status: played` counts (prep for a session not yet played is linked to its
// Plan too), by its `session:` link (to the index, or to a Plan, which names its index); a played scene with no
// `session:` link counts by the session folder whose `Scenes/` it sits in, when that folder holds one session index.
// A link resolves as the site resolves links among every session note of the vault, the nearest when several share a
// name (session-hub.js), and a wrap-up counts for its own index as well. The caller drops a dropped or paused scene.
function sessionsOfScene(scene, vault) {
  const out = new Set();
  const add = (note) => {
    if (!note) return;
    out.add(note.sourcePath);
    if (WRAP_UP_TYPES.has(note.frontmatter.type)) {
      const hub = nearest(note, named(linkTarget(note.frontmatter.session), vault.hubs));
      if (hub) out.add(hub.sourcePath);
    }
  };
  const fm = scene.frontmatter;
  const played = linksOf(fm.played_in);
  if (played.length > 0) {
    for (const target of played) add(nearest(scene, named(target, vault.hubs.concat(vault.wrapUps))));
    return out;
  }
  if (statusOf(fm) !== 'played') return out;
  const sessions = linksOf(fm.session);
  for (const target of sessions) {
    const hit = nearest(scene, named(target, vault.hubs.concat(vault.plans)));
    if (hit && hit.frontmatter.type === 'session-plan') add(nearest(hit, named(linkTarget(hit.frontmatter.session), vault.hubs)));
    else add(hit);
  }
  // An explicit link beats the folder: a scene moved to another session keeps the folder it was written in.
  if (sessions.length > 0) return out;
  // A flat Sessions folder holds several indexes beside one Scenes/: its scenes belong to none of them by folder.
  const folder = folderOf(scene);
  if (path.basename(folder) === 'Scenes') {
    const beside = vault.hubs.filter((hub) => folderOf(hub) === path.dirname(folder));
    if (beside.length === 1) add(beside[0]);
  }
  return out;
}

// The scene pictures of each session unit, from `notes` (every vault note, scanAllNotes: a scene and a Plan carry
// their frontmatter, a scene its `body`). Returns `(unit) => candidates`. A scene counts for a session unit by
// sessionsOfScene, never when dropped or paused; its picture is scenePicture's, an attachment the build has
// (`imageMap`); and it is named by the pages its `locations` and `entities` link (resolved by `linkMap`, else by
// `folded`, the build's reading of a name in another letter case or with underscores) that are in
// `names` (pageNames: player-site pages, not PCs). Its candidate has those pages' names and addresses, together
// (`terms`, `hrefs`) and one by one (`pages`: [{ href, terms }], which placeFigures counts), and nothing of the scene's
// own: no title, no words. A scene with no picture or no such page gives none.
function sceneCandidates(notes, { names, imageMap, linkMap, folded = () => undefined }) {
  const typed = (types) => notes.filter((n) => n.frontmatter && types.has(String(n.frontmatter.type)));
  const vault = { hubs: typed(new Set(['session'])), wrapUps: typed(WRAP_UP_TYPES), plans: typed(new Set(['session-plan'])) };
  const scenes = [];
  for (const scene of typed(new Set(['scene']))) {
    const fm = scene.frontmatter;
    if (NOT_PLAYED.has(statusOf(fm))) continue;
    const key = scenePicture(scene.body);
    if (!key || !imageMap || !(key in imageMap)) continue;
    const seen = new Set();
    const terms = [];
    const hrefs = new Set();
    const pages = [];
    for (const target of [...linksOf(fm.locations), ...linksOf(fm.entities)]) {
      const at = linkMap[target] || folded(target);
      if (!at || !names.has(at)) continue;
      const href = canonicalNfc(at);
      if (!hrefs.has(href)) pages.push({ href, terms: names.get(at) });
      hrefs.add(href);
      for (const term of names.get(at)) if (!seen.has(term.toLowerCase())) { seen.add(term.toLowerCase()); terms.push(term); }
    }
    if (hrefs.size === 0) continue;
    scenes.push({ sessions: sessionsOfScene(scene, vault), candidate: { key, outputPath: null, title: '', terms, hrefs, pages, place: true, scene: true, words: titleWords(scene.body, scene.title) } });
  }
  return (unit) => {
    if (!unit || unit.kind !== 'session') return [];
    const own = [unit.sourcePage, unit.wrapUpPage].filter(Boolean).map((p) => p.sourcePath);
    return scenes.filter((s) => own.some((at) => s.sessions.has(at))).map((s) => s.candidate);
  };
}

// The recap's top-level elements, as { tag, html, start } in order (`start`: where it begins in the recap). Comments
// and loose text between them are not elements.
function topLevelElements(html) {
  const blocks = [];
  let depth = 0;
  let start = 0;
  let tag = '';
  for (const m of String(html || '').matchAll(TAG)) {
    if (m[0].startsWith('<!--')) continue;
    const name = m[2].toLowerCase();
    const closing = m[1] === '/';
    const selfClosed = VOID.has(name) || m[3].trimEnd().endsWith('/');
    if (closing) {
      if (depth === 0) continue;
      depth--;
      if (depth === 0) blocks.push({ tag, html: html.slice(start, m.index + m[0].length), start });
    } else if (depth === 0) {
      if (selfClosed) blocks.push({ tag: name, html: m[0], start: m.index });
      else { depth = 1; start = m.index; tag = name; }
    } else if (!selfClosed) depth++;
  }
  return blocks;
}

// The site path a link points at, from the page at `fromPath`; null for an address outside the site.
function resolveHref(href, fromPath) {
  const bare = decodeEntities(href).split(/[#?]/)[0].trim();
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('//')) return null;
  let decoded = bare;
  try { decoded = decodeURIComponent(bare); } catch { /* an address that is not encoded stays as written */ }
  return canonicalNfc(path.posix.normalize(path.posix.join(path.posix.dirname(fromPath || ''), decoded)));
}

// Curled quotes read as straight ones, one character for one so offsets stay true: the recap is typeset with curled
// quotes (markdown.js) and a name may be written with either.
const straightQuotes = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

// The text and links of one paragraph's HTML, its quotes read straight. `linkAt` maps each link's site path to where
// its words start in the text; `linkSpans` is each link's words, as { start, end, target }. Each run of text is put in
// NFC as it is added, so every offset counts in the text the names are read in: composing a decomposed letter makes
// the text shorter, and offsets taken before it would point past the words they mean.
function readParagraph(html, fromPath) {
  const hrefs = new Set();
  const linkAt = new Map();
  const linkSpans = [];
  let link = null;   // the site link whose words are being read
  let text = '';
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    text += canonicalNfc(decodeEntities(html.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const name = m[2].toLowerCase();
    if (m[1] === '/') {
      if (name === 'a' && link) { linkSpans.push({ ...link, end: text.length }); link = null; }
      continue;
    }
    if (name === 'br') text += ' ';
    if (name !== 'a') continue;
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
    const target = href && resolveHref(href[1] !== undefined ? href[1] : href[2], fromPath);
    if (!target) continue;
    hrefs.add(target);
    if (!linkAt.has(target)) linkAt.set(target, text.length);
    link = { start: text.length, target };
  }
  text += canonicalNfc(decodeEntities(html.slice(last)));
  if (link) linkSpans.push({ ...link, end: text.length });
  return { text: straightQuotes(text), hrefs, linkAt, linkSpans };
}

// The recap's paragraphs: its top-level `<p>` blocks, one entry each. Where `marks` is given (the GM site) the HTML
// still carries the mark characters as plain text, and a mark can run across blocks, so the depth carries from one
// block to the next and what is marked is dropped before anything is read. `block` counts all top-level elements.
function paragraphsOf(recapHtml, { fromPath, marks = null } = {}) {
  const out = [];
  let open = [];   // the open tokens of marks still open, outermost first
  topLevelElements(recapHtml).forEach((el, block) => {
    const html = open.join('') + el.html;
    const kept = withoutMarked(html, marks);
    open = openMarks(html);
    if (el.tag !== 'p') return;
    const { text, hrefs, linkAt, linkSpans } = readParagraph(kept, fromPath);
    const paragraph = { block, text, hrefs, hasImage: /<img\b/i.test(kept) };
    // Not part of the shape callers compare.
    Object.defineProperties(paragraph, { linkAt: { value: linkAt }, linkSpans: { value: linkSpans } });
    out.push(paragraph);
  });
  return out;
}

// The open tokens of the marks still open at the end of the text, outermost first.
function openMarks(text) {
  const stack = [];
  for (const m of String(text).matchAll(/\uE000[0-9a-z]*\uE001|\uE002/g)) {
    if (m[0] === '\uE002') stack.pop();
    else stack.push(m[0]);
  }
  return stack;
}

// The first word of a name, its quotes read straight, lowercased.
const firstWord = (term) => straightQuotes(String(term)).trim().split(/\s+/)[0].toLowerCase();

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One whole-word pattern per name, its quotes read straight. A name of several words matches in any case; a one-word
// name only where it starts with a capital as written, so "Six" is found and "six guards" is not. A name under two
// characters never matches. Each is compiled once and kept (PATTERNS, by name): every candidate is read against every
// recap of the site. The pattern is the name alone; whole words are checked around each match (wholeWords), as a
// pattern holding the check (`(?<![\p{L}\p{N}])` and `(?![\p{L}\p{N}])`) would, which costs far more to build.
const PATTERNS = new Map();
function termPattern(term) {
  if (!PATTERNS.has(term)) PATTERNS.set(term, compileTerm(term));
  return PATTERNS.get(term);
}
const tooShort = (term) => Array.from(term).length < 2;
function compileTerm(term) {
  if (tooShort(term)) return null;
  const words = straightQuotes(term).split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return null;
  return { regex: new RegExp(words.join('\\s+'), words.length > 1 ? 'giu' : 'gu'), single: words.length === 1 };
}

// Each match of `pattern` in `text` with no letter or digit just before or after it, as `matchAll` would find them
// with the check in the pattern: a match that fails it is tried again one character on. From any one place a name can
// match only one way (its words hold no spaces, and the spaces between them are all taken), so nothing is missed.
const LETTER_BEFORE = /[\p{L}\p{N}]$/u;
const LETTER_AFTER = /^[\p{L}\p{N}]/u;
function* wholeWords(pattern, text) {
  const re = pattern.regex;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (!LETTER_BEFORE.test(text.slice(Math.max(0, start - 2), start)) && !LETTER_AFTER.test(text.slice(end, end + 2))) {
      yield m;
      re.lastIndex = end;
    } else re.lastIndex = start + (text.codePointAt(start) > 0xFFFF ? 2 : 1);
  }
}

// Where a candidate's names stand in one paragraph's text: each whole-word match of one of its names, as
// { start, end }, in no particular order. Kept per paragraph (SPANS), as every candidate is read against the others.
const SPANS = new WeakMap();
function nameSpans(candidate, p) {
  if (!SPANS.has(p)) SPANS.set(p, new Map());
  const known = SPANS.get(p);
  if (!known.has(candidate)) known.set(candidate, readSpans(candidate, p));
  return known.get(candidate);
}
function readSpans(candidate, p) {
  const out = [];
  const words = wordsOf(p);
  (candidate.terms || []).forEach((term, i) => {
    const runs = termRuns(term);
    if (runs !== null && !runs.every((w) => words.has(w))) return;
    const pattern = termPattern(term);
    if (!pattern) return;
    for (const m of wholeWords(pattern, p.text)) {
      if (pattern.single && !/^\p{Lu}/u.test(m[0])) continue;
      // `alias`: a one-word name after the title (a candidate's first name is its title).
      out.push({ start: m.index, end: m.index + m[0].length, alias: pattern.single && i > 0, word: m[0] });
    }
  });
  return out;
}

// The word index, so a paragraph is read only for the names whose words it holds: every site page's names are
// rivals in every paragraph (mentionsOf), and most of them are in none. A name's runs are its runs of letters and
// digits, lowercased; a name that matches holds each of them as a whole word of the paragraph (wordsOf, read the same
// way), and is indexed by its first. Only a name wholly in ASCII has runs: there lowercasing reads case as the
// patterns do (with "ſ" read as "s", the one other letter that matches an ASCII one in any case but "K", which
// lowercases to "k"). Any other name has none (null) and is always read. Each is worked out once (RUNS, WORDS, INDEX).
const RUN = /[\p{L}\p{N}]+/gu;
const RUNS = new Map();
function termRuns(term) {
  if (!RUNS.has(term)) {
    const plain = straightQuotes(term);
    const runs = /^[\x00-\x7F]*$/.test(plain) ? (plain.match(RUN) || []).map((w) => w.toLowerCase()) : [];
    RUNS.set(term, runs.length ? runs : null);
  }
  return RUNS.get(term);
}
const WORDS = new WeakMap();
function wordsOf(p) {
  if (!WORDS.has(p)) WORDS.set(p, new Set((p.text.match(RUN) || []).map((w) => w.toLowerCase().replace(/\u017F/g, 's'))));
  return WORDS.get(p);
}
// `list` (one of mentionsOf's `others` lists) by key: { byWord: Map(key -> entries), always: entries with a name that
// has none }. An entry with no name that can match is in neither. Kept per list, so the list every recap shares
// (nameHolders) is indexed once a build.
const INDEX = new WeakMap();
function indexOf(list) {
  if (INDEX.has(list)) return INDEX.get(list);
  const byWord = new Map();
  const always = [];
  for (const o of list) {
    const keys = (o.terms || []).filter((t) => !tooShort(t)).map((t) => { const runs = termRuns(t); return runs && runs[0]; });
    if (keys.includes(null)) { always.push(o); continue; }
    for (const key of new Set(keys)) {
      if (!byWord.has(key)) byWord.set(key, []);
      byWord.get(key).push(o);
    }
  }
  const index = { byWord, always };
  INDEX.set(list, index);
  return index;
}
// The entries of `list` that may name something in paragraph `p`, a Set; an entry not in it names nothing there.
// Kept per paragraph (MAY).
const MAY = new WeakMap();
function inParagraph(list, p) {
  if (!MAY.has(p)) MAY.set(p, new WeakMap());
  const known = MAY.get(p);
  if (known.has(list)) return known.get(list);
  const { byWord, always } = indexOf(list);
  const out = new Set(always);
  for (const word of wordsOf(p)) for (const o of byWord.get(word) || []) out.add(o);
  known.set(list, out);
  return out;
}
// The entries of `list`, a Set kept per list (MEMBERS).
const MEMBERS = new WeakMap();
function membersOf(list) {
  if (!MEMBERS.has(list)) MEMBERS.set(list, new Set(list));
  return MEMBERS.get(list);
}
// mentionsOf's `others`: one list, or { lists, except }, several lists read as one, less `except`. Each list is
// indexed on its own, so one shared by every recap is never indexed again with a recap's own candidates.
const poolOf = (others) => (Array.isArray(others) ? { lists: [others], except: null } : { lists: others.lists, except: others.except || null });

// Where a candidate is mentioned: each paragraph (index into `paragraphs`) that links it or names it, in order, with
// the offset of the first such link or name. The candidate's link targets are `hrefs` when it has them, else its
// `outputPath`. Longest match wins: a name lying wholly inside a longer name of one of `others` (the other
// candidates, and nameHolders' pages but the candidate's own) does not count there, so "Pelham" is not read inside
// "Lady Anne Pelham". A name lying wholly inside the words of a link to another page does not count either: those
// words name where the link goes. A link always counts. `others` is one list or several (poolOf).
function mentionsOf(candidate, paragraphs, others = []) {
  const { lists, except } = poolOf(others);
  const targets = (candidate.hrefs ? [...candidate.hrefs] : [candidate.outputPath]).filter(Boolean).map(canonicalNfc);
  const rival = (o) => o !== candidate && o !== except && !(o.outputPath && targets.includes(canonicalNfc(o.outputPath)));
  // A candidate among `others` (placeFigures) is read only in the paragraphs the index says may name it.
  const indexed = lists.some((list) => membersOf(list).has(candidate));
  const out = [];
  // A one-word alias that another page's longer name begins with ("Anna" for Clara Fen; "Anna Lindqvist") is, unlinked,
  // that page's first name as likely as this alias: it names neither, so only a link or a fuller name counts. This holds
  // only where that page is in the recap, by its full name or a link to it; where it is not, the alias is this page's.
  // (A name another page has whole is not a first name: two pages with one name both count.) Read once, when asked.
  let firstNames = null;
  const firstNamesInRecap = () => {
    if (firstNames) return firstNames;
    firstNames = new Set();
    // A scene's pages are read one by one: Bob Smith in the recap is not Anna Lindqvist there.
    const members = lists.flatMap((list) => list).filter(rival)
      .flatMap((o) => (o.pages ? o.pages.map((pg) => ({ addresses: [pg.href], terms: pg.terms })) : [{ addresses: o.hrefs ? [...o.hrefs] : [o.outputPath], terms: o.terms }]));
    for (const m of members) {
      const full = (m.terms || []).filter((t) => /\s/.test(String(t).trim()));
      if (full.length === 0) continue;
      const addresses = m.addresses.filter(Boolean).map(canonicalNfc);
      if (paragraphs.some((q) => addresses.some((h) => q.hrefs.has(h)) || nameSpans({ terms: full }, q).length > 0)) {
        for (const t of full) firstNames.add(firstWord(t));
      }
    }
    return firstNames;
  };
  paragraphs.forEach((p, para) => {
    let at = Infinity;
    for (const t of targets) {
      if (!p.hrefs.has(t)) continue;
      at = Math.min(at, p.linkAt && p.linkAt.has(t) ? p.linkAt.get(t) : 0);
    }
    const may = lists.map((list) => inParagraph(list, p));
    const spans = !indexed || may.some((s) => s.has(candidate)) ? nameSpans(candidate, p) : [];
    const longer = spans.length ? may.flatMap((s) => [...s]).filter(rival).flatMap((o) => nameSpans(o, p)) : [];
    const elsewhere = spans.length && p.linkSpans ? p.linkSpans.filter((l) => !targets.includes(l.target)) : [];
    const within = (n) => (l) => l.start <= n.start && n.end <= l.end;
    for (const n of spans) {
      if (n.alias && firstNamesInRecap().has(straightQuotes(n.word).toLowerCase())) continue;
      const inside = longer.some((l) => l.end - l.start > n.end - n.start && within(n)(l)) || elsewhere.some(within(n));
      if (!inside) at = Math.min(at, n.start);
    }
    if (at !== Infinity) out.push({ para, at });
  });
  return out;
}

// Which paragraph each picture goes beside: a Map from paragraph index to the candidates shown there, at most
// `perParagraph` each. Mentions are read with mentionsOf against all the others and `blockers` (nameHolders). A scene's
// picture (a candidate with `pages`, sceneSpots) claims first, beside the paragraph that mentions the most of its pages,
// the earliest on a tie; scenes claim in the order of the paragraphs they choose (then position, then as given), and
// one whose paragraph is full takes the next best that has room. Page pictures then fill what is left, in the order of
// their first mention (paragraph, then position, then title), each at the first paragraph that names it and has room.
// A candidate with no room anywhere it is mentioned is left out. A paragraph that already holds an image takes none,
// and a candidate whose key is in `taken` (a picture the recap already shows) is skipped.
function placeFigures(candidates, paragraphs, { perParagraph = 2, taken = new Set(), blockers = [] } = {}) {
  const slots = new Map();
  const open = (i) => !paragraphs[i].hasImage && (slots.get(i) || []).length < perParagraph;
  const claim = (spots, c) => {
    const spot = spots.find((m) => open(m.para));
    if (spot) slots.set(spot.para, [...(slots.get(spot.para) || []), c]);
  };
  const others = { lists: [candidates, blockers] };
  const live = candidates.filter((c) => !taken.has(c.key));
  live.filter((c) => c.pages)
    .map((c, n) => ({ c, n, spots: sceneSpots(c, paragraphs, others) }))
    .filter((x) => x.spots.length > 0)
    .sort((a, b) => a.spots[0].para - b.spots[0].para || a.spots[0].at - b.spots[0].at || a.n - b.n)
    .forEach(({ c, spots }) => claim(spots, c));
  live.filter((c) => !c.pages)
    .map((c) => ({ c, ms: mentionsOf(c, paragraphs, others) }))
    .filter((x) => x.ms.length > 0)
    .sort((a, b) => a.ms[0].para - b.ms[0].para || a.ms[0].at - b.ms[0].at || a.c.title.localeCompare(b.c.title))
    .forEach(({ c, ms }) => claim(ms, c));
  return slots;
}

// A title word is read in a paragraph by its first five letters (or the whole word, when it has four): "becalming"
// is read in "becalmed", "confession" in "confessed".
function readsWord(words, title) {
  const stem = title.slice(0, 5);
  for (const w of words) if (w.length >= 4 && w.startsWith(stem)) return true;
  return false;
}

// The paragraphs a scene's picture may go beside, best first: each that mentions at least one of its `pages` (by
// mentionsOf's rules, each page read on its own against `others`). The scene's title words come first: a paragraph
// that reads one ranks above one that does not, a word weighing the more the fewer paragraphs read it ("cylinder" in
// every paragraph says little, "becalmed" in one says where). Then by how many of the pages a paragraph mentions, most
// first, then earliest. `at`: where the first of them stands in it.
function sceneSpots(scene, paragraphs, others) {
  const byPara = new Map();
  for (const { href, terms } of scene.pages) {
    for (const { para, at } of mentionsOf({ outputPath: href, terms }, paragraphs, others)) {
      const spot = byPara.get(para) || { para, at, count: 0, weight: 0 };
      spot.count++;
      spot.at = Math.min(spot.at, at);
      byPara.set(para, spot);
    }
  }
  for (const word of scene.words || []) {
    const reading = paragraphs.map((_, para) => para).filter((para) => readsWord(wordsOf(paragraphs[para]), word));
    for (const para of reading) if (byPara.has(para)) byPara.get(para).weight += 1 / reading.length;
  }
  return [...byPara.values()].sort((a, b) => b.weight - a.weight || b.count - a.count || a.para - b.para);
}

const ZOOM = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The picture's address from the page at `fromPath`: under images/, encoded as the recap's own pictures are.
const imageSrc = (entry, fromPath) => encodeImageUrl(relativeHref(fromPath, `images/${entry.relPath}`));

// The recap with each placed paragraph's pictures put in: a float just before its `<p>` (sides alternate from the
// right, one per paragraph that has floats, in reading order), a plate just after it. A scene's picture follows
// `mode` (`player_site.story.scene_pictures`): 'inline', a plate; 'float', a float; 'mixed', in threes in reading order,
// the first a plate and the next two floats. A page's picture is always a float. Nothing else in the recap changes.
// `paragraphs` is what `placement` was made from (paragraphsOf), so its `block` numbers count the same top-level
// elements. On the GM site a mark still open where a picture goes is closed before it and opened again after it
// (for a float, just inside the `<p>`), so a picture players also see is never drawn inside a GM mark. `candidates`
// and `blockers`: what placement was read against, read as mentionsOf reads them.
function figuresHtml(recapHtml, placement, { fromPath, imageMap, paragraphs, candidates = [], blockers = [], mode = 'inline' }) {
  const html = String(recapHtml || '');
  if (!placement || placement.size === 0) return html;
  const elements = topLevelElements(html);
  const edits = [];   // { at, text, skip }: `text` goes in at `at`, and `skip` characters after it are kept as they are
  let floats = 0;
  let scenes = 0;
  [...placement.keys()].sort((a, b) => a - b).forEach((para) => {
    const el = elements[paragraphs[para].block];
    const at = el.start;
    const floating = [];
    const plates = [];
    for (const c of placement.get(para)) {
      // A scene's picture has no caption and an empty alt, and its link a name that says nothing of it: nothing of the
      // scene note reaches the page. A page's picture that a scene joined (withFigures) is drawn as the scene's beside
      // a paragraph that never names the page.
      const scene = c.scene || (c.own && !mentionsOf(c.own, paragraphs, { lists: [candidates, blockers], except: c }).some((m) => m.para === para));
      const plate = scene && (mode === 'inline' || (mode === 'mixed' && scenes % 3 === 0));
      if (scene) scenes++;
      (plate ? plates : floating).push({ c, scene });
    }
    const draw = ({ c, scene }, plate) => {
      const src = escapeText(imageSrc(imageMap[c.key], fromPath));
      const title = scene ? '' : escapeText(c.title);
      return `<figure class="story-figure${plate ? ' story-figure--plate' : c.place || scene ? ' story-figure--place' : ''}">`
        + `<a class="story-figure__open" href="${src}"${scene ? ' aria-label="Open picture"' : ''}>`
        + `<img src="${src}" alt="${title}" loading="lazy"><span class="story-figure__zoom" aria-hidden="true">${ZOOM}</span></a>`
        + `${scene ? '' : `<figcaption>${title}</figcaption>`}</figure>`;
    };
    if (floating.length) {
      const classes = ['story-figures', ...(floats++ % 2 ? ['story-figures--left'] : []), ...(floating.length > 1 ? ['story-figures--two'] : [])];
      const div = `<div class="${classes.join(' ')}">${floating.map((x) => draw(x, false)).join('')}</div>`;
      const open = openMarks(html.slice(0, at));
      if (open.length === 0) edits.push({ at, text: div, skip: 0 });
      else {
        const tag = /^<p\b(?:"[^"]*"|'[^']*'|[^>"'])*>/i.exec(html.slice(at))[0];
        edits.push({ at, text: `${''.repeat(open.length)}${div}${tag}${open.join('')}`, skip: tag.length });
      }
    }
    if (plates.length) {
      const end = at + el.html.length;
      const open = openMarks(html.slice(0, end));
      const div = `<div class="story-figures story-figures--plate">${plates.map((x) => draw(x, true)).join('')}</div>`;
      edits.push({ at: end, text: `${''.repeat(open.length)}${div}${open.join('')}`, skip: 0 });
    }
  });
  let out = '';
  let last = 0;
  for (const e of edits.sort((x, y) => x.at - y.at)) {   // stable: a paragraph's plate comes before the next one's float
    out += html.slice(last, e.at) + e.text;
    last = e.at + e.skip;
  }
  return out + html.slice(last);
}

// A picture the GM embedded in the recap, a paragraph of its own, drawn as a plate: a full-width figure with the zoom
// link the side pictures have. Its alt text, and its caption, are what the GM wrote after the `|` of the embed (the
// processor made it the image's alt); with none, the alt is empty, never the file name, and nothing of a scene note
// reaches the page. Only a paragraph that holds
// nothing but one picture of the site's is changed (a mark inside it, or other words, leave it as it was). Where the
// picture stands is untouched.
function platesHtml(recapHtml, { fromPath, imageMap }) {
  const html = String(recapHtml || '');
  if (!html.includes('<img')) return html;
  const byPath = new Map(Object.entries(imageMap || {}).map(([key, e]) => [canonicalNfc(`images/${e.relPath}`), key]));
  let out = '';
  let last = 0;
  for (const el of topLevelElements(html)) {
    const one = el.tag === 'p' && /^<p(?:\s[^>]*)?>\s*(<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>)\s*<\/p>$/i.exec(el.html);
    if (!one) continue;
    const attr = (name) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(one[1]); return m ? (m[1] !== undefined ? m[1] : m[2]) : null; };
    const src = attr('src');
    const key = src !== null && byPath.get(resolveHref(src, fromPath));
    if (!key) continue;
    const written = (attr('alt') || '').trim();
        const url = escapeText(imageSrc(imageMap[key], fromPath));
    out += html.slice(last, el.start)
      + `<figure class="story-figure story-figure--plate"><a class="story-figure__open" href="${url}">`
      + `<img src="${url}" alt="${written}" loading="lazy"><span class="story-figure__zoom" aria-hidden="true">${ZOOM}</span></a>`
      + `${written ? `<figcaption>${written}</figcaption>` : ''}</figure>`;
    last = el.start + el.html.length;
  }
  return out + html.slice(last);
}

// The image keys of the pictures a recap already shows, as players see it: each `<img>` whose address is a picture in
// `imageMap`. A picture the GM placed stays where it is, and its page gets no second one.
function shownImages(recapHtml, { fromPath, imageMap, marks = null }) {
  const byPath = new Map(Object.entries(imageMap || {}).map(([key, e]) => [canonicalNfc(`images/${e.relPath}`), key]));
  const out = new Set();
  for (const m of withoutMarked(String(recapHtml || ''), marks).matchAll(/<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
    const target = src && resolveHref(src[1] !== undefined ? src[1] : src[2], fromPath);
    if (target && byPath.has(target)) out.add(byPath.get(target));
  }
  return out;
}

// One recap with its pictures: where `candidates` (less the unit's own pages, `exclude`) and the unit's `scenes`
// (sceneCandidates) are mentioned, read as players see the recap (`marks`, the GM site), placed and drawn. A scene
// whose picture is already a candidate's (a page's portrait, or another scene's) joins that candidate: one picture,
// placed as a scene's (placeFigures), its pages all of theirs, the page's own among them. It is drawn as that candidate is where the paragraph names the
// candidate's own page (`own`: its names and links), and as a scene's picture where only the scene's pages are named,
// so a caption never names someone the paragraph does not. `blockers` (nameHolders) are the names of every page
// players see, for mentionsOf. Each picture placed is added to `usedImages` so the build copies it.
// Once per chapter: a page's picture whose key is in `shown` (pictured on an earlier Story page of the chapter) is left
// out; a scene's never is, as a scene is pictured where it is played. `pictured`, a Set, is given the keys of the page
// pictures placed here (one a scene joined among them) and of the pictures the recap already shows, for the next page.
function withFigures(recapHtml, { candidates, scenes = [], exclude = new Set(), blockers = [], fromPath, imageMap, usedImages = null, marks = null, shown = null, pictured = null, mode = 'inline' }) {
  const all = [];
  const pages = (candidates || []).filter((x) => !exclude.has(x.page) && !(shown && shown.has(x.key)));
  for (const c of [...pages, ...scenes]) {
    const at = c.scene ? all.findIndex((x) => x.key === c.key) : -1;
    if (at < 0) { all.push(c); continue; }
    const held = all[at];
    const seen = new Set((held.terms || []).map((t) => t.toLowerCase()));
    const terms = [...(held.terms || []), ...c.terms.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))];
    // A page's address is compared in NFC, as a scene's are (sceneCandidates), so a page both list is counted once.
    const heldHrefs = held.hrefs ? [...held.hrefs] : [canonicalNfc(held.outputPath)];
    const own = held.own || (held.scene ? null : { terms: held.terms || [], hrefs: new Set(heldHrefs) });
    const pages = [...(held.pages || [{ href: heldHrefs[0], terms: held.terms || [] }])];
    for (const pg of c.pages || []) if (!pages.some((x) => canonicalNfc(x.href) === canonicalNfc(pg.href))) pages.push(pg);
    all[at] = { ...held, terms, hrefs: new Set([...heldHrefs, ...c.hrefs]), pages, own, words: [...new Set([...(held.words || []), ...(c.words || [])])] };
  }
  if (!recapHtml) return recapHtml;
  const taken = all.length > 0 || pictured ? shownImages(recapHtml, { fromPath, imageMap, marks }) : null;
  if (pictured) for (const key of taken) pictured.add(key);
  if (all.length === 0) return recapHtml;
  const paragraphs = paragraphsOf(recapHtml, { fromPath, marks });
  const placement = placeFigures(all, paragraphs, { taken, blockers });
  for (const placed of placement.values()) {
    for (const c of placed) {
      if (usedImages) usedImages.add(c.key);
      if (pictured && !c.scene) pictured.add(c.key);
    }
  }
  return figuresHtml(recapHtml, placement, { fromPath, imageMap, paragraphs, candidates: all, blockers, mode });
}

module.exports = { platesHtml, figureCandidates, pageNames, nameHolders, scenePicture, sceneCandidates, paragraphsOf, mentionsOf, placeFigures, figuresHtml, shownImages, withFigures, topLevelElements, openMarks };
