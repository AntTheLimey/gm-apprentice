const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { applyChanges, settingsText } = require('./settings/write');
const { siteDirPath } = require('./lines-cli');
const { entry, nameIn, fileLabel } = require('./settings');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates-scaffold');

const DEFAULTS = {
  SITE_TITLE: 'My Campaign',
  SITE_URL: 'https://example.github.io/my-campaign',
  VAULT_PATH: './vault',
};

// The campaign settings a new site starts with, by the settings' own names. They live in the
// vault's settings file, not in the site's vault.config.json.
const DEFAULT_FOLDER_MAP = {
  'Characters/PCs': 'characters/pcs',
  'Characters/NPCs': 'characters/npcs',
  'Locations': 'locations',
  'Factions & Organizations': 'factions',
  'Items & Artifacts': 'items',
  'Creatures': 'creatures',
  'Events': 'events',
  'Documents': 'documents',
  'Clues': 'clues',
  'Chapters': 'chapters',
  '_Campaign': 'campaign',
  '_World': 'world',
  'Heritages': 'heritages',
};

// `siteDir` is where the vault finds its site again: vault_check asks the tool installed
// there what publishes. `player_site.publish` says the vault has a site; `init` is the GM asking for one.
function defaultCampaignSettings(siteTitle, tagline, siteDir) {
  return {
    ...(siteDir ? { 'player_site.publish': true, 'player_site.folder': siteDir.split(path.sep).join('/') } : {}),
    'player_site.title': siteTitle,
    'player_site.folder_map': DEFAULT_FOLDER_MAP,
    'vault.attachments': '_attachments',
    'player_site.hide.folders': ['_meta', '_Templates', '_resources'],
    // The built-in lists, written out so the GM sees them and edits them knowingly: a list in
    // the vault replaces the built-in one, so an entry added to an invisible default would drop
    // the rest. One source: the lists the build falls back to when the vault has none.
    'player_site.hide.sections': [...entry('player_site.hide.sections').default],
    'player_site.hide.fields': [...entry('player_site.hide.fields').default],
    'player_site.hide.callouts': true,
    ...(tagline ? { 'player_site.theme.tagline': tagline } : {}),
  };
}

const FOLDER = 'player_site.folder';
const SWITCH = 'player_site.publish';

/**
 * Write the starting campaign settings into the vault's settings file, for settings it does not
 * already set. Never creates the vault directory. A vault with no settings file gets the new one;
 * a vault still on the old file is written in place. Returns what happened so the caller can tell the user.
 * `settings` is keyed by the settings' names; so are `written`, `kept` and `missing`.
 * @returns {{ written: string[], kept: string[], skipped: string|null, missing: Record<string, unknown>, otherSite?: string }}
 *
 * `options.existingOnly`: add to a settings file that is already there, never create one
 * (update-pin, which must not turn whatever folder `vaultPath` names into a vault).
 */
function seedVaultSettings(vaultDir, settings, options = {}) {
  const none = (skipped, missing) => ({ written: [], kept: [], skipped, missing });
  if (!fsSync.existsSync(vaultDir) || !fsSync.statSync(vaultDir).isDirectory()) {
    return none(`the vault folder ${vaultDir} does not exist yet`, settings);
  }
  let file;
  try {
    file = settingsText(vaultDir);
  } catch (e) {
    return none(String(e.message).split('\n')[0].trim(), settings);
  }
  if (!file && options.existingOnly) return none(`${vaultDir} has no settings file`, settings);
  const have = (name) => (file ? file.get(name) : undefined);
  const set = {};
  const kept = [];
  let otherSite;
  for (const [name, value] of Object.entries(settings)) {
    const held = have(name);
    if (held === undefined) { set[name] = value; continue; }
    // `init` is the GM asking for a site, so it turns one on over an earlier off. Any
    // other caller (update-pin) leaves a switch the GM set.
    if (name === SWITCH && options.turnSiteOn && held !== true) { set[name] = value; continue; }
    if (name === FOLDER) {
      // A blank folder is no site: fill it. One naming another folder is the GM's,
      // and is left, but said out loud by the caller.
      if (held === null || held === '') { set[name] = value; continue; }
      // The same folder written another way (relative to the vault, from `~`, a trailing
      // slash, through a symlink) is this site.
      const real = (p) => { try { return fsSync.realpathSync(p); } catch { return path.resolve(p); } };
      if (typeof held !== 'string' || real(siteDirPath(vaultDir, held)) !== real(value)) {
        otherSite = String(held);
      }
    }
    // The theme's own settings the GM left unset (missing, empty or blank) are filled; the ones set are kept.
    if (name.startsWith('player_site.theme.') && (held === null || held === '')) { set[name] = value; continue; }
    kept.push(name);
  }
  if (!Object.keys(set).length) return { written: [], kept, skipped: null, missing: {}, otherSite };
  try {
    applyChanges(vaultDir, Object.entries(set).map(([name, value]) => ({ op: 'set', name, value })), { create: true });
  } catch (e) {
    return { written: [], kept, skipped: String(e.message).split('\n')[0], missing: set, otherSite };
  }
  return { written: Object.keys(set), kept, skipped: null, missing: {}, otherSite };
}

function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'my-campaign';
}

/**
 * Replace {{PLACEHOLDER}} tokens in a string with values from a map.
 * @param {string} content
 * @param {Record<string, string>} values
 * @returns {string}
 */
function applyPlaceholders(content, values) {
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

/**
 * Scaffold a new gm-apprentice-publish site in targetDir.
 *
 * @param {string} targetDir - Directory to write scaffold into (default: cwd)
 * @param {object} [options]
 * @param {boolean} [options.verbose] - Log progress (default: false)
 * @param {string} [options.siteTitle] - Seeds publish.site_title (default "My Campaign")
 * @param {string} [options.tagline] - Seeds publish.theme.tagline when the vault file leaves it unset
 * @param {string} [options.vaultPath] - The vault; recorded as vaultPath in the site file and
 *   where the starting campaign settings go (default: ./vault beside the site)
 * @returns {Promise<{ success: true, files: string[], vaultSettings: object }>}
 */
async function init(targetDir = '.', options = {}) {
  const verbose = options.verbose === true;
  const siteTitle = options.siteTitle || DEFAULTS.SITE_TITLE;
  const values = {
    ...DEFAULTS,
    SITE_TITLE: siteTitle,
    PACKAGE_NAME: slugify(siteTitle),
    VAULT_PATH: (options.vaultPath || DEFAULTS.VAULT_PATH).split(path.sep).join('/'),
    // Pin the scaffold to THIS tool — the copy running init, which lives in the plugin
    // cache. The site then builds with the exact version of the plugin the GM installed,
    // with no npm-registry round-trip and no manual repoint. options.toolDep is an escape
    // hatch for tests. Forward slashes keep the value valid JSON on Windows too.
    TOOL_DEP: options.toolDep || `file:${path.resolve(__dirname, '..').split(path.sep).join('/')}`,
  };
  const dest = path.resolve(targetDir);

  function log(msg) {
    if (verbose) console.log(msg);
  }

  // Ensure target directory exists
  await fs.mkdir(dest, { recursive: true });

  // Files we will write: [destRelative, templateRelative, isTemplate]
  // isTemplate = true  → read from templates-scaffold, apply placeholders
  // isTemplate = false → read from templates-scaffold as-is (binary-safe / plain copy)
  const plan = [
    { dest: 'package.json',                    tmpl: 'package.json.tmpl',                    isTemplate: true  },
    { dest: 'vault.config.json',               tmpl: 'vault.config.json.tmpl',               isTemplate: true  },
    { dest: 'README.md',                       tmpl: 'README.md.tmpl',                       isTemplate: true  },
    { dest: 'css/overrides.css',               tmpl: 'css/overrides.css',                    isTemplate: false },
    { dest: '.gitignore',                      tmpl: 'dot-gitignore',                         isTemplate: false },
    { dest: 'wrangler.toml',                   tmpl: 'wrangler.toml.tmpl',                    isTemplate: true  },
  ];

  // Check for pre-existing files before writing anything
  for (const entry of plan) {
    const destPath = path.join(dest, entry.dest);
    try {
      await fs.access(destPath);
      // If access succeeds the file exists
      throw new Error(`File already exists: ${destPath}`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Re-throw our own error or unexpected fs errors
        throw err;
      }
      // ENOENT means file doesn't exist — good, continue
    }
  }

  const created = [];

  for (const entry of plan) {
    const srcPath = path.join(TEMPLATES_DIR, entry.tmpl);
    const destPath = path.join(dest, entry.dest);

    // Ensure subdirectory exists
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    if (entry.isTemplate) {
      const raw = await fs.readFile(srcPath, 'utf8');
      const content = applyPlaceholders(raw, values);
      await fs.writeFile(destPath, content, 'utf8');
    } else {
      const raw = await fs.readFile(srcPath);
      await fs.writeFile(destPath, raw);
    }

    log(`  created ${entry.dest}`);
    created.push(entry.dest);
  }

  const nojekyllPath = path.join(dest, '.nojekyll');
  try {
    await fs.access(nojekyllPath);
  } catch {
    await fs.writeFile(nojekyllPath, '');
    log('  created .nojekyll');
    created.push('.nojekyll');
  }

  // The campaign settings go into the vault file. A vault that is not there yet, or a vault
  // file the editor refuses, never stops the scaffold: the site is written and the caller
  // is told which settings to add.
  const vaultDir = path.resolve(dest, values.VAULT_PATH);
  const vaultSettings = seedVaultSettings(vaultDir, defaultCampaignSettings(siteTitle, options.tagline, path.resolve(dest)), { turnSiteOn: true });
  if (vaultSettings.written.length) {
    const which = options.vaultPath ? '' : ' (the default vaultPath, ./vault)';
    log(`  wrote ${vaultSettings.written.map((n) => nameIn(vaultDir, n)).join(', ')} to ${fileLabel(vaultDir)} in ${vaultDir}${which}`);
  }
  if (vaultSettings.skipped) {
    const keys = Object.keys(vaultSettings.missing).map((n) => nameIn(vaultDir, n)).join(', ');
    const where = vaultSettings.missing[FOLDER] ? ` (${nameIn(vaultDir, FOLDER)}: ${vaultSettings.missing[FOLDER]})` : '';
    console.warn(`Campaign settings were not written: ${vaultSettings.skipped}. Add these to ${fileLabel(vaultDir)}: ${keys}${where}.`);
  }
  if (vaultSettings.otherSite) {
    console.warn(`The vault already names a different site (${nameIn(vaultDir, FOLDER)}: ${vaultSettings.otherSite}); it was left as it is. Change it by hand if this is now the campaign's site.`);
  }

  return { success: true, files: created, vaultSettings };
}

module.exports = { init, seedVaultSettings };
