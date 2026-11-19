'use strict';
// What a person's own note says about playing them, for the run sheet. Both answers are '' when
// the note is missing or says nothing usable; they never throw for a note the index holds.

const { label, cleanText } = require('./plan-text');

const known = (p, index) => typeof p === 'string' && p !== '' && index.notes().includes(p);

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

// The note's ### Wants under ## GM Notes.
function wantsOf(p, index) {
  if (!known(p, index)) return '';
  return cleanText(index.gmSection(p, 'Wants')).trim();
}

module.exports = { playAsOf, wantsOf };
