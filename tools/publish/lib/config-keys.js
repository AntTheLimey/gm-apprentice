// Every setting that used to live in the site's vault.config.json and now lives
// under `publish:` in _meta/vault-config.md. The reader, the build warning and
// migrate-config all read this table; a key missing here is not migrated.
const MOVED_KEYS = [
  { json: 'siteTitle',       publish: 'site_title',       kind: 'scalar' },
  { json: 'footer',          publish: 'footer',           kind: 'scalar' },
  { json: 'searchEnabled',   publish: 'search',           kind: 'scalar' },
  { json: 'folderMap',       publish: 'folder_map',       kind: 'map' },
  { json: 'attachmentsDir',  publish: 'attachments_dir',  kind: 'scalar' },
  { json: 'system',          publish: 'system',           kind: 'scalar' },
  { json: 'excludeDirs',     publish: 'exclude_dirs',     kind: 'list' },
  { json: 'excludeSections', publish: 'exclude_sections', kind: 'list' },
  { json: 'excludeFields',   publish: 'exclude_fields',   kind: 'list' },
  { json: 'excludeCallouts', publish: 'exclude_callouts', kind: 'scalar' },
  { json: 'sheet_crest',     publish: 'sheet_crest',      kind: 'scalar' },
  { json: 'landing',         publish: 'landing',          kind: 'map' },
  { json: 'images',          publish: 'images',           kind: 'map' },
  { json: 'banners',         publish: 'banners',          kind: 'map' },
  { json: 'locations',       publish: 'locations',        kind: 'map' },
];
// The six keys that stay in vault.config.json.
const DEPLOY_KEYS = ['vaultPath', 'outputDir', 'host', 'siteUrl', 'cloudflarePagesProject', 'preserveDirs'];
// Old switch names, in either file. Handled by switches.js, moved by migrate-config.
const OLD_SWITCHES = { statusBar: 'live_stats', inbox: 'inbox' };
module.exports = { MOVED_KEYS, DEPLOY_KEYS, OLD_SWITCHES };
