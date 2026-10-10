'use strict';
// One identity card per published page, for the link previews (js/previews.js). A card
// may hold only what its page shows: prose comes through publishedSource, fields from the
// frontmatter the build has already filtered. Never page.markdown, never sourceFrontmatter.
const path = require('path');
const { publishedSource, plainMetaValue, portraitBasename } = require('./processor');
const { excerptFromMarkdown } = require('./excerpt');
const { getCanonStatus } = require('./templates/base');

const VALUE_LIMIT = 120;
const MAX_FACTS = 3;
const ORDINARY_STATUS = new Set(['alive', 'active']);

const KIND_LABELS = {
  npc: 'NPC', pc: 'Player character', creature: 'Creature', location: 'Location',
  faction: 'Faction', item: 'Item', event: 'Event', session: 'Session', session_wrap: 'Session',
  chapter: 'Chapter', clue: 'Clue', document: 'Document',
};

// [label, frontmatter fields tried in order]; the first three with a value are shown. Each
// is a field the kind's own page shows (header badges or body); the pc entry is built from
// the page header's own list in pcFacts.
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

// The header badges a PC page shows after the player (templates/pc.js renderMetaSpans):
// the note's display_meta list, else these.
const PC_DEFAULT_META = ['occupation', 'age', 'nationality'];

function kindLabel(type) {
  const t = String(type || '').trim();
  if (KIND_LABELS[t]) return KIND_LABELS[t];
  const words = t.replace(/_/g, ' ');
  return words ? words[0].toUpperCase() + words.slice(1) : 'Page';
}

function plain(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return isNaN(value) ? '' : value.toISOString().slice(0, 10);
  const text = (Array.isArray(value) ? value.map(plainMetaValue).join(', ') : plainMetaValue(value)).replace(/\s+/g, ' ').trim();
  return text.length > VALUE_LIMIT ? text.slice(0, VALUE_LIMIT).trimEnd() + '…' : text;
}

// Same label the page header gives a display_meta field (templates/pc.js formatLabel).
function metaLabel(field) {
  return String(field).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function pcFacts(fm) {
  const fields = Array.isArray(fm.display_meta) ? fm.display_meta : PC_DEFAULT_META;
  return [['Player', ['player_name']], ...fields.map((f) => [metaLabel(f), [String(f)]])];
}

function factsFor(fm) {
  const table = fm.type === 'pc' ? pcFacts(fm) : (FACT_FIELDS[fm.type] || []);
  const facts = [];
  for (const [label, fields] of table) {
    const field = fields.find((f) => fm[f] != null && fm[f] !== '');
    const value = field ? plain(fm[field]) : '';
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
