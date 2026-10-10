'use strict';
// The words a reader sees for a type value: `plot_thread` reads "Plot thread". The one
// definition: page headers (templates) and the link preview cards (previews.js) both call it.

const KIND_LABELS = {
  npc: 'NPC', pc: 'Player character', creature: 'Creature', location: 'Location',
  faction: 'Faction', item: 'Item', event: 'Event', session: 'Session', session_wrap: 'Session',
  chapter: 'Chapter', clue: 'Clue', document: 'Document',
  pc_roster: 'PC roster', npc_group: 'NPC group',
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

module.exports = { KIND_LABELS, kindLabel, typeLabelText };
