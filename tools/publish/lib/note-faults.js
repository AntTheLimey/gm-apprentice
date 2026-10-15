'use strict';

// Faults in a NOTE that change what the site shows. Four codes:
//
//   NAMED_NO_PAGE   a vault note with no page, linked from a published page that prints its
//                   name as plain words
//   COMMENT_STRAY   a `%%` that is not a comment (unclosed, or straight after a number);
//                   in a frontmatter value, also a comment or hidden block never closed
//   FENCE_UNCLOSED  a code fence never closed, so a hidden marker below it is not obeyed
//   ALIAS_IN_PROSE  a `gm_aliases` name printed on a published page
//   WITHHELD_IN_PROSE    the file name, title or alias of a note marked `withheld: true`,
//                        printed on a published page, in the search index or in the file
//                        name of a copied attachment (#291)
//   WITHHELD_NAME_PUBLIC a withheld name that a published page also answers to, which so
//                        cannot be searched for
//   WITHHELD_PUBLISHED   a note marked `withheld: true` that the site publishes (an error)
//   WITHHELD_FLAG_UNREADABLE  a `withheld:` value that is not true or false (read as false)
//   TOHIT_UNREAD    a row of a GURPS PC sheet the to-hit calculator cannot fully read, with
//                   why and the fix (the calculator's own words, from tohit-data.js); a row
//                   it reads but that is written another way, or whose numbers do not add
//                   up, is information
//
// Nothing here reads a page a second way, and nothing here knows which field a template
// prints. The names are decided by the page as the build makes it: every link to a note
// with no page is given an invisible mark in its words, the page is rendered once more by
// the build's own renderer, and a mark that comes out in the HTML is a name the page prints.
// That holds for every page the build writes: a note's own page and a PC's story page, and
// the pages built from many notes (the section indexes, the timeline, the story, the landing
// page), where a name is counted against the note the link is written in. The names on a
// page's Connections are read from the model the page holds. A secret name is looked
// for in the text of each page that was written. The stray `%%` and the unclosed fence are
// facts the strip chain reports as it runs (processor.js noteFacts).
// The build runs the audit; `doctor --site` runs the build in memory and lists what it found.
const fs = require('fs');
const path = require('path');
const { parseNote, valueStrays } = require('./frontmatter');
const { wikilinkRe, parseWikilink, labelsForLinks } = require('./wikilink');
const { canonicalNfc } = require('./unicode');
const { SWITCH_WORDS } = require('./settings/types');
const { decidePage, publishesPage } = require('./publish-decision');
const { gmAliasList, nameList, gmAliasKey, wikiTargetLabel, humanizeName, isWithheld } = require('./processor');
const { kindOfType } = require('./kind-label');
const { STORY_SUFFIX } = require('./scanner');
const { decodeEntities } = require('./templates/gurps/tables');

const CODES = ['ALIAS_IN_PROSE', 'WITHHELD_PUBLISHED', 'WITHHELD_IN_PROSE', 'WITHHELD_NAME_PUBLIC', 'WITHHELD_FLAG_UNREADABLE', 'FENCE_UNCLOSED', 'COMMENT_STRAY', 'NAMED_NO_PAGE', 'TOHIT_UNREAD'];
const WORST = 3;
// The human report names this many of the pages that link a note with no page.
const PAGES_SHOWN = 3;
const CONTEXT = 80;
const STAYS_HIDDEN = /^\s*stays\s+hidden\s*:/i;

const fold = (name) => canonicalNfc(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const plural = (n, one, many) => (n === 1 ? one : many);
const clip = (text, max = 160) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const baseName = (rel) => path.posix.basename(rel, '.md');
const isPlain = (v) => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

// --- the mark ---------------------------------------------------------------------------
// A number written in zero-width characters between two word joiners. It prints nothing,
// survives the renderer and every template, and the heading reader (heading-key.js) drops
// zero-width characters, so a marked label names the same section the plain one did.
const MARK_EDGE = '⁠';
const MARK_RE = /⁠([‌‍]+)⁠/g;
const markOf = (id) => MARK_EDGE + id.toString(2).replace(/0/g, '‌').replace(/1/g, '‍') + MARK_EDGE;

function marksIn(html) {
  const ids = new Set();
  for (const m of String(html || '').matchAll(MARK_RE)) {
    ids.add(parseInt(m[1].replace(/‌/g, '0').replace(/‍/g, '1'), 2));
  }
  return ids;
}

// --- a built page as text ---------------------------------------------------------------
const BLOCK_TAGS = new Set(('address article aside blockquote br caption dd details div dl dt fieldset figcaption figure '
  + 'footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead title tr ul '
  + 'text option button label').split(' '));
// Entities the templates write that decodeEntities does not know.
const MORE_ENTITIES = {
  rsaquo: '›', lsaquo: '‹', raquo: '»', laquo: '«', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←',
  middot: '·', bull: '•', times: '×', copy: '©', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', apos: "'",
};
const PRINTED_ATTRS = /\s(?:alt|title|aria-label|content|placeholder)="([^"]*)"/gi;
// With the `data-…` values a page carries for its filters and scripts: not printed, but in
// the page a visitor is sent.
const CARRIED_ATTRS = /\s(?:alt|title|aria-label|content|placeholder|data-[a-z0-9-]+)="([^"]*)"/gi;

// The text a built page shows, one line per block, entities decoded. Scripts and styles
// are not text. `attributes: true` adds the words a tag carries in `alt`, `title`,
// `aria-label` and `content` (`'all'`: in a `data-…` attribute and on a link's own tag as
// well). `links` says what to do with the words of a link to another
// page of the site (that page's own name): true keeps them, false leaves them out, 'fence'
// keeps them between LINK_OPEN and LINK_CLOSE so a reader can tell them from the page's own.
const LINK_OPEN = '\u0002';
const LINK_CLOSE = '\u0003';
// `spaced: true` is for reading: the small inline boxes a sheet is made of (a stat's label
// and its number) are set apart by a space instead of run together.
const BOX_TAGS = new Set(['span', 'small', 'label', 'abbr', 'tspan', 'b', 'i', 'kbd', 'sup', 'sub', 'a']);
function pageText(html, { links = true, attributes = false, spaced = false } = {}) {
  let s = String(html || '')
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[\u0002\u0003]/g, '');
  if (links !== true) {
    s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attrs, inner) => (
      /\shref="(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attrs) ? inner
        // 'all': the link's own tag stays, for the words it carries.
        : links === 'fence' ? `${attributes === 'all' ? `<a${attrs}>` : ''}${LINK_OPEN}${inner}${LINK_CLOSE}` : ' '));
  }
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (whole, tag, attrs) => {
    let extra = '';
    if (attributes) for (const m of attrs.matchAll(attributes === 'all' ? CARRIED_ATTRS : PRINTED_ATTRS)) extra += ` ${m[1]} `;
    const name = tag.toLowerCase();
    return (BLOCK_TAGS.has(name) ? '\n' : spaced && BOX_TAGS.has(name) ? ' ' : '') + extra;
  });
  return decodeEntities(s).replace(/&([a-z]+);/gi, (whole, name) => MORE_ENTITIES[name.toLowerCase()] || whole)
    .replace(MARK_RE, '').split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

// The part of a built page that is the page itself: inside <main>, where there is one.
function mainOf(html) {
  const m = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(String(html || ''));
  return m ? m[1] : String(html || '');
}

// How a name is compared with the text of a page: the renderer turns a straight quote into
// a curly one, and a page may carry either.
const foldQuotes = (text) => canonicalNfc(text).replace(/[\u2018\u2019\u02bc\u2032]/g, "'").replace(/[\u201c\u201d\u2033]/g, '"')
  // A character that prints nothing (a zero-width space or joiner, a soft hyphen) does not make a different name.
  // And a name in the other Unicode form (an NFD file name, an NFC page) is the same name.
  .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '');

// Why each vault note has no page, or null when it has one. A scanned page carries the
// publish decision's own code; a note the scan never turned into a page gets the reason
// the scan gave (no type, unparseable, unmapped folder) or DIR_EXCLUDED.
function noPageReason(rel, page, input, skipped) {
  if (page) {
    const verdict = input.verdicts.get(page);
    if (!verdict) return null;   // a PC's story companion: its text is on the PC's story page
    if (!publishesPage(verdict)) return verdict.code;
    return input.getsNoPage(page) ? 'TYPE_NEVER_PUBLISHES' : null;
  }
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const always = decidePage({ rel, frontmatter: null }, { rel, publishConfig: input.publishConfig, manifest: input.manifest });
  if (always.code === 'DIR_ALWAYS_EXCLUDED') return always.code;
  if (skipped.malformed.has(rel)) return 'FILE_UNPARSEABLE';
  if (skipped.untyped.has(rel)) return 'NO_TYPE';
  if (skipped.unmapped.has(dir)) return 'DIR_UNMAPPED';
  return 'DIR_EXCLUDED';
}

// Whether a `withheld:` value is one the build reads on purpose, as a yes or as a no.
function flagReadable(v) {
  if (v == null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return v === 0 || v === 1;
  if (typeof v !== 'string') return false;
  const t = v.trim().toLowerCase();
  return t === '' || SWITCH_WORDS.has(t) || /^\+?0*[01](?:\.0*)?$/.test(t);
}

function noteRel(note) {
  return canonicalNfc(String(note.vaultPath).replace(/\\/g, '/') + '.md');
}

// Every name a link can reach a no-page note by, folded: its file name, its vault path, its
// `aliases`; and each `gm_aliases` name, which the build rewrites to the owner's title. First
// note (by path) wins a name; a name some published page also answers to is that page's.
function indexNoPageNotes(records, publicNames) {
  const index = new Map();
  const put = (key, record, viaAlias) => {
    if (!key || publicNames.has(key) || index.has(key)) return;
    index.set(key, { record, viaAlias });
  };
  for (const record of records) {
    const fm = record.frontmatter || {};
    put(fold(baseName(record.rel)), record, false);
    put(fold(record.rel.replace(/\.md$/, '')), record, false);
    for (const a of Array.isArray(fm.aliases) ? fm.aliases : []) put(fold(String(a)), record, false);
    for (const a of gmAliasList(fm)) put(fold(a), record, true);
  }
  return index;
}

// 1-based line of the file that holds body line `bodyLine` (0-based) of `source`. The file is
// read only now, for a page that has a finding. Null when the line cannot be placed.
function fileLine(readFile, abs, source, bodyLine) {
  if (bodyLine === null || bodyLine === undefined) return null;
  let raw;
  try { raw = readFile(abs); } catch (e) { return null; }
  const lines = raw.split(/\r\n?|\n/);
  const src = String(source).split(/\r\n?|\n/);
  const want = src[bodyLine];
  const guess = lines.length - src.length + bodyLine;
  if (guess >= 0 && lines[guess] === want) return guess + 1;
  const found = lines.indexOf(want);
  return found === -1 ? null : found + 1;
}

/**
 * Start the audit of one vault, from what the build holds once its link map is made.
 *
 * @param {object} input
 * @param {string} input.vaultPath
 * @param {object[]} input.notes       scanAllNotes(vaultPath): every .md in the vault
 * @param {object[]} input.corpus      every scanned page, before story files are folded in
 * @param {Map} input.verdicts         page -> publish decision, for the pages after folding
 * @param {object} input.report        the scan report ({untyped, unmapped, malformed})
 * @param {object[]} input.published   the pages that get a page (no world-flags notes)
 * @param {object} input.linkMap       the link map of those pages
 * @param {object} input.publishConfig
 * @param {object|null} input.manifest loadManifest() output
 * @param {function} input.relOf       page -> vault-relative path
 * @param {function} input.getsNoPage  page -> true for a published note with no page
 * @param {function} input.printsField (page, path of a frontmatter value) -> false when the
 *   site removes that field from the page's frontmatter before anything reads it
 * @param {function} [input.readFile]
 * @returns {object} the audit:
 *   read(rel, html, out)              a page as it was built, looked through for secret names;
 *                                     `out` (its path on the site) for a page not built from one note
 *   mark(page)                        the page's texts with every link to a no-page note marked,
 *                                     or null when it has none
 *   mayPrint(marked, html)            false only when the built page cannot be printing any of them
 *   printed(page, marked, html, storyHtml)  the marked page as rendered: which marks came out
 *   listing(out, html)                a page built from many notes, rendered with every note marked
 *   connections(page, model)          the names a page's Connections prints
 *   findings(facts)                   every finding; facts(page) -> { source, strays, openFence }
 */
function startNoteAudit(input) {
  const readFile = input.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const scanned = new Map(input.corpus.map((p) => [input.relOf(p), p]));
  const secretKeys = new Set();
  const aliasOwners = new Map();   // folded alias -> { alias, rel }
  const withheldOwners = new Map();   // folded name of a `withheld: true` note -> { alias, rel }
  const publishedWithheld = [];       // withheld notes the site publishes: { rel, out }
  const unreadableFlags = [];         // notes whose `withheld:` is neither true nor false: { rel, value }
  const publishedRels = new Set(input.published.map((p) => input.relOf(p)));
  const noPage = [];               // records: { rel, why, page, frontmatter, displayTitle }
  const skipped = {
    malformed: new Set(input.report.malformed.map((m) => canonicalNfc(m.rel))),
    untyped: new Set(input.report.untyped.map(canonicalNfc)),
    unmapped: new Set(input.report.unmapped.map((u) => canonicalNfc(u.dir))),
  };
  for (const note of input.notes) {
    const rel = noteRel(note);
    const page = scanned.get(rel);
    // Names are read from the note as it is on disk: a published page's own frontmatter has
    // had its gm_aliases removed by the time the build asks.
    const fm = note.frontmatter || {};
    for (const alias of gmAliasList(fm)) {
      secretKeys.add(gmAliasKey(alias));
      if (!aliasOwners.has(fold(alias))) aliasOwners.set(fold(alias), { alias, rel });
    }
    // A withheld note's own names: its file name, its title and its aliases (its gm_aliases
    // are searched as every gm_aliases name is).
    if (Object.prototype.hasOwnProperty.call(fm, 'withheld') && !flagReadable(fm.withheld)) unreadableFlags.push({ rel, value: fm.withheld });
    if (isWithheld(fm) && publishedRels.has(rel)) {
      // Its name is on the site by its own page: one finding for that, and no search for it.
      publishedWithheld.push({ rel, out: (scanned.get(rel) || {}).outputPath });
    } else if (isWithheld(fm)) {
      for (const name of [baseName(rel).replace(/_/g, ' '), note.displayTitle, typeof fm.title === 'string' ? labelsForLinks(fm.title) : '',
        ...nameList(fm.aliases)]) {
        const text = typeof name === 'string' ? name.trim() : '';
        if (text && !withheldOwners.has(fold(text))) withheldOwners.set(fold(text), { alias: text, rel });
      }
    }
    const why = noPageReason(rel, page, input, skipped);
    if (why) noPage.push({ rel, page, why, frontmatter: fm, displayTitle: note.displayTitle || baseName(rel).replace(/_/g, ' ') });
  }
  noPage.sort((a, b) => (a.rel < b.rel ? -1 : 1));

  const publicNames = new Set(Object.keys(input.linkMap).map(fold));
  const index = noPage.length > 0 ? indexNoPageNotes(noPage, publicNames) : new Map();
  for (const key of [...aliasOwners.keys()]) if (publicNames.has(key)) aliasOwners.delete(key);
  // A withheld name a published page also answers to is on the site already, so it cannot
  // be searched for: it is told once (WITHHELD_NAME_PUBLIC) and left out of the search. A
  // name gm_aliases already searches is that search's.
  const collisions = [];
  for (const [key, owner] of [...withheldOwners]) {
    if (aliasOwners.has(key)) withheldOwners.delete(key);
    else if (publicNames.has(key)) { collisions.push({ ...owner, key }); withheldOwners.delete(key); }
  }
  const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = (alias) => new RegExp('(?<![\\p{L}\\p{N}])' + foldQuotes(alias.trim()).split(/[\s_\-\u2010\u2011]+/).filter(Boolean).map(esc).join('[\\s_\\-\\u2010\\u2011]+')
    + '(?![\\p{L}\\p{N}])', 'giu');
  const aliasRes = [...aliasOwners.values()].map((a) => ({
    ...a,
    kind: 'alias',
    // Between the words of a name a space, an underscore or a hyphen all read as the same
    // name ("The_Watcher", "The-Watcher"), whichever of them gm_aliases has.
    re: matcher(a.alias),
  })).concat([...withheldOwners.values()].map((a) => ({ ...a, kind: 'withheld', re: matcher(a.alias) })));
  // One cheap look at the raw HTML decides whether a page is read at all: the longest word
  // of each secret name. A name with no word of three letters is looked for on every page.
  const probeWords = aliasRes.map((a) => (foldQuotes(a.alias).match(/[\p{L}\p{N}]+/gu) || []).sort((x, y) => y.length - x.length)[0] || '');
  const probe = aliasRes.length === 0 ? null
    : probeWords.some((w) => w.length < 3) ? /(?:)/
      : new RegExp([...new Set(probeWords)].map(esc).join('|'), 'iu');

  // Whether the raw HTML of a page could hold a secret name. A character that prints nothing
  // (or its entity) may stand inside a word of the page, so a page that holds one is looked
  // at again with those taken out, as the name is compared.
  const HIDDEN_CHAR = /[\u200b-\u200d\u2060\ufeff\u00ad]|&(?:shy|ZeroWidthSpace|NoBreak|#\d+|#x[0-9a-f]+);/i;
  const COMBINING = /[\u0300-\u036f]/;
  const mayHold = (html) => probe.test(html) || ((HIDDEN_CHAR.test(html) || COMBINING.test(html)) && probe.test(foldQuotes(decodeEntities(String(html)))));

  // rel -> { record, pages: Set (notes whose own page prints the name), via: Map (note ->
  // the index and listing pages that print the name from it), printed: Map }
  const named = new Map();
  const covered = new Set();   // link targets (NFC) that name a note with no page
  const aliasHits = [];
  const marks = [];            // marks[id - 1] = { record, words, source }, for the whole vault
  // The marks the vault's own text holds, read once from what the pages are made of.
  let ownIds = null;
  const ownMarks = () => {
    if (ownIds === null) {
      ownIds = new Set();
      for (const page of input.corpus) {
        const text = [page.markdown, page.publishedMarkdown, page.storyMarkdown, page.displayTitle, JSON.stringify(page.frontmatter || {})]
          .filter((t) => typeof t === 'string').join('\n');
        if (text.includes(MARK_EDGE)) for (const id of marksIn(text)) ownIds.add(id);
      }
    }
    return ownIds;
  };
  const storyRelOf = (page) => input.relOf(page).replace(/\.md$/i, STORY_SUFFIX);

  const lookup = (parsed) => {
    if (input.linkMap[parsed.raw] || input.linkMap[parsed.name]) return null;
    return index.get(fold(parsed.name)) || index.get(fold(parsed.name.split('/').pop())) || null;
  };
  const entryOf = (record) => {
    let entry = named.get(record.rel);
    if (!entry) { entry = { record, pages: new Set(), via: new Map(), printed: new Map() }; named.set(record.rel, entry); }
    return entry;
  };
  const sawWords = (entry, words) => {
    if (!entry.printed.has(words.toLowerCase())) entry.printed.set(words.toLowerCase(), words);
  };

  // Every text of `page` a page of the site is built from (its body, the body as published,
  // its story, its frontmatter, its title), each with every link to a no-page note marked.
  // null when it holds no such link. A mark knows the note its link is written in.
  function mark(page) {
    if (index.size === 0) return null;
    const ids = [];
    let source = input.relOf(page);
    // A number the vault already writes as a mark in its own text is passed over (a hole in
    // `marks`, which every reader of a mark skips), so it is never read as a name.
    const tag = (record, words) => {
      while (ownMarks().has(marks.length + 1)) marks.push(null);
      marks.push({ record, words, source });
      ids.push(marks.length);
      return markOf(marks.length);
    };
    const links = (text, withBang) => {
      if (typeof text !== 'string' || !text.includes('[[')) return text;
      return text.replace(wikilinkRe('g', withBang), (whole, body) => {
        const parsed = parseWikilink(body);
        const bang = whole.startsWith('!') ? '!' : '';
        const hit = lookup(parsed);
        if (!hit) return whole;
        covered.add(canonicalNfc(parsed.name.trim()));
        // The words the link prints, as resolveWikiLinks prints an unresolved one.
        const label = parsed.display.trim();
        const words = label && !secretKeys.has(gmAliasKey(label)) ? label
          : hit.viaAlias ? hit.record.displayTitle : wikiTargetLabel(parsed.raw);
        if (!words) return whole;
        // The label the marked link carries is the one the heading reader would read off the
        // plain link (its own label, else the target's name), so a heading that holds the link
        // names the same section marked and unmarked.
        return `${bang}[[${parsed.raw}|${tag(hit.record, words)}${parsed.display || parsed.name}]]`;
      });
    };
    const deep = (value) => {
      if (typeof value === 'string') return links(value, false);
      if (Array.isArray(value)) return value.map(deep);
      if (isPlain(value)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = deep(v);
        return out;
      }
      return value;
    };
    const fm = page.frontmatter || {};
    const frontmatter = deep(fm);
    // A relationship's target is a link with or without its brackets.
    if (Array.isArray(fm.relationships)) {
      frontmatter.relationships = frontmatter.relationships.map((r) => {
        if (!isPlain(r) || typeof r.target !== 'string' || r.target.includes('[[') || !r.target.trim()) return r;
        const parsed = parseWikilink(r.target.trim());
        const hit = lookup(parsed);
        if (!hit) return r;
        covered.add(canonicalNfc(parsed.name.trim()));
        const words = humanizeName(parsed.name.trim());
        return Object.assign({}, r, { target: `[[${parsed.raw}|${tag(hit.record, words)}${words}]]` });
      });
    }
    const markdown = links(page.markdown || '', true);
    // The body as published feeds what is made from a note beside its page: its opening
    // lines on a card or an index, the recap a hub or the landing page takes.
    const publishedMarkdown = typeof page.publishedMarkdown === 'string' ? links(page.publishedMarkdown, true) : page.publishedMarkdown;
    // The title a page prints is read from the frontmatter when the note is scanned, with a
    // labelled link in it already turned into its label: the marked title is made the same way.
    const displayTitle = typeof fm.title === 'string' && page.displayTitle === labelsForLinks(fm.title)
      ? labelsForLinks(frontmatter.title) : links(page.displayTitle, false);
    source = storyRelOf(page);
    const storyMarkdown = page.storyMarkdown ? links(page.storyMarkdown, true) : page.storyMarkdown;
    return ids.length === 0 ? null : { markdown, publishedMarkdown, storyMarkdown, frontmatter, displayTitle, ids };
  }

  // Whether a page as built could be printing one of the names `marked` holds. Most links to
  // a note with no page sit in a hidden part or in a field the page does not print; such a
  // page needs no second render to say so. The test may only ever say yes too often: a name
  // is ruled out only when one of its words, as letters and digits, is nowhere in the HTML.
  // Whatever stands between the words there (a space, `&amp;`, a tag) is not looked at. A
  // word the renderer may itself change is not asked for (a `(c)` or `(tm)`, a character
  // reference). Markup inside a name needs no care: it is not letters, so the name's words
  // are already the pieces it leaves.
  function mayPrint(marked, html) {
    if (marked.names === undefined) {
      const names = new Map();
      for (const id of marked.ids) {
        const { words } = marks[id - 1];
        if (names.has(words)) continue;
        const plain = words.replace(/\((?:c|r|tm|p)\)/gi, ' ').replace(/&[a-z0-9#]+;/gi, ' ');
        names.set(words, plain.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
      }
      marked.names = [...names.values()];
      // A name with no letter or digit left to look for is never ruled out.
      marked.always = marked.names.some((runs) => runs.length === 0);
      const longest = marked.names.map((runs) => runs.slice().sort((x, y) => y.length - x.length)[0]);
      // One pass over the raw HTML settles most pages: the longest word of any of the names.
      marked.probe = marked.always ? null : new RegExp([...new Set(longest)].map(esc).join('|'), 'i');
    }
    if (marked.always) return true;
    if (!marked.probe.test(html)) return false;
    const lower = String(html).toLowerCase();
    return marked.names.some((runs) => runs.every((run) => lower.includes(run)));
  }

  // The marked page as rendered: each mark that came out is a name the page prints.
  function printed(page, marked, html, storyHtml) {
    const note = (rel, ids) => {
      for (const id of ids) {
        const m = marks[id - 1];
        if (!m) continue;
        const entry = entryOf(m.record);
        entry.pages.add(rel);
        sawWords(entry, m.words);
      }
    };
    note(input.relOf(page), marksIn(html));
    if (storyHtml) note(storyRelOf(page), marksIn(storyHtml));
  }

  // A page that is not one note's own (an index, the landing page, the timeline, a story
  // chapter), rendered with every note marked: a mark that came out is a name that page
  // prints from the note the link is written in. It is counted against that note, which is
  // the file the fix is made in, and the finding names the page.
  function listing(out, html) {
    for (const id of marksIn(html)) {
      const m = marks[id - 1];
      if (!m) continue;
      const entry = entryOf(m.record);
      if (!entry.via.has(m.source)) entry.via.set(m.source, new Set());
      entry.via.get(m.source).add(out);
      sawWords(entry, m.words);
    }
  }

  // A name a page's Connections prints: a relationship's target that has no page is an
  // item called by its label or its name, on the page of the note that declares it.
  function connections(page, model) {
    if (index.size === 0) return;
    for (const tab of model.tabs) {
      for (const group of tab.groups) {
        for (const item of group.items) {
          if (item.outputPath || !item.key) continue;
          const hit = lookup(parseWikilink(String(item.key)));
          if (!hit) continue;
          const entry = entryOf(hit.record);
          entry.pages.add(input.relOf(page));
          sawWords(entry, item.title);
        }
      }
    }
  }

  // A page as it was built, looked through for secret names. `rel` is the note it is built
  // from; for a page that is not one note's own, `out` is its path on the site instead.
  // Every name a page of the site answers to, folded: the words a link with no label of its
  // own prints, and the titles pages print. Made when first asked.
  let publicSet = null;
  const publicWords = () => {
    if (publicSet === null) {
      publicSet = new Set(Object.keys(input.linkMap).map((k) => fold(foldQuotes(k))));
      for (const page of input.published) publicSet.add(fold(foldQuotes(page.displayTitle || '')));
    }
    return publicSet;
  };
  // `only: 'withheld'` looks for withheld names alone: for texts that have never been read for
  // gm_aliases names (the records the search index is made of).
  function read(rel, html, out = null, where = 'the page', only = null) {
    if (!probe || (only && !aliasRes.some((a) => a.kind === only)) || !mayHold(html)) return;
    // The page's own text first; a name found only in its <head> or in a tag's words (the
    // tab title, a description, an image's alt) is on the site too.
    // What a link to another page prints is that page's public name, not this page's words:
    // it is blanked for the search and kept for the sentence shown. A label is this page's
    // own words, so it is searched: only words that are a public name of the site are blanked.
    const whole = String(html);
    const headEnd = whole.search(/<\/head\s*>/i);
    const bodyHtml = headEnd === -1 ? whole : whole.slice(headEnd);
    // On an index page a link is a whole card (a name, and fields of the note under it), so
    // there nothing is blanked: every word on it is taken from some note.
    const blank = (text) => (out !== null ? text : text.replace(/\u0002([^\u0003]*)\u0003/g,
      (m, inner) => (publicWords().has(fold(inner)) ? LINK_OPEN.repeat(m.length) : m)));
    const body = foldQuotes(pageText(bodyHtml, { links: 'fence' }));
    const bodyOwn = blank(body);
    let boxes = null;
    let rest = null;
    for (const a of aliasRes) {
      if (only && a.kind !== only) continue;
      a.re.lastIndex = 0;
      let text = body;
      let matches = [...bodyOwn.matchAll(a.re)];
      if (matches.length === 0) {
        // A sheet's small boxes run a label and its value together ("TL" and the name).
        if (boxes === null) boxes = foldQuotes(pageText(bodyHtml, { links: 'fence', spaced: true }));
        text = boxes;
        matches = [...blank(boxes).matchAll(a.re)];
      }
      if (matches.length === 0) {
        // An index page's cards are links that carry a note's fields in their attributes.
        if (rest === null) rest = foldQuotes(pageText(whole, { links: 'fence', attributes: out !== null ? 'all' : true }));
        text = rest;
        matches = [...blank(rest).matchAll(a.re)].slice(0, 1);
      }
      if (matches.length === 0) continue;
      const at = matches[0].index;
      const start = Math.max(text.lastIndexOf('\n', at) + 1, at - CONTEXT);
      const stop = Math.min(...[text.indexOf('\n', at), at + matches[0][0].length + CONTEXT, text.length].filter((x) => x >= 0));
      aliasHits.push({
        kind: a.kind, alias: a.alias, owner: a.rel, re: a.re, rel, out, where, count: matches.length,
        context: clip(text.slice(start, stop).replace(/[\u0002\u0003]/g, '').trim(), 2 * CONTEXT + a.alias.length),
      });
    }
  }

  // The address of a link on a page that is not one of the site's own files: a Markdown-style
  // `[x](Lord_Zorn.md)` is written to the page as it stands. Withheld names only.
  const SITE_FILES = /^(?:images|css|js|fonts|story|[\w-]+)\/?.*\.(?:html|css|js|json|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)$/i;
  function readAddresses(rel, html) {
    if (!aliasRes.some((a) => a.kind === 'withheld')) return;
    const seenNames = new Set();
    for (const m of String(html).matchAll(/\shref="([^"]*)"/gi)) {
      let value = decodeEntities(m[1]).replace(/[?#].*$/, '');
      if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || SITE_FILES.test(value)) continue;
      try { value = decodeURIComponent(value); } catch (e) { /* as written */ }
      const address = foldQuotes(value.replace(/\.md$/i, ''));
      for (const a of aliasRes) {
        if (a.kind !== 'withheld' || seenNames.has(a.alias)) continue;
        a.re.lastIndex = 0;
        if (!a.re.test(address)) continue;
        seenNames.add(a.alias);
        aliasHits.push({ kind: 'withheld', alias: a.alias, owner: a.rel, re: a.re, rel, out: null, where: 'address', count: 1, context: m[1] });
      }
    }
  }

  // A copied file (an attachment) whose name carries a withheld name. `file` is its path in
  // the vault, `copied` its path on the site. The name is on the site in the file's address.
  function readFileName(file, copied = file) {
    if (!aliasRes.some((a) => a.kind === 'withheld')) return;
    const address = foldQuotes(String(copied).replace(/\.[^./]+$/, ''));
    for (const a of aliasRes) {
      if (a.kind !== 'withheld') continue;
      a.re.lastIndex = 0;
      if (!a.re.test(address)) continue;
      aliasHits.push({
        kind: 'withheld', alias: a.alias, owner: a.rel, re: a.re, rel: file, out: null, where: 'file', count: 1,
        context: path.posix.basename(String(copied)),
      });
    }
  }

  // The secret-name findings. A name printed on a note's own page is that note's. One that
  // an index or listing page prints is counted against each note the page could have it
  // from (a note whose title, published frontmatter or published body holds the name), and
  // against the page itself when no note does.
  function aliasFindings(kind = 'alias') {
    const withheld = kind === 'withheld';
    const code = withheld ? 'WITHHELD_IN_PROSE' : 'ALIAS_IN_PROSE';
    const out = new Map();   // "path\nalias" -> finding
    const fixLine = (alias, owner, file) => {
      if (file) return `rename the file, and the embeds that name it, so that its name does not hold "${alias}"`;
      if (withheld) {
        return `reword it to a name the players know, in the text or in the frontmatter field or title that holds it; or, in the text, link the note ([[${alias}]]): a link with no label of its own prints a neutral word (${[...new Set(Object.values(input.publishConfig.withheld_words))].join(', ')}) in place of a withheld note's name; where it is an ordinary word and not the name, the finding stays until the note is no longer marked withheld`;
      }
      return `reword it to the public name, in the text or in the frontmatter field or title that holds it; or, in the text, link the name ([[${alias}]]): the build prints the page's public title for a linked GM alias`;
    };
    const told = (hit, rel) => (withheld
      ? `"${hit.alias}", the name of ${hit.owner === rel ? 'this note, which you marked withheld' : `a note you marked withheld (${hit.owner})`}`
      : `"${hit.alias}", a name you keep secret in gm_aliases${hit.owner === rel ? '' : ` (of ${hit.owner})`}`);
    const base = (hit) => (withheld ? { name: hit.alias } : { alias: hit.alias });
    const hits = aliasHits.filter((h) => h.kind === kind);
    for (const hit of hits.filter((h) => h.out === null)) {
      // A name a note's own page prints is told as that; the same name only the search index
      // holds (read after the pages) is told only when the page does not print it.
      if (hit.where !== 'the page' && out.has(`${hit.rel}\n${hit.alias}`)) continue;
      out.set(`${hit.rel}\n${hit.alias}`, {
        code, severity: 'warning', path: hit.rel,
        detail: hit.where === 'file'
          ? `${told(hit, hit.rel)}, is in the file name of an attachment the site copies`
          : hit.where === 'address' ? `${told(hit, hit.rel)}, is in the address of a link on the page`
            : `${told(hit, hit.rel)}, is printed on ${hit.where}${hit.count > 1 ? ` ${hit.count} times` : ''}`,
        fix: fixLine(hit.alias, hit.owner, hit.where === 'file'),
        ...base(hit), owner: hit.owner, count: hit.count, context: hit.context, listings: [],
      });
    }
    const listed = hits.filter((h) => h.out !== null);
    if (listed.length === 0) return [...out.values()];
    const strings = (value, into) => {
      if (typeof value === 'string') into.push(value);
      else if (Array.isArray(value)) value.forEach((v) => strings(v, into));
      else if (isPlain(value)) Object.values(value).forEach((v) => strings(v, into));
      return into;
    };
    const textOf = new Map();
    const holds = (page, re) => {
      if (!textOf.has(page)) {
        textOf.set(page, foldQuotes(strings(page.frontmatter || {}, [String(page.displayTitle || ''), String(page.publishedMarkdown || '')]).join('\n')));
      }
      re.lastIndex = 0;
      return re.test(textOf.get(page));
    };
    for (const hit of listed) {
      // A section index lists the notes of its own folder: where one of those holds the
      // name, it is theirs. Any other page (the landing page, the timeline) may have it from
      // any note.
      const holders = input.published.filter((page) => holds(page, hit.re));
      const dir = /\/index\.html$/.test(hit.out) ? hit.out.replace(/index\.html$/, '') : null;
      const inDir = dir === null ? [] : holders.filter((page) => String(page.outputPath).startsWith(dir));
      const sources = (inDir.length > 0 ? inDir : holders).map((page) => input.relOf(page)).sort();
      for (const rel of sources.length > 0 ? sources : [hit.out]) {
        const key = `${rel}\n${hit.alias}`;
        if (!out.has(key)) {
          const secret = withheld ? 'a note you marked withheld' : 'a name you keep secret in gm_aliases';
          out.set(key, {
            code, severity: 'warning', path: rel,
            detail: sources.length > 0
              ? `"${hit.alias}", ${withheld ? `the name of ${hit.owner === rel ? 'this note, which you marked withheld' : `${secret} (${hit.owner})`}` : `a name you keep secret in gm_aliases${hit.owner === rel ? '' : ` (of ${hit.owner})`}`}, is in this note's title, frontmatter or text, and an index or listing page prints it`
              : `"${hit.alias}", ${withheld ? `the name of ${secret} (${hit.owner})` : `a name you keep secret in gm_aliases (of ${hit.owner})`}, is printed on this page of the site, which is not built from one note`,
            fix: fixLine(hit.alias, hit.owner, false),
            ...base(hit), owner: hit.owner, count: hit.count, context: hit.context, listings: [],
          });
        }
        const finding = out.get(key);
        if (!finding.listings.includes(hit.out)) finding.listings.push(hit.out);
      }
    }
    for (const finding of out.values()) finding.listings.sort();
    return [...out.values()];
  }

  function findings(facts) {
    const pages = input.published.slice().sort((a, b) => (input.relOf(a) < input.relOf(b) ? -1 : 1));
    const found = [];

    // --- comments and fences: facts the strip chain reported -----------------------
    for (const page of pages) {
      const rel = input.relOf(page);
      const v = facts(page) || {};
      const abs = path.join(input.vaultPath, rel);
      const sourceLine = (n) => clip(String(String(v.source).split(/\r\n?|\n/)[n] || '').trim());
      for (const stray of v.strays || []) {
        const line = fileLine(readFile, abs, v.source, stray.line);
        const unclosed = stray.kind === 'UNCLOSED';
        found.push({
          code: 'COMMENT_STRAY', severity: 'warning', path: rel,
          detail: unclosed
            ? `a %% on ${line ? `line ${line}` : 'this page'} is never closed, so it hides the rest of the note`
            : `a %% on ${line ? `line ${line}` : 'this page'} comes straight after a number, so it reads as a comment and hides what lies between it and the next %%`,
          fix: unclosed
            ? 'if it is a comment, add the closing %% where it ends; if it is a percent sign, write a single % or "percent"'
            : 'if it is a percent sign, write a single % or "percent"; if it opens a comment, put a space before it',
          where: 'body', kind: stray.kind, line, field: null, text: sourceLine(stray.line),
        });
      }
      for (const entry of page.commentValues || []) {
        // A field the site removes prints nothing, so a stray in it changes nothing shown.
        if (!input.printsField(page, entry.field)) continue;
        for (const { kind, mark } of valueStrays(entry.value)) {
          found.push({
            code: 'COMMENT_STRAY', severity: 'warning', path: rel,
            detail: kind === 'UNCLOSED'
              ? `the ${entry.field}: value holds a ${mark} that is never closed, so it hides the rest of the value`
              : `the ${entry.field}: value holds a %% straight after a number, so it hides what lies between it and the next %%`,
            fix: mark === '%%'
              ? 'write a single % or "percent", or put the sign in backticks, unless it is meant as a comment'
              : mark === '<!--'
                ? 'add the closing --> where the comment ends, or take the <!-- out'
                : `add the closing ${mark.replace('<!-- ', '<!-- /')} where the hidden text ends, or take the marker out`,
            where: 'frontmatter', kind, mark, line: null, field: entry.field, text: clip(entry.value),
          });
        }
      }
      if (v.openFence) {
        const fenceLine = fileLine(readFile, abs, v.source, v.openFence.line);
        const markerLine = fileLine(readFile, abs, v.source, v.openFence.markerLine);
        const marker = `the ${v.openFence.marker} marker${markerLine ? ` on line ${markerLine}` : ''}`;
        found.push({
          code: 'FENCE_UNCLOSED', severity: 'warning', path: rel,
          detail: fenceLine
            ? `the code fence on line ${fenceLine} never closes, so ${marker} below it is not obeyed and the text it should hide is published`
            : `${marker} is not obeyed, as if in a code block, and the text it should hide is published`,
          fix: 'add the closing fence after the code: a line of the same marks, at least as many, with nothing after them, so the hidden text below it is hidden again',
          line: fenceLine, marker: v.openFence.marker, markerLine,
          text: v.openFence.line === null ? '' : sourceLine(v.openFence.line),
        });
      }
    }

    found.push(...aliasFindings());
    // The publish list's written reason for a note: only an excluded entry has one.
    const reasons = () => ({
      get: (rel) => {
        const list = input.manifest;
        if (!list || !(list.excluded || []).includes(rel)) return null;
        return { section: 'excluded', annotation: (list.reasons && list.reasons.get(rel)) || null };
      },
    });
    // --- the names of withheld notes ---------------------------------------------------
    // Not settled by a "stays hidden:" reason: that answers the link report (NAMED_NO_PAGE)
    // only. A name in plain text is fixed in the sentence or by taking the flag off.
    found.push(...aliasFindings('withheld'));
    for (const c of collisions) {
      const answers = Object.entries(input.linkMap).find(([key]) => fold(key) === c.key);
      const answering = answers ? input.published.find((p) => p.outputPath === answers[1]) : null;
      const pageRel = answering ? input.relOf(answering) : null;
      found.push({
        code: 'WITHHELD_NAME_PUBLIC', severity: 'warning', path: c.rel,
        detail: `"${c.alias}" is withheld, but ${pageRel ? `the published page ${pageRel}` : 'a published page'} answers to the same name, so it is not looked for on the site`,
        fix: `take withheld: true off this note, or give ${pageRel || 'the published page'} another title or alias`,
        name: c.alias, owner: c.rel, page: pageRel,
      });
    }
    // A withheld note the site publishes: one error for the contradiction. The build does not
    // refuse; the publish decision stays where it is.
    for (const w of publishedWithheld) {
      found.push({
        code: 'WITHHELD_PUBLISHED', severity: 'error', path: w.rel,
        detail: `is marked withheld and is being published: page ${w.out || 'of the site'}`,
        fix: 'remove withheld from the note if its name is not a secret, or stop it publishing (publish: false in its frontmatter, or take it off the publish list: manifest apply --exclude "<path>=<why>")',
        page: w.out || null,
      });
    }
    for (const u of unreadableFlags) {
      const value = typeof u.value === 'string' ? u.value : JSON.stringify(u.value);
      found.push({
        code: 'WITHHELD_FLAG_UNREADABLE', severity: 'warning', path: u.rel,
        detail: `withheld: ${value} is not true or false, so the note is read as not withheld`,
        fix: 'write withheld: true or false',
        value,
      });
    }
    // --- NAMED_NO_PAGE: one finding per note --------------------------------------------
    if (named.size > 0) {
      for (const [rel, entry] of named) {
        const { record } = entry;
        const listed = reasons().get(rel);
        const reason = (listed && listed.annotation) || null;
        const settled = !!(listed && listed.section === 'excluded' && reason && STAYS_HIDDEN.test(reason));
        const type = typeOfNote(record, readFile, input.vaultPath);
        const kind = kindOfType(type);
        // A note whose own page prints the name, and a note an index or listing page prints
        // it from, are both pages that name it; the second kind is said apart.
        const pagesNaming = [...new Set([...entry.pages, ...entry.via.keys()])].sort();
        const viaListing = [...entry.via.keys()].filter((p) => !entry.pages.has(p)).sort();
        const listings = [...new Set([...entry.via.values()].flatMap((outs) => [...outs]))].sort();
        const printed = [...entry.printed.values()];
        const name = baseName(rel);
        // A note marked withheld: a published page linking it is an error (still only a report),
        // and the words it prints are the placeholder, not its name.
        const withheld = isWithheld(record.frontmatter);
        let fix;
        if (withheld) {
          fix = `${name} is marked withheld, so it stays off the site: turn the links to it into the words the players know (links.py unlink "${rel.replace(/\.md$/, '')}" --in "<page>" --as "<words>"), or leave the neutral word it prints and record that with manifest apply --exclude "${rel}=stays hidden: <why>"`;
        } else if (kind === 'entity') {
          // Listing a note under Publishing gives it a page only when the manifest is what holds it back.
          const page = String(record.why).startsWith('MANIFEST_')
            ? `then put it on the publish list so it gets a page: manifest apply --publish "${rel}"`
            : `but the publish list is not what keeps it off the site (${record.why}): run explain "${rel}" for the rule`;
          fix = `move what only you should know under a ## GM Notes heading in ${rel}, ${page}; or leave it hidden and record that with manifest apply --exclude "${rel}=stays hidden: <why>"`;
        } else if (kind === 'working') {
          fix = `turn the link to ${name} into plain words or reword the sentence; a working note like this never gets a page`;
        } else {
          fix = `give ${rel} a type: in its frontmatter, then decide whether it gets a page or the link becomes plain words`;
        }
        found.push({
          code: 'NAMED_NO_PAGE', severity: withheld ? 'error' : 'warning', path: rel,
          detail: `has no page (${record.why}) but is ${withheld ? 'linked from' : 'named on'} ${plural(pagesNaming.length, '1 published page', `${pagesNaming.length} published pages`)} as ${printed.slice(0, 3).map((w) => `"${w}"`).join(', ')}${printed.length > 3 ? ', …' : ''}`
            + (viaListing.length > 0 ? `; for ${viaListing.length} of them it is an index or listing page that prints the name, from that note (${listings.slice(0, 2).join(', ')}${listings.length > 2 ? ', …' : ''})` : ''),
          fix,
          why: record.why, reason, pages: pagesNaming, pageCount: pagesNaming.length, printed, kind, type, settled,
          listings, viaListing,
          ...(withheld ? { withheld: true } : {}),
        });
      }
    }

    for (const c of calcRows) found.push({ code: 'TOHIT_UNREAD', severity: c.severity === 'info' ? 'info' : 'warning', path: c.rel, detail: c.detail, fix: c.fix });
    const sorted = sortFindings(found);
    // The targets that name a note with no page, printed or not, settled or not: the
    // dead-link check leaves them out (a link to a note that exists is not a dead link).
    Object.defineProperty(sorted, 'namedTargets', { value: covered });
    return sorted;
  }

  // The to-hit calculator's report for one PC sheet (`rel`, the PC's note).
  const calcRows = [];
  function calculator(rel, rows) {
    for (const r of rows || []) if (r && r.detail) calcRows.push({ rel, severity: r.severity, detail: r.detail, fix: r.fix || '' });
  }

  return { read, readAddresses, readFileName, mark, mayPrint, printed, listing, connections, calculator, findings, storyRelOf };
}

// A no-page note's `type`: from its scanned page, else from its file (the scan never read a
// note in an excluded folder). null for a note with no type or none that can be read.
function typeOfNote(record, readFile, vaultPath) {
  let type = null;
  if (record.page) type = record.page.frontmatter && record.page.frontmatter.type;
  else if (record.why !== 'NO_TYPE' && record.why !== 'FILE_UNPARSEABLE') {
    try { type = (parseNote(readFile(path.join(vaultPath, record.rel))).data || {}).type; } catch (e) { /* unreadable: no type */ }
  }
  return type ? String(type) : null;
}

// Most-named notes first, then by path: the order a GM works down the list.
function sortFindings(findings) {
  const rank = (f) => CODES.indexOf(f.code);
  return findings.slice().sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.code === 'NAMED_NO_PAGE' && a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.code === 'NAMED_NO_PAGE' && a.pageCount !== b.pageCount) return b.pageCount - a.pageCount;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return (a.line || 0) - (b.line || 0);
  });
}

// One line per code for the build: the count, the worst three, and where to go. Settled
// findings are not counted; a code with none left prints nothing.
function summaryLines(findings) {
  const open = findings.filter((f) => !f.settled);
  const lines = [];
  const where = "campaign-qa's Site Faults check fixes";
  for (const code of CODES) {
    const rows = open.filter((f) => f.code === code);
    const n = rows.length;
    if (n === 0) continue;
    const these = plural(n, 'it', 'these');
    if (code === 'NAMED_NO_PAGE') {
      const mostNamed = (list) => list.slice(0, WORST).map((f) => `${baseName(f.path)} ${f.pageCount} ${plural(f.pageCount, 'page', 'pages')}`).join(', ');
      const plain = rows.filter((f) => !f.withheld);
      const kept = rows.filter((f) => f.withheld);
      if (plain.length > 0) {
        const m = plain.length;
        lines.push(`${m} ${plural(m, 'note is', 'notes are')} named on published pages but ${plural(m, 'has', 'have')} no page, so the name prints as plain words (most named: ${mostNamed(plain)}) — ${where} ${plural(m, 'it', 'these')}.`);
      }
      // A withheld note's name does not print: a neutral word does. The link is the fault.
      if (kept.length > 0) {
        const m = kept.length;
        lines.push(`${m} ${plural(m, 'note marked withheld is', 'notes marked withheld are')} linked from published pages, where a neutral word prints in its place (most linked: ${mostNamed(kept)}) — ${where} ${plural(m, 'it', 'these')}.`);
      }
    } else if (code === 'WITHHELD_PUBLISHED') {
      lines.push(`${n} ${plural(n, 'note marked withheld is published', 'notes marked withheld are published')} (${rows.slice(0, WORST).map((f) => baseName(f.path)).join(', ')}), so ${plural(n, 'its name is', 'their names are')} on the site — ${where} ${these}.`);
    } else if (code === 'WITHHELD_FLAG_UNREADABLE') {
      for (const f of rows.slice(0, 10)) lines.push(`${f.path}: withheld: ${f.value} is not true or false, so the note is read as not withheld.`);
      if (rows.length > 10) lines.push(`${rows.length - 10} more notes have a withheld: value that is not true or false.`);
    } else if (code === 'COMMENT_STRAY') {
      const worst = rows.slice(0, WORST).map((f) => (f.where === 'frontmatter' ? `${f.path} ${f.field}:` : `${f.path}${f.line ? ` line ${f.line}` : ''}`));
      // A comment or hidden block never closed in a frontmatter value is counted here too.
      const what = rows.every((f) => !f.mark || f.mark === '%%') ? 'stray %%' : plural(n, 'stray comment mark', 'stray comment marks');
      lines.push(`${n} ${what} in published notes (${worst.join(', ')}) — ${where} ${these}.`);
    } else if (code === 'FENCE_UNCLOSED') {
      const worst = rows.slice(0, WORST).map((f) => `${f.path}${f.line ? ` line ${f.line}` : ''}`);
      lines.push(`${n} published ${plural(n, 'note has a code fence that never closes', 'notes have a code fence that never closes')}, so hidden text below it is published (${worst.join(', ')}) — ${where} ${these}.`);
    } else if (code === 'WITHHELD_IN_PROSE') {
      const byName = new Map();
      for (const f of rows) byName.set(f.name, (byName.get(f.name) || 0) + 1);
      const worst = [...byName].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, WORST)
        .map(([name, pages]) => `${name} ${pages} ${plural(pages, 'page', 'pages')}`);
      lines.push(`${byName.size} withheld ${plural(byName.size, 'name is', 'names are')} printed on published pages (${worst.join(', ')}) — ${where} ${plural(byName.size, 'it', 'these')}.`);
    } else if (code === 'TOHIT_UNREAD') {
      // Rows it cannot read; a row whose numbers do not add up is only information.
      const unread = rows.filter((f) => f.severity !== 'info');
      if (unread.length === 0) continue;
      const byPc = new Map();
      for (const f of unread) byPc.set(f.path, (byPc.get(f.path) || 0) + 1);
      const worst = [...byPc].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, WORST).map(([p, k]) => `${baseName(p)} ${k}`);
      const m = unread.length;
      lines.push(`${m} ${plural(m, 'row of a PC sheet is', 'rows of PC sheets are')} not fully read by the to-hit calculator (${worst.join(', ')}) — ${where} ${plural(m, 'it', 'these')}.`);
    } else if (code === 'WITHHELD_NAME_PUBLIC') {
      const names = [...new Set(rows.map((f) => f.name))];
      lines.push(`${names.length} withheld ${plural(names.length, 'name is also the name of a published page', 'names are also the names of published pages')}, so ${plural(names.length, 'it is', 'they are')} not looked for (${names.slice(0, WORST).join(', ')}) — ${where} ${plural(names.length, 'it', 'these')}.`);
    } else {
      const byAlias = new Map();
      for (const f of rows) byAlias.set(f.alias, (byAlias.get(f.alias) || 0) + 1);
      const worst = [...byAlias].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, WORST)
        .map(([alias, pages]) => `${alias} ${pages} ${plural(pages, 'page', 'pages')}`);
      lines.push(`${byAlias.size} GM ${plural(byAlias.size, 'alias is', 'aliases are')} printed on published pages (${worst.join(', ')}) — ${where} ${plural(byAlias.size, 'it', 'these')}.`);
    }
  }
  return lines;
}

module.exports = { startNoteAudit, summaryLines, PAGES_SHOWN, kindOfType, pageText, mainOf, CODES, MARK_RE };
