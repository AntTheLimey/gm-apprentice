const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

// The site file holds only the deploy keys; everything else comes from the vault file.
describe('build with settings only in _meta/vault-config.md', () => {
  let root;
  after(() => root && fs.rmSync(root, { recursive: true, force: true }));

  it('maps folders, titles pages and excludes dirs from the vault file', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-vault-only-'));
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, 'NPCs'), { recursive: true });
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
      '---\npublish:\n  mode: player\n  site_title: Vault Only Title\n  folder_map:\n    NPCs: npcs\n  exclude_dirs: [_meta]\n---\n');
    fs.writeFileSync(path.join(vault, 'NPCs', 'Clerk.md'), '---\ntype: npc\n---\n\nA clerk.\n');
    const configPath = path.join(root, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs') }));
    const original = { warn: console.warn, log: console.log };
    const lines = [];
    console.warn = (...a) => lines.push(a.join(' '));
    console.log = (...a) => lines.push(a.join(' '));
    try { build({ configPath }); } finally { Object.assign(console, original); }
    const page = path.join(root, 'docs', 'npcs', 'clerk.html');
    assert.ok(fs.existsSync(page), lines.join('\n'));
    assert.match(fs.readFileSync(page, 'utf8'), /<title>[^<]*Vault Only Title/);
  });
});
