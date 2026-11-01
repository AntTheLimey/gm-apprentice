'use strict';

// The bar a published prop page carries back to its note, and the link a note page carries
// to its prop. A hand-made page does not load the site's stylesheet, so the bar brings its
// own style, and it is hidden when the page is printed: a printed prop is the prop alone.
const { escapeHtml } = require('../processor');

// The style an earlier tool wrote (before the print hint, #524): still read, so a site built by it compares with a new one.
const OLD_BAR_STYLE = '.gma-prop-bar{display:flex;gap:1rem;align-items:center;margin:0;padding:.5rem 1rem;'
  + 'background:#0d1117;color:#c9d1d9;font:14px/1.4 system-ui,-apple-system,sans-serif}'
  + '.gma-prop-bar a{color:#58a6ff;text-decoration:none}.gma-prop-bar a:hover{text-decoration:underline}'
  + '@media print{.gma-prop-bar{display:none}}';

const BAR_STYLE = '.gma-prop-bar{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:center;margin:0;padding:.5rem 1rem;'
  + 'background:#0d1117;color:#c9d1d9;font:14px/1.4 system-ui,-apple-system,sans-serif}'
  + '.gma-prop-bar a{color:#58a6ff;text-decoration:none}.gma-prop-bar a:hover{text-decoration:underline}'
  + '.gma-prop-hint{margin-left:auto;color:#8b949e;font-size:12px}'
  + '@media print{.gma-prop-bar{display:none}}';

// How to print a prop well (#524). `printout`: the page's style has a printout toggle (style.json printout_toggle).
const HINT = 'To print: tick Background graphics, set margins to None.';
const INK = ' The printout look uses less ink.';

const barOpen = (style) => `<nav class="gma-prop-bar" aria-label="Back to the campaign site"><style>${style}</style>`;
const BAR_OPEN = barOpen(BAR_STYLE);
const OLD_BAR_OPEN = barOpen(OLD_BAR_STYLE);
const BAR_CLOSE = '</nav>';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The bar as propBar writes it, and only that: its exact opening, its links (each escaped, so no '<' inside), its print
// hint as written (either form), its close. props/compare.js reads a page without it, so the hint is never page words.
const HINT_WRITTEN = `(?:<span class="gma-prop-hint">${escapeRe(HINT)}(?:${escapeRe(INK)})?</span>)?`;
// The older bar had no print hint, so its opening takes none.
const LINKS_WRITTEN = '(?:<a href="[^"<]*">[^<]*</a>)*';
const BAR_WRITTEN = new RegExp(`${escapeRe(BAR_OPEN)}${LINKS_WRITTEN}${HINT_WRITTEN}${escapeRe(BAR_CLOSE)}`
  + `|${escapeRe(OLD_BAR_OPEN)}${LINKS_WRITTEN}${escapeRe(BAR_CLOSE)}`, 'g');

function propBar({ noteHref = null, noteTitle = '', collectionHref = null, printout = false } = {}) {
  const links = [];
  if (noteHref) links.push(`<a href="${escapeHtml(noteHref)}">&larr; ${escapeHtml(noteTitle)}</a>`);
  if (collectionHref) links.push(`<a href="${escapeHtml(collectionHref)}">All props</a>`);
  if (links.length === 0) return '';
  return `${BAR_OPEN}${links.join('')}<span class="gma-prop-hint">${HINT}${printout ? INK : ''}</span>${BAR_CLOSE}`;
}

// A page as it was before withPropBar: every bar the tool wrote taken out (props/compare.js reads a page's own words).
function withoutPropBar(html) {
  return String(html).replace(BAR_WRITTEN, '');
}

// After the opening <body> tag; with none, after </head>; with neither, at the start.
function withPropBar(html, bar) {
  const text = String(html);
  if (!bar) return text;
  const at = (m) => m.index + m[0].length;
  // A quoted attribute value may hold a '>' (the tag pattern of props/links.js).
  const body = /<body\b(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>/i.exec(text);
  if (body) return text.slice(0, at(body)) + bar + text.slice(at(body));
  const head = /<\/head\s*>/i.exec(text);
  if (head) return text.slice(0, at(head)) + bar + text.slice(at(head));
  return bar + text;
}

function propLinkHtml(href) {
  return `<p class="prop-link"><a class="prop-btn" href="${escapeHtml(href)}">See the prop</a></p>`;
}

module.exports = { propBar, withPropBar, withoutPropBar, propLinkHtml };
