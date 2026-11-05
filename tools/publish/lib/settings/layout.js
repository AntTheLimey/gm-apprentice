'use strict';
// Which layout a vault's settings are on, and the only place the settings file names are written.
// The new file is `_meta/vault-config.yaml`; the old one is `_meta/vault-config.md` (settings in
// its frontmatter); the tools' own bookkeeping is `_meta/vault-state.json`.
const fs = require('node:fs');
const path = require('node:path');
const { readerFrom } = require('../vault-reader');

const NEW_FILE = '_meta/vault-config.yaml';
const OLD_FILE = '_meta/vault-config.md';
// What the tools say of the old file since plugin 1.11.0, when it is the only settings file, and when it is left beside the new one.
const OLD_FILE_STOP = `${OLD_FILE} is the old settings file, no longer read since plugin 1.11.0. Run the update with a 1.10 release, 1.10.134 or later, first.`;
const OLD_FILE_LEFT = `${OLD_FILE} is still beside ${NEW_FILE}: remove or rename \`${OLD_FILE}\` once you have checked its settings are in \`${NEW_FILE}\`; plugin 1.11.0 no longer reads it.`;
const STATE_FILE = '_meta/vault-state.json';
const NOTES_FILE = '_meta/vault-notes.md';

// The publish list: the YAML file, and the Markdown file it replaced (never read since plugin 1.11.0: it stops by name).
const PUBLISH_LIST_FILE = '_meta/publish-list.yaml';
const OLD_LIST_FILE = '_meta/publish-manifest.md';
const OLD_LIST_STOP = `${OLD_LIST_FILE} is the old publish list, no longer read since plugin 1.11.0. Run the update with a 1.10 release, 1.10.134 or later, first.`;
// The first publish tool version that reads the YAML publish list; an older one reads a moved vault as having no list.
const PUBLISH_LIST_FROM = '1.27.0';
// The first publish tool version that reads the accepted leak findings in the publish list; an older one reads a list
// holding only them as an empty publish list.
const ACCEPTED_FROM = '1.30.0';
// The first publish tool version that reads a settled heading (`leaks settle`) in the accepted list; an older one from
// ACCEPTED_FROM on reads it as an accepted leak finding no longer needed, and `leaks prune` deletes it.
const SETTLE_FROM = '1.39.0';
// The first publish tool version that reads an accepted hostile tie (`relationships accept`) in the accepted list; an older
// one reads it as an accepted leak finding no longer needed, and `leaks prune` deletes it.
const TIE_FROM = '1.43.0';

// The new file's top level: `version`, then the groups, in the order they are written. `gm_site` is read like the others, but a name or value under it that cannot be read warns and never stops the player build (it is not in STRICT_PARENTS).
const SETTING_GROUPS = ['vault', 'player_site'];
const GM_GROUP = 'gm_site';
const GROUPS = [...SETTING_GROUPS, GM_GROUP];

// Where a name the list does not know stops a player build instead of warning: directly under these groups
// and anywhere in the hiding group. The reader and the JSON Schema both ask here.
const HIDE_GROUP = 'player_site.hide';
const STRICT_PARENTS = new Set(SETTING_GROUPS);
const stopsUnknown = (parent) => STRICT_PARENTS.has(parent) || parent === HIDE_GROUP || parent.startsWith(`${HIDE_GROUP}.`);

// The first publish tool version that reads the new settings file; an older one reads a moved vault as having no settings.
const FIRST_TOOL_READING_NEW_FILE = '1.23.0';

// The first publish tool version that runs the build steps a vault's settings hold (`player_site.before_build`, `.after_build`).
const STEPS_FROM = '1.24.0';

// The version of the publish tool installed in a site folder (whatever its package.json says), or null when none is
// installed or its package.json cannot be read. The one reader of it. `readFile` is for a caller that has its own.
function siteToolVersion(siteDir, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  try {
    return JSON.parse(readFile(path.join(siteDir, 'node_modules', 'gm-apprentice-publish', 'package.json'))).version || null;
  } catch {
    return null;
  }
}

const at = (vaultPath, rel) => path.join(vaultPath, ...rel.split('/'));

// 'new' whenever the new file exists (the old file, if it is still there, is not read), 'legacy'
// when only the old file exists (its settings are not read: the build stops), 'none' when neither does.
function layoutOf(vaultPath, deps) {
  const rd = readerFrom(deps);
  if (rd.exists(at(vaultPath, NEW_FILE))) return 'new';
  return rd.exists(at(vaultPath, OLD_FILE)) ? 'legacy' : 'none';
}

// What a message to the GM calls the settings file, and a setting as that file writes it. Only the new file is read,
// so both are the new file's whatever the layout; the old-name/new-name pairs live in the list.
const fileLabelFor = () => NEW_FILE;
const nameInFor = (layout, name) => name;
const fileLabel = () => NEW_FILE;
const nameIn = (vaultPath, name) => name;

module.exports = { FIRST_TOOL_READING_NEW_FILE, STEPS_FROM, siteToolVersion, SETTING_GROUPS, GM_GROUP, GROUPS, HIDE_GROUP, STRICT_PARENTS, stopsUnknown, NEW_FILE, OLD_FILE, OLD_FILE_STOP, OLD_FILE_LEFT, STATE_FILE, NOTES_FILE, PUBLISH_LIST_FILE, OLD_LIST_FILE, OLD_LIST_STOP, PUBLISH_LIST_FROM, ACCEPTED_FROM, SETTLE_FROM, TIE_FROM, layoutOf, at, fileLabel, nameIn, fileLabelFor, nameInFor };
