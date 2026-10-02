const fs = require('fs');
const path = require('path');

const SCAFFOLD_FUNCTIONS_DIR = path.join(__dirname, '..', 'templates-scaffold', 'functions');

/**
 * List every file under `dir`, recursively, as paths relative to `dir`
 * (forward-slashed so comparisons are stable across platforms).
 */
function listFilesRelative(dir) {
  const out = [];
  function walk(current, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // directory absent — nothing to list
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(dir, '');
  return out;
}

// Which feature each function file belongs to, in one place. The roots are the routes a
// feature serves; every file a root imports (followed through `from './x'`) belongs to it
// too, and a file no root reaches (the api/package.json both need) belongs to every feature.
const FEATURE_ROOTS = {
  liveStats: ['api/loadout.js', 'api/loadout-list.js'],
  inbox: ['api/request.js'],
};

// Map: file (relative to functions/) -> Set of the features that need it.
function featuresByFile(sourceDir = SCAFFOLD_FUNCTIONS_DIR) {
  const files = listFilesRelative(sourceDir);
  const reach = (root) => {
    const seen = new Set();
    const visit = (rel) => {
      if (seen.has(rel) || !files.includes(rel)) return;
      seen.add(rel);
      const text = fs.readFileSync(path.join(sourceDir, rel), 'utf8');
      for (const m of text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
        visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
      }
    };
    visit(root);
    return seen;
  };
  const owners = new Map(files.map((f) => [f, new Set()]));
  for (const [feature, roots] of Object.entries(FEATURE_ROOTS)) {
    for (const root of roots) for (const f of reach(root)) owners.get(f).add(feature);
  }
  for (const set of owners.values()) if (!set.size) Object.keys(FEATURE_ROOTS).forEach((f) => set.add(f));
  return owners;
}

// The features that need one scaffold file, given its path relative to functions/ spelled with
// either separator (a Windows caller may hand in `api\\request.js`). Empty set for an unknown file.
function featuresOfFile(rel, sourceDir = SCAFFOLD_FUNCTIONS_DIR) {
  return featuresByFile(sourceDir).get(String(rel).split('\\').join('/')) || new Set();
}

// Files a site with these features on needs: any file one of them needs.
function filesForFeatures(sourceDir, features) {
  const out = new Set();
  for (const [rel, owners] of featuresByFile(sourceDir)) {
    if ([...owners].some((f) => features[f])) out.add(rel);
  }
  return out;
}

/**
 * Sync the plugin's scaffold Cloudflare Pages Functions into an existing site.
 *
 * Functions under `templates-scaffold/functions/` are plugin-owned infrastructure
 * (the inbox and loadout APIs), NOT user-editable content. `init` copies them once
 * when a site is first scaffolded, but Functions added or fixed in a later plugin
 * version never reach older sites — `init` refuses to run over an existing site and
 * a build/repoint never touches `functions/`. The result is silent 404s on new API
 * routes (e.g. `/api/loadout-list` on a site scaffolded before that Function existed).
 *
 * This walks the scaffold Functions tree and copies any file that is missing or whose
 * bytes differ from the current scaffold, overwriting stale copies to match the running
 * plugin version — the same "the site should track the tool" model as the version repoint.
 * A byte comparison means unchanged files are never rewritten, so a clean site produces
 * no churn.
 *
 * @param {string} siteRoot - Site root (the directory that holds `functions/` and
 *   `vault.config.json`).
 * @param {object} [options]
 * @param {string} [options.sourceDir] - Override the scaffold source (for tests).
 * @returns {{ created: string[], updated: string[] }} Paths (relative to `functions/`)
 *   that were written, split by whether they were newly created or overwritten.
 */
function syncScaffoldFunctions(siteRoot, options = {}) {
  const sourceDir = options.sourceDir || SCAFFOLD_FUNCTIONS_DIR;
  const targetDir = path.join(siteRoot, 'functions');

  const created = [];
  const updated = [];

  const wanted = options.features ? filesForFeatures(sourceDir, options.features) : null;
  for (const rel of listFilesRelative(sourceDir)) {
    if (wanted && !wanted.has(rel)) continue;
    const srcPath = path.join(sourceDir, rel);
    const destPath = path.join(targetDir, rel);
    const srcBytes = fs.readFileSync(srcPath);

    let destBytes = null;
    try {
      destBytes = fs.readFileSync(destPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (destBytes === null) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, srcBytes);
      created.push(rel);
    } else if (!srcBytes.equals(destBytes)) {
      fs.writeFileSync(destPath, srcBytes);
      updated.push(rel);
    }
  }

  return { created, updated };
}

// Why a feature is off, for the line printed with a removal.
const OFF_REASON = {
  liveStats: (sw) => (sw.characterSheets === false ? 'publish.character_sheets is off, so live stats are off' : 'publish.live_stats is off'),
  inbox: () => 'publish.inbox is off',
};

// True when `file` (a path under `<site>/functions/`) is a regular file whose parent folders
// are inside the site folder: a symlinked file or folder is never followed out of it.
function isPlainFileInside(siteRoot, file) {
  let st;
  try { st = fs.lstatSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const root = fs.realpathSync(siteRoot);
  const parent = fs.realpathSync(path.dirname(file));
  return parent === root || parent.startsWith(root + path.sep);
}

/**
 * Remove the function files of a feature the GM switched off. Only files the scaffold ships
 * for that feature are looked at, only inside `<site>/functions/`, and only when the bytes
 * equal the scaffold's current file; a file shared with a feature that is not explicitly off
 * stays. Anything else found there is kept and named in a warning.
 *
 * @param {string} siteRoot
 * @param {object} switches - resolveSwitches() output (reads `explicitOff` and `characterSheets`).
 * @param {object} [options] - `sourceDir` (tests), `log`, `warn`.
 * @returns {{ removed: string[], kept: string[] }}
 */
function removeScaffoldFunctions(siteRoot, switches, options = {}) {
  const sourceDir = options.sourceDir || SCAFFOLD_FUNCTIONS_DIR;
  const log = options.log || console.log;
  const warn = options.warn || console.warn;
  const off = (switches && switches.explicitOff) || {};
  const removed = [];
  const kept = [];
  for (const [rel, owners] of featuresByFile(sourceDir)) {
    const owning = [...owners];
    if (!owning.length || !owning.every((f) => off[f])) continue;
    const file = path.join(siteRoot, 'functions', rel);
    if (!fs.existsSync(file) && !isSymlink(file)) continue;
    const reason = owning.map((f) => OFF_REASON[f](switches)).join(' and ');
    if (!isPlainFileInside(siteRoot, file)) {
      warn(`  WARNING: functions/${rel} is not a plain file inside the site folder, so it was not removed although ${reason}. Delete it yourself if you do not want it deployed.`);
      kept.push(rel);
      continue;
    }
    if (!fs.readFileSync(file).equals(fs.readFileSync(path.join(sourceDir, rel)))) {
      warn(`  WARNING: functions/${rel} differs from the file this tool ships, so it was not removed although ${reason}. Delete it yourself if you do not want it deployed.`);
      kept.push(rel);
      continue;
    }
    fs.unlinkSync(file);
    removed.push(rel);
    log(`  removed functions/${rel}: ${reason}`);
  }
  return { removed, kept };
}

function isSymlink(file) {
  try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; }
}

/**
 * The build's function step: copy the files of each feature that is on (and refresh stale
 * ones), then remove those of each feature that is explicitly off. A switch nothing sets
 * copies nothing and removes nothing, so a deployed feature is never changed by an unset one.
 * `build()` itself never calls this; the CLI and the setup commands do.
 *
 * @param {object} args
 * @param {string} args.configPath - the site's vault.config.json
 * @param {object} [args.options] - `sourceDir`, `log`, `warn` (tests)
 */
function syncSiteFunctions({ configPath, options = {} }) {
  const log = options.log || console.log;
  const siteRoot = path.dirname(path.resolve(configPath));
  // Unreadable config throws: nothing is synced, nothing is guessed.
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const vaultPath = path.resolve(siteRoot, rawConfig.vaultPath);
  // The build resolves the same config next and says everything it has to say; this
  // read only needs the switches, so its warnings go nowhere rather than print twice.
  const { publishConfig } = require('./config').resolveConfig(rawConfig, vaultPath, () => {});
  const switches = publishConfig.switches;
  const { created, updated } = syncScaffoldFunctions(siteRoot, {
    sourceDir: options.sourceDir, features: { liveStats: switches.liveStats, inbox: switches.inbox },
  });
  for (const f of created) log(`  synced (new) functions/${f}`);
  for (const f of updated) log(`  synced (updated) functions/${f}`);
  const { removed, kept } = removeScaffoldFunctions(siteRoot, switches, options);
  return { created, updated, removed, kept };
}

// The step as the commands that build run it: a failure is a warning, never a stopped build.
function syncSiteFunctionsOrWarn(configPath, options = {}) {
  try {
    return syncSiteFunctions({ configPath, options });
  } catch (err) {
    (options.warn || console.warn)(`⚠️  Could not sync scaffold Functions: ${err.message}`);
    return null;
  }
}

module.exports = { syncScaffoldFunctions, removeScaffoldFunctions, syncSiteFunctions, syncSiteFunctionsOrWarn, featuresByFile, featuresOfFile, FEATURE_ROOTS, SCAFFOLD_FUNCTIONS_DIR };
