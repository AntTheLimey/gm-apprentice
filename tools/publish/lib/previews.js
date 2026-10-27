'use strict';
// One identity card per published page, for the link previews (js/previews.js). A card
// may hold only what its page shows: prose comes through publishedSource, fields from the
// frontmatter the build has already filtered. Never page.markdown, never sourceFrontmatter.
const path = require('path');
const { publishedSource, portraitBasename, plainRefValue, valueText, playerSafeMarkdown } = require('./processor');
const { entry } = require('./settings/registry');
const { createMarks, sanitize, unmark } = require('./gm-marks');
const { excerptFromMarkdown } = require('./excerpt');
const { getCanonStatus, headerValueText } = require('./templates/base');
const { headerMeta, pcEpithetText } = require('./pc-header-meta');
const { shownInGameDate } = require('./templates/session');
const { kindLabel } = require('./kind-label');
const { canonicalNfc } = require('./unicode');
const { labelsForLinks } = require('./wikilink');
const { NO_PAGE_TYPES } = require('./excluding-values');
const { isListedOnly } = require('./props/note');

const ORDINARY_STATUS = new Set(['alive', 'active']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// [label, frontmatter fields tried in order, how the page prints the value]; the first three
// with a value are shown. Each is a field the kind's own page shows (header badges or body);
// a PC's come from the page header's own list (pc-header-meta.js). How a value reads:
//   (none)  a header badge: headerValueText, which every template's header calls
//   'ref'   a value naming a page: plainRefValue, the text of the template's refMetaValue
const FACT_FIELDS = {
  npc: [['Role', ['occupation']], ['Status', ['status']], ['Rank', ['rank']], ['Nationality', ['nationality']]],
  creature: [['Kind', ['creature_type']]],
  location: [['Sort of place', ['location_type']], ['Part of', ['parent_location'], 'ref']],
  faction: [['Sort of group', ['faction_type']], ['Led by', ['leadership'], 'ref'], ['Territory', ['territory'], 'ref']],
  item: [['Sort of thing', ['item_type']], ['Held by', ['current_holder'], 'ref']],
  event: [['Date', ['in_game_date', 'date']], ['Where', ['location'], 'ref'], ['Outcome', ['outcome']]],
  session: [['Session', ['session_number']], ['In-game date', ['in_game_date']], ['Played', ['play_date', 'actual_date']]],
  chapter: [['Chapter', ['sort_order']]],
};

// At most `limit` characters of `text` and a "…" when it was longer; never splits a pair.
function capped(text, limit) {
  if (text.length <= limit || (text.length === limit + 1 && text.endsWith('…'))) return text;
  let end = limit;
  if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end).trimEnd() + '…';
}

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

// [label, text] rows for a page, before any is shown; the text is what the page prints.
function rowsFor(page, ctx) {
  const fm = page.frontmatter || {};
  if (fm.type === 'pc') {
    // The CoC folio prints the player (its identity plate) but none of the header badges.
    return [['Player', labelsForLinks(valueText(fm.player_name))], ...(ctx && ctx.cocFolio ? [] : headerMeta(fm, ctx.headerFacts))];
  }
  if (!own(FACT_FIELDS, fm.type)) return [];
  return FACT_FIELDS[fm.type].map(([label, fields, how]) => {
    const field = fields.find((f) => fm[f] != null && fm[f] !== '');
    if (!field) return [label, ''];
    // A session page prints its in-game date only in a hub body that a Wrap-Up replaces.
    if (fm.type === 'session' && field === 'in_game_date') {
      return [label, shownInGameDate(fm, ctx && ctx.hubWrapUps && ctx.hubWrapUps.get(page))];
    }
    return [label, how === 'ref' ? plainRefValue(fm[field]) : headerValueText(field, fm[field])];
  });
}

function factsFor(page, ctx) {
  const facts = [];
  if (ctx.limits.card_facts === 0) return facts;
  for (const [label, raw] of rowsFor(page, ctx)) {
    const value = capped(oneLine(raw), ctx.limits.card_fact_chars);
    if (!value) continue;
    if (label === 'Status' && ORDINARY_STATUS.has(value.toLowerCase())) continue;
    facts.push([label, value]);
    if (facts.length === ctx.limits.card_facts) break;
  }
  return facts;
}

function cardFor(page, ctx) {
  const fm = page.frontmatter || {};
  const title = page.displayTitle || page.title;
  if (!title) return null;
  const card = { t: capped(String(title), ctx.limits.card_title_chars), k: kindLabel(fm.type) };

  const facts = factsFor(page, ctx);
  if (facts.length) card.f = facts;

  // ctx.cocFolio: the CoC folio shows no epithet to repeat (and no header badges, see rowsFor).
  const opening = fm.type === 'pc' ? (ctx && ctx.cocFolio ? '' : pcEpithetText(page)) : excerptFromMarkdown(publishedSource(page), {
    sentences: 2, limit: ctx.limits.card_excerpt_chars, excludeSections: (ctx && ctx.excludeSections) || [], wordUnderscores: true, prose: true,
  });
  if (opening) card.x = capped(opening, ctx.limits.card_excerpt_chars);

  const basename = portraitBasename(fm);
  // The image map is an NFC-aware lookup table: ask for the NFC key, and only its own entries.
  const key = basename && canonicalNfc(basename);
  const entry = key && ctx && ctx.imageMap && own(ctx.imageMap, key) && ctx.imageMap[key];
  if (entry) card.i = 'images/' + entry.relPath;

  if (getCanonStatus(fm) === 'DRAFT') card.d = 1;
  return card;
}

// A note the build writes no page for (a world-flags file is internal tracking). The one
// definition: the render loop and the card list both ask it, so a note with no page has no card.
// A prop a container lists with nothing of its own to show (props/note.js isListedOnly) is one too: its container lists it
// with no link. Whether it has anything to show is judged on the body the site shows: on the player site its player view
// (gm-only fences, GM Notes and the other hidden sections cut), on the GM site the note as written, where its GM Notes
// show. Each site's build decides its pages once (decideNoPage) before it asks, so every later ask agrees with the first;
// a page no build decided is judged as the player site with the default hidden sections.
const noPage = new WeakMap();
const DEFAULT_HIDDEN_SECTIONS = entry('player_site.hide.sections').default;

// `show`: on the GM site, the kinds of hidden material it shows (gm_site.show), so the body it shows is the player cut
// with those kinds kept (their words count); without it, the note as written.
function shownBody(page, { gm = false, show = null, excludeSections = DEFAULT_HIDDEN_SECTIONS, excludeCallouts = false } = {}) {
  const fm = page.sourceFrontmatter || page.frontmatter || {};
  if (gm && !show) return String(page.markdown == null ? '' : page.markdown);
  if (gm) {
    const mark = { marks: createMarks(), show, sanitized: true };
    return unmark(playerSafeMarkdown(sanitize(page.markdown), { excludeSections, excludeCallouts, frontmatter: fm, mark }).text);
  }
  return playerSafeMarkdown(page.markdown, { excludeSections, excludeCallouts, frontmatter: fm }).text;
}

function noPageFor(page, site) {
  const fm = page.sourceFrontmatter || page.frontmatter || {};
  if (NO_PAGE_TYPES.has(fm.type)) return true;
  return isListedOnly(fm, '') && isListedOnly(fm, shownBody(page, site));
}

// Decide, for one site's build (`site`: { gm, show, excludeSections, excludeCallouts }), which of `pages` get no page.
function decideNoPage(pages, site = {}) {
  for (const page of pages) noPage.set(page, noPageFor(page, site));
}

function getsNoPage(page) {
  if (!noPage.has(page)) noPage.set(page, noPageFor(page, {}));
  return noPage.get(page);
}

// A published note its container lists with no page of its own (isListedOnly), as getsNoPage decided it.
function listedOnly(page) {
  return getsNoPage(page) && !NO_PAGE_TYPES.has((page.sourceFrontmatter || page.frontmatter || {}).type);
}

function buildPreviews(pages, ctx) {
  const out = {};
  for (const page of pages) {
    if (getsNoPage(page)) continue;
    const card = cardFor(page, ctx);
    if (card) out[page.outputPath.split(path.sep).join('/')] = card;
  }
  return out;
}

// The last guard, run once the pages are written: a card whose key is not a file the build
// wrote is dropped, whatever skipped that page. `isBuilt` takes the key (a '/'-joined path).
function onlyBuiltPages(cards, isBuilt) {
  const out = {};
  for (const key of Object.keys(cards)) if (isBuilt(key)) out[key] = cards[key];
  return out;
}

module.exports = { cardFor, rowsFor, buildPreviews, getsNoPage, decideNoPage, listedOnly, onlyBuiltPages };
