'use strict';

// `update-pin` command: repoint a site's `gm-apprentice-publish` dependency at the
// newest version in the plugin cache, and install it. With `--tag publish-vX.Y.Z`
// it pins to a GitHub release tarball instead (see runUpdatePinTag).
//
// A `/plugin update` drops a new `<version>/` next to the old one and never touches
// the site's package.json, so the site keeps building with the OLD renderer while
// the plugin reports itself up to date. Doing this by hand means reading a cache
// path out of a warning, editing JSON, and remembering the `npm install` — three
// steps, each of which has been got wrong. This is the routine first half of a
// rebuild: `update-pin`, then `deploy --verify`.
//
// Every side effect is behind an injectable dep, so the runner is unit-testable with
// no cache, no site and no npm.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEP = 'gm-apprentice-publish';

// The `<semver>` segment of a `file:…/<semver>/tools/publish` spec, or null for any
// other shape. Windows specs arrive with backslashes; compare on posix.
function pinnedVersionOf(spec) {
  const posix = String(spec).replace(/\\/g, '/').replace(/\/+$/, '');
  const m = /\/(\d+\.\d+\.\d+)\/tools\/publish$/.exec(posix);
  return m ? m[1] : null;
}

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

// The last few lines of npm's complaint. The whole log is noise; the tail is the
// part that names the actual failure.
function tail(text, lines = 6) {
  return String(text || '').trimEnd().split('\n').slice(-lines).join('\n');
}

const RELEASE_BASE = 'https://github.com/AntTheLimey/gm-apprentice/releases/download';
const TAG_RE = /^publish-v(\d+\.\d+\.\d+)$/;
const FETCH_TIMEOUT_MS = 30000;

// The hex digest SHA256SUMS records for `name`, or null. Lines are
// `<64 hex>  <name>` (text mode) or `<64 hex> *<name>` (binary mode).
function checksumFor(sums, name) {
  for (const line of String(sums).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

async function download(fetchFn, url) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// `update-pin --tag publish-vX.Y.Z`: pin the site to a tagged release tarball
// instead of a plugin-cache path, for sites that live outside the plugin. The
// tarball is downloaded, checked against the release's SHA256SUMS, vendored into
// the site under vendor/, and referenced by a file: dependency. A checksum
// mismatch aborts before anything is written.
async function runUpdatePinTag(opts, d) {
  const out = d.out || console.log;
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = d.writeFile || ((p, c) => fs.writeFileSync(p, c));
  const mkdirp = d.mkdirp || ((p) => fs.mkdirSync(p, { recursive: true }));
  const unlink = d.unlink || ((p) => { try { fs.unlinkSync(p); } catch { /* already gone */ } });
  const fetchFn = d.fetch || globalThis.fetch;
  const runCommand = d.runCommand || require('./run-command').runCommand;
  const siteDir = path.resolve(opts.siteDir || '.');
  const asJson = !!opts.json;
  const say = (line) => { if (!asJson) out(line); };

  const m = TAG_RE.exec(String(opts.tag));
  const desired = m ? m[1] : null;
  if (m) recordSiteDir(siteDir, opts, d);
  const result = (fields, rc) => {
    const payload = Object.assign({
      tag: opts.tag, pinnedBefore: null, pinnedAfter: null, installedBefore: null,
      installedAfter: null, desired, changed: false, ok: rc === 0,
    }, fields);
    if (asJson) out(JSON.stringify(payload, null, 2));
    return rc;
  };
  if (!m) {
    say(`--tag must look like publish-vX.Y.Z (got "${opts.tag}").`);
    return result({}, 1);
  }

  const sitePkgPath = path.join(siteDir, 'package.json');
  let sitePkg;
  try {
    sitePkg = JSON.parse(readFile(sitePkgPath));
  } catch (err) {
    say(`Could not read ${sitePkgPath} — no package.json there, or it is not valid JSON (${err.message}).`);
    say('Point --site at the directory holding your vault.config.json.');
    return result({}, 1);
  }
  const dependencies = sitePkg.dependencies || {};
  const before = dependencies[DEP] ? String(dependencies[DEP]) : null;
  const tarName = `${DEP}-${desired}.tgz`;
  const newSpec = `file:vendor/${tarName}`;
  const installedOf = () => {
    try {
      return JSON.parse(readFile(path.join(siteDir, 'node_modules', DEP, 'package.json'))).version || null;
    } catch {
      return null;
    }
  };
  const installedBefore = installedOf();
  const pinnedBefore = before && /-(\d+\.\d+\.\d+)\.tgz$/.exec(before.replace(/\\/g, '/'));
  const pinnedVersion = pinnedBefore ? pinnedBefore[1] : null;

  if (before === newSpec && installedBefore === desired) {
    say(`${DEP} ${desired} is current`);
    return result({ pinnedBefore: pinnedVersion, pinnedAfter: desired, installedBefore, installedAfter: installedBefore }, 0);
  }
  if (opts.check) {
    say(`${DEP} is not pinned to ${opts.tag}.`);
    say(`  pinned:    ${before || 'none'}`);
    say(`  installed: ${installedBefore || 'none'}`);
    return result({ pinnedBefore: pinnedVersion, installedBefore, installedAfter: installedBefore }, 1);
  }

  let tgz;
  try {
    const sumsBuf = await download(fetchFn, `${RELEASE_BASE}/${opts.tag}/SHA256SUMS`);
    const sums = sumsBuf.toString('utf8');
    const expected = checksumFor(sums, tarName);
    if (!expected) throw new Error(`SHA256SUMS in ${opts.tag} has no entry for ${tarName}`);
    tgz = await download(fetchFn, `${RELEASE_BASE}/${opts.tag}/${tarName}`);
    const actual = crypto.createHash('sha256').update(tgz).digest('hex');
    if (actual !== expected) {
      say(`CHECKSUM MISMATCH for ${tarName}: SHA256SUMS says ${expected}, the download is ${actual}.`);
      say('Refusing to pin. Nothing was written. Try again; if it persists, do not use this release.');
      return result({ pinnedBefore: pinnedVersion, installedBefore, installedAfter: installedBefore, error: 'checksum mismatch' }, 1);
    }
    const vendorDir = path.join(siteDir, 'vendor');
    mkdirp(vendorDir);
    writeFile(path.join(vendorDir, tarName), tgz);
    writeFile(path.join(vendorDir, `${tarName}.SHA256SUMS`), `${expected}  ${tarName}\n`);
  } catch (err) {
    say(`Could not fetch ${opts.tag}: ${err.message}`);
    return result({ pinnedBefore: pinnedVersion, installedBefore, installedAfter: installedBefore, error: err.message }, 1);
  }

  sitePkg.dependencies = Object.assign({}, dependencies, { [DEP]: newSpec });
  writeFile(sitePkgPath, JSON.stringify(sitePkg, null, 2) + '\n');
  // Drop the tarball an earlier --tag pin vendored, so vendor/ holds only the live one.
  const oldName = before && /^file:vendor\/(gm-apprentice-publish-\d+\.\d+\.\d+\.tgz)$/.exec(before.replace(/\\/g, '/'));
  if (oldName && oldName[1] !== tarName) {
    unlink(path.join(siteDir, 'vendor', oldName[1]));
    unlink(path.join(siteDir, 'vendor', `${oldName[1]}.SHA256SUMS`));
  }

  const install = runCommand('npm', ['install'], { cwd: siteDir });
  const installedAfter = installedOf();
  const ok = installedAfter === desired;
  if (ok) {
    say(`Updated ${DEP} from ${installedBefore || 'none'} to ${installedAfter} (${opts.tag}, checksum verified)`);
  } else {
    say(`Pinned ${sitePkgPath} to ${opts.tag}, but npm install left ${installedAfter || 'nothing'} in node_modules.`);
    const detail = tail(install.stderr) || tail(install.stdout);
    if (detail) say(detail);
    say(`Run \`npm install\` in ${siteDir} by hand to see the whole log.`);
  }
  return result({ pinnedBefore: pinnedVersion, pinnedAfter: desired, installedBefore, installedAfter, changed: true }, ok ? 0 : 1);
}

// A site made before `init` wrote it has no `publish.site_dir` in its vault, so the
// vault cannot find the site and vault_check takes it to have none. Any update-pin run
// puts that right: it is the command a GM with an older site is told to run. It adds to
// a vault file that is already there and never creates one, never changes a site_dir
// that is set, and never stops the repoint. What it could not do, it says.
function recordSiteDir(siteDir, opts, d) {
  if (opts.check) return null;
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const seed = d.seedVaultSettings || require('./init').seedVaultSettings;
  const say = (line) => { if (!opts.json) (d.out || console.log)(line); };
  const here = toPosix(siteDir);
  let vaultPath;
  try {
    // A folder with no package.json is not a site this command can repoint.
    readFile(path.join(siteDir, 'package.json'));
    vaultPath = JSON.parse(readFile(path.join(siteDir, 'vault.config.json'))).vaultPath;
  } catch { return null; }
  if (typeof vaultPath !== 'string' || vaultPath === '') return null;
  let result;
  try {
    result = seed(path.resolve(siteDir, vaultPath), { site_dir: here }, { existingOnly: true });
  } catch (err) {
    result = { written: [], kept: [], skipped: err.message, missing: {} };
  }
  if (result.written.length) say(`recorded this site in the vault: publish.site_dir = ${here}`);
  else if (result.skipped) say(`could not record this site in the vault (${result.skipped}). Add \`site_dir: ${here}\` under publish: in _meta/vault-config.md.`);
  else if (result.otherSite) say(`the vault already names a different site (publish.site_dir: ${result.otherSite}); it was left as it is.`);
  return result;
}

async function runUpdatePin(options, deps) {
  const opts = options || {};
  const d = deps || {};
  // Any --tag at all, even an empty one, is a tag pin: `--tag ""` falling through to a
  // plugin-cache repoint would silently do the opposite of what was asked.
  if (opts.tag !== undefined && opts.tag !== null && opts.tag !== false) return runUpdatePinTag(opts, d);
  const out = d.out || console.log;
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = d.writeFile || ((p, c) => fs.writeFileSync(p, c));
  const runCommand = d.runCommand || require('./run-command').runCommand;
  const detect = d.detect || require('./version-check').detectVersionDrift;
  const toolDir = d.toolDir || path.join(__dirname, '..');
  const siteDir = path.resolve(opts.siteDir || '.');
  const asJson = !!opts.json;
  recordSiteDir(siteDir, opts, d);

  const report = (payload, rc) => {
    if (asJson) out(JSON.stringify(payload, null, 2));
    return rc;
  };

  const cache = detect();
  if (!cache) {
    // A dev checkout, or a tool copied out of the cache. There is no "newest
    // installed version" to point at, so there is nothing this command can do.
    let version = 'unknown';
    try { version = JSON.parse(readFile(path.join(toolDir, 'package.json'))).version; } catch { /* keep 'unknown' */ }
    if (!asJson) out(`not in a versioned plugin cache — the running tool is ${version}; nothing to repoint`);
    return report({
      pinnedBefore: null, pinnedAfter: null, installedBefore: null, installedAfter: null,
      desired: version, changed: false, ok: true,
    }, 0);
  }
  const desired = cache.latest;

  const sitePkgPath = path.join(siteDir, 'package.json');
  let sitePkg;
  try {
    sitePkg = JSON.parse(readFile(sitePkgPath));
  } catch (err) {
    if (!asJson) {
      out(`Could not read ${sitePkgPath} — no package.json there, or it is not valid JSON (${err.message}).`);
      out('Point --site at the directory holding your vault.config.json.');
    }
    return report({
      pinnedBefore: null, pinnedAfter: null, installedBefore: null, installedAfter: null,
      desired, changed: false, ok: false,
    }, 1);
  }

  const dependencies = sitePkg.dependencies || {};
  const spec = dependencies[DEP];
  if (!spec) {
    if (!asJson) out(`${sitePkgPath} has no ${DEP} dependency — nothing to repoint.`);
    return report({
      pinnedBefore: null, pinnedAfter: null, installedBefore: null, installedAfter: null,
      desired, changed: false, ok: true,
    }, 0);
  }
  if (!String(spec).startsWith('file:')) {
    // A registry or git spec is somebody's deliberate choice; rewriting it to a
    // local cache path would break their install on the next `npm ci`.
    if (!asJson) out(`pinned to ${spec}, not a plugin-cache path — leave it alone`);
    return report({
      pinnedBefore: null, pinnedAfter: null, installedBefore: null, installedAfter: null,
      desired, changed: false, ok: true,
    }, 0);
  }

  const pinnedBefore = pinnedVersionOf(String(spec).slice('file:'.length));

  const readInstalled = () => {
    try {
      return JSON.parse(readFile(path.join(siteDir, 'node_modules', DEP, 'package.json'))).version || null;
    } catch {
      return null;
    }
  };
  const installedBefore = readInstalled();

  // suggestedPath is null whenever detectVersionDrift saw no drift — which happens
  // routinely here, because the tool being run is usually already the newest one and
  // it is the SITE that is stale. Build the path from versionsRoot in that case.
  const targetPath = cache.suggestedPath
    || toPosix(path.join(cache.versionsRoot, desired, 'tools', 'publish'));
  // `desired` is the PLUGIN's version (the cache folder's name). The package that folder
  // holds has its own version, and that is what lands in node_modules: plugin 1.10.19
  // holds tool 1.11.41. Comparing the two called every successful install a failure.
  let desiredTool = desired;
  try { desiredTool = JSON.parse(readFile(path.join(targetPath, 'package.json'))).version || desired; } catch { /* keep the folder's number */ }

  if (pinnedBefore === desired && installedBefore === desiredTool) {
    if (!asJson) out(`${DEP} ${desiredTool} is current (plugin ${desired})`);
    return report({
      pinnedBefore, pinnedAfter: pinnedBefore, installedBefore, installedAfter: installedBefore,
      desired, changed: false, ok: true,
    }, 0);
  }

  if (opts.check) {
    if (!asJson) {
      out(`${DEP} is out of date — the site would build with the old renderer.`);
      out(`  pinned:    ${pinnedBefore || '(unrecognised path)'}`);
      out(`  installed: ${installedBefore || 'none'}`);
      out(`  desired:   ${desiredTool} (plugin ${desired})`);
      out('Run `gm-publish update-pin` to repoint it.');
    }
    return report({
      pinnedBefore, pinnedAfter: pinnedBefore, installedBefore, installedAfter: installedBefore,
      desired, changed: false, ok: false,
    }, 1);
  }

  sitePkg.dependencies = Object.assign({}, dependencies, { [DEP]: `file:${targetPath}` });
  writeFile(sitePkgPath, JSON.stringify(sitePkg, null, 2) + '\n');

  const install = runCommand('npm', ['install'], { cwd: siteDir });
  const installedAfter = readInstalled();
  const ok = installedAfter === desiredTool;

  if (!asJson) {
    if (ok) {
      out(`Updated ${DEP} from ${installedBefore || 'none'} to ${installedAfter}`);
    } else {
      out(`Repointed ${sitePkgPath} to plugin ${desired} (tool ${desiredTool}), but npm install left ${installedAfter || 'nothing'} in node_modules.`);
      const detail = tail(install.stderr) || tail(install.stdout);
      if (detail) out(detail);
      out(`Run \`npm install\` in ${siteDir} by hand to see the whole log.`);
    }
  }
  return report({
    pinnedBefore, pinnedAfter: desired, installedBefore, installedAfter,
    desired, changed: true, ok,
  }, ok ? 0 : 1);
}

module.exports = { runUpdatePin, pinnedVersionOf, checksumFor };
