'use strict';

// An unfilled template placeholder: `{To flesh out for colour.}`, a whole paragraph or list item in braces that reads
// like a note to the GM (isTemplateNote below), so a handout's `{REDACTED}`, a `{1d6}` and a `{[[Bob]]}` are text, and
// `\{...\}` keeps a literal. This is the one place that says what one is (#720): excerpt.js (cards), pc-background.js
// and the sheet readers (sheet-parse's isPlaceholder) and the page renderer (processor.js, dropPlaceholders) read it here.
const BRACED_SOURCE = '\\{[^{}]{0,400}\\}';
// Lone braced text on a page or in a card reads as a note to the GM only with a space in it, or as one capitalised word
// (`{Name}`, `{Backstory}`: the shipped templates' own), and never with a link: `{REDACTED}`, `{1d6}`, `{[[Bob]]}` are text.
const NOTE_RE = /^\{(?=[^{}]*\s|[A-Z][a-z][^{}\s]*\})(?![^{}]*\[\[)[^{}]{0,400}\}$/;
// A labelled sheet value in braces, any length: the sheet readers' reading before #720, kept (CodeRabbit, #728).
const WHOLE_RE = /^\{[^}]*\}$/;

// Excerpt text: a placeholder anywhere on a line, with the bullet in front of it when it stands alone on its line.
const PLACEHOLDER_RE = new RegExp(`(?:^[ \\t]*[-*+][ \\t]+)?${BRACED_SOURCE}`, 'gm');

// Text that is only a placeholder. Marks (the GM site's private-use characters) never count: a placeholder inside a
// hidden span is the span's business, and dropping half of one would unbalance it.
function isPlaceholder(text) {
  const s = String(text == null ? '' : text).trim();
  return WHOLE_RE.test(s) && !/[-]/.test(s);
}

// The same, as the page and the cards read a lone paragraph, list item or line (not a labelled sheet value, where any
// braced text is a placeholder: isPlaceholder).
function isTemplateNote(text) {
  const s = String(text == null ? '' : text).trim();
  return NOTE_RE.test(s) && !/[\uE000-\uE002]/.test(s);
}

const GONE = 'placeholder_gone';
const gone = () => ({ type: GONE, nesting: 0, level: 0 });
const LISTS = new Set(['bullet_list', 'ordered_list', 'list_item']);

// Drops from a parsed note (markdown-it tokens) every paragraph or list item that is only a placeholder, then every
// list and every heading that was emptied by that, and says what it dropped: `dropped` is [{ text, section }], the
// section being the heading it stood under ('' above the first). A heading goes when nothing is left under it before
// the next heading of its level or higher and something was dropped there (so `## A`, `## B`, `{x}`, `## C` loses both
// A and B); a heading that was empty before any drop is left alone. A list item holding only a placeholder and one
// list of its own of the same kind gives its place to that list's items; text with braces in a sentence is not one. Returns the tokens to render.
function dropPlaceholders(tokens) {
  const out = [];
  const dropped = [];
  const open = [];       // the block tokens that enclose this one
  let section = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && tokens[i + 1] && tokens[i + 1].type === 'inline') section = tokens[i + 1].content.replace(/[-]/g, '').trim();
    if (t.type === 'paragraph_open' && tokens[i + 1] && tokens[i + 2] && tokens[i + 2].type === 'paragraph_close'
        && open.every((o) => LISTS.has(o.type.replace(/_open$/, ''))) && isTemplateNote(tokens[i + 1].content)) {
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
  // `- {x}` with a list of the same kind nested in it: the nested items take the emptied item's place.
  const hoist = (a, b) => {
    if (!out[a + 1] || out[a + 1].type !== GONE) return false;   // only an item whose own text was the placeholder
    const inner = out.slice(a + 1, b).filter((x) => x.type !== GONE);
    if (inner.length === 0 || inner[0].nesting !== 1 || !/^(bullet|ordered)_list_open$/.test(inner[0].type)) return false;
    if (inner[inner.length - 1].type !== inner[0].type.replace('_open', '_close') || inner[0].level !== out[a].level + 1) return false;
    let depth = 0;
    for (let k = 0; k < inner.length - 1; k++) { depth += inner[k].nesting; if (depth === 0) return false; }   // one list only
    let d = 0;
    let parent = null;
    for (let k = a - 1; k >= 0 && !parent; k--) { if (out[k].nesting === -1) d++; else if (out[k].nesting === 1) { if (d === 0) parent = out[k]; else d--; } }
    if (!parent || parent.type !== inner[0].type) return false;
    const items = inner.slice(1, -1).map((x) => { const c = Object.assign(Object.create(Object.getPrototypeOf(x)), x); c.level -= 2; return c; });
    out.splice(a, b - a + 1, ...items);
    return true;
  };
  // A list item or list holding only what was dropped goes with it, inside out, until nothing more does.
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length; i++) {
      const t = out[i];
      if (t.nesting !== 1 || !/^(list_item|bullet_list|ordered_list)_open$/.test(t.type)) continue;
      const close = out.findIndex((x, j) => j > i && x.nesting === -1 && x.type === t.type.replace('_open', '_close') && x.level === t.level);
      if (close > 0 && onlyGone(i, close)) { out.splice(i, close - i + 1, gone()); again = true; break; }
      if (close > 0 && t.type === 'list_item_open' && hoist(i, close)) { again = true; break; }
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

// Text with every paragraph or line that is only a placeholder (a bullet in front allowed) taken out, a placeholder
// over several lines included; braces inside a sentence stay.
function withoutPlaceholderLines(text) {
  const bare = (s) => s.replace(/^\s*[-*+]\s+/, '');
  return String(text == null ? '' : text).split(/(\n[ \t]*\n)/).map((part, i) => {
    if (i % 2 === 1) return part;   // the blank line between two paragraphs
    if (part.includes('\n') && isTemplateNote(bare(part))) return '';
    return part.split('\n').filter((l) => !isTemplateNote(bare(l))).join('\n');
  }).join('');
}

module.exports = { PLACEHOLDER_RE, isPlaceholder, isTemplateNote, withoutPlaceholderLines, dropPlaceholders };
