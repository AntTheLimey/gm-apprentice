'use strict';
const { fenceStep, strippedLines } = require('./processor');
const { markerRe } = require('./markers');
// The Campaign Overview's `## Open Threads` bullets, and the ones that name a PC put on that PC's page.
// The writer is skills/shared/scripts/threads.py `format_shared`:
//   - {text} — since {since}; involves [[A]], [[B]]     (or `involves the party`; `since` may be absent)
// Python writes one line per shared thread; a hand-wrapped or nested bullet is read whole, as Python reads it.
// A hand-written bullet may have no tail at all: it names nobody, so it goes on no PC page.

// Greedy, as Python's `_TAIL_RE`: the text runs to the LAST valid tail.
const TAIL_RE = /^(.*)\s+—\s+(?:since\s+([^;]+?);\s*)?involves\s+(.+?)\s*$/;
const LINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g;

function eol(text) { return text.includes('\r\n') ? '\r\n' : '\n'; }

// Line indexes outside a code fence.
function unfenced(lines) {
  const out = new Set();
  let fence = null;
  lines.forEach((line, i) => {
    const step = fenceStep(line, fence);
    fence = step.fenceDelim;
    if (!step.isFenceLine && fence === null) out.add(i);
  });
  return out;
}

// The first level-2 `## {title}` heading in any case, outside a code fence, up to the next heading of level 1 or 2
// outside one: as threads.py `_shared_span` finds the shared list.
function sectionRange(lines, title, open = unfenced(lines)) {
  const heading = new RegExp(`^##\\s+${title}\\s*(?:\\s#+)?\\s*$`, 'i');
  const start = lines.findIndex((l, i) => open.has(i) && heading.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (open.has(i) && /^#{1,2}(?:\s|$)/.test(lines[i])) { end = i; break; }
  return { start, end };
}

// threads.py `_lazy`: can `line`, unindented and straight under a bullet, carry on its text? Not a bullet, a bold
// label line, a heading, a code fence, a gm-only marker, a comment mark or a blockquote or callout.
const GM_MARKER_RE = markerRe(['gm-only'], '');
function lazy(line) {
  const bare = line.trim();
  return !(/^\s*[-*]\s+.+$/.test(line) || /^\*\*[^*]+\*\*/.test(bare) || /^#{1,6}\s+.+$/.test(bare)
    || GM_MARKER_RE.test(line) || /^(```|~~~|<!--|-->|%%|>)/.test(bare));
}

// One shared entry's text from its bullet's text: { text, since, involves, party, tailed } as threads.py
// `_parse_body` reads it; `tailed` when it has a valid `involves` tail.
function parseBody(body) {
  const tail = TAIL_RE.exec(body);
  if (tail) {
    const who = tail[3];
    if (/^the party$/i.test(who)) return { text: tail[1].trim(), since: tail[2], involves: [], party: true, tailed: true };
    const involves = [...who.matchAll(LINK_RE)].map((m) => m[1].trim());
    if (involves.length) return { text: tail[1].trim(), since: tail[2], involves, party: false, tailed: true };
  }
  return { text: body, since: undefined, involves: [], party: false, tailed: false };
}

// -> [{ markdown, involves: [target], party }]; `markdown` is the thread on one line without its `involves` tail.
// Read as threads.py `shared_threads` reads it (`_blocks`, `_shared_of`): each top-level bullet with every line under
// it (deeper lines, after blank lines too, and a lazy line straight under it), joined into one text, a wrapped line
// after a space and a nested bullet's text after "; ". The tail is read off the first line when it has one, else off
// the end of the joined text (also when the first line's `involves` list ends on a comma). A bullet-like line indented
// four or more spaces before the list starts is indented code, not a thread.
// With `all`, a bullet with no valid tail is an entry too (`involves: []`, `party: false`): the party page lists every
// open thread, while a PC page shows only those that name it. Each entry also carries `text` (no tail) and `since`.
function sharedEntries(publishedMarkdown, { all = false } = {}) {
  const lines = String(publishedMarkdown || '').split(/\r?\n/);
  const range = sectionRange(lines, 'Open Threads');
  if (!range) return [];
  const entries = [];
  let base = null;
  let fence = null;
  let i = range.start + 1;
  while (i < range.end) {
    const line = lines[i];
    const step = fenceStep(line, fence);
    fence = step.fenceDelim;
    // Python's bullets: `-` or `*` (vaultlib BULLET_RE).
    const bullet = /^(\s*)[-*]\s+(.+)$/.exec(line);
    const indent = bullet ? bullet[1].length : 0;
    if (step.isFenceLine || fence !== null || !bullet || (base === null && indent >= 4)) { i++; continue; }
    if (base === null || indent < base) base = indent;   // a later bullet outdented past the first one
    if (indent > base) { i++; continue; }   // nested under a bullet the walk skipped
    let stop = i + 1;
    let inner = null;   // a code fence the thread opened: every line in it is the thread's, indented or not
    for (let j = i + 1; j < range.end; j++) {
      const next = lines[j];
      if (inner !== null) { inner = fenceStep(next, inner).fenceDelim; stop = j + 1; continue; }
      if (!next.trim()) continue;   // a blank: the bullet goes on only if a deeper line follows
      if (next.length - next.trimStart().length <= base && !(j === stop && lazy(next))) break;
      inner = fenceStep(next, inner).fenceDelim;
      stop = j + 1;
    }
    const parts = [bullet[2].trim()];
    for (let k = i + 1; k < stop; k++) if (lines[k].trim()) parts.push(lines[k].trim());
    let joined = parts[0];
    for (const part of parts.slice(1)) {
      const sub = /^\s*[-*]\s+(.+)$/.exec(part);
      joined += sub ? `; ${sub[1].trim()}` : ` ${part}`;
    }
    // An `involves` list the first line leaves open on a comma goes on below: the tail is read off the joined text.
    const first = parseBody(parts[0]);
    const cut = parts.length > 1 && parts[0].trimEnd().endsWith(',');
    const entry = first.tailed && !cut ? { ...first, text: first.text + joined.slice(parts[0].length) } : parseBody(joined);
    if (entry.tailed || all) {
      // A hand-written bullet with no `involves` may still end `— since Session 4`: the party page reads that date.
      const dated = !entry.tailed && /^(.*\S)\s+—\s+since\s+(\S.*?)\s*$/.exec(entry.text);
      const text = dated ? dated[1] : entry.text;
      const since = dated ? dated[2] : (entry.since ? entry.since.trim() : undefined);
      entries.push({ markdown: `- ${text}${since ? ` — since ${since}` : ''}`, involves: entry.involves, party: entry.party, text, since });
    }
    i = stop;
  }
  return entries;
}

// Adds `**Shared threads:**` and the entries to `## Current Status`, after its lead fields: before its first
// subsection outside a code fence (a `### GM Notes` the site leaves out would take them with it; so would one inside a
// gm-only block, since the page still files what follows it under that heading, #447), else at its end. The point
// chosen is never inside a hidden span: from it the walk moves up until a line put there survives the page strips, so
// a subsection hidden in a block or comment, or a section that ends inside an unclosed one, gets them before its
// opener. Unchanged with no entries or no section, or with no visible place in it.
const PROBE = 'shared-threads-probe';
function shownAt(lines, at) {
  const probe = [...lines.slice(0, at), PROBE, ...lines.slice(at)].join('\n');
  return strippedLines(probe).lines.some((l) => l.includes(PROBE));
}

function withSharedThreads(pcMarkdown, entries) {
  const text = String(pcMarkdown || '');
  if (!entries || !entries.length) return text;
  const nl = eol(text);
  const lines = text.split(/\r?\n/);
  const open = unfenced(lines);
  const range = sectionRange(lines, 'Current Status', open);
  if (!range) return text;
  let end = range.end;
  for (let i = range.start + 1; i < range.end; i++) if (open.has(i) && /^#{3,6}\s/.test(lines[i])) { end = i; break; }
  let at = end;
  while (at > range.start + 1 && lines[at - 1].trim() === '') at--;
  // One strip says which lines survive; a probe is tried only where a line next to it does (or at the section's top),
  // so a long hidden span costs one strip, not one per line. A spot between two hidden lines is passed over.
  const kept = new Set(strippedLines(lines.join('\n')).from);
  const last = at;
  const worth = (i) => i === last || i === range.start + 1 || kept.has(i - 1) || kept.has(i);
  while (at > range.start + 1 && !(worth(at) && shownAt(lines, at))) {
    at--;
    while (at > range.start + 1 && !worth(at)) at--;
  }
  if (!shownAt(lines, at)) return text;
  while (at > range.start + 1 && lines[at - 1].trim() === '') at--;
  const added = ['', '**Shared threads:**', ...entries.map((e) => e.markdown)];
  if (at < lines.length && lines[at].trim() !== '') added.push('');
  lines.splice(at, 0, ...added);
  return lines.join(nl);
}

// The Overview's shared threads as one site's PC pages show them: the build places them, and the leak check reads the
// same ones as published text (#674), so the two never disagree.
// The Overview is the one vaultlib.campaign_overview picks, from every note in the vault (allNotes): the first by
// vault path, never in a folder Python skips (hidden, templates, the inbox) or an archived, QA or Midwife copy. A
// folder the player site hides, or one no folder_map entry covers, does not matter: its threads are player-facing
// wherever the note sits, and the writer has taken them off the PC notes. When the note is no scanned page, it is
// scanned once with its folder added to the map. Its view is made on a copy by the site's player-safe strip chain
// (`viewOptions`, as publishView takes them); a view that cannot be made gives nothing, never the raw text. A caller
// whose corpus has not had the GM-alias rewrite the build applies in place (the leak check) passes `rewrite`, the
// rewriter's markdown function, and the copy is rewritten first, so its threads read as the site prints them.
function overviewView({ allNotes, corpus, config, viewOptions, rewrite = null, rewriteFreshOnly = false, warn = () => {}, what = 'shared threads were left off the PC pages' }) {
  const path = require('path');
  const { scanVaultReport } = require('./scanner');
  const { ALWAYS_EXCLUDE_DIRS } = require('./publish-decision');
  const { vaultRelPath } = require('./config');
  const overviewNote = (allNotes || [])
    .map((n) => [`${n.vaultPath}.md`, n])
    .filter(([rel, n]) => String((n.frontmatter || {}).type || '').trim().toLowerCase() === 'campaign_overview'
      && !rel.split('/').some((seg) => seg.startsWith('.'))
      && !(rel.includes('/') && ['_Templates', '_templates', '_inbox', '_QA', '_archive', '_midwife'].includes(rel.split('/')[0])))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, n]) => n)[0];
  if (!overviewNote) return null;
  // `rewriteFreshOnly`: the build has already rewritten the pages of its corpus in place, so `rewrite` is for a copy it
  // scans afresh (an Overview in a folder the site never reads).
  let fresh = false;
  const overviewPage = (corpus || []).find((p) => p.sourcePath === overviewNote.sourcePath)
    || (() => {
      fresh = true;
      const dir = path.posix.dirname(overviewNote.vaultPath);
      const folderMap = { ...(config.folderMap || {}), [dir === '.' ? '' : dir]: '_overview' };
      const report = scanVaultReport(Object.assign({}, config, { excludeDirs: ALWAYS_EXCLUDE_DIRS, folderMap }), { quiet: true });
      return report.pages.find((p) => p.sourcePath === overviewNote.sourcePath);
    })();
  if (!overviewPage) {
    warn(`${overviewNote.vaultPath}.md: ${what} because the site never reads that folder`);
    return null;
  }
  try {
    const copy = { ...overviewPage };
    if (rewrite && (fresh || !rewriteFreshOnly)) copy.markdown = rewrite(copy.markdown || '');
    require('./published-view').publishView(copy, viewOptions);   // looked up at the call: a test can make it throw
    return String(copy.publishedMarkdown || '');
  } catch (err) {
    warn(`${vaultRelPath(config.vaultPath, overviewPage.sourcePath)}: ${what} because the Overview's published view could not be made (${err.message})`);
    return null;
  }
}

function overviewThreads(opts) {
  const view = overviewView(opts);
  return view === null ? [] : sharedEntries(view);
}

// The Overview's `## House Rules` section as its published view shows it (player-safe: the gm-only, spoiler and comment
// strips, and the hidden headings, have run), as markdown without its heading; '' when there is none or it is empty.
// The section is found as the shared list is, outside code fences, up to the next heading of level 1 or 2.
function houseRulesOf(publishedMarkdown) {
  const lines = String(publishedMarkdown || '').split(/\r?\n/);
  const range = sectionRange(lines, 'House Rules');
  if (!range) return '';
  // A template's `{hint}` line left in place is no rule.
  return lines.slice(range.start + 1, range.end).filter((l) => !/^\s*\{[^{}]*\}\s*$/.test(l)).join('\n').trim();
}

// A PC's own threads, from the published (player-safe) view of its note: the `**Open threads:**` field under
// `## Current Status`, before its first subsection, read as threads.py `_pc_span` and `_blocks` read it. The label is
// bold, bulleted or not; its list ends at the next heading, and at the next line no deeper than the label that is a
// bold label line (`**Knows:**`, the `**Shared threads:**` the build adds) or, for a bulleted label, a bullet. Text on
// the label line is a thread of its own unless it only says there are none (`None.`, `—`) or is a `{placeholder}`.
// Returns the list as markdown (`- ` bullets, each with the lines under it), '' when there is none.
const LABEL_RE = /^(?<indent>[ \t]*)(?<mark>[-*][ \t]+)?\*\*(?<name>[^*:]+):\*\*(?<rest>.*)$/;
// threads.py `_filler`: inline text that only says there are none, with case and the punctuation and emphasis round
// it dropped.
const NONE_WORDS = new Set(['none', 'nothing', 'n/a', 'na', '-', '—', '–', 'nothing yet', 'none yet', '']);
const filler = (text) => NONE_WORDS.has(text.replace(/^[ \t.,;:!?*_()]+|[ \t.,;:!?*_()]+$/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' '));
function width(line) { return line.replace(/\t/g, '    ').length - line.replace(/\t/g, '    ').trimStart().length; }
function pcOwnThreads(publishedMarkdown) {
  const lines = String(publishedMarkdown || '').split(/\r?\n/);
  const open = unfenced(lines);
  const range = sectionRange(lines, 'Current Status', open);
  if (!range) return '';
  let label = -1;
  let m = null;
  for (let i = range.start + 1; i < range.end; i++) {
    if (!open.has(i)) continue;
    if (/^#{1,6}\s/.test(lines[i])) return '';   // a subsection's label is not the field
    m = LABEL_RE.exec(lines[i]);
    if (m && m.groups.name.trim().toLowerCase() === 'open threads') { label = i; break; }
  }
  if (label < 0) return '';
  const level = width(m.groups.indent);
  let end = range.end;
  for (let j = label + 1; j < range.end; j++) {
    if (!open.has(j)) continue;
    const line = lines[j];
    if (/^#{1,6}\s/.test(line)) { end = j; break; }
    if (!line.trim() || width(line) > level) continue;
    if (/^\*\*[^*]+\*\*/.test(line.trim()) || (m.groups.mark && /^\s*[-*]\s+/.test(line))) { end = j; break; }
  }
  // The threads, as `_blocks` reads them: text on the label line is one, with the lines under it as under a bullet at
  // the label's indent; then each top-level bullet with the lines under it (`blockStop`). Anything else between them
  // (a paragraph after a blank line) is no thread, and a `{placeholder}` bullet is none.
  const blocks = [];
  const rest = m.groups.rest.trim();
  let i = label + 1;
  if (!filler(rest) && !/^\{.*\}$/.test(rest)) {
    const stop = blockStop(lines, label, end, m.groups.indent.length);
    blocks.push({ lines: [`- ${rest}`, ...lines.slice(label + 1, stop)], indent: level });
    i = stop;
  }
  let base = null;
  let fence = null;
  while (i < end) {
    const line = lines[i];
    const step = fenceStep(line, fence);
    fence = step.fenceDelim;
    const bullet = /^(\s*)[-*]\s+(.+)$/.exec(line);
    if (step.isFenceLine || fence !== null || !bullet) { i++; continue; }
    const indent = bullet[1].length;
    if (base === null || indent < base) base = indent;   // a later bullet outdented past the first one
    if (indent > base) { i++; continue; }
    const stop = blockStop(lines, i, end, base);
    if (!/^\{.*\}$/.test(bullet[2].trim())) blocks.push({ lines: lines.slice(i, stop), indent: width(line) });
    i = stop;
  }
  // Each thread out-dented to the list's own level, its nesting kept, its trailing blank lines dropped.
  return blocks.map((b) => {
    const kept = b.lines.map((l) => l.replace(/\t/g, '    ')).map((l) => l.slice(Math.min(b.indent, width(l))));
    while (kept.length > 1 && !kept[kept.length - 1].trim()) kept.pop();
    return kept.join('\n');
  }).join('\n');
}

// threads.py `_block_stop`: the index just past the thread whose first line is `i`: the lines deeper than `base`
// under it, after blank lines too, and a lazy line straight under it; inside a code fence it opened, every line.
function blockStop(lines, i, end, base) {
  let stop = i + 1;
  let j = i + 1;
  let fence = null;
  while (j < end) {
    const next = lines[j];
    if (fence !== null) {
      fence = fenceStep(next, fence).fenceDelim;
      stop = j = j + 1;
      continue;
    }
    if (!next.trim()) { j++; continue; }   // a blank: the bullet goes on only if a deeper line follows
    if (next.length - next.trimStart().length <= base && !(j === stop && lazy(next))) break;
    fence = fenceStep(next, fence).fenceDelim;
    stop = j = j + 1;
  }
  return stop;
}

// "Session 12" -> 12: the number a `since` names, for ordering newest first; null when it names none.
function sinceNumber(since) {
  const n = /(\d+)/.exec(String(since || ''));
  return n ? Number(n[1]) : null;
}

// Newest first by `since`; threads with no date after the dated ones, in their own order (the party page's Open
// Threads, decided 2026-11-19). Stable.
function newestFirst(entries) {
  return entries.map((e, i) => ({ e, i, n: sinceNumber(e.since) }))
    .sort((a, b) => (a.n === null) - (b.n === null) || (b.n || 0) - (a.n || 0) || a.i - b.i)
    .map((x) => x.e);
}

// The shared threads one PC page shows: those that name it, by a link the site resolves to that page, and the party's
// while the PC is in play (as `vw threads move … party` reads it: an out-of-play PC gets one only by name).
function threadsOnPage(page, entries, { linkMap, pages, outOfPlay }) {
  const { resolveSiteLink } = require('./build');
  const { isOutOfPlay } = require('./pc-status');
  const names = (target) => {
    const found = resolveSiteLink(`[[${target}]]`, { linkMap, pages });
    return found.kind === 'page' && found.href === page.outputPath;
  };
  const active = !isOutOfPlay(page.frontmatter, outOfPlay);
  return entries.filter((e) => (e.party && active) || e.involves.some(names));
}

module.exports = { overviewView, houseRulesOf, sharedEntries, withSharedThreads, overviewThreads, threadsOnPage, pcOwnThreads, newestFirst };
