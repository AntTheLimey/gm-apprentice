'use strict';
// Builds a small vault given as { 'Folder/Note.md': text } as a full-mode site and returns
// readers for the built files. Folders become same-named lower-case output folders.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { writeSettings } = require('./vault-files');

function buildVault(files, { settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'small-vault-'));
  const vault = path.join(root, 'vault');
  const folders = new Set();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    if (rel.includes('/') && !rel.startsWith('_meta/')) folders.add(path.dirname(rel));
  }
  const folderMap = Object.fromEntries([...folders].map((f) => [f, f.toLowerCase()]));
  writeSettings(vault, { 'player_site.title': 'T', 'player_site.folder_map': folderMap, ...settings });
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
  return {
    root,
    read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8'),
    exists: (...p) => fs.existsSync(path.join(root, 'docs', ...p)),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

module.exports = { buildVault };
