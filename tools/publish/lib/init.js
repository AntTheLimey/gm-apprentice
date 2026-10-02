const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { parseNote } = require('./frontmatter');
const { setPublishKeys, fillUnset } = require('./vault-config-edit');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates-scaffold');

const DEFAULTS = {
  SITE_TITLE: 'My Campaign',
  SITE_URL: 'https://example.github.io/my-campaign',
  VAULT_PATH: './vault',
};

// The campaign settings a new site starts with. They live in the vault file
// (_meta/vault-config.md, under publish:), not in the site's vault.config.json.
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

function defaultCampaignSettings(siteTitle, tagline) {
  return {
    site_title: siteTitle,
    folder_map: DEFAULT_FOLDER_MAP,
    attachments_dir: '_attachments',
    exclude_dirs: ['_meta', '_Templates', '_resources'],
    exclude_callouts: true,
    ...(tagline ? { theme: { tagline } } : {}),
  };
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Write the starting campaign settings into the vault file, for keys it does not
 * already set. Never creates the vault directory and never writes into a vault file
 * the editor refuses. Returns what happened so the caller can tell the user.
 * @returns {{ written: string[], kept: string[], skipped: string|null, missing: Record<string, unknown> }}
 */
function seedVaultSettings(vaultDir, settings) {
  const none = (skipped, missing) => ({ written: [], kept: [], skipped, missing });
  if (!fsSync.existsSync(vaultDir) || !fsSync.statSync(vaultDir).isDirectory()) {
    return none(`the vault folder ${vaultDir} does not exist yet`, settings);
  }
  const file = path.join(vaultDir, '_meta', 'vault-config.md');
  let publish = {};
  if (fsSync.existsSync(file)) {
    try {
      publish = parseNote(fsSync.readFileSync(file, 'utf8')).data.publish ?? {};
    } catch (e) {
      return none(`_meta/vault-config.md does not parse: ${String(e.message).split('\n')[0].trim()}`, settings);
    }
    if (publish === null || typeof publish !== 'object' || Array.isArray(publish)) {
      return none('publish: in _meta/vault-config.md is not a map', settings);
    }
  }
  const set = {};
  const kept = [];
  for (const [key, value] of Object.entries(settings)) {
    if (publish[key] === undefined) { set[key] = value; continue; }
    // `theme` holds other keys the GM may have set: add the seeded ones beside them, only
    // where the vault file leaves them unset. (The theme block is re-written, so comments
    // inside it are not kept, as with migrate-config.)
    if (key === 'theme' && isMap(value) && isMap(publish.theme)) {
      const filled = fillUnset(publish.theme, value);
      if (filled) { set.theme = filled; continue; }
    }
    kept.push(key);
  }
  if (!Object.keys(set).length) return { written: [], kept, skipped: null, missing: {} };
  try {
    setPublishKeys(vaultDir, set);
  } catch (e) {
    return { written: [], kept, skipped: e.message, missing: set };
  }
  return { written: Object.keys(set), kept, skipped: null, missing: {} };
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
  const vaultSettings = seedVaultSettings(vaultDir, defaultCampaignSettings(siteTitle, options.tagline));
  if (vaultSettings.written.length) {
    const which = options.vaultPath ? '' : ' (the default vaultPath, ./vault)';
    log(`  wrote ${vaultSettings.written.join(', ')} to ${path.join(vaultDir, '_meta', 'vault-config.md')}${which}`);
  }
  if (vaultSettings.skipped) {
    const keys = Object.keys(vaultSettings.missing).join(', ');
    console.warn(`Campaign settings were not written: ${vaultSettings.skipped}. Add these under publish: in _meta/vault-config.md: ${keys}.`);
  }

  return { success: true, files: created, vaultSettings };
}

module.exports = { init };
