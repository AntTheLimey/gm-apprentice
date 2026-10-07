// tools/publish/test/helpers/pc-vault.js
// Makes a one-PC vault from a real PC template body, builds it, and returns the page.
// The vault is made in code, not kept as a fixture, so it follows the template.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

// `publishLines` are extra keys under `publish:` in the vault config, e.g. ['sheet_skin: ledger'].
function buildPc(system, body, publishLines = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gm-publish-${system}-`));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  const extra = publishLines.map((l) => `  ${l}\n`).join('');
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  mode: player\n  system: ${system}\n${extra}---\n`);
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Test_Hero.md'),
    `---\ntype: pc\ncanon_status: AUTHORITATIVE\nplayer_name: "Test Player"\nstatus: alive\nrelationships: []\n---\n${body.replace('{Keeper-only notes. Protected — skills never modify.}', 'GM-SECRET')}`);
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
    siteTitle: 'Test', system, excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
    folderMap: { 'Characters/PCs': 'characters/pcs' },
  }));
  build({ configPath });
  const out = path.join(root, 'docs');
  return { root, out, html: fs.readFileSync(path.join(out, 'characters', 'pcs', 'test-hero.html'), 'utf-8') };
}

module.exports = { buildPc };
