'use strict';
// #469: an event page prints its own location and participants. A name that reaches a withheld note must not
// print there (page or previews.json), whatever way the field is written; the leak gate must see it if it does.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { leakSite } = require('./helpers/leak-site');
const { runLeakGate } = require('../lib/leak-gate');

const NOTES = {
  'NPCs/Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nA man.\n',
  'Places/Black Quay.md': '---\ntype: location\nwithheld: true\npublish: false\n---\nA quay.\n',
  'NPCs/Mara.md': '---\ntype: npc\n---\nA friend.\n',
  'Events/Raid.md': [
    '---', 'type: event', 'location: Black Quay',
    'participants:', '  - "[[Mara]]"', '  - "[[Zorn]]"', '  - "Zorn (the host)"', '  - "[[Zorn]] (the host)"', '  - Zorn', '  - "[[Mara]] (with [[Zorn]])"',
    '---', '', 'They met.', ''].join('\n'),
  'Events/Ball.md': '---\ntype: event\nlocation: "[[Black Quay]]"\n---\nA ball.\n',
  'Events/Dock.md': '---\ntype: event\nlocation: "Docks near the Black Quay"\n---\nA dock.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs', Places: 'places', Events: 'events' } } };

const hitsIn = (text) => text.split('\n').filter((l) => /zorn|black quay/i.test(l));

describe('an event page and a withheld note named in its own fields (#469)', () => {
  it('prints neither name, however the field writes it, on the page or in previews.json', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      for (const page of ['raid', 'ball']) assert.deepEqual(hitsIn(s.player.read('events', `${page}.html`)), [], page);
      const previews = JSON.parse(s.player.read('previews.json'));
      for (const page of ['events/raid.html', 'events/ball.html']) assert.deepEqual(hitsIn(JSON.stringify(previews[page])), [], page);
    } finally { s.cleanup(); }
  });
  it('a name written into free text in a field stays the gate\'s to catch, on the page and in previews.json', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      const found = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings
        .filter((f) => f.code === 'WITHHELD_IN_PROSE');
      assert.deepEqual(found.map((f) => f.page).sort(), ['events/dock.html', 'previews.json']);
    } finally { s.cleanup(); }
  });
});

describe('an event participant written as running text (#469 follow-up)', () => {
  const NOTES2 = {
    'NPCs/Ilse.md': '---\ntype: npc\n---\nIlse.\n',
    'NPCs/Otto.md': '---\ntype: npc\n---\nOtto.\n',
    'NPCs/Petra.md': '---\ntype: npc\n---\nPetra.\n',
    'NPCs/Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nA man.\n',
    'Events/Meet.md': [
      '---', 'type: event', 'participants:',
      '  - "[[Ilse]] — met at the quay"', '  - "[[Otto]], [[Zorn]]"', '  - "[[Petra]]: the host"', '  - "[[Petra|P.]] (with [[Zorn]])"',
      '---', '', 'They met.', ''].join('\n'),
  };
  it('prints each link as a link, never literal brackets, and keeps a withheld name off the page', () => {
    const s = leakSite(NOTES2, SETTINGS);
    try {
      const html = s.player.read('events', 'meet.html');
      const start = html.indexOf('<div class="event-participants"');
      const list = html.slice(start, html.indexOf('</ul>', start));
      assert.doesNotMatch(list, /\[\[|\]\]/);
      for (const n of ['ilse', 'otto', 'petra']) assert.match(list, new RegExp(`<a href="[^"]*${n}\\.html"`));
      assert.match(list, /met at the quay/);
      assert.deepEqual(hitsIn(html), []);
    } finally { s.cleanup(); }
  });
});
