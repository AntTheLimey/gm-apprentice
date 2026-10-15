'use strict';
// The GM site's folder and the rules it keeps. The GM site is built into its own folder, which the build empties first,
// so that folder must be one the GM site owns: never the player site's, never the vault, never a folder of the GM's own files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER_FILE = 'gm-build.json';
// The mark every page of a GM build carries. A GM build that failed before it wrote the marker file leaves pages that
// carry this, so its own folder is still known as its own.
const GM_META = /<meta\s+name=["']gm-apprentice-build["']\s+content=["']gm["']/i;

// The real path of a path that may not exist yet: its nearest existing folder's real path with the rest put back.
// A link in the folder that leads somewhere is compared by where it leads.
function real(p) {
  const tail = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...tail); } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      tail.unshift(path.basename(cur));
      cur = up;
    }
  }
}

// A folder as written: `~/` is the home folder, a relative path is read from `base`.
function resolveGmFolder(folder, base) {
  const text = String(folder).trim();
  if (text === '~') return os.homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2));
  return path.resolve(base || '.', text);
}

// The player site folder with `-gm` added: the GM site's folder when none is named.
function defaultGmFolder(playerFolder) {
  const trimmed = String(playerFolder).replace(/[\\/]+$/, '');
  return `${trimmed}-gm`;
}

const inside = (child, parent) => child.startsWith(parent + path.sep);

// Whether a page under `dir` carries the GM build's meta tag; the first found ends the search.
function hasGmPage(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (hasGmPage(full)) return true;
    } else if (e.isFile() && /\.html?$/i.test(e.name)) {
      try { if (GM_META.test(fs.readFileSync(full, 'utf8'))) return true; } catch { /* unreadable: not a GM page */ }
    }
  }
  return false;
}

// Why a folder is not the GM site's to empty, or null when it is: it is missing, empty, holds the marker
// file, or holds a page the GM build made (so a build that failed part-way does not lock its own folder).
function gmOutputReason(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) {
    if (e.code === 'ENOENT') return null;
    return 'cannot be read as a folder';
  }
  if (entries.length === 0 || entries.includes(MARKER_FILE) || hasGmPage(dir)) return null;
  return 'holds files the GM site did not make';
}

// null when `gmFolder` can be the GM site's folder, otherwise the one reason it cannot, as a line for the GM.
function gmFolderProblem(gmFolder, { playerSiteDir, vaultPath }) {
  const shown = `gm_site.folder (${gmFolder})`;
  const gm = real(gmFolder);
  if (gm === path.parse(gm).root) return `${shown} is the filesystem root; the GM site cannot be built there`;
  if (playerSiteDir) {
    const player = real(playerSiteDir);
    if (gm === player) return `${shown} is the player site's folder; the GM site needs a folder of its own`;
    if (inside(gm, player)) return `${shown} is inside the player site's folder; the GM site needs a folder of its own`;
    if (inside(player, gm)) return `${shown} holds the player site's folder; the GM site needs a folder of its own`;
  }
  if (vaultPath) {
    const vault = real(vaultPath);
    if (gm === vault || inside(gm, vault)) return `${shown} is the vault or inside it; the GM site is built outside the vault`;
    if (inside(vault, gm)) return `${shown} holds the vault; the GM site is built outside the vault`;
  }
  const why = gmOutputReason(gm);
  if (why) return `${shown} ${why}; use an empty or new folder`;
  return null;
}

module.exports = { MARKER_FILE, GM_META, real, resolveGmFolder, defaultGmFolder, gmFolderProblem, gmOutputReason };
