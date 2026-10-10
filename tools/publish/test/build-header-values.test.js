const { test } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const { buildVault } = require('./helpers/build-vault');
const { pageText } = require('./helpers/card-subset');

// What a reader sees in a page's header block (title to first heading), as text.
function header(html) {
  const main = html.slice(html.indexOf('<main'));
  return pageText(main.split(/<h2\b/)[0]);
}

const SETTINGS = { extraConfig: '  link_previews: off\n' };
function site(files) { return buildVault(files, SETTINGS); }

test('B1: an unquoted date in a header prints as written (YYYY-MM-DD), on every template', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'America/New_York';
  const v = site({
    'Sessions/S4.md': '---\ntype: session\nsession_number: 4\nplay_date: 2026-07-02\n---\nBody.\n',
    'Events/Fire.md': '---\ntype: event\nin_game_date: 1925-03-04\n---\nBody.\n',
    'Documents/Letter.md': '---\ntype: document\ndate_written: 1925-03-04\n---\nBody.\n',
  });
  try {
    for (const [p, want] of [[['sessions', 's4.html'], '2026-07-02'], [['events', 'fire.html'], '1925-03-04'], [['documents', 'letter.html'], '1925-03-04']]) {
      const text = header(v.read(...p));
      assert.ok(text.includes(want), `${p.join('/')}: ${text}`);
      assert.ok(!/GMT|\b20\d\d \d\d:\d\d/.test(text), `${p.join('/')} prints a machine date: ${text}`);
    }
  } finally { process.env.TZ = prev; if (prev === undefined) delete process.env.TZ; v.cleanup(); }
});

test('B2: a wikilink in a header prints as its label on every template that prints it', () => {
  const v = site({
    'Clues/C.md': '---\ntype: clue\nfound_by: "[[Anna_Lindqvist]] (Brenner); [[Target_Name|alias]]"\n---\nBody.\n',
    'Documents/D.md': '---\ntype: document\nauthor: "[[Ramkanta_Sett]] as registrar"\n---\nBody.\n',
    'Items/I.md': '---\ntype: item\norigin: "[[Safe_House|Thaliastrasse 12]]"\ncurrent_holder: "[[A_B]] (held for [[C_D]])"\n---\nBody.\n',
    'Events/E.md': '---\ntype: event\noutcome: "Won by [[Left_Side|the left]]"\nlocation: "[[Old_Town|the old town]] (north)"\n---\nBody.\n',
    'Factions/F.md': '---\ntype: faction\nleadership: "[[The_Boss|Boss]]"\nterritory: "[[Big_Area]]"\n---\nBody.\n',
  });
  try {
    const want = [
      [['clues', 'c.html'], 'Anna Lindqvist (Brenner); alias'],
      [['documents', 'd.html'], 'Ramkanta Sett as registrar'],
      [['items', 'i.html'], 'Thaliastrasse 12'],
      [['items', 'i.html'], 'A B (held for C D)'],
      [['events', 'e.html'], 'Won by the left'],
      [['events', 'e.html'], 'the old town (north)'],
      [['factions', 'f.html'], 'Boss'],
      [['factions', 'f.html'], 'Big Area'],
    ];
    for (const [p, text] of want) {
      const h = header(v.read(...p));
      assert.ok(h.includes(text), `${p.join('/')} should show ${text}: ${h}`);
      assert.ok(!/\[\[|\]\]|_|\|/.test(h), `${p.join('/')} shows raw markup: ${h}`);
    }
  } finally { v.cleanup(); }
});

test('B3: a snake_case type label in a header prints as words', () => {
  const v = site({
    'Locations/L.md': '---\ntype: location\nlocation_type: government_quarter\n---\nBody.\n',
    'Events/E.md': '---\ntype: event\nevent_type: betrayal_event\n---\nBody.\n',
    'Items/I.md': '---\ntype: item\nitem_type: plot_thread\n---\nBody.\n',
    'Clues/C.md': '---\ntype: clue\nclue_type: physical_clue\n---\nBody.\n',
    'Factions/F.md': '---\ntype: faction\nfaction_type: secret_society\n---\nBody.\n',
  });
  try {
    for (const [p, text] of [[['locations', 'l.html'], 'Government quarter'], [['events', 'e.html'], 'Betrayal event'],
      [['items', 'i.html'], 'Plot thread'], [['clues', 'c.html'], 'Physical clue'], [['factions', 'f.html'], 'Secret society']]) {
      const h = header(v.read(...p));
      assert.ok(h.includes(text), `${p.join('/')}: ${h}`);
      assert.ok(!h.includes('_'), `${p.join('/')} keeps an underscore: ${h}`);
    }
  } finally { v.cleanup(); }
});

test('A2: an item holder is shown whole in its real shapes, never cut at a slash or bracket', () => {
  const holders = {
    A: ['[[Name]]', 'Name'],
    B: ['[[Name|alias]]', 'alias'],
    C: ['Name (note)', 'Name (note)'],
    D: ['Name / Other', 'Name / Other'],
    E: ['[[A]] (held for [[B]])', 'A (held for B)'],
    F: ['[[Nathaniel]] (and / or [[Cleo]])', 'Nathaniel (and / or Cleo)'],
    G: ['n/a — federal fleet vessel', 'n/a — federal fleet vessel'],
  };
  const files = {};
  for (const [k, [raw]] of Object.entries(holders)) files[`Items/Item ${k}.md`] = `---\ntype: item\ncurrent_holder: ${JSON.stringify(raw)}\n---\nBody.\n`;
  const v = site(files);
  try {
    for (const [k, [raw, want]] of Object.entries(holders)) {
      const h = header(v.read('items', `item-${k.toLowerCase()}.html`));
      assert.ok(h.includes(`Current Holder: ${want}`), `${raw}: ${h}`);
    }
  } finally { v.cleanup(); }
});
