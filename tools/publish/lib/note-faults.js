'use strict';

// Faults in a NOTE that change what the site shows. Four codes:
//
//   NAMED_NO_PAGE   a vault note with no page, linked from a published page that prints its
//                   name as plain words
//   COMMENT_STRAY   a `%%` that is not a comment (unclosed, or straight after a number)
//   FENCE_UNCLOSED  a code fence never closed, so a hidden marker below it is not obeyed
//   ALIAS_IN_PROSE  a `gm_aliases` name printed on a published page
//
// Nothing here reads a page a second way, and nothing here knows which field a template
// prints. The names are decided by the page as the build makes it: every link to a note
// with no page is given an invisible mark in its words, the page is rendered once more by
// the build's own renderer, and a mark that comes out in the HTML is a name the page prints.
// A secret name is looked for in the text of the page that was written. The stray `%%` and
// the unclosed fence are facts the strip chain reports as it runs (processor.js noteFacts).
// The build runs the audit; `doctor --site` runs the build in memory and lists what it found.
const fs = require('fs');
const path = require('path');
const { parseNote, percentStrays } = require('./frontmatter');
const { wikilinkRe, parseWikilink } = require('./wikilink');
const { canonicalNfc } = require('./unicode');
const { decidePage, publishesPage } = require('./publish-decision');
const { gmAliasList, gmAliasKey, wikiTargetLabel, humanizeName } = require('./processor');
const { kindOfType } = require('./kind-label');
const { STORY_SUFFIX } = require('./scanner');
const { decodeEntities } = require('./templates/gurps/tables');

const CODES = ['ALIAS_IN_PROSE', 'FENCE_UNCLOSED', 'COMMENT_STRAY', 'NAMED_NO_PAGE'];
const WORST = 3;
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

// The text a built page shows, one line per block, entities decoded. Scripts and styles
// are not text. `attributes: true` adds the words a tag carries in `alt`, `title`,
// `aria-label` and `content`. `links` says what to do with the words of a link to another
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
      /\shref="(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attrs) ? inner : links === 'fence' ? `${LINK_OPEN}${inner}${LINK_CLOSE}` : ' '));
  }
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (whole, tag, attrs) => {
    let extra = '';
    if (attributes) for (const m of attrs.matchAll(PRINTED_ATTRS)) extra += ` ${m[1]} `;
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
const foldQuotes = (text) => String(text).replace(/[‘’ʼ′]/g, "'").replace(/[“”″]/g, '"');

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
 * @param {function} [input.readFile]
 * @returns {object} the audit:
 *   read(rel, html)                   a page as it was built: looked through for secret names
 *   mark(page)                        the page's markdown, story, frontmatter and title with every link
 *                                     to a no-page note marked, or null when it has none
 *   printed(page, marked, html, storyHtml)  the marked page as rendered: which marks came out
 *   findings(facts)                   every finding; facts(page) -> { source, strays, openFence }
 */
function startNoteAudit(input) {
  const readFile = input.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const scanned = new Map(input.corpus.map((p) => [input.relOf(p), p]));
  const secretKeys = new Set();
  const aliasOwners = new Map();   // folded alias -> { alias, rel }
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
    const why = noPageReason(rel, page, input, skipped);
    if (why) noPage.push({ rel, page, why, frontmatter: fm, displayTitle: note.displayTitle || baseName(rel).replace(/_/g, ' ') });
  }
  noPage.sort((a, b) => (a.rel < b.rel ? -1 : 1));

  const publicNames = new Set(Object.keys(input.linkMap).map(fold));
  const index = noPage.length > 0 ? indexNoPageNotes(noPage, publicNames) : new Map();
  for (const key of [...aliasOwners.keys()]) if (publicNames.has(key)) aliasOwners.delete(key);
  const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliasRes = [...aliasOwners.values()].map((a) => ({
    ...a,
    re: new RegExp('(?<![\\p{L}\\p{N}])' + esc(foldQuotes(a.alias.trim())).replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'giu'),
  }));
  // One cheap look at the raw HTML decides whether a page is read at all: the longest word
  // of each secret name. A name with no word of three letters is looked for on every page.
  const probeWords = aliasRes.map((a) => (a.alias.match(/[\p{L}\p{N}]+/gu) || []).sort((x, y) => y.length - x.length)[0] || '');
  const probe = aliasRes.length === 0 ? null
    : probeWords.some((w) => w.length < 3) ? /(?:)/
      : new RegExp([...new Set(probeWords)].map(esc).join('|'), 'iu');

  const named = new Map();     // rel -> { record, pages: Set, printed: Map }
  const covered = new Set();   // link targets (NFC) that name a note with no page
  const aliasHits = [];
  const storyRelOf = (page) => input.relOf(page).replace(/\.md$/i, STORY_SUFFIX);

  const lookup = (parsed) => {
    if (input.linkMap[parsed.raw] || input.linkMap[parsed.name]) return null;
    return index.get(fold(parsed.name)) || index.get(fold(parsed.name.split('/').pop())) || null;
  };

  function mark(page) {
    if (index.size === 0) return null;
    const marks = [];   // marks[id - 1] = { record, words }
    const tag = (record, words) => { marks.push({ record, words, target: record.rel }); return markOf(marks.length); };
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
        return `${bang}[[${parsed.raw}|${tag(hit.record, words)}${words}]]`;
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
    const storyMarkdown = page.storyMarkdown ? links(page.storyMarkdown, true) : page.storyMarkdown;
    // The title a page prints is read from the frontmatter when the note is scanned.
    const displayTitle = links(page.displayTitle, false);
    return marks.length === 0 ? null : { markdown, storyMarkdown, frontmatter, displayTitle, marks };
  }

  // Whether a page as built could be printing one of the names `marked` holds: the words of
  // some marked link, read loosely (letters and digits in order, whatever stands between
  // them), are somewhere in its HTML. Most links to a note with no page sit in a hidden part
  // or in a field the page does not print; such a page needs no second render to say so.
  function mayPrint(marked, html) {
    if (marked.probe === undefined) {
      // Each marked name as its words (letters and digits), longest word first.
      const names = new Map();
      for (const m of marked.marks) {
        const words = m.words.toLowerCase();
        if (!names.has(words)) names.set(words, words.match(/[\p{L}\p{N}]+/gu) || []);
      }
      marked.names = [...names.values()];
      const longest = marked.names.map((runs) => runs.slice().sort((x, y) => y.length - x.length)[0]);
      // One pass over the raw HTML settles most pages: the longest word of any of the names.
      marked.probe = longest.some((w) => !w) ? null : new RegExp([...new Set(longest)].map(esc).join('|'), 'i');
    }
    if (marked.probe && !marked.probe.test(html)) return false;
    const lower = String(html).toLowerCase();
    // Every word of a name must be there (a plain search), and then in order with little
    // between them. "Little" is read loosely, which only sends a page on to the second render.
    return marked.names.some((runs) => runs.every((run) => lower.includes(run))
      && (runs.length < 2 || new RegExp(runs.map(esc).join('[^a-z0-9]{0,12}')).test(lower)));
  }

  function printed(page, marked, html, storyHtml) {
    const note = (rel, ids) => {
      for (const id of ids) {
        const m = marked.marks[id - 1];
        if (!m) continue;
        let entry = named.get(m.record.rel);
        if (!entry) { entry = { record: m.record, pages: new Set(), printed: new Map() }; named.set(m.record.rel, entry); }
        entry.pages.add(rel);
        if (!entry.printed.has(m.words.toLowerCase())) entry.printed.set(m.words.toLowerCase(), m.words);
      }
    };
    note(input.relOf(page), marksIn(html));
    if (storyHtml) note(storyRelOf(page), marksIn(storyHtml));
  }

  function read(rel, html) {
    if (!probe || !probe.test(html)) return;
    // The page's own text first; a name found only in its <head> or in a tag's words (the
    // tab title, a description, an image's alt) is on the site too.
    // What a link to another page prints is that page's public name, not this page's words:
    // it is blanked for the search and kept for the sentence shown.
    const whole = String(html);
    const headEnd = whole.search(/<\/head\s*>/i);
    const blank = (text) => text.replace(/\u0002[^\u0003]*\u0003/g, (m) => LINK_OPEN.repeat(m.length));
    const body = foldQuotes(pageText(headEnd === -1 ? whole : whole.slice(headEnd), { links: 'fence' }));
    const bodyOwn = blank(body);
    let rest = null;
    for (const a of aliasRes) {
      a.re.lastIndex = 0;
      let text = body;
      let matches = [...bodyOwn.matchAll(a.re)];
      if (matches.length === 0) {
        if (rest === null) rest = foldQuotes(pageText(whole, { links: 'fence', attributes: true }));
        text = rest;
        matches = [...blank(rest).matchAll(a.re)].slice(0, 1);
      }
      if (matches.length === 0) continue;
      const at = matches[0].index;
      const start = Math.max(text.lastIndexOf('\n', at) + 1, at - CONTEXT);
      const stop = Math.min(...[text.indexOf('\n', at), at + matches[0][0].length + CONTEXT, text.length].filter((x) => x >= 0));
      aliasHits.push({
        code: 'ALIAS_IN_PROSE', severity: 'warning', path: rel,
        detail: `"${a.alias}", a name you keep secret in gm_aliases${a.rel === rel ? '' : ` (of ${a.rel})`}, is printed on the page${matches.length > 1 ? ` ${matches.length} times` : ''}`,
        fix: `reword it to the public name, in the text or in the frontmatter field or title that holds it; or, in the text, link the name ([[${a.alias}]]): the build prints the page's public title for a linked GM alias`,
        alias: a.alias, owner: a.rel, count: matches.length, context: clip(text.slice(start, stop).replace(/[\u0002\u0003]/g, '').trim(), 2 * CONTEXT + a.alias.length),
      });
    }
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
      for (const entry of page.percentValues || []) {
        for (const kind of percentStrays(entry.value)) {
          found.push({
            code: 'COMMENT_STRAY', severity: 'warning', path: rel,
            detail: kind === 'UNCLOSED'
              ? `the ${entry.field}: value holds a %% that is never closed, so it hides the rest of the value`
              : `the ${entry.field}: value holds a %% straight after a number, so it hides what lies between it and the next %%`,
            fix: 'write a single % or "percent", or put the sign in backticks, unless it is meant as a comment',
            where: 'frontmatter', kind, line: null, field: entry.field, text: clip(entry.value),
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

    found.push(...aliasHits);
    // --- NAMED_NO_PAGE: one finding per note --------------------------------------------
    if (named.size > 0) {
      let annotations = null;   // the manifest's written reasons, read only when something is named
      const reasons = () => {
        if (annotations) return annotations;
        annotations = new Map();
        try {
          const { parseAnnotatedManifest } = require('./manifest-cli');
          annotations = parseAnnotatedManifest(readFile(path.join(input.vaultPath, '_meta', 'publish-manifest.md')));
        } catch (e) { /* no manifest, or none readable: no reasons */ }
        return annotations;
      };
      for (const [rel, entry] of named) {
        const { record } = entry;
        const listed = reasons().get(rel);
        const reason = (listed && listed.annotation) || null;
        const settled = !!(listed && listed.section === 'excluded' && reason && STAYS_HIDDEN.test(reason));
        const type = typeOfNote(record, readFile, input.vaultPath);
        const kind = kindOfType(type);
        const pagesNaming = [...entry.pages].sort();
        const printed = [...entry.printed.values()];
        const name = baseName(rel);
        let fix;
        if (kind === 'entity') {
          // Listing a note under Publishing gives it a page only when the manifest is what holds it back.
          const page = String(record.why).startsWith('MANIFEST_')
            ? `then list it under Publishing in _meta/publish-manifest.md so it gets a page`
            : `but the manifest is not what keeps it off the site (${record.why}): run explain "${rel}" for the rule`;
          fix = `move what only you should know under a ## GM Notes heading in ${rel}, ${page}; or leave it hidden and record that with manifest apply --exclude "${rel}=stays hidden: <why>"`;
        } else if (kind === 'working') {
          fix = `turn the link to ${name} into plain words or reword the sentence; a working note like this never gets a page`;
        } else {
          fix = `give ${rel} a type: in its frontmatter, then decide whether it gets a page or the link becomes plain words`;
        }
        found.push({
          code: 'NAMED_NO_PAGE', severity: 'warning', path: rel,
          detail: `has no page (${record.why}) but is named on ${plural(pagesNaming.length, '1 published page', `${pagesNaming.length} published pages`)} as ${printed.slice(0, 3).map((w) => `"${w}"`).join(', ')}${printed.length > 3 ? ', …' : ''}`,
          fix,
          why: record.why, reason, pages: pagesNaming, pageCount: pagesNaming.length, printed, kind, type, settled,
        });
      }
    }

    const sorted = sortFindings(found);
    // The targets that name a note with no page, printed or not, settled or not: the
    // dead-link check leaves them out (a link to a note that exists is not a dead link).
    Object.defineProperty(sorted, 'namedTargets', { value: covered });
    return sorted;
  }

  return { read, mark, mayPrint, printed, findings, storyRelOf };
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
      const worst = rows.slice(0, WORST).map((f) => `${baseName(f.path)} ${f.pageCount} ${plural(f.pageCount, 'page', 'pages')}`);
      lines.push(`${n} ${plural(n, 'note is', 'notes are')} named on published pages but ${plural(n, 'has', 'have')} no page, so the name prints as plain words (most named: ${worst.join(', ')}) — ${where} ${these}.`);
    } else if (code === 'COMMENT_STRAY') {
      const worst = rows.slice(0, WORST).map((f) => (f.where === 'frontmatter' ? `${f.path} ${f.field}:` : `${f.path}${f.line ? ` line ${f.line}` : ''}`));
      lines.push(`${n} stray %% in published notes (${worst.join(', ')}) — ${where} ${these}.`);
    } else if (code === 'FENCE_UNCLOSED') {
      const worst = rows.slice(0, WORST).map((f) => `${f.path}${f.line ? ` line ${f.line}` : ''}`);
      lines.push(`${n} published ${plural(n, 'note has a code fence that never closes', 'notes have a code fence that never closes')}, so hidden text below it is published (${worst.join(', ')}) — ${where} ${these}.`);
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

module.exports = { startNoteAudit, summaryLines, kindOfType, pageText, mainOf, CODES };
