// The party page and its Party Status board are built at characters/pcs only (#744). A folder of PCs in play that
// player_site.folder_map publishes elsewhere gets a build warning and a Site Faults row, with the map change that
// brings it back.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

const pc = (name, status = 'active') => `---\ntype: pc\nstatus: ${status}\nplayer_name: P\n---\n\n# ${name}\n\nA traveller.\n`;

function run(folderMap, notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-address-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: folderMap } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const warnings = [];
  let faults = [];
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = (m) => warnings.push(String(m));
  try {
    build({ configPath, site: 'player' });
    build({ configPath, site: 'player', inMemory: true, onNoteFaults: (f) => { faults = f; } });
  } finally { console.log = real; console.warn = warn; }
  return { warnings: warnings.filter((w) => /party page/.test(w)), rows: faults.filter((f) => f.code === 'PCS_ADDRESS') };
}

test('PCs at characters/pcs: no warning and no row', () => {
  const { warnings, rows } = run({ PCs: 'characters/pcs' }, { 'PCs/Ada.md': pc('Ada') });
  assert.deepEqual(warnings, []);
  assert.deepEqual(rows, []);
});

test('a PCs folder sent elsewhere: one warning and one row for the folder, with the entry to set back', () => {
  const { warnings, rows } = run({ PCs: 'people', NPCs: 'npcs' }, { 'PCs/Ada.md': pc('Ada'), 'PCs/Bram.md': pc('Bram') });
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.path, 'PCs');
  assert.equal(row.severity, 'warning');
  assert.match(row.detail, /2 character pages publish at people\/ \(Ada, Bram\)/);
  assert.match(row.detail, /party page or the Party Status board/);
  assert.equal(row.fix, 'set "PCs" in player_site.folder_map back to characters/pcs (it says people)');
  assert.ok(warnings[0].includes(row.fix));
});

test('a PCs folder sent elsewhere by a parent folder\'s entry: the fix adds an entry for the PCs folder', () => {
  const { rows } = run({ Characters: 'folk' }, { 'Characters/PCs/Ada.md': pc('Ada') });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, 'Characters/PCs');
  assert.equal(rows[0].fix, 'add "Characters/PCs": "characters/pcs" to player_site.folder_map (now "Characters" sends it to folk/PCs)');
});

test('a PC out of play kept at another address is left alone', () => {
  const { warnings, rows } = run({ PCs: 'characters/pcs', Fallen: 'fallen' },
    { 'PCs/Ada.md': pc('Ada'), 'Fallen/Bram.md': pc('Bram', 'dead') });
  assert.deepEqual(warnings, []);
  assert.deepEqual(rows, []);
});
