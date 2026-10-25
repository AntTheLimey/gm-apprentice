'use strict';

// The page the tool makes for a prop that names a style: the note's own `## The Text`, as the
// note page shows it to players, cut into sheets and filled into the style's layout. Every link
// in its head is relative, to the tool's base sheet, the self-hosted fonts and the style's own
// files under props/styles/<name>/; nothing is loaded from another site.
const { escapeHtml, relativeHref, encodeHref } = require('../processor');
const { propTextOf, propTextState, propSheets } = require('./text');
const { layoutNames, layoutView, fillLayout, FILTERS } = require('./layout');
const { propBar, withPropBar } = require('../templates/prop-bar');

const STYLES_DIR = 'props/styles';
const FONTS_CSS = `${STYLES_DIR}/fonts.css`;
const BASE_CSS = 'css/props.css';
const NO_TEXT = {
  detail: 'has no ## The Text section, so its styled page is not made',
  fix: 'add a ## The Text section with the words the players see',
};
const EMPTY_TEXT = {
  detail: 'has a ## The Text section with no words the players see, so its styled page is not made',
  fix: 'write the words the players see under ## The Text (outside any hidden block)',
};

// Why a note's player view gives no words for a styled page, or null when it gives some.
function textProblem(markdown) {
  const state = propTextState(markdown || '');
  return state === 'none' ? NO_TEXT : state === 'empty' ? EMPTY_TEXT : null;
}

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

// `items`: a container's listing (its rows' HTML), for `{{{items}}}`; a container's `## The Text` is optional.
// `names`: { title, noteTitle } as a listing prints them (the GM site's marks in them), in place of the note's own.
function styledPage({ prop, style, page, linkMap, imageMap, usedImages, collectionHref = null, fontsCss = false, items = null, names = null }) {
  const problem = items === null ? textProblem(page.publishedMarkdown) : null;
  if (problem) return { problem };
  const text = propTextOf(page.publishedMarkdown);
  const fields = page.frontmatter || {};
  const noteTitle = (names && names.noteTitle) || page.displayTitle || page.title || '';
  const title = (names && names.title) || textField(fields, 'prop_title') || noteTitle;
  const at = prop.address;
  const found = propSheets(text, {
    breaks: breaksOf(fields), shift: textField(fields, 'prop_shift') || undefined,
    linkMap, imageMap, usedImages, outputPath: at,
  });
  // A container with no words still has one sheet when its sheet is where the style lists the items.
  const sheets = found.length || items === null || !layoutNames(style.sheet).includes('items') ? found : [''];
  const sheetNames = layoutNames(style.sheet);
  const filled = sheets.map((html, i) => fillLayout(style.sheet, layoutView(fields, sheetNames, {
    title, note_title: noteTitle, text: html,
    sheet_number: String(i + 1), sheet_count: String(sheets.length), first: i === 0, last: i === sheets.length - 1,
    // A container's listing, once: on its last sheet.
    items: i === sheets.length - 1 ? items || '' : '',
  })));
  const body = fillLayout(style.layout, layoutView(fields, layoutNames(style.layout), { title, note_title: noteTitle, body: filled.join('\n'), items: items || '' }));

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

module.exports = { styledPage, styleFontFamilies, textProblem, STYLES_DIR, FONTS_CSS, BASE_CSS, NO_TEXT, EMPTY_TEXT };
