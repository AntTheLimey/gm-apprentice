'use strict';
const { fenceStep } = require('./processor');
// The Campaign Overview's `## Open Threads` bullets, and the ones that name a PC put on that PC's page.
// The writer is skills/shared/scripts/threads.py `format_shared`:
//   - {text} — since {since}; involves [[A]], [[B]]     (or `involves the party`; `since` may be absent)
// Python writes one line per shared thread; a hand-wrapped or nested bullet is read by its first line only.
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

// -> [{ markdown, involves: [target], party }]; `markdown` is the bullet without its `involves` tail.
function sharedEntries(publishedMarkdown) {
  const lines = String(publishedMarkdown || '').split(/\r?\n/);
  const open = unfenced(lines);
  const range = sectionRange(lines, 'Open Threads', open);
  if (!range) return [];
  const entries = [];
  let base = null;
  for (let i = range.start + 1; i < range.end; i++) {
    // Python's bullets: `-` or `*` (vaultlib BULLET_RE). Only top-level ones (the indent of the list's first bullet)
    // are threads: one indented deeper belongs to the thread above it (threads.py `_blocks`).
    const bullet = open.has(i) && /^(\s*)[-*]\s+(.+?)\s*$/.exec(lines[i]);
    if (!bullet) continue;
    if (base === null) base = bullet[1].length;
    if (bullet[1].length > base) continue;
    const tail = TAIL_RE.exec(bullet[2]);
    if (!tail) continue;
    const who = tail[3];
    const party = /^the party$/i.test(who);
    const involves = party ? [] : [...who.matchAll(LINK_RE)].map((m) => m[1].trim());
    if (!party && !involves.length) continue;
    entries.push({ markdown: `- ${tail[1].trim()}${tail[2] ? ` — since ${tail[2].trim()}` : ''}`, involves, party });
  }
  return entries;
}

// Adds `**Shared threads:**` and the entries at the end of `## Current Status`. Unchanged with no entries or no section.
function withSharedThreads(pcMarkdown, entries) {
  const text = String(pcMarkdown || '');
  if (!entries || !entries.length) return text;
  const nl = eol(text);
  const lines = text.split(/\r?\n/);
  const range = sectionRange(lines, 'Current Status');
  if (!range) return text;
  let at = range.end;
  while (at > range.start + 1 && lines[at - 1].trim() === '') at--;
  const added = ['', '**Shared threads:**', ...entries.map((e) => e.markdown)];
  if (at === range.end && range.end < lines.length) added.push('');
  lines.splice(at, 0, ...added);
  return lines.join(nl);
}

module.exports = { sharedEntries, withSharedThreads };
