'use strict';

// An unfilled template placeholder: `{To flesh out for colour.}`, a whole paragraph or list item in braces. This is
// the one place that says what one is (#720). excerpt.js (cards), pc-background.js and the sheet readers (through
// sheet-parse's isPlaceholder) and the page renderer (processor.js, dropPlaceholders below) all read it from here.
const BRACED_SOURCE = '\\{[^{}]{0,400}\\}';
const WHOLE_RE = new RegExp(`^${BRACED_SOURCE}$`);

// Excerpt text: a placeholder anywhere on a line, with the bullet in front of it when it stands alone on its line.
const PLACEHOLDER_RE = new RegExp(`(?:^[ \\t]*[-*+][ \\t]+)?${BRACED_SOURCE}`, 'gm');

// Text that is only a placeholder. Marks (the GM site's private-use characters) never count: a placeholder inside a
// hidden span is the span's business, and dropping half of one would unbalance it.
function isPlaceholder(text) {
  const s = String(text == null ? '' : text).trim();
  return WHOLE_RE.test(s) && !/[-]/.test(s);
}

const GONE = 'placeholder_gone';
const gone = () => ({ type: GONE, nesting: 0, level: 0 });
const LISTS = new Set(['bullet_list', 'ordered_list', 'list_item']);

// Drops from a parsed note (markdown-it tokens) every paragraph or list item that is only a placeholder, then every
// list and every heading that was emptied by that, and says what it dropped: `dropped` is [{ text, section }], the
// section being the heading it stood under ('' above the first). A heading that held nothing before is left alone;
// text with braces in the middle of a sentence is not a placeholder. Returns the tokens to render.
function dropPlaceholders(tokens) {
  const out = [];
  const dropped = [];
  const open = [];       // the block tokens that enclose this one
  let section = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && tokens[i + 1] && tokens[i + 1].type === 'inline') section = tokens[i + 1].content.replace(/[-]/g, '').trim();
    if (t.type === 'paragraph_open' && tokens[i + 1] && tokens[i + 2] && tokens[i + 2].type === 'paragraph_close'
        && open.every((o) => LISTS.has(o.type.replace(/_open$/, ''))) && isPlaceholder(tokens[i + 1].content)) {
      dropped.push({ text: tokens[i + 1].content.trim(), section });
      out.push(gone());
      i += 2;
      continue;
    }
    if (t.nesting === 1) open.push(t);
    else if (t.nesting === -1) open.pop();
    out.push(t);
  }
  if (dropped.length === 0) return { tokens, dropped };

  const onlyGone = (a, b) => b > a + 1 && out.slice(a + 1, b).every((x) => x.type === GONE);
  // A list item or list holding only what was dropped goes with it, inside out, until nothing more does.
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length; i++) {
      const t = out[i];
      if (t.nesting !== 1 || !/^(list_item|bullet_list|ordered_list)_open$/.test(t.type)) continue;
      const close = out.findIndex((x, j) => j > i && x.nesting === -1 && x.type === t.type.replace('_open', '_close') && x.level === t.level);
      if (close > 0 && onlyGone(i, close)) { out.splice(i, close - i + 1, gone()); again = true; break; }
    }
  }
  // A heading left with nothing under it goes too, last first, so a heading that only held an emptied one goes as well.
  for (let i = out.length - 1; i >= 0; i--) {
    const t = out[i];
    if (t.type !== 'heading_open' || t.level !== 0 || out[i + 2] === undefined || out[i + 2].type !== 'heading_close') continue;
    let j = i + 3;
    let touched = false;
    while (j < out.length && out[j].type === GONE) { touched = true; j++; }
    const next = out[j];
    const ends = next === undefined || (next.type === 'heading_open' && next.level === 0 && Number(next.tag.slice(1)) <= Number(t.tag.slice(1)));
    if (touched && ends) out.splice(i, j - i, gone());
  }
  return { tokens: out.filter((x) => x.type !== GONE), dropped };
}

// Text with every line that is only a placeholder (a bullet in front allowed) taken out; braces inside a sentence stay.
function withoutPlaceholderLines(text) {
  return String(text == null ? '' : text).split('\n').filter((l) => !isPlaceholder(l.replace(/^\s*[-*+]\s+/, ''))).join('\n');
}

module.exports = { PLACEHOLDER_RE, isPlaceholder, withoutPlaceholderLines, dropPlaceholders };
