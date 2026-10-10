'use strict';
// One identity card per published page, for the link previews (js/previews.js). A card
// may hold only what its page shows: prose comes through publishedSource, fields from the
// frontmatter the build has already filtered. Never page.markdown, never sourceFrontmatter.
const path = require('path');
const { publishedSource, plainMetaValue, portraitBasename } = require('./processor');
const { excerptFromMarkdown } = require('./excerpt');
const { getCanonStatus } = require('./templates/base');
const { headerMeta } = require('./pc-header-meta');
const { inGameDateText } = require('./templates/session');

const VALUE_LIMIT = 120;
const MAX_FACTS = 3;
const ORDINARY_STATUS = new Set(['alive', 'active']);

const KIND_LABELS = {
  npc: 'NPC', pc: 'Player character', creature: 'Creature', location: 'Location',
  faction: 'Faction', item: 'Item', event: 'Event', session: 'Session', session_wrap: 'Session',
  chapter: 'Chapter', clue: 'Clue', document: 'Document',
};

// [label, frontmatter fields tried in order]; the first three with a value are shown. Each
// is a field the kind's own page shows (header badges or body); a PC's come from the
// page header's own list (pc-header-meta.js).
const FACT_FIELDS = {
  npc: [['Role', ['occupation']], ['Status', ['status']], ['Rank', ['rank']], ['Nationality', ['nationality']]],
  creature: [['Kind', ['creature_type']]],
  location: [['Sort of place', ['location_type']], ['Part of', ['parent_location']]],
  faction: [['Sort of group', ['faction_type']], ['Led by', ['leadership']], ['Territory', ['territory']]],
  item: [['Sort of thing', ['item_type']], ['Held by', ['current_holder']]],
  event: [['Date', ['in_game_date', 'date']], ['Where', ['location']], ['Outcome', ['outcome']]],
  session: [['Session', ['session_number']], ['In-game date', ['in_game_date']], ['Played', ['play_date', 'actual_date']]],
  chapter: [['Chapter', ['sort_order']]],
};

function kindLabel(type) {
  const t = String(type || '').trim();
  if (KIND_LABELS[t]) return KIND_LABELS[t];
  const words = t.replace(/_/g, ' ');
  return words ? words[0].toUpperCase() + words.slice(1) : 'Page';
}

// A value as its page prints it: a list is whatever String() makes of it (the headers
// print String(value)); a session's in-game date is joined by rowsFor, as its page does.
function plain(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return isNaN(value) ? '' : value.toISOString().slice(0, 10);
  const text = plainMetaValue(String(value)).replace(/\s+/g, ' ').trim();
  return text.length > VALUE_LIMIT ? text.slice(0, VALUE_LIMIT).trimEnd() + '…' : text;
}

// [label, rawValue] rows for a kind, before any value is shown.
function rowsFor(fm) {
  if (fm.type === 'pc') {
    return [['Player', fm.player_name], ...headerMeta(fm)];
  }
  return (FACT_FIELDS[fm.type] || []).map(([label, fields]) => {
    const field = fields.find((f) => fm[f] != null && fm[f] !== '');
    const raw = field ? fm[field] : null;
    return [label, fm.type === 'session' && field === 'in_game_date' ? inGameDateText(raw) : raw];
  });
}

function factsFor(fm) {
  const facts = [];
  for (const [label, raw] of rowsFor(fm)) {
    const value = plain(raw);
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
  const card = { t: title, k: kindLabel(fm.type) };

  const facts = factsFor(fm);
  if (facts.length) card.f = facts;

  const opening = excerptFromMarkdown(publishedSource(page), {
    sentences: 2, limit: 200, excludeSections: (ctx && ctx.excludeSections) || [], skipSheetLines: fm.type === 'pc',
  });
  if (opening) card.x = opening;

  const basename = portraitBasename(fm);
  const entry = basename && ctx && ctx.imageMap && ctx.imageMap[basename];
  if (entry) card.i = 'images/' + entry.relPath;

  if (getCanonStatus(fm) === 'DRAFT') card.d = 1;
  return card;
}

function buildPreviews(pages, ctx) {
  const out = {};
  for (const page of pages) {
    const card = cardFor(page, ctx);
    if (card) out[page.outputPath.split(path.sep).join('/')] = card;
  }
  return out;
}

module.exports = { cardFor, buildPreviews };
