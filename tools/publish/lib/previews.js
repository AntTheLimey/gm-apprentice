'use strict';
// One identity card per published page, for the link previews (js/previews.js). A card
// may hold only what its page shows: prose comes through publishedSource, fields from the
// frontmatter the build has already filtered. Never page.markdown, never sourceFrontmatter.
const path = require('path');
const { publishedSource, portraitBasename, plainRefValue, valueText } = require('./processor');
const { excerptFromMarkdown } = require('./excerpt');
const { getCanonStatus, headerValueText } = require('./templates/base');
const { headerMeta, pcEpithetText } = require('./pc-header-meta');
const { shownInGameDate } = require('./templates/session');
const { kindLabel } = require('./kind-label');
const { canonicalNfc } = require('./unicode');

const VALUE_LIMIT = 120;
const TITLE_LIMIT = 120;
const EXCERPT_LIMIT = 200;
const MAX_FACTS = 3;
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
    return [['Player', valueText(fm.player_name)], ...(ctx && ctx.cocFolio ? [] : headerMeta(fm))];
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
  for (const [label, raw] of rowsFor(page, ctx)) {
    const value = capped(oneLine(raw), VALUE_LIMIT);
    if (!value) continue;
    if (label === 'Status' && ORDINARY_STATUS.has(value.toLowerCase())) continue;
    facts.push([label, value]);
    if (facts.length === MAX_FACTS) break;
  }
  return facts;
}

function cardFor(page, ctx) {
  const fm = page.frontmatter || {};
  const title = page.displayTitle || page.title;
  if (!title) return null;
  const card = { t: capped(String(title), TITLE_LIMIT), k: kindLabel(fm.type) };

  const facts = factsFor(page, ctx);
  if (facts.length) card.f = facts;

  // ctx.cocFolio: the CoC folio shows no epithet to repeat (and no header badges, see rowsFor).
  const opening = fm.type === 'pc' ? (ctx && ctx.cocFolio ? '' : pcEpithetText(page)) : excerptFromMarkdown(publishedSource(page), {
    sentences: 2, limit: EXCERPT_LIMIT, excludeSections: (ctx && ctx.excludeSections) || [], wordUnderscores: true, prose: true,
  });
  if (opening) card.x = capped(opening, EXCERPT_LIMIT);

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
function getsNoPage(page) {
  return (page.frontmatter || {}).type === 'world_flags';
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

module.exports = { cardFor, buildPreviews, getsNoPage, onlyBuiltPages };
