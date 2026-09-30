'use strict';

// Which gm-apprentice-publish a site builds with, and whether that tool withholds a
// paired session index's body (#276, publish tool 1.11.40). `manifest publish-played`
// must not tick a hub for a site whose renderer would publish its body in full.
//
// The rules are mirrored in skills/shared/scripts/vault_check.py (site_pin), and both
// are held to the same test vectors (test/fixtures/site-pin-vectors.json):
//   1. A usable installed tool (<site>/node_modules/gm-apprentice-publish/package.json)
//      answers. One whose package.json is there but has no strict semver version is
//      stale: it can't be told apart from an old one.
//   2. Nothing installed (missing, or a dangling symlink): the site's package.json
//      dependency on the tool (dependencies, then devDependencies) answers, since the
//      next `npm install` installs exactly that. A plugin-cache pin gives its version
//      directory, a vendored tarball its filename, a semver spec the least version it
//      allows. Any spec whose least version can't be read for sure is stale.
//   3. No dependency on the tool at all: the site is built by whichever tool runs, so
//      there is nothing to gate on (source 'none').
// Prereleases compare strictly: 1.11.40-rc.1 is below 1.11.40.
const fs = require('fs');
const path = require('path');
const { pinnedVersionOf } = require('./update-pin');

const PKG = 'gm-apprentice-publish';
const WITHHOLDS_HUB_BODIES_SINCE = '1.11.40';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(text) {
  const m = SEMVER.exec(String(text == null ? '' : text));
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

// Semver precedence: core numbers, then a prerelease sorts below its release, then
// prerelease identifiers left to right (numeric below alphanumeric). Build metadata is
// ignored. Both must be valid semver; an invalid one throws.
function semverBelow(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`not a semver version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i];
  }
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length > 0 && pb.pre.length === 0;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return true;
    if (y === undefined) return false;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y);
    if (nx !== ny) return nx;
    return x < y;
  }
  return false;
}

// The least version a package.json spec for the tool can install, or null when that
// can't be read for sure.
function specVersion(spec) {
  const s = String(spec).trim();
  if (s.startsWith('file:')) {
    const target = s.slice('file:'.length);
    const cached = pinnedVersionOf(target);
    if (cached) return cached;
    const tarball = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/.exec(target.replace(/\\/g, '/'));
    return tarball && parseSemver(tarball[1]) ? tarball[1] : null;
  }
  const range = /^(?:\^|~|>=|=)?\s*v?(\S+)$/.exec(s);
  return range && parseSemver(range[1]) ? range[1] : null;
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { missing: true };
    return { error: err.code || err.message };
  }
  try {
    return { data: JSON.parse(text) };
  } catch (err) {
    return { error: 'invalid JSON' };
  }
}

// { source: 'installed' | 'package.json' | 'none', version, stale } where `stale` is
// the reason the site would publish hub bodies in full (or can't be shown not to), or
// null. `version` is the version read, or null.
function sitePin(siteDir) {
  const installed = readJson(path.join(siteDir, 'node_modules', PKG, 'package.json'));
  if (!installed.missing) {
    const version = installed.data && typeof installed.data.version === 'string' ? installed.data.version : null;
    if (!version || !parseSemver(version)) {
      return { source: 'installed', version: null, stale: `the site's installed ${PKG} has no readable version; update the pin before publishing sessions` };
    }
    return { source: 'installed', version, stale: staleReason(version) };
  }
  const pkg = readJson(path.join(siteDir, 'package.json'));
  if (pkg.missing) return { source: 'none', version: null, stale: null };
  if (!pkg.data) {
    return { source: 'package.json', version: null, stale: `the site's package.json can't be read (${pkg.error}); update the pin before publishing sessions` };
  }
  const data = pkg.data || {};
  const spec = ((data.dependencies || {})[PKG]) || ((data.devDependencies || {})[PKG]);
  if (!spec) return { source: 'none', version: null, stale: null };
  const version = specVersion(spec);
  if (!version) {
    return { source: 'package.json', version: null, stale: `the site pins ${PKG} as "${spec}", which isn't a version this can check; update the pin before publishing sessions` };
  }
  return { source: 'package.json', version, stale: staleReason(version) };
}

function staleReason(version) {
  return semverBelow(version, WITHHOLDS_HUB_BODIES_SINCE)
    ? `site is pinned to ${version}; update the pin before publishing sessions`
    : null;
}

module.exports = { sitePin, semverBelow, parseSemver, specVersion, WITHHOLDS_HUB_BODIES_SINCE, PKG };
