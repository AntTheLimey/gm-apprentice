// tools/publish/test/helpers/pc-vault.js
// Makes a one-PC vault from a real PC template body, builds it, and returns the page.
// The vault is made in code, not kept as a fixture, so it follows the template.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { writeSettings } = require('./vault-files');

// `settings` are extra settings for the vault's settings file, by their new names, e.g. { 'player_site.sheets.skin': 'ledger' }.
// pcOptions.status: the PC's `status:` (alive unless given).
function buildPc(system, body, settings = {}, buildOptions = {}, pcOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gm-publish-${system}-`));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  writeSettings(vault, { 'vault.system': system, 'player_site.title': 'Test', 'player_site.folder_map': { 'Characters/PCs': 'characters/pcs' }, ...settings });
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Test_Hero.md'),
    `---\ntype: pc\ncanon_status: AUTHORITATIVE\nplayer_name: "Test Player"\nstatus: ${pcOptions.status || 'alive'}\nrelationships: []\n---\n${body.replace('{Keeper-only notes. Protected — skills never modify.}', 'GM-SECRET')}`);
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  build({ configPath, ...buildOptions });
  const out = path.join(root, 'docs');
  return { root, out, html: fs.readFileSync(path.join(out, 'characters', 'pcs', 'test-hero.html'), 'utf-8') };
}

module.exports = { buildPc };
