'use strict';
// Props run in the order they reached the players: the session `revealed_in` names, placed in the campaign's play order
// (chapter, then session number, as the Saga and the session pages' prev/next read it), not by a number in the
// session's title, which need hold none. Two props from one session run by title. Text is original to these tests.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoth } = require('../helpers/gm-build');
const { byArrival, latestProps } = require('../../lib/props/collection');

const chapter = (n) => `---\ntype: chapter\nsort_order: ${n}\n---\nChapter ${n}.\n`;
const session = (ch, n, title) => `---\ntype: session\nsession_number: ${n}\ntitle: "${title}"\nchapter: "[[Chapter ${ch}]]"\n---\nWhat happened.\n`;
const paper = (title, at) => `---\ntype: prop\ntitle: "${title}"\nprop_kind: document\nprop_group: Papers\nrevealed_in: "[[${at}]]"\n---\n## The Text\n\n${title}, in a careful hand.\n`;

const FILES = {
  'Chapters/Chapter 3/Chapter 3.md': chapter(3),
  'Chapters/Chapter 4/Chapter 4.md': chapter(4),
  'Chapters/Chapter 3/Sessions/Landfall.md': session(3, 14, 'Landfall'),
  'Chapters/Chapter 3/Sessions/The Quiet Road.md': session(3, 5, 'The Quiet Road'),
  'Chapters/Chapter 4/Sessions/The Third Course.md': session(4, 8, 'The Third Course'),
  'Chapters/Chapter 4/Sessions/A Long Night.md': session(4, 12, 'A Long Night'),
  // Titles chosen so title order is the wrong order.
  'Props/Aaron Letter.md': paper('Aaron Letter', 'A Long Night'),
  'Props/Bell Notice.md': paper('Bell Notice', 'The Third Course'),
  'Props/Cole Chit.md': paper('Cole Chit', 'Landfall'),
  'Props/Dale Card.md': paper('Dale Card', 'The Quiet Road'),
  'Props/Abbot Card.md': paper('Abbot Card', 'Landfall'),
};

describe('props in arrival order across chapters', () => {
  const s = buildBoth(FILES, { sites: ['player'] });
  after(() => s.cleanup());

  it('Ch3 S5, Ch3 S14 (two by title), Ch4 S8, Ch4 S12', () => {
    const page = s.player.read('props', 'index.html');
    const at = (t) => page.indexOf(`>${t}<`);
    const order = ['Dale Card', 'Abbot Card', 'Cole Chit', 'Bell Notice', 'Aaron Letter'];
    for (const t of order) assert.ok(at(t) > 0, `${t} is listed`);
    assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order, page);
  });
});

// Wave 1: a Wrap-Up stands for its session; a page with no place sorts with the props that name no session.
describe('a revealed_in that names a Wrap-Up, or no session at all', () => {
  const s = buildBoth({
    ...FILES,
    'Chapters/Chapter 4/Sessions/The Third Course Wrap-Up.md': '---\ntype: session_wrap\nsession: "[[The Third Course]]"\nchapter: "[[Chapter 4]]"\n---\n## Narrative Recap\n\nDinner went badly.\n',
    'Locations/The Docks.md': '---\ntype: location\n---\nWet planks.\n',
    'Props/Eden Slip.md': paper('Eden Slip', 'The Third Course Wrap-Up'),
    'Props/Able Token.md': paper('Able Token', 'The Docks'),
    'Chapters/Chapter 3/Sessions/Landfall Play Notes.md': '---\ntype: session-play-notes\nsession: "[[Landfall]]"\n---\nNotes.\n',
    'Props/Cove Ticket.md': paper('Cove Ticket', 'Landfall Play Notes'),
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('the Wrap-Up and the Play Notes sort at their sessions, the other page after every session', () => {
    const page = s.player.read('props', 'index.html');
    const at = (t) => page.indexOf(`>${t}<`);
    const order = ['Dale Card', 'Abbot Card', 'Cole Chit', 'Cove Ticket', 'Bell Notice', 'Eden Slip', 'Aaron Letter', 'Able Token'];
    for (const t of order) assert.ok(at(t) > 0, `${t} is listed`);
    assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order, page);
  });
});

describe('a site with no ordered sessions', () => {
  const night = (n) => `---\ntype: event\n---\nNight ${n}.\n`;
  const s = buildBoth({
    'Events/Night 12.md': night(12),
    'Events/Night 3.md': night(3),
    'Props/Ash Note.md': paper('Ash Note', 'Night 12'),
    'Props/Birch Note.md': paper('Birch Note', 'Night 3'),
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('places a prop by the number in its page\'s title', () => {
    const page = s.player.read('props', 'index.html');
    assert.ok(page.indexOf('>Birch Note<') > 0 && page.indexOf('>Birch Note<') < page.indexOf('>Ash Note<'), page);
  });
});

describe('byArrival', () => {
  const row = (title, arrived) => ({ rel: `Props/${title}.md`, title, sealed: false, arrived, updated: null });
  it('a known place in the play order wins over a number in the title', () => {
    const a = row('A', { title: 'Session 12', order: 2 });
    const b = row('B', { title: 'Session 3', order: 5 });
    assert.deepEqual([b, a].sort(byArrival).map((r) => r.title), ['A', 'B']);
  });
  it('a page with no place on a site that orders its sessions sorts with the missing', () => {
    const a = row('A', { title: 'Session 1', order: null });
    const b = row('B', { title: 'Session 9', order: 4 });
    const c = row('C', null);
    assert.deepEqual([a, c, b].sort(byArrival).map((r) => r.title), ['B', 'A', 'C']);
  });
  it('with no place, the number in the title is the fallback', () => {
    const a = row('A', { title: 'Session 12' });
    const b = row('B', { title: 'Session 3' });
    assert.deepEqual([a, b].sort(byArrival).map((r) => r.title), ['B', 'A']);
  });
  it('the newest props read the same places', () => {
    const model = { groups: [{ rows: [row('A', { title: 'Landfall', order: 2 }), row('B', { title: 'Dusk', order: 7 })] }] };
    assert.deepEqual(latestProps(model, 1).map((r) => r.title), ['B']);
  });
});
