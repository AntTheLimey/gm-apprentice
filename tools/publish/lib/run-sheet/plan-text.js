'use strict';
// Pure string helpers the run sheet reader builds on. Every one takes text that may be CRLF, may
// hold <!-- comments -->, may be empty or odd, and never throws: empty input gives '' or [].
//
// LINE INDEXES. `start` and `end` are line indexes into `normalise(text)`: CRLF turned to LF, each
// <!-- ... --> comment cut out but its line breaks kept, so a multi-line comment leaves blank lines
// and never shifts the lines after it. `end` is INCLUSIVE. A caller that wants to know what no
// field took passes the same text to `unclaimed`, which normalises it the same way.

const { splitTableRow, wikilinkSpans, parseWikilink } = require('../wikilink');

function normalise(text) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  // An unclosed comment runs to the end of the text.
  return s.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, ''));
}

const linesOf = (text) => normalise(text).split('\n');
const isBlank = (l) => l.trim() === '';
const HEADING = /^#{1,6}\s/;
const FENCE = /^\s*(```|~~~)/;
const LABEL = /^(?:[-*+]\s+)?\*\*([^*\n]+?):\*\*[ \t]*(.*)$/;
const BLOCK_HEAD = /^\*\*([^*\n]+?):?\*\*[ \t]*$/;
const BULLET = /^(?:[-*+]|\d+[.)])\s+/;
const isQuote = (l) => /^\s*>/.test(l);
const isTableRow = (l) => /^\s*\|/.test(l);
const nameKey = (s) => String(s == null ? '' : s).trim().toLowerCase();

// The `level` sections of a body, in order, duplicates kept. `text` is trimmed of blank edges.
// Text before the first heading comes back as { title: '', text } when it is not blank.
function sections(body, level) {
  const n = Number(level);
  const head = new RegExp(`^#{${n}}[ \\t]+(.*?)[ \\t#]*$`);
  const out = [];
  let cur = { title: '', lines: [] };
  let fence = null;
  for (const line of linesOf(body)) {
    const f = line.match(FENCE);
    if (f) fence = fence === null ? f[1] : (fence === f[1] ? null : fence);
    const m = fence === null && !f && n >= 1 ? line.match(head) : null;
    if (m) {
      out.push(cur);
      cur = { title: m[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  out.push(cur);
  return out
    .map((s) => ({ title: s.title, text: s.lines.join('\n').trim() }))
    .filter((s, i) => i > 0 || s.text !== '');
}

// Every `**Name:** value` or `- **Name:** value` line. The value runs from after the label to the
// next label line, blank line, bullet, table row, quote or heading; lines that wrap are joined
// with a space.
function labels(text) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    const parts = m[2].trim() === '' ? [] : [m[2].trim()];
    let end = i;
    while (end + 1 < lines.length) {
      const nx = lines[end + 1];
      if (isBlank(nx) || LABEL.test(nx) || BULLET.test(nx) || isTableRow(nx) || isQuote(nx) || HEADING.test(nx)) break;
      parts.push(nx.trim());
      end++;
    }
    out.push({ name: m[1].trim(), value: parts.join(' '), start: i, end });
    i = end;
  }
  return out;
}

// All values for `name` (case-insensitive), in order, joined with a blank line.
function label(text, name) {
  const key = nameKey(name);
  return labels(text).filter((l) => nameKey(l.name) === key && l.value !== '').map((l) => l.value).join('\n\n');
}

// The lines after a line that is only `**Name**` or `**Name:**`, up to the next label line, bare
// bold heading line, quote or heading. Blank lines inside are kept; the value is trimmed.
// Not found: { value: '', start: -1, end: -1 }.
function block(text, name) {
  const key = nameKey(name);
  const lines = linesOf(text);
  const at = lines.findIndex((l) => { const m = l.match(BLOCK_HEAD); return m && nameKey(m[1]) === key; });
  if (at === -1) return { value: '', start: -1, end: -1 };
  let end = at;
  const body = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (LABEL.test(l) || BLOCK_HEAD.test(l) || isQuote(l) || HEADING.test(l)) break;
    body.push(l);
    if (!isBlank(l)) end = i;
  }
  return { value: body.join('\n').trim(), start: at, end };
}

// The body rows of the first-found table lines: header and separator dropped, cells trimmed.
// An escaped pipe stays as written (`\|`).
function tableRows(text) {
  const rows = linesOf(text).filter(isTableRow).map((l) => {
    const cells = splitTableRow(l.trim());
    if (cells[0].trim() === '') cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    return cells.map((c) => c.trim());
  });
  const isSep = (r) => r.length > 0 && r.every((c) => /^:?-{1,}:?$/.test(c));
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (isSep(rows[i])) continue;
    // the row just before a separator is a header
    if (i + 1 < rows.length && isSep(rows[i + 1])) continue;
    out.push(rows[i]);
  }
  return out;
}

// Top-level list items. Indented (nested) lines and wrapped lines fold into the item with '\n'.
// `box` is true for `- [ ]` / `- [x]`; the box is removed from `text`.
function bullets(text) {
  const lines = linesOf(text);
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (BULLET.test(l)) {
      flush();
      let t = l.replace(BULLET, '').trimEnd();
      const b = t.match(/^\[([ xX])\][ \t]*(.*)$/);
      if (b) t = b[2];
      cur = { text: t, box: Boolean(b) };
    } else if (cur && isBlank(l)) {
      // a blank line continues the item only when an indented line follows
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && /^\s+\S/.test(lines[j]) && !isQuote(lines[j])) { i = j - 1; } else flush();
    } else if (cur && !HEADING.test(l) && !isTableRow(l) && !isQuote(l)) {
      cur.text += `\n${l.trimEnd()}`;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

// Wikilink targets in order, duplicates kept; `#heading` and `|alias` dropped; embeds skipped.
function links(text) {
  const s = normalise(text);
  const out = [];
  for (const span of wikilinkSpans(s, true)) {
    if (s[span.index] === '!') continue;
    const target = parseWikilink(span.body).target.trim();
    if (target) out.push(target);
  }
  return out;
}

// The quoted lines (`> ...`), marker removed, as one string; separate quotes are joined with a
// blank line. A callout title line (`> [!type] ...`) is dropped.
function readAloud(text) {
  const groups = [];
  let cur = null;
  for (const l of linesOf(text)) {
    if (!isQuote(l)) { cur = null; continue; }
    const t = l.replace(/^\s*>[ \t]?/, '');
    if (!cur) { cur = []; groups.push(cur); }
    if (/^\s*\[![^\]]*\]/.test(t)) continue;
    cur.push(t.trimEnd());
  }
  return groups.map((g) => g.join('\n').trim()).filter(Boolean).join('\n\n');
}

// The lines no range covers (ranges are inclusive line indexes, see the top), joined with '\n'
// and trimmed of blank lines at both ends.
function unclaimed(text, claimed) {
  const taken = new Set();
  for (const r of Array.isArray(claimed) ? claimed : []) {
    if (!r || !Number.isInteger(r.start) || !Number.isInteger(r.end)) continue;
    for (let i = Math.max(r.start, 0); i <= r.end; i++) taken.add(i);
  }
  return linesOf(text).filter((_, i) => !taken.has(i)).join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').trim();
}

module.exports = { normalise, sections, labels, label, block, tableRows, bullets, links, readAloud, unclaimed };
