'use strict';
// Stable keys for the run sheet. A key names a beat or an item so a GM's ticks and HP stay on
// the right one across page reloads and Plan edits. Nothing here throws: empty or odd input gets
// a key like any other.
//
// `normalise` is NOT `cleanText` (plan-text.js): that keeps lines; this boils text down to what
// the GM would call "the same words".

const crypto = require('node:crypto');
const { canonicalNfc } = require('../unicode');
const { replaceWikilinks, parseWikilink } = require('../wikilink');

function normalise(text) {
  const s = canonicalNfc(text == null ? '' : text);
  return replaceWikilinks(s, (_link, body) => parseWikilink(body).target)
    .replace(/(?:^|\s)(?:[-*+]\s+)?\[[ xX]\]/g, ' ')
    .replace(/[*_`]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// First 10 hex chars of SHA-1 of the normalised text. Exported: step 5 re-homes items by it
// after a beat rename changes their beat key.
function textHash(text) {
  return crypto.createHash('sha1').update(normalise(text)).digest('hex').slice(0, 10);
}

// `~2`, `~3`... on the second and later repeats, in order.
function dedupe(keys) {
  const seen = new Map();
  return keys.map((key) => {
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}~${n}`;
  });
}

function beatKeys(headings) {
  const list = Array.isArray(headings) ? headings : [];
  return dedupe(list.map((h) => {
    const title = String((h && h.title) || '')
      .replace(/^\s*scene\s+\d+\s*:\s*/i, '')
      .replace(/\((?:hub|routing)\)/gi, '');
    return `${h && h.contingency ? 'c' : 'b'}-${textHash(title)}`;
  }));
}

function itemKeys(beatKey, kind, texts) {
  const list = Array.isArray(texts) ? texts : [];
  return dedupe(list.map((t) => `${beatKey}.${kind}.${textHash(t)}`));
}

function personKey(pathOrName) {
  return `p-${textHash(pathOrName)}`;
}

// A known place's beat key (plan 6a Task 7, review P2): `pl-` and 8 hex of SHA-1 of the note's path, as it is,
// so a stem with a dot in it (`St. Mary's.md`) still makes a key with none. A place typed tonight is keyed
// `pn-<action id>` by state.js instead. Neither holds a dot, so a beat key stays everything before the first one.
function placeKey(notePath) {
  return `pl-${crypto.createHash('sha1').update(String(notePath == null ? '' : notePath)).digest('hex').slice(0, 8)}`;
}

module.exports = { normalise, textHash, dedupe, beatKeys, itemKeys, personKey, placeKey };
