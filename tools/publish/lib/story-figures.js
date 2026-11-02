'use strict';
// Pictures beside a session recap: which pages may be pictured, where the recap mentions them, and which paragraph
// each picture goes beside. Pure: it reads pages and the recap's HTML and changes nothing, so no word of the recap
// is ever touched; the build adds a figure before the paragraph it chose.

const path = require('node:path');
const { portraitBasename, nameList, isWebImageAddress, publishedFrontmatter, relativeHref, encodeImageUrl, strippedLines, fenceStep, IMAGE_EXT_REGEX } = require('./processor');
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

// The pages that may be named for a picture, each with its published frontmatter: not a PC, not one of `exclude`,
// and on the GM site (`onPlayerSite`, a Set of the pages the player site publishes) only those.
function* namedPages(pages, { onPlayerSite = null, exclude = new Set(), excludeFields = [], overridesOf = null } = {}) {
  for (const page of pages) {
    if (exclude.has(page) || (onPlayerSite && !onPlayerSite.has(page))) continue;
    const source = page.sourceFrontmatter || page.frontmatter || {};
    if (source.type === 'pc') continue;
    yield { page, source, published: publishedFrontmatter(page.frontmatter || {}, excludeFields, (overridesOf && overridesOf(page)) || {}) };
  }
}

// The pages a recap may be pictured with, in `pages` order. `onPlayerSite` (the GM site: a Set of the pages the
// player site publishes) keeps only those; `exclude` is a Set of the unit's own pages. A page counts when it is not
// a PC and its portrait names an attachment the build has. Its names are namesOf's.
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
// names (namesOf), with figureCandidates' rules for which pages count.
function pageNames(pages, { marks = null, ...options } = {}) {
  const out = new Map();
  for (const { page, published } of namedPages(pages, options)) out.set(page.outputPath, namesOf(page, published, marks).terms);
  return out;
}

// A scene's picture: the file name of the first image embed (`![[x.png]]` or `![](x.png)`) after its H1 (from the top
// when it has none) and before its next heading (`#`, or text underlined with `===` or `---`), read with gm-only and
// spoiler fences, comments and callouts taken out and code left alone; null when there is none. Any other picture in
// the scene is never used.
function scenePicture(body) {
  const lines = strippedLines(String(body == null ? '' : body).replace(/\r\n?/g, '\n'), true).lines;
  // Each line outside code as { line, level }: a heading's level, 0 for any other line. A setext heading's text lines
  // become one heading when its underline is reached; an underline after a blank line is a rule.
  const read = [];
  let para = [];   // where the paragraph so far starts in `read`, while it has lines
  let fence = null;
  for (const line of lines) {
    const step = fenceStep(line, fence);
    const inCode = fence !== null || step.isFenceLine;
    fence = step.fenceDelim;
    if (inCode) { para = []; continue; }
    const atx = /^ {0,3}(#{1,6})(\s|$)/.exec(line);
    const under = /^ {0,3}(=+|-+)\s*$/.exec(line);
    if (under && para.length) { read.splice(para[0]); read.push({ line: '', level: under[1][0] === '=' ? 1 : 2 }); para = []; continue; }
    if (atx || under || !line.trim()) { read.push({ line, level: atx ? atx[1].length : 0 }); para = []; continue; }
    if (!para.length) para = [read.length];
    read.push({ line, level: 0 });
  }
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
// `names` (pageNames: player-site pages, not PCs). Its candidate has those pages' names and addresses and nothing of
// the scene's own: no title, no words. A scene with no picture or no such page gives none.
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
    for (const target of [...linksOf(fm.locations), ...linksOf(fm.entities)]) {
      const at = linkMap[target] || folded(target);
      if (!at || !names.has(at)) continue;
      hrefs.add(canonicalNfc(at));
      for (const term of names.get(at)) if (!seen.has(term.toLowerCase())) { seen.add(term.toLowerCase()); terms.push(term); }
    }
    if (hrefs.size === 0) continue;
    scenes.push({ sessions: sessionsOfScene(scene, vault), candidate: { key, outputPath: null, title: '', terms, hrefs, place: true, scene: true } });
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
// its words start in the text.
function readParagraph(html, fromPath) {
  const hrefs = new Set();
  const linkAt = new Map();
  let text = '';
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    text += decodeEntities(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--') || m[1] === '/') continue;
    const name = m[2].toLowerCase();
    if (name === 'br') text += ' ';
    if (name !== 'a') continue;
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
    const target = href && resolveHref(href[1] !== undefined ? href[1] : href[2], fromPath);
    if (!target) continue;
    hrefs.add(target);
    if (!linkAt.has(target)) linkAt.set(target, text.length);
  }
  text += decodeEntities(html.slice(last));
  return { text: straightQuotes(canonicalNfc(text)), hrefs, linkAt };
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
    const { text, hrefs, linkAt } = readParagraph(kept, fromPath);
    const paragraph = { block, text, hrefs, hasImage: /<img\b/i.test(kept) };
    Object.defineProperty(paragraph, 'linkAt', { value: linkAt });   // not part of the shape callers compare
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

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One whole-word pattern per name, its quotes read straight. A name of several words matches in any case; a one-word
// name only where it starts with a capital as written, so "Six" is found and "six guards" is not. A name under two
// characters never matches. Each is compiled once and kept (PATTERNS, by name): every candidate is read against every
// recap of the site.
const PATTERNS = new Map();
function termPattern(term) {
  if (!PATTERNS.has(term)) PATTERNS.set(term, compileTerm(term));
  return PATTERNS.get(term);
}
function compileTerm(term) {
  if (Array.from(term).length < 2) return null;
  const words = straightQuotes(term).split(/\s+/).map(escapeRegExp);
  const source = `(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`;
  return { regex: new RegExp(source, words.length > 1 ? 'giu' : 'gu'), single: words.length === 1 };
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
  for (const pattern of (candidate.terms || []).map(termPattern)) {
    if (!pattern) continue;
    pattern.regex.lastIndex = 0;
    for (const m of p.text.matchAll(pattern.regex)) {
      if (pattern.single && !/^\p{Lu}/u.test(m[0])) continue;
      out.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

// Where a candidate is mentioned: each paragraph (index into `paragraphs`) that links it or names it, in order, with
// the offset of the first such link or name. The candidate's link targets are `hrefs` when it has them, else its
// `outputPath`. Longest match wins: a name lying wholly inside a longer name of one of `others` (the other
// candidates) does not count there, so "Pelham" is not read inside "Lady Anne Pelham"; a link always counts.
function mentionsOf(candidate, paragraphs, others = []) {
  const targets = candidate.hrefs ? [...candidate.hrefs] : [candidate.outputPath];
  const rivals = others.filter((o) => o !== candidate);
  const out = [];
  paragraphs.forEach((p, para) => {
    let at = Infinity;
    for (const t of targets) {
      if (!p.hrefs.has(t)) continue;
      at = Math.min(at, p.linkAt && p.linkAt.has(t) ? p.linkAt.get(t) : 0);
    }
    const spans = nameSpans(candidate, p);
    const longer = spans.length ? rivals.flatMap((o) => nameSpans(o, p)) : [];
    for (const n of spans) {
      const inside = longer.some((l) => l.end - l.start > n.end - n.start && l.start <= n.start && n.end <= l.end);
      if (!inside) at = Math.min(at, n.start);
    }
    if (at !== Infinity) out.push({ para, at });
  });
  return out;
}

// Which paragraph each picture goes beside: a Map from paragraph index to the candidates shown there, at most
// `perParagraph` each. Candidates claim in the order of their first mention (paragraph, then position, then title),
// read with mentionsOf against all the others. Each takes the first paragraph that names it and has room, and is left
// out if none does. A paragraph that already holds an image takes none, and a candidate whose key is in `taken` (a
// picture the recap already shows) is skipped.
function placeFigures(candidates, paragraphs, { perParagraph = 2, taken = new Set() } = {}) {
  const slots = new Map();
  const open = (i) => !paragraphs[i].hasImage && (slots.get(i) || []).length < perParagraph;
  const ranked = candidates
    .filter((c) => !taken.has(c.key))
    .map((c) => ({ c, ms: mentionsOf(c, paragraphs, candidates) }))
    .filter((x) => x.ms.length > 0)
    .sort((a, b) => a.ms[0].para - b.ms[0].para || a.ms[0].at - b.ms[0].at || a.c.title.localeCompare(b.c.title));
  for (const { c, ms } of ranked) {
    const spot = ms.find((m) => open(m.para));
    if (spot) slots.set(spot.para, [...(slots.get(spot.para) || []), c]);
  }
  return slots;
}

const ZOOM = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The picture's address from the page at `fromPath`: under images/, encoded as the recap's own pictures are.
const imageSrc = (entry, fromPath) => encodeImageUrl(relativeHref(fromPath, `images/${entry.relPath}`));

// The recap with each placed paragraph's float put just before its `<p>`: sides alternate from the right, one per
// paragraph that has pictures, in reading order. Nothing else in the recap changes. `paragraphs` is what `placement`
// was made from (paragraphsOf), so its `block` numbers count the same top-level elements. On the GM site a mark still
// open where the paragraph starts is closed before the float and opened again just inside the `<p>`, so a picture
// players also see is never drawn inside a GM mark. `candidates`: all that were placed from, read as mentionsOf reads
// them.
function figuresHtml(recapHtml, placement, { fromPath, imageMap, paragraphs, candidates = [] }) {
  const html = String(recapHtml || '');
  if (!placement || placement.size === 0) return html;
  const starts = topLevelElements(html).map((el) => el.start);
  let out = '';
  let last = 0;
  [...placement.keys()].sort((a, b) => a - b).forEach((para, n) => {
    const at = starts[paragraphs[para].block];
    const shown = placement.get(para);
    const classes = ['story-figures', ...(n % 2 ? ['story-figures--left'] : []), ...(shown.length > 1 ? ['story-figures--two'] : [])];
    const figs = shown.map((c) => {
      const src = escapeText(imageSrc(imageMap[c.key], fromPath));
      // A scene's picture has no caption and an empty alt, and its link a name that says nothing of it: nothing of the
      // scene note reaches the page. A page's picture that a scene joined (withFigures) is drawn as the scene's beside
      // a paragraph that never names the page.
      const scene = c.scene || (c.own && mentionsOf(c.own, [paragraphs[para]], candidates.filter((o) => o !== c)).length === 0);
      const title = scene ? '' : escapeText(c.title);
      return `<figure class="story-figure${c.place || scene ? ' story-figure--place' : ''}">`
        + `<a class="story-figure__open" href="${src}"${scene ? ' aria-label="Open picture"' : ''}>`
        + `<img src="${src}" alt="${title}" loading="lazy"><span class="story-figure__zoom" aria-hidden="true">${ZOOM}</span></a>`
        + `${scene ? '' : `<figcaption>${title}</figcaption>`}</figure>`;
    }).join('');
    const open = openMarks(html.slice(0, at));
    if (open.length === 0) {
      out += `${html.slice(last, at)}<div class="${classes.join(' ')}">${figs}</div>`;
      last = at;
      return;
    }
    const tag = /^<p\b(?:"[^"]*"|'[^']*'|[^>"'])*>/i.exec(html.slice(at))[0];
    out += `${html.slice(last, at)}${'\uE002'.repeat(open.length)}<div class="${classes.join(' ')}">${figs}</div>${tag}${open.join('')}`;
    last = at + tag.length;
  });
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
// placed at the first mention of any of their pages. It is drawn as that candidate is where the paragraph names the
// candidate's own page (`own`: its names and links), and as a scene's picture where only the scene's pages are named,
// so a caption never names someone the paragraph does not. Each picture placed is added to `usedImages` so the build
// copies it.
function withFigures(recapHtml, { candidates, scenes = [], exclude = new Set(), fromPath, imageMap, usedImages = null, marks = null }) {
  const all = [];
  for (const c of [...(candidates || []).filter((x) => !exclude.has(x.page)), ...scenes]) {
    const at = c.scene ? all.findIndex((x) => x.key === c.key) : -1;
    if (at < 0) { all.push(c); continue; }
    const held = all[at];
    const seen = new Set((held.terms || []).map((t) => t.toLowerCase()));
    const terms = [...(held.terms || []), ...c.terms.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))];
    const own = held.own || (held.scene ? null : { terms: held.terms || [], hrefs: new Set(held.hrefs || [held.outputPath]) });
    all[at] = { ...held, terms, hrefs: new Set([...(held.hrefs || [held.outputPath]), ...c.hrefs]), own };
  }
  if (!recapHtml || all.length === 0) return recapHtml;
  const paragraphs = paragraphsOf(recapHtml, { fromPath, marks });
  const taken = shownImages(recapHtml, { fromPath, imageMap, marks });
  const placement = placeFigures(all, paragraphs, { taken });
  if (usedImages) for (const shown of placement.values()) for (const c of shown) usedImages.add(c.key);
  return figuresHtml(recapHtml, placement, { fromPath, imageMap, paragraphs, candidates: all });
}

module.exports = { figureCandidates, pageNames, scenePicture, sceneCandidates, paragraphsOf, mentionsOf, placeFigures, figuresHtml, shownImages, withFigures };
