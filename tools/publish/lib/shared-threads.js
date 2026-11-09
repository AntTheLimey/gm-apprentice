'use strict';
// The Campaign Overview's `## Open Threads` bullets, and the ones that name a PC put on that PC's page.
// The writer is skills/shared/scripts/threads.py `format_shared`:
//   - {text} — since {since}; involves [[A]], [[B]]     (or `involves the party`; `since` may be absent)
// A hand-written bullet may have no tail at all: it names nobody, so it goes on no PC page.

const TAIL_RE = /^(.*?)\s+—\s+(?:since\s+([^;]+?);\s*)?involves\s+(.+?)\s*$/;
const LINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g;

function eol(text) { return text.includes('\r\n') ? '\r\n' : '\n'; }

// The lines of a `## {title}` section (heading excluded), up to the next heading of level 1 or 2.
function sectionRange(lines, title) {
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\s*#*\\s*$`, 'i').test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  return { start, end };
}

// -> [{ markdown, involves: [target], party }]; `markdown` is the bullet without its `involves` tail.
function sharedEntries(publishedMarkdown) {
  const lines = String(publishedMarkdown || '').split(/\r?\n/);
  const range = sectionRange(lines, 'Open Threads');
  if (!range) return [];
  const entries = [];
  for (const line of lines.slice(range.start + 1, range.end)) {
    const bullet = /^[-*+]\s+(.+?)\s*$/.exec(line);
    if (!bullet) continue;
    const tail = TAIL_RE.exec(bullet[1]);
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
