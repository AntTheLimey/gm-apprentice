'use strict';

// `update-pin` command: repoint a site's `gm-apprentice-publish` dependency at the
// newest version in the plugin cache, and install it.
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

async function runUpdatePin(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const out = d.out || console.log;
  const readFile = d.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = d.writeFile || ((p, c) => fs.writeFileSync(p, c));
  const runCommand = d.runCommand || require('./run-command').runCommand;
  const detect = d.detect || require('./version-check').detectVersionDrift;
  const toolDir = d.toolDir || path.join(__dirname, '..');
  const siteDir = path.resolve(opts.siteDir || '.');
  const asJson = !!opts.json;

  const report = (payload, rc) => {
    if (asJson) out(JSON.stringify(payload, null, 2));
    return rc;
  };

  const cache = detect();
  if (!cache) {
    // A dev checkout, or a tool copied out of the cache. There is no "newest
    // installed version" to point at, so there is nothing this command can do.
    const version = (d.toolPackage || require(path.join(toolDir, 'package.json'))).version;
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
    out(`Could not read ${sitePkgPath} — no package.json there, or it is not valid JSON (${err.message}).`);
    out('Point --site at the directory holding your vault.config.json.');
    return 1;
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

  if (pinnedBefore === desired && installedBefore === desired) {
    if (!asJson) out(`${DEP} ${desired} is current`);
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
      out(`  desired:   ${desired}`);
      out('Run `gm-publish update-pin` to repoint it.');
    }
    return report({
      pinnedBefore, pinnedAfter: pinnedBefore, installedBefore, installedAfter: installedBefore,
      desired, changed: false, ok: false,
    }, 1);
  }

  // suggestedPath is null whenever detectVersionDrift saw no drift — which happens
  // routinely here, because the tool being run is usually already the newest one and
  // it is the SITE that is stale. Build the path from versionsRoot in that case.
  const targetPath = cache.suggestedPath
    || toPosix(path.join(cache.versionsRoot, desired, 'tools', 'publish'));
  sitePkg.dependencies = Object.assign({}, dependencies, { [DEP]: `file:${targetPath}` });
  writeFile(sitePkgPath, JSON.stringify(sitePkg, null, 2) + '\n');

  const install = runCommand('npm', ['install'], { cwd: siteDir });
  const installedAfter = readInstalled();
  const ok = installedAfter === desired;

  if (!asJson) {
    if (ok) {
      out(`Updated ${DEP} from ${installedBefore || 'none'} to ${installedAfter}`);
    } else {
      out(`Repointed ${sitePkgPath} to ${desired}, but npm install left ${installedAfter || 'nothing'} in node_modules.`);
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

module.exports = { runUpdatePin, pinnedVersionOf };
