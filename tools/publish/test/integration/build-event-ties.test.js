'use strict';
// An event's participants and location become Connections ties (#368). They are read from the
// published frontmatter only, so nothing the build hides may come through them.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildVault } = require('../helpers/build-vault');

const note = (fm, body = '') => `---\n${fm}\n---\n${body}\n`;
const FILES = {
  'PCs/Emma.md': note('type: pc', 'Emma.'),
  'NPCs/Hallam.md': note('type: npc', 'Hallam.'),
  'NPCs/Cult_Leader.md': note('type: npc\npublish: false', 'Hidden.'),
  'Locations/Docks.md': note('type: location', 'The docks.'),
  'Locations/Secret_Place.md': note('type: location\npublish: false', 'Hidden.'),
  'Events/Dock_Fire.md': note(
    'type: event\nlocation: "[[Docks]]"\nparticipants:\n  - "[[Emma]] (raised the alarm)"\n  - "[[Cult_Leader]] (SECRETROLE)"',
    'It burned.\n\n## GM Notes\n\n[[Hallam]] lit it, SECRETBODY.'),
  'Events/Quiet_Night.md': note(
    'type: event\npublish_exclude_fields: [participants, location]\nlocation: "[[Docks]]"\nparticipants:\n  - "[[Emma]] (QUIETLINE)"', 'Quiet.'),
  'Events/Hidden_Meeting.md': note(
    'type: event\npublish: false\nlocation: "[[Docks]]"\nparticipants:\n  - "[[Emma]] (HIDDENMEETING)"', 'Hidden.'),
  'Events/Secret_Deal.md': note(
    'type: event\nlocation: "[[Secret_Place]]"\nparticipants:\n  - "[[Emma]] (made the deal)"', 'A deal.'),
};
const s = buildVault(FILES);
after(() => s.cleanup());

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('a PC lists the events that name it, with the line the event gives', () => {
  const emma = s.read('pcs', 'emma.html');
  assert.match(emma, /Participated in/);
  assert.match(emma, /Dock Fire/);
  assert.match(emma, /raised the alarm/);
  assert.match(emma, /Visited/);
  assert.match(emma, /Docks/);
});

test('nothing the build hides comes through a derived tie', () => {
  const emma = s.read('pcs', 'emma.html');
  // an excluded field, an unpublished event: not ties
  assert.ok(!emma.includes('Quiet Night'));
  assert.ok(!emma.includes('Hidden Meeting'));
  // an unpublished place is no place to have visited
  assert.ok(!emma.includes('Secret Place'));
  const hallam = s.read('npcs', 'hallam.html');
  // a name in a GM Notes section of the event is not a participant
  assert.ok(!hallam.includes('Dock Fire'));
  const files = walk(path.join(s.root, 'docs')).filter((f) => /\.html$/i.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8');
    // An event page prints its own fields as written; its Connections are the new part.
    if (file.includes(path.sep + 'events' + path.sep) && !file.endsWith('index.html')) text = (text.match(/<section class="cx"[^]*?<\/section>|class="cx-data">[^]*?<\/script>/g) || []).join('');
    for (const secret of ['SECRETROLE', 'SECRETBODY', 'QUIETLINE', 'HIDDENMEETING', 'Cult Leader', 'Cult_Leader', 'Secret Place', 'Secret_Place', 'Hidden Meeting']) {
      assert.ok(!text.includes(secret), `${path.relative(s.root, file)} holds "${secret}"`);
    }
  }
});
