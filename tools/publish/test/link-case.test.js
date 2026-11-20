// A link is followed as Obsidian follows it, letter case aside (#790): `[[the cloister]]` finds `The Cloister.md`,
// unless two names that differ only by case name two notes. One rule, in the lookup table the site's link map and the
// run sheet's note index both use.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nfcLookupTable } = require('../lib/unicode');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

test('the lookup table answers a name in another case only when one entry does', () => {
  const t = nfcLookupTable({ 'The Cloister': 'a.html', Ash: 'ash.html', ASH: 'ash2.html', Bell: 'b.html', BELL: 'b.html' }, { foldCase: true });
  assert.equal(t['The Cloister'], 'a.html');
  assert.equal(t['the cloister'], 'a.html');
  assert.ok('THE CLOISTER' in t);
  // Two names that differ only by case, naming two things: an exact one is still found, another spelling finds neither.
  assert.equal(t.Ash, 'ash.html');
  assert.equal(t.ash, undefined);
  assert.ok(!('ash' in t));
  // Two spellings naming the same thing still answer.
  assert.equal(t.bell, 'b.html');
  // A name added through the table is found in another case at once.
  t['Old Mill'] = 'mill.html';
  assert.equal(t['old mill'], 'mill.html');
  // Without foldCase nothing changes.
  const plain = nfcLookupTable({ 'The Cloister': 'a.html' });
  assert.equal(plain['the cloister'], undefined);
});

function site(notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-case-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { Locations: 'locations', NPCs: 'npcs' } } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { build({ configPath }); } finally { console.log = real; console.warn = warn; }
  return (rel) => fs.readFileSync(path.join(siteDir, 'docs', rel), 'utf8');
}

test('a built page links a note named in another case, and not one two notes answer', () => {
  const read = site({
    'Locations/The Cloister.md': '---\ntype: location\n---\n\n# The Cloister\n\nQuiet stones.\n',
    'Locations/Ash.md': '---\ntype: location\n---\n\n# Ash\n\nA grove.\n',
    'NPCs/ASH.md': '---\ntype: npc\n---\n\n# ASH\n\nA machine.\n',
    'NPCs/Brother Tam.md': '---\ntype: npc\n---\n\n# Brother Tam\n\nKeeps [[the cloister]] and [[THE CLOISTER|its gate]]. Fears [[ash]].\n',
  });
  const html = read('npcs/brother-tam.html');
  const links = [...html.matchAll(/<a [^>]*href="([^"]*the-cloister\.html)"[^>]*>([^<]*)<\/a>/g)].map((m) => m[2]);
  assert.deepEqual(links, ['the cloister', 'its gate']);
  assert.doesNotMatch(html, /href="[^"]*ash[^"]*\.html"/, 'two notes differ only by case: neither is linked');
});
