'use strict';
// Builds a fixture vault as a full-mode site, the way the previews proofs need: a temp copy
// of the vault, every folder holding notes mapped, and publish.mode: full so every page
// publishes. Shared by the build test, the byte-identity proof and Task 7's proof script.
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const SKIP = new Set(['_meta', '_Templates', '_attachments']);

function fixtureNames() {
  return fs.readdirSync(FIXTURES).filter((n) => fs.statSync(path.join(FIXTURES, n)).isDirectory());
}

function folderMapFor(vault) {
  const map = {};
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (fs.readdirSync(path.join(dir, e.name)).some((f) => f.endsWith('.md'))) map[r] = r.toLowerCase().replace(/^_/, '');
      walk(path.join(dir, e.name), r);
    }
  })(vault, '');
  return map;
}

// Copies fixture `name` under `root` and returns the config path. `keys` are extra
// publish keys (e.g. { link_previews: 'off' }); `toolDir` is the publish tool whose
// vault-config-edit writes them (default: this checkout).
function prepareFixture(name, root, { keys = {}, toolDir = path.join(__dirname, '..', '..') } = {}) {
  const vault = path.join(root, 'vault');
  fs.cpSync(path.join(FIXTURES, name), vault, { recursive: true });
  require(path.join(toolDir, 'lib', 'vault-config-edit')).setPublishKeys(vault, { mode: 'full', ...keys });
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T',
    excludeDirs: ['_meta', '_Templates'], folderMap: folderMapFor(vault),
  }));
  return configPath;
}

module.exports = { fixtureNames, prepareFixture };
