// The raw-HTML allowlist for page bodies (#266). Only consulted when the GM opts in
// with `publish.allow_html: true`; with the flag off, markdown-it runs with
// `html: false` and nothing here is used.
//
// This file is the ONE place to extend what a handout may contain. Add a tag to
// HTML_TAGS / SVG_TAGS, its attributes to the matching attribute map, and a CSS
// property to STYLE_PROPERTIES. Everything not listed is removed.
//
// Never add: script, style, iframe, object, embed, form controls, link, meta, base,
// foreignObject, any on* handler attribute, or a URL scheme that can execute
// (javascript:, vbscript:, data: outside <img>). The tests in
// test/unit/html-allowlist.test.js pin those exclusions.
const sanitizeHtml = require('sanitize-html');

// Structural and text markup, plus everything markdown-it itself emits (the whole
// rendered body passes through the sanitiser, not just the raw-HTML fragments).
const HTML_TAGS = [
  'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'small', 'sub', 'sup', 'mark', 'abbr', 'cite', 'q', 'kbd',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'figure', 'figcaption', 'aside', 'section', 'header', 'footer', 'article',
  'details', 'summary',
  'img', 'a',
];

// Inline SVG, in SVG's own camelCase. The parser keeps tag case inside <svg> but
// lowercases attribute names, so both spellings are registered below; the browser's
// HTML parser restores SVG casing (viewbox → viewBox) when it reads the page.
const SVG_TAGS = [
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'use', 'title', 'desc',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'symbol',
];

// On every allowed tag. `aria-*` is a wildcard; `data-*` is deliberately absent so
// a handout cannot trigger the site's own data-attribute-driven scripts.
const GLOBAL_ATTRIBUTES = ['class', 'id', 'title', 'lang', 'dir', 'style', 'role', 'aria-*'];

const TAG_ATTRIBUTES = {
  a: ['href', 'name'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  ol: ['start', 'type', 'reversed'],
  ul: ['type'],
  li: ['value'],
  td: ['colspan', 'rowspan', 'headers'],
  th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'],
  col: ['span'],
  colgroup: ['span'],
  details: ['open'],
  abbr: ['title'],
  q: ['cite'],
  blockquote: ['cite'],
};

// Presentational SVG attributes, allowed on every SVG tag.
const SVG_ATTRIBUTES = [
  'xmlns', 'xmlns:xlink', 'viewBox', 'preserveAspectRatio', 'width', 'height',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy',
  'd', 'points', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'pathLength',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'transform', 'visibility', 'display',
  'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'text-decoration',
  'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clip-path', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits',
  'refX', 'refY',
];

// `href` / `xlink:href` on <use>, and only as a same-document "#id" reference —
// enforced in transformTags below, because an external <use> target can pull in
// markup from another origin.
const USE_REF_ATTRIBUTES = ['href', 'xlink:href'];

// CSS allowed in `style="…"`. Every value is checked against SAFE_CSS_VALUE, which
// rejects url(), expression(), and anything that could close the declaration.
// url() is blocked outright — no background images from arbitrary hosts.
const STYLE_PROPERTIES = [
  'color', 'background', 'background-color', 'opacity',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-radius', 'border-collapse', 'border-spacing',
  'outline',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
  'letter-spacing', 'word-spacing', 'line-height',
  'text-align', 'text-decoration', 'text-transform', 'text-indent', 'text-shadow',
  'white-space', 'vertical-align',
  'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
  'display', 'float', 'clear', 'box-shadow', 'box-sizing', 'overflow',
  'columns', 'column-count', 'column-gap', 'column-rule', 'gap', 'row-gap',
  'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'list-style', 'list-style-type', 'transform', 'font-feature-settings',
  // SVG styling
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
];

const SAFE_CSS_VALUE = /^(?!.*(?:url|expression|image|image-set|element|paint)\s*\()(?!.*(?:javascript|vbscript|behavior|-moz-binding))[-#%.,()/\s\w'"!+*]*$/i;

// Raster images only. An SVG data: URI is refused even in <img> (it cannot run
// script there, but there is no handout need that justifies the extra surface).
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

// Elements whose whole content is dropped, not just their tags. Everything else that
// is disallowed loses its tags but keeps its text.
const DROP_WITH_CONTENT = [
  'script', 'style', 'textarea', 'option', 'noscript', 'template', 'foreignObject',
  'iframe', 'object', 'embed', 'noembed', 'noframes', 'xmp', 'select', 'button',
];

// Both spellings of every name: the parser's casing depends on context.
const bothCases = (list) => [...new Set(list.flatMap((s) => [s, s.toLowerCase()]))];

function buildOptions() {
  const svgTags = bothCases(SVG_TAGS);
  const svgAttrs = bothCases(SVG_ATTRIBUTES);
  const allowedAttributes = { '*': GLOBAL_ATTRIBUTES.slice() };
  for (const [tag, attrs] of Object.entries(TAG_ATTRIBUTES)) allowedAttributes[tag] = attrs.slice();
  for (const tag of svgTags) {
    allowedAttributes[tag] = svgAttrs.concat(tag === 'use' ? USE_REF_ATTRIBUTES : []);
  }
  const styleRules = {};
  for (const prop of STYLE_PROPERTIES) styleRules[prop] = [SAFE_CSS_VALUE];

  return {
    allowedTags: HTML_TAGS.concat(svgTags),
    allowedAttributes,
    allowedStyles: { '*': styleRules },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'xlink:href'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: bothCases(DROP_WITH_CONTENT),
    // Comments are already gone (processor.stripHtmlComments runs before render);
    // sanitize-html also drops any that survive, which is the backstop.
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
    transformTags: {
      img: (tagName, attribs) => {
        const out = { ...attribs };
        if (/^\s*data:/i.test(out.src || '') && !DATA_IMAGE_RE.test(out.src)) delete out.src;
        return { tagName, attribs: out };
      },
      use: (tagName, attribs) => {
        const out = { ...attribs };
        for (const a of USE_REF_ATTRIBUTES) {
          if (a in out && !/^#[\w-]+$/.test(String(out[a]).trim())) delete out[a];
        }
        return { tagName, attribs: out };
      },
    },
  };
}

const OPTIONS = buildOptions();

function sanitizeBodyHtml(html) {
  return sanitizeHtml(html, OPTIONS);
}

// Plain text for the derived views (search index, landing recap) that read a page's
// markdown source rather than its rendered HTML. Drops tag-shaped markup and the whole
// content of elements whose text is never prose. A bare `<` in prose ("a < b") is not
// tag-shaped and survives. Excerpts have their own, richer strip in excerpt.js.
const NON_PROSE_ELEMENT_RE = /<(script|style|template|noscript|textarea|foreignObject)\b[\s\S]*?<\/\1\s*>/gi;
const TAG_RE = /<\/?([A-Za-z][\w:-]*)[^<>]*>/g;
// Inline tags close up ("<b>Magellan</b>'s" → "Magellan's"); every other tag is a word break.
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'cite', 'code', 'del', 'em', 'i', 'ins', 'kbd',
  'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'tspan']);

// Only real element names count as tags, so prose like "<Grim> said" or an autolink
// "<https://…>" survives in search and the recap, as it does on the page when
// allow_html is off.
const KNOWN_ELEMENTS = new Set([...HTML_TAGS, ...SVG_TAGS].map(t => t.toLowerCase()).concat([
  'script', 'style', 'template', 'noscript', 'textarea', 'foreignobject', 'iframe', 'object',
  'embed', 'form', 'input', 'button', 'select', 'option', 'label', 'link', 'meta', 'base',
  'html', 'head', 'body', 'main', 'nav', 'video', 'audio', 'source', 'track', 'picture',
  'canvas', 'center', 'font', 'big', 'tt', 'wbr', 'time', 'var', 'samp', 'dfn', 'bdi', 'bdo',
  'ruby', 'rt', 'rp', 'data', 'output', 'progress', 'meter', 'fieldset', 'legend', 'map',
  'area', 'dialog', 'slot', 'address', 'hgroup', 'search', 'animate', 'set', 'image',
  'marker', 'pattern', 'filter', 'switch', 'textpath', 'animatetransform', 'animatemotion',
]));

function stripTags(text) {
  return String(text || '')
    .replace(NON_PROSE_ELEMENT_RE, ' ')
    .replace(TAG_RE, (m, name) => {
      const tag = name.toLowerCase();
      if (!KNOWN_ELEMENTS.has(tag)) return m;
      return INLINE_TAGS.has(tag) ? '' : ' ';
    });
}

module.exports = {
  sanitizeBodyHtml,
  stripTags,
  HTML_TAGS,
  SVG_TAGS,
  GLOBAL_ATTRIBUTES,
  TAG_ATTRIBUTES,
  SVG_ATTRIBUTES,
  STYLE_PROPERTIES,
};
