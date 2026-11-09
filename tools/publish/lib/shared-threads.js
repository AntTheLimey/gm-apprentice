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
  for (let i = start + 1; i < lines.length; i++) if (open.has(i) && /^#{1,2}\s/.test(lines[i])) { end = i; break; }
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
function sharedEntries(publishedMarkdown) {
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
    if (base === null) base = indent;
    if (indent > base) { i++; continue; }   // nested under a bullet the walk skipped
    let stop = i + 1;
    for (let j = i + 1; j < range.end; j++) {
      const next = lines[j];
      if (!next.trim()) continue;   // a blank: the bullet goes on only if a deeper line follows
      if (next.length - next.trimStart().length <= base && !(j === stop && lazy(next))) break;
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
    if (entry.tailed) {
      entries.push({ markdown: `- ${entry.text}${entry.since ? ` — since ${entry.since.trim()}` : ''}`, involves: entry.involves, party: entry.party });
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

module.exports = { sharedEntries, withSharedThreads };
