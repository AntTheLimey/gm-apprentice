'use strict';
// The marks on the GM site. Where the player site removes a hidden part, the GM site keeps it and wraps it in two
// private-use characters: U+E000, the mark's number in base 36 and U+E001 open it, U+E002 closes it. The renderer
// passes them through as text; renderMarks turns them into the panel's HTML when a GM page is written, and unmark
// takes them out of every other file. This module knows nothing about notes, and requires nothing else in lib/ at
// load: processor.js requires it, and the settings list loads templates that read processor.js as they load.

const OPEN = '\uE000';
const MID = '\uE001';
const CLOSE = '\uE002';
// A whole open token (its number in group 1), an open token an excerpt cut in half (no U+E001: dropped with its
// digits), a stray U+E001, a close.
const TOKEN = /\uE000([0-9a-z]+)\uE001|\uE000[0-9a-z]*|[\uE001\uE002]/g;
const SHOW = 'gm_site.show.';

// A table of marks for one build: each open token carries its number in this table.
function createMarks() {
  const table = [];
  return {
    open(kind, label) {
      table.push({ kind: String(kind), label: String(label == null ? '' : label) });
      return OPEN + (table.length - 1).toString(36) + MID;
    },
    // The same mark opened again, after a heading closed it.
    again(token) { return token; },
    close() { return CLOSE; },
    get(id) { return table[id] ? { ...table[id] } : undefined; },
  };
}

// The kinds of mark: the names of the GM site's show switches, in the settings list's order.
function markKinds() {
  const { REGISTRY } = require('./settings/registry');   // here, not at the top (see above)
  return REGISTRY.filter((e) => e.name.startsWith(SHOW) && !e.container && !e.twinOf).map((e) => e.name.slice(SHOW.length));
}

// A note's own text: any of the three characters it holds becomes U+FFFD, so a note cannot forge a mark.
const sanitize = (text) => String(text == null ? '' : text).replace(/[\uE000-\uE002]/g, '\uFFFD');

// The text with every token taken out and the words between them kept.
const unmark = (text) => String(text == null ? '' : text).replace(TOKEN, '');

// The text as players see it: each marked span dropped, its tokens with it, and every half token and stray character.
// A span whose label says what players see in its place ("players see: someone", "gm_aliases; players see: Vex")
// leaves those words. A span still open at the end drops the rest. Every excerpt the GM site makes reads this, so no
// excerpt can cut a mark open.
function withoutMarked(text, marks) {
  const s = String(text == null ? '' : text);
  if (!/[-]/.test(s)) return s;
  let out = '';
  let depth = 0;
  let instead = '';
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (depth === 0) out += s.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      if (depth === 0) {
        const rec = marks ? marks.get(parseInt(m[1], 36)) : undefined;
        const seen = rec ? /players see: (.*)$/.exec(rec.label) : null;
        instead = seen ? seen[1] : '';
      }
      depth++;
    } else if (m[0] === CLOSE && depth > 0) {
      depth--;
      if (depth === 0) out += instead;
    }
  }
  if (depth === 0) out += s.slice(last);
  return out;
}

// A token that marks a block stands alone between blank lines, so it renders as a paragraph of its own.
const blockLines = (token) => ['', token, ''];

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A heading line with its text wrapped in the given open tokens; the hashes, and any closing hashes, stay outside.
function wrapHeading(line, tokens) {
  const cr = line.endsWith('\r') ? '\r' : '';
  const m = /^( {0,3}#{1,6})([ \t]*)(.*)$/.exec(cr ? line.slice(0, -1) : line);
  if (!m) return line;
  const [, hashes, lead, rest] = m;
  const [, title, trail] = /^#+[ \t]*$/.test(rest) ? [null, '', rest] : /^(.*?)((?:[ \t]+#+)?[ \t]*)$/.exec(rest);
  return hashes + (lead || ' ') + tokens.join('') + title + CLOSE.repeat(tokens.length) + trail + cr;
}

// A setext heading's title lines with their text wrapped: the tokens open after the first line's indent and close
// before the last line's trailing spaces, so the underline below still makes them a heading.
function wrapSetext(titleLines, tokens) {
  const out = titleLines.slice();
  out[0] = out[0].replace(/^( {0,3})/, `$1${tokens.join('')}`);
  const last = out.length - 1;
  out[last] = out[last].replace(/([ \t]*\r?)$/, `${CLOSE.repeat(tokens.length)}$1`);
  return out;
}

// Do a line's own tokens close every mark they open, and never one opened before the line?
function balancedLine(line) {
  let depth = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m[1] !== undefined) depth++;
    else if (m[0] === CLOSE && --depth < 0) return false;
  }
  return depth === 0;
}

// A mark never spans a level 1-2 heading (amendment 5): the templates cut a page there. Every mark open at such a
// heading is closed before it, the heading's own text is wrapped in the innermost, and each is opened again below.
// A mark whose open line stands directly above the heading (blank lines between) starts at it: that line is taken out
// and the heading wrapped in it, so no empty panel is left above. An open line followed only by blank lines and a
// close line is an empty panel, and both lines are taken out. `findHeadings` is processor.js's, passed in.
function marksAtHeadings(markdown, findHeadings) {
  const text = String(markdown == null ? '' : markdown);
  if (!/[\uE000\uE002]/.test(text)) return text;
  const { headingAt, inCode } = findHeadings(text);
  const lines = text.split('\n');
  const out = [];     // { text, open }: `open` is the token of a line that is an open token alone, outside code
  const stack = [];   // the tokens open, outermost first
  const lastFull = () => { for (let j = out.length - 1; j >= 0; j--) if (out[j].text.trim()) return j; return -1; };
  const push = (t) => out.push({ text: t, open: /^\uE000[0-9a-z]+\uE001$/.test(t) ? t : null });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bare = line.replace(/\r$/, '');
    const code = inCode && inCode.has(i);
    const h = headingAt.get(i);
    // A setext heading's title runs from this line to the line above its underline (h.end - 1).
    const titleLines = h && (h.atx ? [line] : lines.slice(i, h.end - 1));
    if (h && !h.nested && h.level <= 2 && stack.length && titleLines.length
      && balancedLine(titleLines.join('\n').replace(/\r/g, ''))) {
      const starting = [];   // marks that start at this heading, outermost first
      for (let j = lastFull(); j >= 0 && starting.length < stack.length
        && out[j].open === stack[stack.length - 1 - starting.length]; j = lastFull()) {
        starting.unshift(out[j].open);
        out.splice(j, 1);
      }
      for (let k = stack.length - starting.length; k > 0; k--) blockLines(CLOSE).forEach(push);
      const wrap = starting.length ? starting : [stack[stack.length - 1]];
      if (h.atx) out.push({ text: wrapHeading(line, wrap), open: null });
      else {
        wrapSetext(titleLines, wrap).forEach((t) => out.push({ text: t, open: null }));
        lines.slice(h.end - 1, h.end).forEach((t) => out.push({ text: t, open: null }));   // the underline
        i = h.end - 1;
      }
      for (const t of stack) blockLines(t).forEach(push);
      continue;
    }
    if (!code && bare === CLOSE && stack.length) {
      const j = lastFull();
      if (j >= 0 && out[j].open === stack[stack.length - 1]) {
        out.splice(j, 1);
        stack.pop();
        continue;
      }
    }
    out.push({ text: line, open: code ? null : (/^\uE000[0-9a-z]+\uE001$/.test(bare) ? bare : null) });
    for (const m of bare.matchAll(TOKEN)) {
      if (m[1] !== undefined) stack.push(m[0]);
      else if (m[0] === CLOSE) stack.pop();
    }
  }
  return out.map((o) => o.text).join('\n');
}

// The parts of a page's HTML: a paragraph holding only a token (a block mark), elements whose text is never marked
// (their tokens are removed), comments, and tags.
const PARTS = /(<p>\s*(?:\uE000[0-9a-z]+\uE001|\uE002)\s*<\/p>|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<title\b[\s\S]*?<\/title>|<textarea\b[\s\S]*?<\/textarea>|<!--[\s\S]*?-->|<[^>]*>)/i;
const BLOCK_PART = /^<p>\s*(?:\uE000([0-9a-z]+)\uE001|\uE002)\s*<\/p>$/;
const PROTECTED = /^<(?:script|style|title|textarea|!)/i;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Elements a span may open before (text-level elements).
const PHRASING = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'ins',
  'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);
// Elements a panel (a div) may stand in directly.
const FLOW = new Set(['article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'figure', 'footer', 'header', 'li',
  'main', 'nav', 'section', 'td', 'th']);

// The page's HTML with every token turned into a mark's element. A token alone in a paragraph is a panel
// (a div with its label); any other is a span (its label shown from CSS). Tokens inside a tag or in a script, style,
// title or textarea are removed. A mark is never left crossing an element: when the element it opened in closes,
// it closes with it and opens again at the next text; a close that falls deeper than its open waits for the elements
// between to close. A close with nothing open is dropped; a mark left open is closed at the end.
function renderMarks(html, marks) {
  const out = [];
  const open = [];   // the elements open, in order: { tag } or { rec } (a mark's element)
  const live = [];   // the marks open, in token order: { kind, label, block, as, closed }; `as` is its element while drawn
  const flowParent = () => {
    const top = open[open.length - 1];
    return !top || (top.rec ? top.rec.as === 'div' : FLOW.has(top.tag));
  };
  const draw = (rec, asDiv) => {
    rec.as = asDiv ? 'div' : 'span';
    const kind = escapeAttr(rec.kind);
    const label = escapeAttr(rec.label);
    const attrs = `class="gm-mark gm-mark--${kind}" data-gm-kind="${kind}" data-gm-label="${label}"`;
    out.push(asDiv ? `<div ${attrs}><p class="gm-mark__label">GM: ${label}</p>` : `<span ${attrs}>`);
    open.push({ rec });
  };
  const undraw = (rec) => { out.push(`</${rec.as}>`); rec.as = null; };
  // Draw again the marks closed with an element, above the last mark still drawn (so marks nest in token order).
  // Before a block element only panels in a place that holds one; before text, any (a panel as a span).
  const resume = (ctx) => {
    let i = live.length;
    while (i > 0 && !live[i - 1].as) i--;
    for (; i < live.length; i++) {
      const rec = live[i];
      if (rec.silent) continue;
      if (ctx === 'flow') {
        if (!rec.block || !flowParent()) break;
        draw(rec, true);
      } else draw(rec, false);
    }
  };
  // Close the marks that were closed by token while an element inside them was still open.
  const flush = () => {
    while (open.length && open[open.length - 1].rec && open[open.length - 1].rec.closed) undraw(open.pop().rec);
  };
  const openMark = (id, block) => {
    const m = marks.get(id);
    if (!m) { live.push({ silent: true, as: null }); return; }   // a number no mark has: its close still pairs with it
    resume(block ? 'flow' : 'phrasing');
    const rec = { kind: m.kind, label: m.label, block, as: null, closed: false };
    live.push(rec);
    draw(rec, block && flowParent());
  };
  const closeMark = () => {
    const rec = live.pop();
    if (!rec || !rec.as) return;
    rec.closed = true;
    flush();
  };
  const text = (s) => {
    if (/\S/.test(s)) resume('phrasing');
    out.push(s);
  };
  const parts = String(html == null ? '' : html).split(PARTS);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part) continue;
    if (p % 2 === 0) {   // text
      let last = 0;
      for (const m of part.matchAll(TOKEN)) {
        text(part.slice(last, m.index));
        last = m.index + m[0].length;
        if (m[1] !== undefined) openMark(parseInt(m[1], 36), false);
        else if (m[0] === CLOSE) closeMark();
      }
      text(part.slice(last));
      continue;
    }
    const block = BLOCK_PART.exec(part);
    if (block) {
      if (block[1] !== undefined) openMark(parseInt(block[1], 36), true);
      else closeMark();
      continue;
    }
    const tag = unmark(part);
    if (PROTECTED.test(part)) { out.push(tag); continue; }
    const t = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(part);
    if (!t) { out.push(tag); continue; }
    const name = t[2].toLowerCase();
    if (!t[1]) {
      resume(PHRASING.has(name) ? 'phrasing' : 'flow');
      out.push(tag);
      if (!VOID.has(name) && !/\/>$/.test(part)) open.push({ tag: name });
      continue;
    }
    let i = open.length - 1;
    while (i >= 0 && open[i].tag !== name) i--;
    if (i < 0) { out.push(tag); continue; }   // a close tag with nothing to close
    while (open.length - 1 > i) {
      const e = open.pop();
      if (e.rec) undraw(e.rec);   // closed with the element; drawn again at the next text unless closed by token
    }
    out.push(tag);
    open.pop();
    flush();
  }
  while (open.length) {
    const e = open.pop();
    if (e.rec) undraw(e.rec);
  }
  return out.join('');
}

module.exports = { createMarks, markKinds, sanitize, unmark, withoutMarked, blockLines, marksAtHeadings, renderMarks };
