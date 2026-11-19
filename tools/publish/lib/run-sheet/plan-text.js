'use strict';
// Pure string helpers the run sheet reader builds on. Every one takes text that may be CRLF, may
// hold <!-- comments -->, may be empty or odd, and never throws: empty input gives '' or [].
//
// LINE INDEXES. `start` and `end` are line indexes into `cleanText(text)`: CRLF turned to LF, each
// <!-- ... --> comment cut out but its line breaks kept, so a multi-line comment leaves blank lines
// and never shifts the lines after it. `end` is INCLUSIVE. A caller that wants to know what no
// field took passes the same text to `unclaimed`, which cleans it the same way.

const { splitTableRow, wikilinkSpans, parseWikilink } = require('../wikilink');

function cleanText(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inComment = false;
  let fence = null;
  for (const line of src) {
    if (!inComment) {
      const f = line.match(FENCE);
      if (fence !== null || f) {
        if (f && (fence === null || fence === f[1])) fence = fence === null ? f[1] : null;
        out.push(line);
        continue;
      }
    }
    let res = '';
    let pos = 0;
    for (;;) {
      if (inComment) {
        const c = line.indexOf('-->', pos);
        if (c === -1) break; // the rest of the line is comment
        inComment = false;
        pos = c + 3;
      } else {
        const o = line.indexOf('<!--', pos);
        if (o === -1) { res += line.slice(pos); break; }
        res += line.slice(pos, o);
        inComment = true;
        pos = o + 4;
      }
    }
    out.push(res);
  }
  return out.join('\n');
}

const linesOf = (text) => cleanText(text).split('\n');
// true for each line inside a fenced code block, fence lines included
function fenceMask(lines) {
  let fence = null;
  return lines.map((l) => {
    const f = l.match(FENCE);
    if (fence !== null) { if (f && f[1] === fence) fence = null; return true; }
    if (f) { fence = f[1]; return true; }
    return false;
  });
}
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
// next label line, bare bold block head (`**Then**`), blank line, bullet, table row, quote or heading; lines that wrap are joined
// with a space.
function labels(text) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    const parts = m[2].trim() === '' ? [] : [m[2].trim()];
    let end = i;
    // an empty value makes this line a block head: the lines after it belong to block()
    while (parts.length > 0 && end + 1 < lines.length) {
      const nx = lines[end + 1];
      if (isBlank(nx) || LABEL.test(nx) || BLOCK_HEAD.test(nx) || BULLET.test(nx) || isTableRow(nx) || isQuote(nx) || HEADING.test(nx)) break;
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
  const all = linesOf(text);
  const fenced = fenceMask(all);
  const rows = all.filter((l, i) => !fenced[i] && isTableRow(l)).map((l) => {
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

// Each table's line range (header, separator and rows), fenced code skipped.
function tableRanges(text) {
  const lines = linesOf(text);
  const fenced = fenceMask(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i] || !isTableRow(lines[i])) continue;
    let end = i;
    while (end + 1 < lines.length && !fenced[end + 1] && isTableRow(lines[end + 1])) end++;
    out.push({ start: i, end });
    i = end;
  }
  return out;
}

// Top-level list items. Indented (nested) lines and wrapped lines fold into the item with '\n'.
// `box` is true for `- [ ]` / `- [x]`; the box is removed from `text`.
function bullets(text) {
  const lines = linesOf(text);
  const fenced = fenceMask(lines);
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (fenced[i]) {
      flush();
    } else if (BULLET.test(l)) {
      flush();
      let t = l.replace(BULLET, '').trimEnd();
      const b = t.match(/^\[([ xX])\][ \t]*(.*)$/);
      if (b) t = b[2];
      cur = { text: t, box: Boolean(b), start: i, end: i };
    } else if (cur && isBlank(l)) {
      // a blank line continues the item only when an indented line follows
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && !fenced[j] && /^\s+\S/.test(lines[j]) && !isQuote(lines[j])) { i = j - 1; } else flush();
    } else if (cur && !HEADING.test(l) && !isTableRow(l) && !isQuote(l)) {
      cur.text += `\n${l.trimEnd()}`;
      cur.end = i;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

// Wikilink targets in order, duplicates kept; `#heading` and `|alias` dropped; embeds skipped.
function links(text) {
  const ls = linesOf(text);
  const fenced = fenceMask(ls);
  const s = ls.map((l, i) => (fenced[i] ? '' : l)).join('\n');
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

// The line ranges of the quote groups readAloud reads.
function readAloudRanges(text) {
  const out = [];
  let cur = null;
  linesOf(text).forEach((l, i) => {
    if (!isQuote(l)) { cur = null; return; }
    if (!cur) { cur = { start: i, end: i }; out.push(cur); } else cur.end = i;
  });
  return out;
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

module.exports = { cleanText, sections, labels, label, block, tableRows, tableRanges, bullets, links, readAloud, readAloudRanges, unclaimed };
