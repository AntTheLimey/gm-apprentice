const { test } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');

function buildVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backlinks-build-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T' }));
  const real = console.log; console.log = () => {};
  try { build({ configPath }); } finally { console.log = real; }
  return { read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8'), root };
}

const CONFIG = '---\npublish:\n  mode: full\n  folder_map:\n    Characters/NPCs: characters/npcs\n    Characters/PCs: characters/pcs\n    Sessions: sessions\n---\n';

test('a page only mentioned in a session keeps its connections graph and its mentioned-in sidebar', () => {
  const { read, root } = buildVault({
    '_meta/vault-config.md': CONFIG,
    'Characters/NPCs/Hallam.md': '---\ntype: npc\n---\n# Hallam\n',
    'Sessions/S1.md': '---\ntype: session\n---\nWe met [[Hallam]].\n',
  });
  const html = read('characters', 'npcs', 'hallam.html');
  assert.match(html, /class="relationship-graph"/);
  assert.match(html, /mentioned_in|Mentioned In/i);
  assert.match(html, /sessions\/s1\.html|s1\.html/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a mention through an alias counts for the page the alias reaches', () => {
  const { read, root } = buildVault({
    '_meta/vault-config.md': CONFIG,
    'Characters/NPCs/Hallam.md': '---\ntype: npc\naliases: ["The Warden"]\n---\n# Hallam\n',
    'Sessions/S1.md': '---\ntype: session\n---\nWe met [[The Warden]].\n',
  });
  assert.match(read('characters', 'npcs', 'hallam.html'), /Mentioned In/i);
  fs.rmSync(root, { recursive: true, force: true });
});
