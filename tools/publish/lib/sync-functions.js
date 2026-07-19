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

  for (const rel of listFilesRelative(sourceDir)) {
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

module.exports = { syncScaffoldFunctions, SCAFFOLD_FUNCTIONS_DIR };
