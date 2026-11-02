'use strict';
// Pictures beside a session recap: which pages may be pictured, where the recap mentions them, and which paragraph
// each picture goes beside. Pure: it reads pages and the recap's HTML and changes nothing, so no word of the recap
// is ever touched; the build adds a figure before the paragraph it chose.

const path = require('node:path');
const { portraitBasename, nameList, isWebImageAddress, publishedFrontmatter, relativeHref, encodeImageUrl } = require('./processor');
const { canonicalNfc } = require('./unicode');
const { withoutMarked } = require('./gm-marks');
const { decodeEntities } = require('./templates/gurps/tables');

const PLACE_TYPES = new Set(['location', 'faction', 'item']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// A tag (quoted attribute values may hold a `>`) or a comment.
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

// The pages a recap may be pictured with, in `pages` order. `onPlayerSite` (the GM site: a Set of the pages the
// player site publishes) keeps only those; `exclude` is a Set of the unit's own pages. A page counts when it is not
// a PC and its portrait names an attachment the build has. Its names are its published title and published
// `aliases`: a hidden field is not a name, and `gm_aliases` is never read. On the GM site (`marks`, the build's marks) a
// title or alias can hold a marked name (a withheld note's, kept for the GM): each is read as players see it, so a
// caption never prints the GM's name and the names match the words the player page has.
function figureCandidates(pages, { imageMap, onPlayerSite = null, exclude = new Set(), excludeFields = [], overridesOf = null, marks = null } = {}) {
  const out = [];
  for (const page of pages) {
    if (exclude.has(page) || (onPlayerSite && !onPlayerSite.has(page))) continue;
    const source = page.sourceFrontmatter || page.frontmatter || {};
    if (source.type === 'pc') continue;
    const published = publishedFrontmatter(page.frontmatter || {}, excludeFields, (overridesOf && overridesOf(page)) || {});
    const base = portraitBasename(published);
    if (!base || isWebImageAddress(published.portrait)) continue;
    const key = canonicalNfc(base);
    if (!imageMap || !(key in imageMap)) continue;
    const title = withoutMarked(page.displayTitle || page.title || '', marks).trim();
    const seen = new Set();
    const terms = [];
    for (const raw of [title, ...nameList(published.aliases)]) {
      const term = canonicalNfc(withoutMarked(raw, marks)).trim();
      if (term && !seen.has(term.toLowerCase())) { seen.add(term.toLowerCase()); terms.push(term); }
    }
    out.push({ page, key, outputPath: page.outputPath, title, terms, place: PLACE_TYPES.has(source.type) });
  }
  return out;
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

// The text and links of one paragraph's HTML. `linkAt` maps each link's site path to where its words start in the text.
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
  return { text: canonicalNfc(text), hrefs, linkAt };
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

// One whole-word pattern per name. A name of several words matches in any case; a one-word name only where it starts
// with a capital as written, so "Six" is found and "six guards" is not. A name under two characters never matches.
function termPattern(term) {
  if (Array.from(term).length < 2) return null;
  const words = term.split(/\s+/).map(escapeRegExp);
  const source = `(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`;
  return { regex: new RegExp(source, words.length > 1 ? 'giu' : 'gu'), single: words.length === 1 };
}

// Where a candidate is mentioned: each paragraph (index into `paragraphs`) that links it or names it, in order, with
// the offset of the first such link or name. The candidate's link targets are `hrefs` when it has them, else its
// `outputPath`.
function mentionsOf(candidate, paragraphs) {
  const targets = candidate.hrefs ? [...candidate.hrefs] : [candidate.outputPath];
  const patterns = (candidate.terms || []).map(termPattern).filter(Boolean);
  const out = [];
  paragraphs.forEach((p, para) => {
    let at = Infinity;
    for (const t of targets) {
      if (!p.hrefs.has(t)) continue;
      at = Math.min(at, p.linkAt && p.linkAt.has(t) ? p.linkAt.get(t) : 0);
    }
    for (const { regex, single } of patterns) {
      regex.lastIndex = 0;
      for (const m of p.text.matchAll(regex)) {
        if (single && !/^\p{Lu}/u.test(m[0])) continue;
        at = Math.min(at, m.index);
        break;
      }
    }
    if (at !== Infinity) out.push({ para, at });
  });
  return out;
}

// Which paragraph each picture goes beside: a Map from paragraph index to the candidates shown there, at most
// `perParagraph` each. Candidates claim in the order of their first mention (paragraph, then position, then title);
// each takes the first paragraph that names it and has room, and is left out if none does. A paragraph that already
// holds an image takes none, and a candidate whose key is in `taken` (a picture the recap already shows) is skipped.
function placeFigures(candidates, paragraphs, { perParagraph = 2, taken = new Set() } = {}) {
  const slots = new Map();
  const open = (i) => !paragraphs[i].hasImage && (slots.get(i) || []).length < perParagraph;
  const ranked = candidates
    .filter((c) => !taken.has(c.key))
    .map((c) => ({ c, ms: mentionsOf(c, paragraphs) }))
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
// was made from (paragraphsOf), so its `block` numbers count the same top-level elements.
function figuresHtml(recapHtml, placement, { fromPath, imageMap, paragraphs }) {
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
      const title = escapeText(c.title);
      return `<figure class="story-figure${c.place ? ' story-figure--place' : ''}"><a class="story-figure__open" href="${src}">`
        + `<img src="${src}" alt="${title}" loading="lazy"><span class="story-figure__zoom" aria-hidden="true">${ZOOM}</span></a>`
        + `<figcaption>${title}</figcaption></figure>`;
    }).join('');
    out += `${html.slice(last, at)}<div class="${classes.join(' ')}">${figs}</div>`;
    last = at;
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

// One recap with its pictures: where `candidates` (less the unit's own pages, `exclude`) are mentioned, read as
// players see the recap (`marks`, the GM site), placed and drawn. Each picture placed is added to `usedImages` so the
// build copies it.
function withFigures(recapHtml, { candidates, exclude = new Set(), fromPath, imageMap, usedImages = null, marks = null }) {
  if (!recapHtml || !candidates || candidates.length === 0) return recapHtml;
  const paragraphs = paragraphsOf(recapHtml, { fromPath, marks });
  const taken = shownImages(recapHtml, { fromPath, imageMap, marks });
  const placement = placeFigures(candidates.filter((c) => !exclude.has(c.page)), paragraphs, { taken });
  if (usedImages) for (const shown of placement.values()) for (const c of shown) usedImages.add(c.key);
  return figuresHtml(recapHtml, placement, { fromPath, imageMap, paragraphs });
}

module.exports = { figureCandidates, paragraphsOf, mentionsOf, placeFigures, figuresHtml, shownImages, withFigures };
