// Plain text for the derived views (search index, landing recap) that read a page's
// markdown source rather than its rendered HTML. The page renderer escapes raw HTML, so
// a tag typed in a body shows as literal text on the page; these views reduce it to its
// words instead, so search and the recap never index or print markup.
//
// Drops tag-shaped markup and the whole content of elements whose text is never prose.
// A bare `<` in prose ("a < b") is not tag-shaped and survives. Excerpts have their own,
// richer strip in excerpt.js.
const NON_PROSE_ELEMENT_RE = /<(script|style|template|noscript|textarea|foreignObject)\b[\s\S]*?<\/\1\s*>/gi;
const TAG_RE = /<\/?([A-Za-z][\w:-]*)[^<>]*>/g;
// Inline tags close up ("<b>Magellan</b>'s" → "Magellan's"); every other tag is a word break.
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'cite', 'code', 'del', 'em', 'i', 'ins', 'kbd',
  'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'tspan']);

// Only real HTML and SVG element names count as tags, so prose like "<Grim> said" or an
// autolink "<https://…>" survives in search and the recap, as it does on the page.
const KNOWN_ELEMENTS = new Set([
  // Common HTML
  'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  'code', 'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'small', 'sub', 'sup', 'mark',
  'abbr', 'cite', 'q', 'kbd', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'figure', 'figcaption', 'aside',
  'section', 'header', 'footer', 'article', 'details', 'summary', 'img', 'a',
  // Inline SVG (lowercased)
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text',
  'tspan', 'defs', 'use', 'title', 'desc', 'lineargradient', 'radialgradient', 'stop',
  'clippath', 'mask', 'symbol',
  // The rest of HTML and SVG
  'script', 'style', 'template', 'noscript', 'textarea', 'foreignobject', 'iframe', 'object',
  'embed', 'form', 'input', 'button', 'select', 'option', 'label', 'link', 'meta', 'base',
  'html', 'head', 'body', 'main', 'nav', 'video', 'audio', 'source', 'track', 'picture',
  'canvas', 'center', 'font', 'big', 'tt', 'wbr', 'time', 'var', 'samp', 'dfn', 'bdi', 'bdo',
  'ruby', 'rt', 'rp', 'data', 'output', 'progress', 'meter', 'fieldset', 'legend', 'map',
  'area', 'dialog', 'slot', 'address', 'hgroup', 'search', 'animate', 'set', 'image',
  'marker', 'pattern', 'filter', 'switch', 'textpath', 'animatetransform', 'animatemotion',
]);

function stripTags(text) {
  return String(text || '')
    .replace(NON_PROSE_ELEMENT_RE, ' ')
    .replace(TAG_RE, (m, name) => {
      const tag = name.toLowerCase();
      if (!KNOWN_ELEMENTS.has(tag)) return m;
      return INLINE_TAGS.has(tag) ? '' : ' ';
    });
}

module.exports = { stripTags };
