'use strict';
// The Plan's Handouts & Props section, one Handout per table row or bullet; `leftover` is the
// section's other lines ("No handouts or props."). Never throws: a missing section reads empty.

const { sections, tableRows, tableRanges, bullets, links, unclaimed } = require('./plan-text');
const { itemKeys } = require('./keys');

const TITLE = /^handouts\s*(?:&|and)\s*props$/i;

function readHandouts(planBody, index) {
  const sec = sections(planBody, 2).filter((s) => TITLE.test(s.title)).map((s) => s.text).join('\n');
  const rows = tableRows(sec).map((cells) => ({
    note: noteOf(cells[0] || '', index),
    scene: cells[1] || '',
    status: cells[2] || '',
    text: cells.slice(3).join(' · '),
    id: cells.join(' | '),
  }));
  const items = bullets(sec).map((b) => ({ note: noteOf(b.text, index), scene: '', status: '', text: b.text, id: b.text }));
  const all = rows.concat(items);
  const keys = itemKeys('handouts', 'ho', all.map((h) => h.id));
  const leftover = unclaimed(sec, [...tableRanges(sec), ...bullets(sec)]);
  const handouts = all.map((h, i) => ({ key: keys[i], note: h.note, scene: h.scene, status: h.status, text: h.text }));
  return { handouts, leftover };
}

function noteOf(text, index) {
  const first = links(text)[0];
  return first ? index.resolve(first) : null;
}

module.exports = { readHandouts };
