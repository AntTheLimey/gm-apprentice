const MarkdownIt = require('markdown-it');
const { splitTableRow } = require('./wikilink');

// Obsidian callout: `> [!type] Optional Title` on the first line of a blockquote,
// with the rest of the quote as the body. The type may carry a fold marker (`+`/`-`),
// which affects Obsidian's reading view only and is ignored here.
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\][+-]?[ \t]*([^\n]*)(?:\n([\s\S]*))?$/;

// Rewrites callout blockquotes into `<div class="callout callout-{type}">` with a
// title div, so the `[!type]` marker never survives as literal body text.
//
// Registered after markdown-it's `inline` rule and therefore before `replacements` /
// `smartquotes`: the inline tokens this rule re-parses still get typographer treatment.
function calloutPlugin(md) {
  md.core.ruler.after('inline', 'obsidian_callout', function callouts(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;

      const pOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      const pClose = tokens[i + 3];
      if (!pOpen || pOpen.type !== 'paragraph_open') continue;
      if (!inline || inline.type !== 'inline') continue;
      if (!pClose || pClose.type !== 'paragraph_close') continue;

      const match = CALLOUT_RE.exec(inline.content);
      if (!match) continue;

      // Find this blockquote's own close, not a nested one's.
      let depth = 0;
      let closeIndex = -1;
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') depth++;
        else if (tokens[j].type === 'blockquote_close') {
          depth--;
          if (depth === 0) { closeIndex = j; break; }
        }
      }
      if (closeIndex === -1) continue;

      const type = match[1].toLowerCase();
      // Obsidian falls back to the callout type as its own title when none is given.
      const title = match[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
      const body = match[3] || '';

      tokens[i].tag = 'div';
      tokens[i].attrJoin('class', `callout callout-${type}`);
      tokens[closeIndex].tag = 'div';

      pOpen.tag = 'div';
      pOpen.attrJoin('class', 'callout-title');
      pClose.tag = 'div';
      inline.content = title;
      inline.children = [];
      state.md.inline.parse(title, state.md, state.env, inline.children);

      // A callout written as one lazy paragraph (`> [!info] Title` then `> prose` with no
      // blank line) parses into a single inline token. Split the prose back out so it
      // renders as body rather than being swallowed by the title.
      if (body.trim()) {
        const bodyOpen = new state.Token('paragraph_open', 'p', 1);
        const bodyInline = new state.Token('inline', '', 0);
        bodyInline.content = body;
        bodyInline.children = [];
        state.md.inline.parse(body, state.md, state.env, bodyInline.children);
        const bodyClose = new state.Token('paragraph_close', 'p', -1);
        tokens.splice(i + 4, 0, bodyOpen, bodyInline, bodyClose);
      }
    }
  });
}

// --- tables wider than their header --------------------------------------------------------
// GFM (markdown-it) drops a body cell that sits past the header's last column, silently. A GM
// who tacks a note onto one row of a template table would lose it from the page. So before the
// blocks are parsed, a table whose widest body row is wider than its header gets blank header
// and delimiter cells to match, and every cell renders. A row with fewer cells is unchanged
// (the renderer pads it), as is any table that already fits. Code (fenced or indented) is left
// alone; a table in a blockquote, callout or list item is widened in place. Runs on the text
// the page publishes, after the hidden material is gone, so it can bring none back.
const LINE_RE = /^((?:[ \t]*>)*)([ \t]*)([\s\S]*)$/;
const LIST_MARK_RE = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const FENCE_RE = /^(`{3,}|~{3,})/;
const DELIM_RE = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;

// The cells of one row, trimmed. A pipe is a cell break unless escaped, inside a
// `[[link|alias]]` (splitTableRow) or inside a code span (masked here).
function rowCells(rest) {
  const masked = rest.trim().replace(/(`+)[^\n]*?\1/g, (m) => m.replace(/\|/g, '\u0000'));
  const segs = splitTableRow(masked);
  if (masked.startsWith('|')) segs.shift();
  if (segs.length > 0 && segs[segs.length - 1] === '' && /(^|[^\\])\|$/.test(masked)) segs.pop();
  return segs.map((c) => c.replace(/\u0000/g, '|').trim());
}

function widenTables(text) {
  const lines = String(text).split('\n');
  const widened = [];
  let fence = null;
  let inList = false;
  const parse = (line) => {
    const [, quote, indent, rest] = LINE_RE.exec(line);
    const marker = LIST_MARK_RE.exec(rest);
    return { quote, indent: indent.length, rest, marker, body: marker ? rest.slice(marker[0].length) : rest };
  };
  for (let i = 0; i < lines.length; i++) {
    const p = parse(lines[i]);
    if (p.rest.trim() === '') continue;
    if (fence) {
      const close = FENCE_RE.exec(p.rest.trim());
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && p.rest.trim() === close[1]) fence = null;
      continue;
    }
    if (p.indent === 0 && !p.marker) inList = false;
    if (p.indent === 0 && p.marker) inList = true;
    const open = FENCE_RE.exec(p.body.trim());
    if (open && (p.indent < 4 || inList)) { fence = open[1]; continue; }
    if (p.indent >= 4 && !inList) continue;
    if (!p.body.includes('|') || i + 1 >= lines.length) continue;
    const d = parse(lines[i + 1]);
    if (d.quote.replace(/\s/g, '') !== p.quote.replace(/\s/g, '')) continue;
    const dtext = d.rest.trim();
    if (!DELIM_RE.test(dtext)) continue;
    const head = rowCells(p.body);
    if (head.length === 0 || rowCells(d.rest).length !== head.length) continue;
    let end = i + 2;
    const over = [];
    let max = head.length;
    for (; end < lines.length; end++) {
      const r = parse(lines[end]);
      if (r.rest.trim() === '' || r.quote.replace(/\s/g, '') !== p.quote.replace(/\s/g, '') || !r.rest.includes('|')) break;
      const n = rowCells(r.rest).length;
      if (n > head.length) over.push({ row: rowCells(r.rest)[0], cells: n, header: head.length });
      if (n > max) max = n;
    }
    if (max > head.length) {
      const extra = max - head.length;
      const grow = (line, cell) => {
        const t = line.replace(/[ \t]+$/, '');
        return (/(^|[^\\])\|$/.test(t) ? t : t + ' |') + cell.repeat(extra);
      };
      lines[i] = grow(lines[i], ' |');
      lines[i + 1] = grow(lines[i + 1], ' --- |');
      widened.push(...over);
    }
    i = end - 1;
  }
  return { text: lines.join('\n'), widened };
}

function tableWidenPlugin(md) {
  md.core.ruler.before('block', 'widen_tables', (state) => { state.src = widenTables(state.src).text; });
}

function createRenderer() {
  return new MarkdownIt({ html: false, typographer: true }).use(calloutPlugin).use(tableWidenPlugin);
}

module.exports = { createRenderer, calloutPlugin, widenTables };
