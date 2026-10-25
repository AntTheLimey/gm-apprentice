'use strict';

// The page the tool makes for a prop that names a style: the note's own `## The Text`, as the
// note page shows it to players, cut into sheets and filled into the style's layout. Every link
// in its head is relative, to the tool's base sheet, the self-hosted fonts and the style's own
// files under props/styles/<name>/; nothing is loaded from another site.
const { escapeHtml, relativeHref, encodeHref } = require('../processor');
const { propTextOf, propSheets } = require('./text');
const { layoutNames, layoutView, fillLayout, FILTERS } = require('./layout');
const { propBar, withPropBar } = require('../templates/prop-bar');

const STYLES_DIR = 'props/styles';
const FONTS_CSS = `${STYLES_DIR}/fonts.css`;
const BASE_CSS = 'css/props.css';
const NO_TEXT = {
  detail: 'has no ## The Text section, so its styled page is not made',
  fix: 'add a ## The Text section with the words the players see',
};

const textField = (fields, name) => {
  const v = fields && fields[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
};

// prop_breaks: one string or a list of them.
function breaksOf(fields) {
  const v = fields && fields.prop_breaks;
  if (typeof v === 'string') return v === '' ? [] : [v];
  return Array.isArray(v) ? v.filter((b) => typeof b === 'string' && b !== '') : [];
}

// The typefaces a styled prop needs: its style's own, then each value the layout reads through
// the font filter (`{{prop_font|font}}`) that is a family the tool can fetch.
function styleFontFamilies(style, fields) {
  const out = [...style.json.fonts];
  const names = [...new Set([...layoutNames(style.layout), ...layoutNames(style.sheet)])];
  for (const name of names) {
    const [base, filter] = name.split('|');
    if (filter !== 'font') continue;
    const family = FILTERS.font(layoutView(fields, [base], {})[base]);
    if (family) out.push(family);
  }
  return out.filter((v, i, a) => a.indexOf(v) === i);
}

function styledPage({ prop, style, page, linkMap, imageMap, usedImages, collectionHref = null, fontsCss = false }) {
  const text = propTextOf(page.publishedMarkdown || '');
  if (!text) return { problem: NO_TEXT };
  const fields = page.frontmatter || {};
  const noteTitle = page.displayTitle || page.title || '';
  const title = textField(fields, 'prop_title') || noteTitle;
  const at = prop.address;
  const sheets = propSheets(text, {
    breaks: breaksOf(fields), shift: textField(fields, 'prop_shift') || undefined,
    linkMap, imageMap, usedImages, outputPath: at,
  });
  const sheetNames = layoutNames(style.sheet);
  const filled = sheets.map((html, i) => fillLayout(style.sheet, layoutView(fields, sheetNames, {
    title, note_title: noteTitle, text: html,
    sheet_number: String(i + 1), sheet_count: String(sheets.length), first: i === 0, last: i === sheets.length - 1,
  })));
  const body = fillLayout(style.layout, layoutView(fields, layoutNames(style.layout), { title, note_title: noteTitle, body: filled.join('\n') }));

  const rel = (out) => escapeHtml(encodeHref(relativeHref(at, out)));
  const own = (file) => rel(`${STYLES_DIR}/${style.name}/${file}`);
  const bar = propBar({ noteHref: encodeHref(relativeHref(at, page.outputPath)), noteTitle, collectionHref });
  const head = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="stylesheet" href="${rel(BASE_CSS)}">`,
    ...(fontsCss ? [`<link rel="stylesheet" href="${rel(FONTS_CSS)}">`] : []),
    `<link rel="stylesheet" href="${own('style.css')}">`,
    '</head>',
    `<body class="prop-page prop-style-${style.name}">`,
  ];
  const tail = [
    ...(style.script ? [`<script src="${own('script.js')}" defer></script>`] : []),
    '</body>',
    '</html>',
  ];
  const html = withPropBar(`${head.join('\n')}\n${body}\n${tail.join('\n')}\n`, bar);
  return { html };
}

module.exports = { styledPage, styleFontFamilies, STYLES_DIR, FONTS_CSS, BASE_CSS, NO_TEXT };
