'use strict';
// Which layout a vault's settings are on, and the only place the settings file names are written.
// The new file is `_meta/vault-config.yaml`; the old one is `_meta/vault-config.md` (settings in
// its frontmatter); the tools' own bookkeeping is `_meta/vault-state.json`.
const fs = require('node:fs');
const path = require('node:path');
const { entry, legacyNameOf } = require('./registry');

const NEW_FILE = '_meta/vault-config.yaml';
const OLD_FILE = '_meta/vault-config.md';
const STATE_FILE = '_meta/vault-state.json';
const NOTES_FILE = '_meta/vault-notes.md';

// The new file's top level: `version`, then the groups, in the order they are written. `gm_site` reads nothing yet.
const SETTING_GROUPS = ['vault', 'player_site'];
const GM_GROUP = 'gm_site';
const GROUPS = [...SETTING_GROUPS, GM_GROUP];

// Where a name the list does not know stops a player build instead of warning: directly under these groups
// and anywhere in the hiding group. The reader and the JSON Schema both ask here.
const HIDE_GROUP = 'player_site.hide';
const STRICT_PARENTS = new Set(SETTING_GROUPS);
const stopsUnknown = (parent) => STRICT_PARENTS.has(parent) || parent === HIDE_GROUP || parent.startsWith(`${HIDE_GROUP}.`);

const at = (vaultPath, rel) => path.join(vaultPath, ...rel.split('/'));

// 'new' whenever the new file exists (the old file, if it is still there, is not read), 'legacy'
// when only the old file exists, 'none' when neither does.
function layoutOf(vaultPath) {
  if (fs.existsSync(at(vaultPath, NEW_FILE))) return 'new';
  return fs.existsSync(at(vaultPath, OLD_FILE)) ? 'legacy' : 'none';
}

// What a message to the GM calls the settings file of a layout, and a setting as that file writes it:
// the new name on the new layout (and when there is no file yet), the old name on the old one. These
// two are the only way a message names either; the old-name/new-name pairs live in the list.
const fileLabelFor = (layout) => (layout === 'legacy' ? OLD_FILE : NEW_FILE);
const nameInFor = (layout, name) => {
  const e = entry(name);
  return (layout === 'legacy' && e && legacyNameOf(e)) || name;
};
const layoutOrNone = (vaultPath) => (typeof vaultPath === 'string' && vaultPath ? layoutOf(vaultPath) : 'none');
const fileLabel = (vaultPath) => fileLabelFor(layoutOrNone(vaultPath));
const nameIn = (vaultPath, name) => nameInFor(layoutOrNone(vaultPath), name);

module.exports = { SETTING_GROUPS, GM_GROUP, GROUPS, HIDE_GROUP, STRICT_PARENTS, stopsUnknown, NEW_FILE, OLD_FILE, STATE_FILE, NOTES_FILE, layoutOf, at, fileLabel, nameIn, fileLabelFor, nameInFor };
