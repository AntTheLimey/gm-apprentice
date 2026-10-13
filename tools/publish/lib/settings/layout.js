'use strict';
// Which layout a vault's settings are on, and the only place the settings file names are written.
// The new file is `_meta/vault-config.yaml`; the old one is `_meta/vault-config.md` (settings in
// its frontmatter); the tools' own bookkeeping is `_meta/vault-state.json`.
const fs = require('node:fs');
const path = require('node:path');

const NEW_FILE = '_meta/vault-config.yaml';
const OLD_FILE = '_meta/vault-config.md';
const STATE_FILE = '_meta/vault-state.json';

const at = (vaultPath, rel) => path.join(vaultPath, ...rel.split('/'));

// 'new' whenever the new file exists (the old file, if it is still there, is not read), 'legacy'
// when only the old file exists, 'none' when neither does.
function layoutOf(vaultPath) {
  if (fs.existsSync(at(vaultPath, NEW_FILE))) return 'new';
  return fs.existsSync(at(vaultPath, OLD_FILE)) ? 'legacy' : 'none';
}

module.exports = { NEW_FILE, OLD_FILE, STATE_FILE, layoutOf, at };
