'use strict';

// The bar a published prop page carries back to its note, and the link a note page carries
// to its prop. A hand-made page does not load the site's stylesheet, so the bar brings its
// own style, and it is hidden when the page is printed: a printed prop is the prop alone.
const { escapeHtml } = require('../processor');

const BAR_STYLE = '.gma-prop-bar{display:flex;gap:1rem;align-items:center;margin:0;padding:.5rem 1rem;'
  + 'background:#0d1117;color:#c9d1d9;font:14px/1.4 system-ui,-apple-system,sans-serif}'
  + '.gma-prop-bar a{color:#58a6ff;text-decoration:none}.gma-prop-bar a:hover{text-decoration:underline}'
  + '@media print{.gma-prop-bar{display:none}}';

function propBar({ noteHref = null, noteTitle = '', collectionHref = null } = {}) {
  const links = [];
  if (noteHref) links.push(`<a href="${escapeHtml(noteHref)}">&larr; ${escapeHtml(noteTitle)}</a>`);
  if (collectionHref) links.push(`<a href="${escapeHtml(collectionHref)}">All props</a>`);
  if (links.length === 0) return '';
  return `<nav class="gma-prop-bar" aria-label="Back to the campaign site"><style>${BAR_STYLE}</style>${links.join('')}</nav>`;
}

// After the opening <body> tag; with none, after </head>; with neither, at the start.
function withPropBar(html, bar) {
  const text = String(html);
  if (!bar) return text;
  const at = (m) => m.index + m[0].length;
  const body = /<body\b[^>]*>/i.exec(text);
  if (body) return text.slice(0, at(body)) + bar + text.slice(at(body));
  const head = /<\/head\s*>/i.exec(text);
  if (head) return text.slice(0, at(head)) + bar + text.slice(at(head));
  return bar + text;
}

function propLinkHtml(href) {
  return `<p class="prop-link"><a class="prop-btn" href="${escapeHtml(href)}">See the prop</a></p>`;
}

module.exports = { propBar, withPropBar, propLinkHtml };
