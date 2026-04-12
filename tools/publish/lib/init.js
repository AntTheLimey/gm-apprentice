const fs = require('fs').promises;
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates-scaffold');

const DEFAULTS = {
  SITE_TITLE: 'My Campaign',
  SITE_URL: 'https://example.github.io/my-campaign',
};

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
 * @returns {Promise<{ success: true, files: string[] }>}
 */
async function init(targetDir = '.', options = {}) {
  const verbose = options.verbose === true;
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
    { dest: 'package.json',         tmpl: 'package.json.tmpl',        isTemplate: true  },
    { dest: 'vault.config.json',    tmpl: 'vault.config.json.tmpl',   isTemplate: true  },
    { dest: 'README.md',            tmpl: 'README.md.tmpl',           isTemplate: true  },
    { dest: 'css/overrides.css',    tmpl: 'css/overrides.css',        isTemplate: false },
    { dest: '.gitignore',           tmpl: '.gitignore',               isTemplate: false },
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
      const content = applyPlaceholders(raw, DEFAULTS);
      await fs.writeFile(destPath, content, 'utf8');
    } else {
      const raw = await fs.readFile(srcPath);
      await fs.writeFile(destPath, raw);
    }

    log(`  created ${entry.dest}`);
    created.push(entry.dest);
  }

  // Create empty .nojekyll for GitHub Pages
  const nojekyllPath = path.join(dest, '.nojekyll');
  await fs.writeFile(nojekyllPath, '');
  log('  created .nojekyll');
  created.push('.nojekyll');

  return { success: true, files: created };
}

module.exports = { init };
