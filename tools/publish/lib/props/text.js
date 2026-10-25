'use strict';

// The words under a prop note's `## The Text` heading, made into sheets of HTML. A fenced
// block is shown exactly as written (lines mode, one <pre>); anything else is prose and
// renders as a page does. A style's layout is filled with these sheets (layout.js).
const { fenceStep, resolveImageEmbeds, resolveWikiLinks, renderMarkdown } = require('../processor');

const HEADING_RE = /^ {0,3}(#{1,2})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE_RE = /^[─═━\-_=]{8,}$/;
const KEY_RE = /^([A-Z][A-Z ]*? \.+)(?= )/;

const isBlank = (line) => /^\s*$/.test(line);
// A thematic break: three or more of one of - * _, spaces between allowed (CommonMark).
const BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start++;
  while (end > start && isBlank(lines[end - 1])) end--;
  return lines.slice(start, end);
}

// The section's lines, blank edges dropped ([] when it is empty), or null when the note has no `## The Text`.
function sectionLines(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  let fence = null;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const step = fenceStep(lines[i], fence);
    fence = step.fenceDelim;
    if (step.isFenceLine || fence !== null) continue;
    const heading = HEADING_RE.exec(lines[i]);
    if (!heading) continue;
    if (start === -1) {
      if (heading[1].length === 2 && heading[2].trim().toLowerCase() === 'the text') start = i + 1;
    } else {
      end = i;
      break;
    }
  }
  if (start === -1) return null;
  return trimBlankEdges(lines.slice(start, end));
}

// The section's lines when they are exactly one fenced block, closed on the last line.
function fencedLines(body) {
  let fence = null;
  for (let i = 0; i < body.length; i++) {
    const step = fenceStep(body[i], fence);
    if (i === 0 && !(step.isFenceLine && step.fenceDelim !== null)) return null;
    fence = step.fenceDelim;
    if (fence === null && i !== body.length - 1) return null;
  }
  if (fence !== null || body.length < 2) return null;
  return body.slice(1, -1);
}

// The words under `## The Text`: { mode: 'lines', lines } or { mode: 'prose', markdown }; null when
// the note has no such section or it holds no words (propTextState says which).
function propTextOf(markdown) {
  const body = sectionLines(markdown);
  if (!body || !body.length) return null;
  // Rules and blank lines after the fence are not words of it (a note often ends the section with `---`).
  let last = body.length;
  while (last > 0 && (isBlank(body[last - 1]) || BREAK_RE.test(body[last - 1]))) last--;
  const inner = fencedLines(body.slice(0, last));
  if (inner) {
    let end = inner.length;
    while (end > 0 && isBlank(inner[end - 1])) end--;
    return { mode: 'lines', lines: inner.slice(0, end) };
  }
  const quoted = body.filter((l) => !isBlank(l)).every((l) => /^ {0,3}>/.test(l));
  const out = quoted ? body.map((l) => l.replace(/^ {0,3}> ?/, '')) : body;
  return { mode: 'prose', markdown: out.join('\n') };
}

// 'none' (no `## The Text`), 'empty' (the section holds no words), or 'words'.
function propTextState(markdown) {
  if (sectionLines(markdown) === null) return 'none';
  const text = propTextOf(markdown);
  const words = text && (text.mode === 'lines' ? text.lines.some((l) => !isBlank(l)) : !isBlank(text.markdown));
  return words ? 'words' : 'empty';
}

const breakStrings = (breaks) => (Array.isArray(breaks) ? breaks : []).filter((b) => typeof b === 'string' && b !== '');

// Index ranges [from, to) of each sheet, blank lines at the edges dropped.
function sheetRanges(lines, breaks) {
  const starts = breakStrings(breaks);
  const ranges = [];
  let from = 0;
  let seen = false;
  const close = (to) => {
    let a = from;
    let b = to;
    while (a < b && isBlank(lines[a])) a++;
    while (b > a && isBlank(lines[b - 1])) b--;
    if (b > a) ranges.push([a, b]);
  };
  for (let i = 0; i < lines.length; i++) {
    if (seen && starts.some((b) => lines[i].startsWith(b))) {
      close(i);
      from = i;
      seen = false;
    }
    if (!isBlank(lines[i])) seen = true;
  }
  close(lines.length);
  return ranges;
}

function splitSheets(lines, breaks) {
  return sheetRanges(lines, breaks).map(([a, b]) => lines.slice(a, b));
}

function lineClasses(lines, { shift } = {}) {
  const rules = [];
  lines.forEach((l, i) => { if (RULE_RE.test(l)) rules.push(i); });
  const shiftAt = typeof shift === 'string' && shift !== '' ? lines.findIndex((l) => l.startsWith(shift)) : -1;
  let last = lines.length - 1;
  while (last >= 0 && isBlank(lines[last])) last--;
  return lines.map((line, i) => {
    const c = ['l'];
    if (isBlank(line)) c.push('l-blank');
    if (/[A-Z]/.test(line) && !/[a-z]/.test(line)) c.push('l-caps');
    if (/^[A-Z]+:\s/.test(line)) c.push('l-label');
    if (RULE_RE.test(line)) c.push('l-rule');
    if (line.startsWith(' ')) c.push('l-indent');
    if (/ \.+ /.test(line)) c.push('l-leader');
    if (rules.length && i < rules[0]) {
      c.push('l-head');
      if (i === 0) c.push('l-head1');
    }
    if (rules.length >= 2 && i > rules[rules.length - 1]) c.push('l-fine');
    if (shiftAt !== -1 && i >= shiftAt) c.push('l-shift');
    if (i === last) c.push('l-last');
    return c;
  });
}

// A fence shows its text as written: only the three characters that would read as markup.
const rawEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lineHtml(line, classes) {
  const key = KEY_RE.exec(line);
  const text = key
    ? `<span class="l-key">${rawEscape(key[1])}</span>${rawEscape(line.slice(key[1].length))}`
    : rawEscape(line);
  return `<span class="${classes.join(' ')}">${text}</span>`;
}

function proseParts(markdown, breaks) {
  const starts = breakStrings(breaks);
  const parts = [[]];
  let fence = null;
  let afterBlank = false;
  for (const line of markdown.split('\n')) {
    const step = fenceStep(line, fence);
    const outside = fence === null && !step.isFenceLine;
    if (outside && afterBlank && starts.some((b) => line.startsWith(b))) parts.push([]);
    parts[parts.length - 1].push(line);
    fence = step.fenceDelim;
    afterBlank = isBlank(line);
  }
  return parts.map((p) => p.join('\n')).filter((p) => !isBlank(p));
}

function propSheets(text, { breaks, shift, linkMap, imageMap, usedImages, outputPath } = {}) {
  if (!text) return [];
  if (text.mode === 'lines') {
    const classes = lineClasses(text.lines, { shift });
    return sheetRanges(text.lines, breaks).map(([a, b]) => {
      const rows = [];
      for (let i = a; i < b; i++) rows.push(lineHtml(text.lines[i], classes[i]));
      return `<pre class="prop-text">${rows.join('\n')}</pre>`;
    });
  }
  return proseParts(text.markdown, breaks).map((part) => {
    let md = resolveImageEmbeds(part, imageMap || {}, outputPath, usedImages);
    md = resolveWikiLinks(md, linkMap || {}, outputPath);
    return `<div class="prop-text">${renderMarkdown(md)}</div>`;
  });
}

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function linesOfPropHtml(html) {
  const out = [];
  const re = /<pre class="prop-text">([\s\S]*?)<\/pre>/g;
  let m;
  while ((m = re.exec(html))) {
    for (const row of m[1].split('\n')) out.push(decode(row.replace(/<[^>]*>/g, '')));
  }
  return out;
}

module.exports = { propTextOf, propTextState, splitSheets, lineClasses, propSheets, linesOfPropHtml };
