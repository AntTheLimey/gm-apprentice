'use strict';
// The Plan's NPC Quick Reference, one Person per row. Works with what it has: a row naming no note
// reads with empty playAs and wants, and a warning.

const { sections, tableRows, tableRanges, bullets, links, unclaimed } = require('./plan-text');
const { personKey } = require('./keys');
const { playAsOf, wantsOf } = require('./people-from-notes');
const { replaceWikilinks, parseWikilink } = require('../wikilink');

const TITLE = /^npc\s+quick\s+reference$/i;

// The words of a cell: a link prints its label (or target), the rest stays.
const wordsOf = (cell) => replaceWikilinks(String(cell), (_l, body) => {
  const w = parseWikilink(body);
  return w.display || w.name;
}).replace(/[*_`]/g, '').trim();

function readPeople(planBody, index) {
  const warnings = [];
  const seen = new Set();
  const warn = (kind, note, text) => {
    const k = JSON.stringify([kind, note, text]);
    if (!seen.has(k)) { seen.add(k); warnings.push({ kind, note, text }); }
  };
  const sec = sections(planBody, 2).filter((s) => TITLE.test(s.title)).map((s) => s.text).join('\n');
  const people = [];
  const nameless = [];
  for (const cells of tableRows(sec)) {
    if (!cells[0]) { if (cells.some(Boolean)) nameless.push(cells.join(' | ').trim()); continue; }
    const first = links(cells[0])[0];
    const note = first ? index.resolve(first) : null;
    const name = wordsOf(cells[0]);
    const playAs = note ? playAsOf(note, index) : '';
    const wants = note ? wantsOf(note, index) : '';
    if (!note) {
      warn('no-note', null, `${name} has no note in the vault: no way to play them or what they want`);
    } else {
      if (!playAs) warn('no-play-as', note, `${name} has no Playing Them speech or tell`);
      if (!wants) warn('no-wants', note, `${name} has no Wants`);
    }
    people.push({
      key: personKey(note || name),
      note,
      name,
      playAs,
      wants,
      now: (cells[1] || '') + (cells[2] ? ` — ${cells[2]}` : ''),
      where: cells[3] || '',
      cells,
    });
  }
  const leftover = [unclaimed(sec, [...tableRanges(sec), ...bullets(sec)]), ...nameless].filter(Boolean).join('\n');
  return { people, warnings, leftover };
}

module.exports = { readPeople };
