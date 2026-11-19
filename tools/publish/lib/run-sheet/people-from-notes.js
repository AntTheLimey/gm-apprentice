'use strict';
// What a person's own note says about playing them, for the run sheet. Both answers are '' when
// the note is missing or says nothing usable; they never throw for a note the index holds.

const { label, cleanText } = require('./plan-text');

const known = (p, index) => index.has(p);

// Playing Them **Speech:** and **Tell:** joined by a space; a value still holding a template
// placeholder (`{...}`) is skipped. A creature with neither: its ### Behaviour first paragraph.
function playAsOf(p, index) {
  if (!known(p, index)) return '';
  const pt = index.gmSection(p, 'Playing Them');
  const parts = [label(pt, 'Speech'), label(pt, 'Tell')].filter((x) => x && !x.includes('{'));
  if (parts.length) return parts.join(' ');
  if (String(index.read(p).fm.type || '').toLowerCase() !== 'creature') return '';
  const para = cleanText(index.gmSection(p, 'Behaviour')).split(/\n[ \t]*\n/).map((x) => x.trim()).find(Boolean);
  return para ? para.split('\n').map((l) => l.trim()).join(' ') : '';
}

// How to play a disguised NPC once unmasked: Playing Them **Unmasked:** and **Tell:**, the play-as
// the note has after `gma reveal --unmask` renames Unmasked to Speech. '' when it gives neither.
function unmaskedPlayAsOf(p, index) {
  if (!known(p, index)) return '';
  const pt = index.gmSection(p, 'Playing Them');
  return [label(pt, 'Unmasked'), label(pt, 'Tell')].filter((x) => x && !x.includes('{')).join(' ');
}

// The note's ### Wants under ## GM Notes.
function wantsOf(p, index) {
  if (!known(p, index)) return '';
  return cleanText(index.gmSection(p, 'Wants')).trim();
}

module.exports = { playAsOf, unmaskedPlayAsOf, wantsOf };
