const fs = require('fs');
const path = require('path');

// Plugin-cache version folders are plain `x.y.z`. Anchor both ends so a stray name
// like `1.7.9-old` or `01.7.0` is not mistaken for a real version (which could drive a
// spurious or misdirected drift warning).
function parseSemver(s) {
  // Strict x.y.z: anchored, no leading zeros, no pre-release/suffix — matches the clean
  // version folders the plugin cache uses, and rejects stray names like `1.7.9-old`.
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(s));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Detect whether the build tool being run is an older version than the newest one
 * installed in the plugin cache.
 *
 * The plugin cache lays each installed version out as:
 *   ~/.claude/plugins/cache/gm-apprentice/gm-apprentice/<version>/tools/publish/...
 *
 * A site repo pins its `gm-apprentice-publish` dependency to one specific `<version>`
 * path. A bare `/plugin` update drops a new `<version>/` alongside the old one but never
 * touches the site's pin, so builds keep silently using the OLD renderer. This walks up
 * from the running tool's directory to find its own `<version>`, lists the sibling
 * versions, and reports drift if a newer one exists.
 *
 * @param {string} [fromDir] Directory to resolve from. Defaults to this file's directory
 *   (i.e. `<version>/tools/publish/lib`). Injectable for testing.
 * @returns {{pinned:string,latest:string,drift:boolean,message:string,
 *   suggestedPath:string|null,versionsRoot:string}|null}
 *   null when not running from a versioned plugin-cache layout (e.g. a dev checkout).
 */
function detectVersionDrift(fromDir = __dirname) {
  // fromDir = <version>/tools/publish/lib  →  versionDir = <version>
  const versionDir = path.resolve(fromDir, '..', '..', '..');
  const pinned = path.basename(versionDir);
  if (!parseSemver(pinned)) return null; // not a versioned cache layout — stay silent

  const versionsRoot = path.dirname(versionDir);
  let entries;
  try {
    entries = fs.readdirSync(versionsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  // Only real directories count as installed versions — a symlink (e.g. a dangling
  // `latest` alias) must not be selected and turned into a suggested `file:` path.
  const versions = entries
    .filter((e) => e.isDirectory() && parseSemver(e.name))
    .map((e) => e.name);
  if (versions.length === 0) return null;

  let latest = versions[0];
  for (const v of versions) {
    if (cmpSemver(parseSemver(v), parseSemver(latest)) > 0) latest = v;
  }

  const drift = cmpSemver(parseSemver(pinned), parseSemver(latest)) < 0;
  const suggestedPath = drift ? path.join(versionsRoot, latest, 'tools', 'publish') : null;

  let message;
  if (drift) {
    message =
      `⚠️  gm-apprentice-publish version drift detected.\n` +
      `   You are building with ${pinned}, but ${latest} is installed.\n` +
      `   Your site is still using the OLD renderer — new templates and fixes\n` +
      `   from ${latest} will NOT appear until you repoint the build tool.\n\n` +
      `   To fix, set this in your site's package.json:\n` +
      `       "gm-apprentice-publish": "file:${suggestedPath}"\n` +
      `   then run:  npm install\n\n` +
      `   Or just ask the publish-site skill to "update my site" and it will repoint for you.`;
  } else {
    message = `gm-apprentice-publish ${pinned} is current.`;
  }

  return { pinned, latest, drift, message, suggestedPath, versionsRoot };
}

module.exports = { detectVersionDrift, parseSemver, cmpSemver };
