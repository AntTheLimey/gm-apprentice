'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { buildVault } = require('../helpers/build-vault');

const note = (fm, body = '') => `---\n${fm}\n---\n${body}\n`;
const FILES = {
  'NPCs/Emma.md': note('type: npc\nrelationships:\n  - target: "[[Hallam]]"\n    type: serves\n    tone: loyal\n    description: His secretary.\n  - target: "[[Vesper_Hale|the stranger]]"\n    type: fears\n  - target: "[[Cult_Leader]]"\n    type: serves\n    gm_only: true\n    description: Secretly hers.', 'Emma works at [[Docks]].'),
  'NPCs/Hallam.md': note('type: npc\nrelationships:\n  - target: "[[Emma]]"\n    type: distrusts\n    tone: cold\n    description: Watches her.\n    gm_only: true', 'Hallam.'),
  'NPCs/Cult_Leader.md': note('type: npc\npublish: false', 'Hidden. Knows [[Emma]].'),
  'NPCs/Quiet.md': note('type: npc\npublish_exclude_fields: [relationships]\nrelationships:\n  - target: "[[Emma]]"\n    type: blackmails\n    description: Holds the letters.', 'Quiet.'),
  'Locations/Docks.md': note('type: location', 'The docks. [[Emma]] is often here.'),
  'World/Magic.md': note('type: world_domain\nrules:\n  - rule: Magic costs blood.', 'Magic.'),
  'Sessions/Session_1.md': note('type: session\nsession_number: 1', '[[Emma]] met [[Hallam]].'),
};
const sites = [];
const site = (extraConfig = '') => { const s = buildVault(FILES, { extraConfig }); sites.push(s); return s; };
after(() => sites.forEach((s) => s.cleanup()));

test('a page carries one Connections section and none of the old four', () => {
  const emma = site().read('npcs', 'emma.html');
  assert.strictEqual((emma.match(/<section class="cx"/g) || []).length, 1);
  assert.match(emma, /data-cx-mode="tree"/);
  assert.match(emma, /<a href="hallam\.html">Hallam<\/a> <span class="cx-kind">NPC<\/span> <span class="cx-tone cx-warm">warm<\/span><span class="cx-line">His secretary\.<\/span><span class="cx-sess">1 session: Session 1<\/span>/);
  assert.ok(!emma.includes('relationship-graph'));
  assert.match(emma, /js\/connections\.js/);
});

test('the other end shows the relationship, worded by the inverse', () => {
  assert.match(site().read('npcs', 'hallam.html'), /<h4>Served by<\/h4>\s*<ul>\s*<li><a href="emma\.html">Emma<\/a>/);
});

test('a page that only mentions the subject is under Mentions', () => {
  assert.match(site().read('npcs', 'emma.html'), /<h3>Mentions<\/h3>[^]*<a href="\.\.\/locations\/docks\.html">Docks<\/a>/);
});

test('hidden material: no gm-only edge either way, no hidden note, no excluded field, no name behind a label', () => {
  const s = site();
  for (const file of [['npcs', 'emma.html'], ['npcs', 'hallam.html'], ['npcs', 'quiet.html'], ['locations', 'docks.html']]) {
    const html = s.read(...file);
    for (const secret of ['Cult', 'Secretly hers', 'Watches her', 'distrust', 'Holds the letters', 'lackmail', 'Vesper']) {
      assert.ok(!html.includes(secret), `${file.join('/')} holds "${secret}"`);
    }
  }
  assert.match(s.read('npcs', 'emma.html'), /<span class="cx-name">the stranger<\/span>/);
});

test('each mode builds; off leaves no section and no script', () => {
  for (const mode of ['web', 'cards']) {
    assert.match(site(`  connections: ${mode}\n`).read('npcs', 'emma.html'), new RegExp(`data-cx-mode="${mode}"`));
  }
  const off = site('  connections: off\n');
  const html = off.read('npcs', 'emma.html');
  assert.ok(!html.includes('class="cx"') && !html.includes('connections.js'));
  assert.ok(!off.exists('js', 'connections.js'));
  assert.ok(site().exists('js', 'connections.js'));
});

test('no page keeps the sidebar, the body list or the NPC cards', () => {
  const s = site();
  for (const file of [['npcs', 'emma.html'], ['npcs', 'hallam.html'], ['locations', 'docks.html'], ['sessions', 'session-1.html']]) {
    const html = s.read(...file);
    for (const old of ['context-sidebar', 'content-with-sidebar', 'relationship-list', 'relationship-cards', 'rel-card', 'Mentioned In', 'sidebar-badge']) {
      assert.ok(!html.includes(old), `${file.join('/')} still has ${old}`);
    }
  }
});

test("a session page's NPCs are in its Connections, under Appearing", () => {
  assert.match(site().read('sessions', 'session-1.html'), /<h4>Appearing<\/h4>\s*<ul>\s*<li><a href="[^"]*emma\.html">Emma<\/a>/);
});

test('World Rules sit in the page, not beside it', () => {
  const html = site().read('world', 'magic.html');
  assert.match(html, /<section class="world-rules"><h2>World Rules<\/h2><ul><li>Magic costs blood\.<\/li><\/ul><\/section>/);
  assert.ok(!html.includes('<aside'));
});
