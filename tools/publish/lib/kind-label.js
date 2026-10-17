'use strict';
// The words a reader sees for a type value: `plot_thread` reads "Plot thread". The one
// definition: page headers (templates) and the link preview cards (previews.js) both call it.
const { WRAP_UP_TYPES } = require('./shared-lists');

const KIND_LABELS = {
  npc: 'NPC', pc: 'Player character', creature: 'Creature', location: 'Location',
  faction: 'Faction', item: 'Item', event: 'Event', session: 'Session',
  chapter: 'Chapter', clue: 'Clue', document: 'Document',
  pc_roster: 'PC roster', npc_group: 'NPC group',
  // A Wrap-Up reads as the session it records, in every spelling of its type.
  ...Object.fromEntries([...WRAP_UP_TYPES].map((t) => [t, 'Session'])),
};

// An own-property lookup: a type named `constructor` or `__proto__` is not a kind.
function snakeWords(text) {
  const words = text.replace(/_/g, ' ');
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

function kindLabel(type) {
  const t = String(type || '').trim();
  if (Object.prototype.hasOwnProperty.call(KIND_LABELS, t)) return KIND_LABELS[t];
  return snakeWords(t) || 'Page';
}

const SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

// A type-ish header value as a reader sees it: a snake_case label becomes words, anything
// else (already written for a reader) is left as written.
function typeLabelText(value) {
  const text = String(value == null ? '' : value).trim();
  return SNAKE_CASE.test(text) ? snakeWords(text) : text;
}

// Whether a note is something in the world (`entity`: a person, a place, a thing a player
// can meet) or part of running the game (`working`: a plan, a session, a scene, a chapter,
// the campaign overview). A type the tool does not know reads as `working`, so a custom
// type is never offered a page by mistake. null when there is no type to read.
const ENTITY_TYPES = new Set([
  'npc', 'pc', 'creature', 'location', 'faction', 'organization', 'item', 'event', 'clue',
  'document', 'handout', 'npc_group', 'heritage', 'world_domain',
]);

function kindOfType(type) {
  const t = String(type == null ? '' : type).trim().toLowerCase().replace(/-/g, '_');
  if (!t) return null;
  return ENTITY_TYPES.has(t) ? 'entity' : 'working';
}

module.exports = { KIND_LABELS, kindLabel, typeLabelText, kindOfType, ENTITY_TYPES };
