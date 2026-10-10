'use strict';

// Faults in a NOTE that change what the site shows, found from data the build and
// `doctor --site` both already hold. Four codes:
//
//   NAMED_NO_PAGE   a vault note with no page, linked from the text of a published page,
//                   so its name prints as plain words
//   COMMENT_STRAY   a `%%` that is not a comment (unclosed, or glued to the word before it)
//   FENCE_UNCLOSED  a code fence never closed, with a hidden marker below it
//   ALIAS_IN_PROSE  a `gm_aliases` name in the text of a published page, outside a link
//
// Nothing here reads a page a second way. What a reader sees is the page's own strip chain
// (processor.js strippedLines / playerSafeMarkdown), handed in through `view`; the stray `%%`
// and the unclosed fence are facts that chain reports as it runs. One definition, two callers:
// the build prints a summary, the doctor lists the findings.
const fs = require('fs');
const path = require('path');
const { parseNote } = require('./frontmatter');
const { wikilinkRe, parseWikilink } = require('./wikilink');
const { canonicalNfc } = require('./unicode');
const { percentStrays } = require('./frontmatter');
const { decidePage, publishesPage } = require('./publish-decision');
const { gmAliasList, gmAliasKey, wikiTargetLabel, NOTE_NAME_FIELDS } = require('./processor');
const { kindOfType } = require('./kind-label');
const { TYPE_BADGE_FIELDS } = require('./templates/base');

const CODES = ['ALIAS_IN_PROSE', 'FENCE_UNCLOSED', 'COMMENT_STRAY', 'NAMED_NO_PAGE'];
const WORST = 3;
const CONTEXT = 80;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg)$/i;
const STAYS_HIDDEN = /^\s*stays\s+hidden\s*:/i;

// The frontmatter fields whose wikilinks a page prints as words: the ones a header names a
// note by, the type badges, an NPC's header, an event's outcome, a world domain's summary,
// and a relationship's target. A link in any other field (`session`, `tags`, `documents`)
// is bookkeeping and never reaches the page.
const PRINTED_FIELDS = new Set([
  ...NOTE_NAME_FIELDS,
  ...Object.values(TYPE_BADGE_FIELDS).flat(),
  'occupation', 'nationality', 'rank', 'outcome', 'summary',
]);

const fold = (name) => canonicalNfc(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const plural = (n, one, many) => (n === 1 ? one : many);
const clip = (text, max = 160) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const baseName = (rel) => path.posix.basename(rel, '.md');

// The strings of a frontmatter value that a page can print a link from, at any depth.
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  return out;
}

function printedFrontmatterStrings(fm) {
  const out = [];
  const fields = new Set(PRINTED_FIELDS);
  if (Array.isArray(fm.display_meta)) fm.display_meta.forEach((f) => fields.add(String(f)));
  for (const field of fields) if (fm[field] != null) strings(fm[field], out);
  if (Array.isArray(fm.relationships)) {
    for (const r of fm.relationships) if (r && typeof r.target === 'string') out.push(r.target);
  }
  return out;
}

// Why each vault note has no page, or null when it has one. A scanned page carries the
// publish decision's own code; a note the scan never turned into a page gets the reason
// the scan gave (no type, unparseable, unmapped folder) or DIR_EXCLUDED.
function noPageReason(rel, page, input, skipped) {
  if (page) {
    const verdict = input.verdicts.get(page);
    if (!verdict) return null;   // a PC's story companion: its text is on the PC's page
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

// The text a link prints on the site, as resolveWikiLinks would print an unresolved one.
function printedWords(parsed, record, viaAlias, secretKeys) {
  const label = parsed.display.trim();
  if (label && !secretKeys.has(gmAliasKey(label))) return label;
  return viaAlias ? record.displayTitle : wikiTargetLabel(parsed.raw);
}

function* linksIn(text, withBang) {
  for (const match of String(text).matchAll(wikilinkRe('g', withBang))) {
    const parsed = parseWikilink(match[1]);
    if (match[0].startsWith('!') && IMAGE_EXT.test(parsed.raw.trim())) continue;
    yield parsed;
  }
}

// 1-based line of the file that holds body line `bodyLine` (0-based) of `source`. The file is
// read only now, for a page that has a finding. Null when the line cannot be placed.
function fileLine(readFile, abs, source, bodyLine) {
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
 * Find every note fault in one vault, from what the build and the doctor both hold.
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
 * @param {function} input.view        page -> { source, text, frontmatter, strays, openFence }:
 *   the markdown as stripped, what the reader sees of it, the published frontmatter, and the
 *   two facts the strip chain reported
 * @param {function} [input.readFile]
 * @returns {object[]} findings: {code, severity, path, detail, fix, ...}
 */
function findNoteFaults(input) {
  const readFile = input.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const pages = input.published.slice().sort((a, b) => (input.relOf(a) < input.relOf(b) ? -1 : 1));
  const views = new Map(pages.map((p) => [p, input.view(p)]));
  const findings = [];

  // --- comments and fences: facts the strip chain already reported -----------------
  for (const page of pages) {
    const rel = input.relOf(page);
    const v = views.get(page);
    const abs = path.join(input.vaultPath, rel);
    for (const stray of v.strays || []) {
      const text = clip(String(v.source).split(/\r\n?|\n/)[stray.line].trim());
      const line = fileLine(readFile, abs, v.source, stray.line);
      const unclosed = stray.kind === 'UNCLOSED';
      findings.push({
        code: 'COMMENT_STRAY', severity: 'warning', path: rel,
        detail: unclosed
          ? `a %% on ${line ? `line ${line}` : 'this page'} is never closed, so it hides the rest of the note`
          : `a %% on ${line ? `line ${line}` : 'this page'} is glued to the word before it, so it reads as a comment and hides what lies between it and the next %%`,
        fix: unclosed
          ? 'if it is a comment, add the closing %% where it ends; if it is a percent sign, write "percent" or put it in backticks'
          : 'put a space before the %% if it opens a comment; if it is a percent sign, write "percent" or put it in backticks',
        where: 'body', kind: stray.kind, line, field: null, text,
      });
    }
    for (const entry of page.percentValues || []) {
      for (const kind of percentStrays(entry.value)) {
        findings.push({
          code: 'COMMENT_STRAY', severity: 'warning', path: rel,
          detail: kind === 'UNCLOSED'
            ? `the ${entry.field}: value holds a %% that is never closed, so it hides the rest of the value`
            : `the ${entry.field}: value holds a %% glued to the word before it, so it hides what lies between it and the next %%`,
          fix: 'write "percent" or put the sign in backticks, unless it is meant as a comment',
          where: 'frontmatter', kind, line: null, field: entry.field, text: clip(entry.value),
        });
      }
    }
    if (v.openFence) {
      const fenceLine = fileLine(readFile, abs, v.source, v.openFence.line);
      const markerLine = fileLine(readFile, abs, v.source, v.openFence.markerLine);
      findings.push({
        code: 'FENCE_UNCLOSED', severity: 'warning', path: rel,
        detail: `the code fence on ${fenceLine ? `line ${fenceLine}` : 'this page'} never closes, so the ${v.openFence.marker} marker below it${markerLine ? ` (line ${markerLine})` : ''} is published as code`,
        fix: 'add the closing ``` after the code, so the hidden text below it is hidden again',
        line: fenceLine, marker: v.openFence.marker, markerLine,
        text: clip(String(v.source).split(/\r\n?|\n/)[v.openFence.line].trim()),
      });
    }
  }

  // --- the names: GM aliases in prose, notes named with no page --------------------
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
  const aliasRes = [...aliasOwners.values()].map((a) => ({
    ...a,
    lower: a.alias.toLowerCase(),
    re: new RegExp('(?<![\\p{L}\\p{N}])' + a.alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'giu'),
  }));

  const named = new Map();   // rel -> { record, pages: Set, printed: Map }
  const covered = new Set();   // link targets (NFC) that name a note with no page
  const nameIt = (page, parsed) => {
    const raw = parsed.raw;
    if (input.linkMap[raw] || input.linkMap[parsed.name]) return;
    const key = fold(parsed.name);
    const hit = index.get(key) || index.get(fold(parsed.name.split('/').pop()));
    if (!hit) return;
    covered.add(canonicalNfc(parsed.name.trim()));
    const words = printedWords(parsed, hit.record, hit.viaAlias, secretKeys);
    if (!words) return;
    let entry = named.get(hit.record.rel);
    if (!entry) { entry = { record: hit.record, pages: new Set(), printed: new Map() }; named.set(hit.record.rel, entry); }
    entry.pages.add(input.relOf(page));
    if (!entry.printed.has(words.toLowerCase())) entry.printed.set(words.toLowerCase(), words);
  };

  for (const page of pages) {
    const v = views.get(page);
    const rel = input.relOf(page);
    if (index.size > 0) {
      for (const parsed of linksIn(v.text, true)) nameIt(page, parsed);
      for (const value of printedFrontmatterStrings(v.frontmatter || {})) {
        for (const parsed of linksIn(value, false)) nameIt(page, parsed);
      }
    }
    if (aliasRes.length > 0 && v.text) {
      // Links blanked to the same length, so a match's position is its place in the text too.
      const prose = String(v.text).replace(wikilinkRe('g', true), (m) => ' '.repeat(m.length));
      const lower = prose.toLowerCase();
      for (const a of aliasRes) {
        if (!lower.includes(a.lower.trim().split(/\s+/)[0])) continue;
        a.re.lastIndex = 0;
        const matches = [...prose.matchAll(a.re)];
        if (matches.length === 0) continue;
        const at = matches[0].index;
        const start = Math.max(prose.lastIndexOf('\n', at) + 1, at - CONTEXT);
        const stop = Math.min(...[prose.indexOf('\n', at), at + matches[0][0].length + CONTEXT].filter((x) => x >= 0));
        findings.push({
          code: 'ALIAS_IN_PROSE', severity: 'warning', path: rel,
          detail: `"${a.alias}", a name you keep secret in gm_aliases${a.rel === rel ? '' : ` (of ${a.rel})`}, is printed in the page text${matches.length > 1 ? ` ${matches.length} times` : ''}`,
          fix: `reword the sentence to use the public name, or link the name ([[${a.alias}]]): the build prints the page's public title for a linked GM alias`,
          alias: a.alias, owner: a.rel, count: matches.length, context: clip(String(v.text).slice(start, stop).trim(), 2 * CONTEXT + a.alias.length),
        });
      }
    }
  }

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
        fix = `move what only you should know under a ## GM Notes heading in ${rel}, then list it under Publishing in _meta/publish-manifest.md so it gets a page; or leave it hidden and record that with manifest apply --exclude "${rel}=stays hidden: <why>"`;
      } else if (kind === 'working') {
        fix = `turn the link to ${name} into plain words or reword the sentence; a working note like this never gets a page`;
      } else {
        fix = `give ${rel} a type: in its frontmatter, then decide whether it gets a page or the link becomes plain words`;
      }
      findings.push({
        code: 'NAMED_NO_PAGE', severity: 'warning', path: rel,
        detail: `has no page (${record.why}) but is named on ${plural(pagesNaming.length, '1 published page', `${pagesNaming.length} published pages`)} as ${printed.slice(0, 3).map((w) => `"${w}"`).join(', ')}${printed.length > 3 ? ', …' : ''}`,
        fix,
        why: record.why, reason, pages: pagesNaming, pageCount: pagesNaming.length, printed, kind, type, settled,
      });
    }
  }

  const sorted = sortFindings(findings);
  // The targets NAMED_NO_PAGE speaks for, settled or not, so the dead-link check can leave them out.
  Object.defineProperty(sorted, 'namedTargets', { value: covered });
  return sorted;
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
      lines.push(`${n} published ${plural(n, 'note has a code fence that never closes', 'notes have a code fence that never closes')}, so hidden text below it is published as code (${worst.join(', ')}) — ${where} ${these}.`);
    } else {
      const byAlias = new Map();
      for (const f of rows) byAlias.set(f.alias, (byAlias.get(f.alias) || 0) + 1);
      const worst = [...byAlias].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, WORST)
        .map(([alias, pages]) => `${alias} ${pages} ${plural(pages, 'page', 'pages')}`);
      lines.push(`${byAlias.size} GM ${plural(byAlias.size, 'alias is', 'aliases are')} printed in the text of published pages (${worst.join(', ')}) — ${where} ${plural(byAlias.size, 'it', 'these')}.`);
    }
  }
  return lines;
}

module.exports = { findNoteFaults, summaryLines, kindOfType, CODES, PRINTED_FIELDS };
