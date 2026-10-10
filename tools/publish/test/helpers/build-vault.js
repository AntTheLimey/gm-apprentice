'use strict';
// Builds a small vault given as { 'Folder/Note.md': text } as a full-mode site and returns
// readers for the built files. Folders become same-named lower-case output folders.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');

function buildVault(files, { extraConfig = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'small-vault-'));
  const vault = path.join(root, 'vault');
  const folders = new Set();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    if (rel.includes('/') && !rel.startsWith('_meta/')) folders.add(path.dirname(rel));
  }
  const map = [...folders].map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  mode: full\n${extraConfig}  folder_map:\n${map}---\n`);
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T' }));
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
