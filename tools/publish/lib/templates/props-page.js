'use strict';

// The pages that list props: a container's page (what it holds), and the props page (every prop the site shows). Each row is a prop the site
// shows, linked, or (asked for by its container) the title of one not yet found, and nothing more.
const { escapeHtml, relativeHref, encodeHref, campaignImageSrc, isWebImageAddress } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');
const { propTextOf, propSheets } = require('../props/text');
const { fieldText } = require('../props/layout');

const EMPTY_HTML = '<p class="prop-empty">Nothing in it yet.</p>';

function rowHtml(row, fromOut) {
  const href = (out) => escapeHtml(encodeHref(relativeHref(fromOut, out)));
  if (row.sealed) {
    return `<li class="prop-item prop-sealed"><span class="prop-title">${escapeHtml(row.title)}</span> <span class="prop-seal">Sealed</span></li>`;
  }
  // A prop its container lists with no page of its own has no link: its title alone.
  const parts = [row.href ? `<a href="${href(row.href)}">${escapeHtml(row.title)}</a>` : `<span class="prop-title">${escapeHtml(row.title)}</span>`];
  if (row.line) parts.push(`<span class="prop-line">${escapeHtml(row.line)}</span>`);
  if (row.arrived) parts.push(`<span class="prop-arrived">Arrived in <a href="${href(row.arrived.href)}">${escapeHtml(row.arrived.title)}</a></span>`);
  if (row.unrevealed) parts.push('<span class="gm-unrevealed">not yet revealed</span>');
  return `<li class="prop-item">${parts.join(' ')}</li>`;
}

const listOf = (rows, fromOut) => `<ul class="prop-list">\n${rows.map((r) => rowHtml(r, fromOut)).join('\n')}\n</ul>`;

// The rows as a list, each link relative to `fromOut` (the page it is printed on); '' with none. When a
// row has a `group`: the ungrouped shown rows first, then one headed list per group in the order of its
// first row, then the sealed rows in a last bare list. `flat`: one list whatever the groups.
function propListHtml(rows, fromOut, { flat = false } = {}) {
  if (!rows.length) return '';
  if (flat || !rows.some((r) => r.group)) return listOf(rows, fromOut);
  const groups = new Map();
  const bare = [];
  const sealed = [];
  for (const r of rows) {
    if (r.sealed) sealed.push(r);
    else if (!r.group) bare.push(r);
    else if (groups.has(r.group)) groups.get(r.group).push(r);
    else groups.set(r.group, [r]);
  }
  return [
    ...(bare.length ? [listOf(bare, fromOut)] : []),
    ...[...groups].map(([heading, list]) => `<h3 class="prop-group">${escapeHtml(heading)}</h3>\n${listOf(list, fromOut)}`),
    ...(sealed.length ? [listOf(sealed, fromOut)] : []),
  ].join('\n');
}

// What a container's page lists: its rows, or that it holds nothing yet.
function containerItemsHtml(rows, fromOut) {
  return propListHtml(rows, fromOut) || EMPTY_HTML;
}

// A container's own page, in the site shell: its title, a link back to its note, its
// `## The Text` as the note page shows it (if it has one), then what it holds. `title` and
// `noteTitle` are as containerItems gives them (the GM site's marks in them); by default the note's own.
function containerTemplate({ container, rows, address, title: shownTitle, noteTitle: shownNote }, navFor, config, publishConfig, { linkMap, imageMap, usedImages } = {}) {
  const page = container.page;
  const noteTitle = shownNote || page.displayTitle || page.title || '';
  const title = shownTitle || fieldText((page.frontmatter || {}).prop_title).trim() || noteTitle;
  const text = propTextOf(page.publishedMarkdown || '');
  const sheets = propSheets(text, { linkMap, imageMap, usedImages, outputPath: address });
  const back = escapeHtml(encodeHref(relativeHref(address, page.outputPath)));
  const content = [
    `<h1 class="page-title">${escapeHtml(title)}</h1>`,
    `<p class="prop-back"><a href="${back}">&larr; ${escapeHtml(noteTitle)}</a></p>`,
    ...sheets,
    containerItemsHtml(rows, address),
  ].join('\n');
  return baseShell({
    title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(address),
    navHtml: navFor(address, config),
    rootHref: rootPath(address),
    content,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    scripts: clientScripts(address),
  });
}

// The props page, in the site shell: its title, its cover picture and paragraph when set, then each
// group under its heading (linked when the heading is a page), with its rows. `model` is collectionModel's;
// its `cover` is a web address, or the picture's path on the site; or `coverRow` is a prop, printed as a link.
function collectionTemplate(model, navFor, config, publishConfig) {
  const { address, title } = model;
  const href = (out) => escapeHtml(encodeHref(relativeHref(address, out)));
  const cover = model.cover ? campaignImageSrc(isWebImageAddress(model.cover) ? model.cover : relativeHref(address, model.cover)) : '';
  const row = model.coverRow;
  const coverLink = row && row.href ? `<a class="props-cover" href="${href(row.href)}"><span class="props-cover-title">${escapeHtml(row.title)}</span>${row.line ? `<span class="prop-line">${escapeHtml(row.line)}</span>` : ''}</a>${row.unrevealed ? ' <span class="gm-unrevealed">not yet revealed</span>' : ''}` : '';
  const groups = model.groups.map((g) => {
    const heading = g.href ? `<a href="${href(g.href)}">${escapeHtml(g.heading)}</a>` : escapeHtml(g.heading);
    return `<section class="prop-group">\n<h2>${heading}</h2>\n${containerItemsHtml(g.rows, address)}\n</section>`;
  });
  const content = [
    `<h1 class="page-title">${escapeHtml(title)}</h1>`,
    ...(coverLink ? [coverLink] : []),
    ...(cover ? [`<img class="props-cover" src="${escapeHtml(cover)}" alt="">`] : []),
    ...(model.intro ? [`<p class="props-intro">${escapeHtml(model.intro)}</p>`] : []),
    ...groups,
  ].join('\n');
  return baseShell({
    title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(address),
    navHtml: navFor(address, config),
    rootHref: rootPath(address),
    content,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    scripts: clientScripts(address),
  });
}

module.exports = { containerTemplate, collectionTemplate, propListHtml, containerItemsHtml };
