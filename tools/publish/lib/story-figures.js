'use strict';
// Pictures beside a session recap: which pages may be pictured, where the recap mentions them, and which paragraph
// each picture goes beside. Pure: it reads pages and the recap's HTML and changes nothing, so no word of the recap
// is ever touched; the build adds a figure before the paragraph it chose.

const path = require('node:path');
const { portraitBasename, nameList, isWebImageAddress, publishedFrontmatter } = require('./processor');
const { canonicalNfc } = require('./unicode');
const { withoutMarked } = require('./gm-marks');
const { decodeEntities } = require('./templates/gurps/tables');

const PLACE_TYPES = new Set(['location', 'faction', 'item']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// A tag (quoted attribute values may hold a `>`) or a comment.
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const OPEN_MARK = '' + '0' + '';

// The pages a recap may be pictured with, in `pages` order. `onPlayerSite` (the GM site: a Set of the pages the
// player site publishes) keeps only those; `exclude` is a Set of the unit's own pages. A page counts when it is not
// a PC and its portrait names an attachment the build has. Its names are its published title and published
// `aliases`: a hidden field is not a name, and `gm_aliases` is never read.
function figureCandidates(pages, { imageMap, onPlayerSite = null, exclude = new Set(), excludeFields = [], overridesOf = null } = {}) {
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
    const title = page.displayTitle || page.title || '';
    const seen = new Set();
    const terms = [];
    for (const raw of [title, ...nameList(published.aliases)]) {
      const term = canonicalNfc(raw).trim();
      if (term && !seen.has(term.toLowerCase())) { seen.add(term.toLowerCase()); terms.push(term); }
    }
    out.push({ page, key, outputPath: page.outputPath, title, terms, place: PLACE_TYPES.has(source.type) });
  }
  return out;
}

// The recap's top-level elements, as { tag, html } in order. Comments and loose text between them are not elements.
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
      if (depth === 0) blocks.push({ tag, html: html.slice(start, m.index + m[0].length) });
    } else if (depth === 0) {
      if (selfClosed) blocks.push({ tag: name, html: m[0] });
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
  let depth = 0;
  topLevelElements(recapHtml).forEach((el, block) => {
    const kept = withoutMarked(OPEN_MARK.repeat(depth) + el.html, marks);
    depth = markDepth(OPEN_MARK.repeat(depth) + el.html);
    if (el.tag !== 'p') return;
    const { text, hrefs, linkAt } = readParagraph(kept, fromPath);
    const paragraph = { block, text, hrefs, hasImage: /<img\b/i.test(kept) };
    Object.defineProperty(paragraph, 'linkAt', { value: linkAt });   // not part of the shape callers compare
    out.push(paragraph);
  });
  return out;
}

// How many marks are still open at the end of the text.
function markDepth(text) {
  let depth = 0;
  for (const m of String(text).matchAll(/[0-9a-z]*|/g)) depth = m[0] === '' ? Math.max(0, depth - 1) : depth + 1;
  return depth;
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

module.exports = { figureCandidates, paragraphsOf, mentionsOf };
