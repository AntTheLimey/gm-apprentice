'use strict';
// A small vault with a player site and an empty publish list, for `props pages --note`. `files` is { 'Folder/Note.md': text }.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeNewConfig } = require('./settings-files');

function propVault(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prop-vault-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vaultDir = path.join(root, 'vault');
  const siteDir = path.join(root, 'campaign');
  const map = {};
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, rel), text);
    const dir = rel.includes('/') ? path.posix.dirname(rel) : null;
    if (dir && !dir.startsWith('_')) map[dir] = dir.toLowerCase();
  }
  fs.mkdirSync(path.join(vaultDir, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, '_meta', 'publish-list.yaml'), 'publish: []\n');
  fs.mkdirSync(siteDir);
  writeNewConfig(vaultDir, { version: 1, player_site: { folder: siteDir, title: 'T', folder_map: map } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vaultDir }));
  return { root, vaultDir, siteDir, configPath };
}

module.exports = { propVault };
