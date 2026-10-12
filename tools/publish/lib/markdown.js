const MarkdownIt = require('markdown-it');

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
// who tacks a note onto one row of a template table would lose it from the page. So the
// renderer's own table rule is wrapped: it decides what is a table (fences, containers, where
// a table ends), and when it has made one, the cells it dropped are read back from the same
// lines, split the way it splits them, and given blank header cells and body cells of their
// own. A row with fewer cells is padded as before; a table that fits is untouched. Trailing
// blank cells are not "over-wide" (nothing is lost). Each widened table is recorded in
// `env.widenedTables` for the build to warn about. This runs on the text the page publishes,
// after the hidden material is gone, so it can bring none back.

// markdown-it's own cell splitter (rules_block/table): only a backslash escapes a pipe.
function escapedSplit(str) {
  const result = [];
  let current = '';
  let lastPos = 0;
  let escaped = false;
  for (let pos = 0; pos < str.length; pos++) {
    const ch = str.charCodeAt(pos);
    if (ch === 0x7c) {
      if (!escaped) { result.push(current + str.substring(lastPos, pos)); current = ''; lastPos = pos + 1; }
      else { current += str.substring(lastPos, pos - 1); lastPos = pos; }
    }
    escaped = ch === 0x5c;
  }
  result.push(current + str.substring(lastPos));
  return result;
}

function rowCells(state, line) {
  const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
  const cells = escapedSplit(text);
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells.map((c) => c.trim());
}

function widenTable(state, from) {
  const tokens = state.tokens;
  const rows = [];   // { open, close, line } for every tr, header first
  for (let k = from; k < tokens.length; k++) {
    if (tokens[k].type === 'tr_open') rows.push({ open: k, line: tokens[k].map[0] });
    else if (tokens[k].type === 'tr_close') rows[rows.length - 1].close = k;
  }
  if (rows.length < 2) return;
  const headerCount = tokens.slice(rows[0].open, rows[0].close).filter((t) => t.type === 'th_open').length;
  let width = headerCount;
  const over = [];
  for (const row of rows.slice(1)) {
    const cells = rowCells(state, row.line);
    let n = cells.length;
    while (n > headerCount && cells[n - 1] === '') n--;
    row.cells = cells;
    if (n > headerCount) over.push({ first: cells[0], cells: n });
    if (n > width) width = n;
  }
  if (width === headerCount) return;
  const cell = (kind, tag, content, like) => {
    const open = new state.Token(`${kind}_open`, tag, 1);
    const inline = new state.Token('inline', '', 0);
    const close = new state.Token(`${kind}_close`, tag, -1);
    open.level = like.level; inline.level = like.level + 1; close.level = like.level;
    inline.content = content; inline.children = [];
    return [open, inline, close];
  };
  for (const row of rows.slice().reverse()) {
    const isHead = row === rows[0];
    const have = isHead ? headerCount : headerCount;
    const like = tokens.slice(row.open, row.close).filter((t) => t.type === (isHead ? 'th_open' : 'td_open')).pop();
    const extra = [];
    for (let c = have; c < width; c++) {
      extra.push(...cell(isHead ? 'th' : 'td', isHead ? 'th' : 'td', isHead ? '' : (row.cells[c] || ''), like));
    }
    tokens.splice(row.close, 0, ...extra);
  }
  const env = state.env;
  if (env && typeof env === 'object') {
    (env.widenedTables = env.widenedTables || []).push({ header: headerCount, cells: width, rows: over.length, first: over[0] ? over[0].first : '' });
  }
}

function tableWidenPlugin(md) {
  const rule = md.block.ruler.__rules__.find((r) => r.name === 'table');
  const original = { fn: rule.fn, alt: rule.alt };
  md.block.ruler.at('table', function table(state, startLine, endLine, silent) {
    const before = state.tokens.length;
    const ok = original.fn(state, startLine, endLine, silent);
    if (ok && !silent) widenTable(state, before);
    return ok;
  }, { alt: original.alt });
}

function createRenderer() {
  return new MarkdownIt({ html: false, typographer: true }).use(calloutPlugin).use(tableWidenPlugin);
}

module.exports = { createRenderer, calloutPlugin };
