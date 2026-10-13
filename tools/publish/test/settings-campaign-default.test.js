'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../lib/settings/read');

// Unset, the campaign is the vault folder's name, with the origin `default`, on every layout.
test('vault.campaign unset reads as the vault folder\'s name on the old file, the new file and with no file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-default-'));
  const make = (name, file, text) => {
    const vault = path.join(root, name);
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    if (file) fs.writeFileSync(path.join(vault, '_meta', file), text);
    return vault;
  };
  const cases = [
    make('Old Hollow', 'vault-config.md', '---\ntype: meta\npublish:\n  mode: player\n---\n'),
    make('New Hollow', 'vault-config.yaml', 'version: 1\n'),
    make('Bare Hollow', null),
  ];
  for (const vault of cases) {
    const r = readSettings({ vaultPath: vault });
    assert.equal(r.values.vault.campaign, path.basename(vault), vault);
    assert.equal(r.origins['vault.campaign'], 'default', vault);
  }
  const named = make('Named', 'vault-config.yaml', 'version: 1\nvault:\n  campaign: The Hollow\n');
  assert.equal(readSettings({ vaultPath: named }).values.vault.campaign, 'The Hollow');
});
