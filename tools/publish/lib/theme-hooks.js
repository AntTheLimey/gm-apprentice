'use strict';
// The hooks a theme may style (#360): the one list of them, and the code that writes the ones the tool adds when a site
// turns on player_site.theme.hooks. docs/theme-hooks.md prints the list (scripts/gen-theme-hooks-doc.js writes its
// table), and test/theme-hooks.test.js builds a site and fails when a listed hook leaves the output.
//
// A hook here is a promise: before one changes or goes, downstream tools are told in an issue first. Anything a page
// carries that is not listed is incidental and may change in any release.
//
// The added hooks are attributes on markup the tool already writes: no wrapper is added, so nothing moves. They are
// written only when the switch is on, because tools that read the pages as text (a theme that matches `<h2>` or
// `<h1 class="page-title">` exactly) would stop matching once an attribute is added; with it off a page is byte for
// byte what it was.
const { headingKey } = require('./heading-key');
const { decodeEntities } = require('./templates/gurps/tables');

// Each hook: `selector` (what a theme writes), `marks` (what it is on the page), `example` (a rule that uses it) and
// `when`: 'always' (on every site), 'switch' (only with player_site.theme.hooks on) or 'setting' (only when the
// setting named in `setting` asks for the layout it marks).
const HOOKS = [
  { selector: 'main.content', when: 'always', marks: "The page's main column, on every page", example: 'main.content { max-width: 52rem; }' },
  { selector: 'header.top-nav', when: 'always', marks: "The site's menu bar at the top of every page except the page-not-found page (`404.html`), which has no menu: its plain header is `header.site-header`, left as it is so that page stays as it was", example: 'header.top-nav { border-bottom: 1px solid currentColor; }' },
  { selector: 'nav.breadcrumbs', when: 'always', marks: 'The trail of links above a note\'s title', example: 'nav.breadcrumbs { font-size: 0.85rem; }' },
  { selector: '.page-title', when: 'always', marks: 'The title of a section list, a story page or a plain note page (an `<h1>`)', example: 'h1.page-title { letter-spacing: 0.05em; }' },
  { selector: '.metadata-badge[data-field]', when: 'always', marks: 'One fact in a note\'s header; `data-field` names the field it shows (`event_type`, `in_game_date`, `session_number` ...)', example: '.metadata-badge[data-field="in_game_date"] { font-style: italic; }' },
  { selector: '.landing-hero', when: 'always', marks: "The landing page's title area: the campaign picture, title, tagline and dates", example: '.landing-hero h1 { font-size: 3rem; }' },
  { selector: 'main[data-page-type]', when: 'switch', marks: "The kind of page: a note's own `type` (`npc`, `pc`, `location`, `session` ...), or `landing`, `index` (a section's list), `story`, `timeline`, `props`, `prop-container` or `not-found` for a page the tool makes; `page` for a note with no type", example: 'main[data-page-type="npc"] { --accent: #7a3b2e; }' },
  { selector: '[data-title-block]', when: 'switch', marks: "The block that holds the page's title and the facts beside it (a note's header card or banner, the landing title area); on a page with no such block, the title itself", example: '[data-title-block] { margin-bottom: 2rem; }' },
  { selector: 'h1[data-page-title]', when: 'switch', marks: "The page's title", example: 'h1[data-page-title] { font-variant: small-caps; }' },
  { selector: 'p[data-first-paragraph]', when: 'switch', marks: "The first paragraph of a note's own text (not on a character page, which is laid out as a sheet)", example: 'p[data-first-paragraph]::first-letter { font-size: 3em; float: left; }' },
  { selector: 'h2[data-section]', when: 'switch', marks: 'Each section heading; `data-section` is a key made from the heading\'s words, lower case, joined by hyphens (`## Current Status` is `current-status`)', example: 'h2[data-section="gm-notes"] { color: #900; }' },
  { selector: '.landing-hero--full-bleed', when: 'setting', setting: 'player_site.landing.hero.layout: full-bleed', marks: "The landing page's title area, laid out with the campaign picture edge to edge under the menu", example: '.landing-hero--full-bleed h1 { text-transform: uppercase; }' },
  { selector: 'body.landing-full-bleed', when: 'setting', setting: 'player_site.landing.hero.layout: full-bleed', marks: "The landing page's `<body>` when its title area is full-bleed (the page whose menu sits over the picture)", example: 'body.landing-full-bleed > .top-nav { backdrop-filter: blur(4px); }' },
  { selector: '.landing-hero--align-left', when: 'setting', setting: 'player_site.landing.hero.align: left', marks: "The landing page's title area with its title, tagline and dates set to the left", example: '.landing-hero--align-left h1 { margin-left: -0.05em; }' },
];

// The classes of the blocks that hold a page's title, outermost first where they nest.
const TITLE_BLOCK_CLASSES = ['landing-hero', 'char-header', 'hero-cinematic', 'hero-banner', 'masthead'];

const addAttr = (openTag, attr) => openTag.replace(/\s*(\/?)>$/, (m, slash) => ` ${attr}${slash}>`);
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A section heading's key: its words (a nested <span>, such as a hint, left out when other words remain), read as the
// tool reads any heading's title, lower case, joined by hyphens. '' when it has no words.
function sectionKey(innerHtml) {
  // A GM site's mark stands in a heading as a placeholder (gm-marks.js) until the page is written: not a word of it.
  const words = (html) => decodeEntities(String(html).replace(/\uE000[0-9a-z]+\uE001|\uE002/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const bare = words(String(innerHtml).replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ''));
  const text = bare || words(innerHtml);
  return headingKey(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

// The tags a paragraph can sit inside that make it not the body's own first paragraph.
const CONTAINERS = new Set(['div', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dd', 'dt', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'details', 'summary', 'aside', 'section', 'figure', 'figcaption', 'nav', 'header', 'footer', 'article', 'pre', 'form']);

// A note's rendered text with its first top-level paragraph marked. Unchanged when there is none.
function markFirstParagraph(html) {
  const s = String(html || '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let depth = 0;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[2].toLowerCase();
    if (CONTAINERS.has(tag)) depth = Math.max(0, depth + (m[1] ? -1 : 1));
    else if (tag === 'p' && !m[1] && depth === 0) {
      return s.slice(0, m.index) + addAttr(m[0], 'data-first-paragraph') + s.slice(m.index + m[0].length);
    }
  }
  return s;
}

// Whether the element opened at `start` (tag `tag`, the opening tag ending at `from`) is still open at `at`.
function stillOpen(s, tag, from, at) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(s)) && m.index < at) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return false;
  }
  return true;
}

// A page's <main> content with its title, its title block and each section heading marked.
function markPage(content) {
  let s = String(content || '');
  const h1 = /<h1\b[^>]*>/i.exec(s);
  if (h1) {
    let block = null;
    const open = /<(div|header|section)\b[^>]*\bclass="([^"]*)"[^>]*>/gi;
    let m;
    while ((m = open.exec(s)) && m.index < h1.index) {
      const classes = m[2].split(/\s+/);
      if (!TITLE_BLOCK_CLASSES.some((c) => classes.includes(c))) continue;
      if (stillOpen(s, m[1], m.index + m[0].length, h1.index)) { block = m; break; }
    }
    const titled = addAttr(h1[0], block ? 'data-page-title' : 'data-page-title data-title-block');
    s = s.slice(0, h1.index) + titled + s.slice(h1.index + h1[0].length);
    if (block) s = s.slice(0, block.index) + addAttr(block[0], 'data-title-block') + s.slice(block.index + block[0].length);
  }
  return s.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (whole, attrs, inner) => {
    if (/\sdata-section=/.test(attrs)) return whole;
    const key = sectionKey(inner);
    return key ? `<h2${attrs} data-section="${escapeAttr(key)}">${inner}</h2>` : whole;
  });
}

module.exports = { HOOKS, TITLE_BLOCK_CLASSES, sectionKey, markFirstParagraph, markPage };
