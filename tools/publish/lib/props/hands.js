'use strict';

// The vault's hand registry: one handwriting typeface per writer, so every prop a writer wrote
// is in the same hand. `prop-new` and `prop-hand` write _meta/prop-hands.json; only the tool
// reads it (`_meta` never publishes). A prop's `prop_hand` names a hand; the hand's font stands
// in for `prop_font` unless the note chose a font of its own.
const fs = require('fs');
const path = require('path');
const { isValidFamily } = require('../fonts');

const HANDS_FILE = '_meta/prop-hands.json';
const HAND_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const FIX_FILE = 'fix the file: {"hands": {"<id>": {"font": "<Google Fonts family>"}}}';

// The registry's hands, as a Map of id to { font }, and why it could not all be read (null when it could).
// An entry that is not usable is skipped; `who` is for the GM's eyes and is read by nothing here.
function loadHands(vaultPath) {
  const hands = new Map();
  let text;
  try {
    text = fs.readFileSync(path.join(vaultPath, HANDS_FILE), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { hands, problem: null };
    return { hands, problem: { detail: `${HANDS_FILE} is not a hand registry (${e.code || e.message})`, fix: FIX_FILE } };
  }
  const bad = (why) => ({ hands: new Map(), problem: { detail: `${HANDS_FILE} is not a hand registry (${why})`, fix: FIX_FILE } });
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return bad('not JSON');
  }
  const entries = json && json.hands;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return bad('"hands" is not an object');
  const skipped = [];
  for (const [id, entry] of Object.entries(entries)) {
    const font = entry && typeof entry === 'object' ? entry.font : undefined;
    if (!HAND_ID_RE.test(id) || !isValidFamily(font)) skipped.push(id);
    else hands.set(id, { font });
  }
  const problem = skipped.length ? {
    detail: `${HANDS_FILE} has ${skipped.length === 1 ? 'a hand' : 'hands'} that cannot be used, so ${skipped.length === 1 ? 'it is' : 'they are'} skipped: ${skipped.map((s) => JSON.stringify(s)).join(', ')}`,
    fix: 'give each hand an id of lower-case letters, digits and hyphens, and a Google Fonts family as its font',
  } : null;
  return { hands, problem };
}

// A note's hand id, trimmed and lower-cased, or null when it names none.
function handOf(fm) {
  const v = fm && fm.prop_hand;
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
}

// The fields with `prop_font` filled from the note's hand. A font the note names itself wins. Never mutates.
function withHand(fields, hands) {
  const own = fields && fields.prop_font;
  const id = handOf(fields);
  if (id === null || (typeof own === 'string' && own.trim())) return { fields, problem: null };
  const hand = hands.get(id);
  if (hand) return { fields: { ...fields, prop_font: hand.font }, problem: null };
  return {
    fields,
    problem: {
      detail: `prop_hand "${id}" is not in ${HANDS_FILE}, so the style's own hand is used`,
      fix: `add the hand to ${HANDS_FILE} (vault_write.py prop-hand --hand ${id} --hand-font "<family>"), or correct prop_hand`,
    },
  };
}

module.exports = { HANDS_FILE, HAND_ID_RE, loadHands, handOf, withHand };
