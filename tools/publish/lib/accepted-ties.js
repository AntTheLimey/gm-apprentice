'use strict';
// Hostile ties the GM reviewed and left for players to see (#367). Each is a record in the publish list's `accepted`
// list, beside the leak gate's accepted findings and the settled headings: `page` is the note's vault path, `text`
// the tie as `tieText` writes it, `note` this marker. The leak gate leaves them alone. A tie is accepted while its
// note, tone, target and description all still read the same; its line does not matter, so a note that gains a line
// above keeps its record, and an edited tie is raised again.
const TIE_NOTE = 'tone.tie';

const isAcceptedTie = (a) => Boolean(a) && a.note === TIE_NOTE;

const squash = (s) => String(s || '').normalize('NFC').split(/\s+/).filter(Boolean).join(' ');

// The tie as the record holds it: the tone as the site reads it (trimmed, lower case), the target and the description
// with their whitespace folded.
function tieText({ tone, target, description }) {
  return `${squash(tone).toLowerCase()} | ${squash(target)} | ${squash(description)}`;
}

const keyOf = (page, text) => `${String(page).normalize('NFC')}\n${text}`;

// The set of keys of a publish list's accepted ties, to test a listed row against.
function acceptedTieKeys(list) {
  return new Set(((list && list.accepted) || []).filter(isAcceptedTie).map((a) => keyOf(a.page, a.text)));
}

const isAccepted = (keys, row) => keys.has(keyOf(row.rel, tieText(row)));

module.exports = { TIE_NOTE, isAcceptedTie, tieText, acceptedTieKeys, isAccepted, keyOf };
