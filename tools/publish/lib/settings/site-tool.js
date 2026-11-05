'use strict';
// The site folder's own publish tool and the site folder a vault names: how old the tool that builds a site is (asked
// of `update-pin --check --json` and of the tool installed there), and where the vault's settings say its site is.
const fs = require('node:fs');
const path = require('node:path');
const { getPath } = require('./types');
const { siteToolVersion, layoutOf } = require('./layout');
const read = require('./read');

// What `update-pin --check --json` says of the site folder: { ok, ours, spec, installedBefore }, or null when it says
// nothing usable. The same code the update uses; asked by running the command, so there is one rule.
// A host that embeds the move answers this itself by passing `deps.pinCheck` (the caller), and then no
// program is started: child_process is loaded here, on first use, not when the module loads (#535). In a packaged
// host process.execPath is the host, not node, so a host should always pass its own.
function pinCheck(siteDir) {
  const { spawnSync } = require('node:child_process');
  const bin = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
  const run = spawnSync(process.execPath, [bin, 'update-pin', '--check', '--json', '--site', siteDir], { encoding: 'utf8' });
  try {
    const said = JSON.parse(run.stdout);
    return said && typeof said === 'object' ? said : null;
  } catch {
    return null;
  }
}

// The numbers of a version in a text ("1.22.0", "^1.20.0", ">=1.4.2 <2"), or null.
const versionIn = (text) => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const atLeast = (have, want) => {
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
};

// null when the site's tool is at least `from` (or the caller is bringing it up to date and the plugin owns the pin),
// else { shown, ours }: the version or pin the GM would be told, and whether the plugin owns it. `pin` is the
// update-pin answer. A site with no tool pinned or installed is built by the plugin's own, so it is never old.
function oldTool(pin, from, updated) {
  if (!pin || (!pin.spec && !pin.installedBefore)) return null;
  // (A plugin path's number is the plugin's, not the tool's, so only a pin that is not ours is read for one.)
  // A spec is read by the build's own rule (site-pin.js), not by the first three numbers in its text: an address
  // such as http://10.0.0.1/x.tgz is no version.
  const fromSpec = pin.ours ? null : versionIn(require('../site-pin').specVersion(pin.spec || ''));
  const installed = versionIn(pin.installedBefore) || fromSpec;
  if (installed && atLeast(installed, versionIn(from))) return null;
  if (pin.ours && updated) return null;
  return { shown: pin.installedBefore || pin.spec, ours: !!pin.ours };
}

// Whether the tool that builds a site folder is older than `from`: { shown, ours } or null. The same reading of the pin
// and of the installed tool as siteToolHold; the caller words the answer.
function siteToolOlderThan(siteDir, from, { updated = false, pinCheck: ask = pinCheck } = {}) {
  const pin = { ...(ask(siteDir) || {}) };
  const installed = siteToolVersion(siteDir);
  if (installed) {
    pin.installedBefore = installed;
    if (!pin.spec) pin.ours = false;
  }
  return oldTool(pin, from, updated);
}

// The site folder a vault's own settings name (player_site.folder), and its vault.config.json: { dir, file, exists }.
// null when the vault has no settings file, names no folder, or its settings cannot be read. The one place that says it.
function siteFileNamedBy(vault) {
  if (layoutOf(vault) !== 'new') return null;
  let raw;
  try {
    raw = getPath(read.readSettings({ vaultPath: vault, siteConfig: {} }).values, ['player_site', 'folder']);
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const dir = require('../lines-cli').siteDirPath(vault, raw);
  const file = path.join(dir, 'vault.config.json');
  return { dir, file, exists: fs.existsSync(file) };
}

module.exports = { pinCheck, oldTool, siteToolOlderThan, siteFileNamedBy };
