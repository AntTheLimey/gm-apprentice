'use strict';
// The one place a list of folders is tidied, for both layouts, on reading and on writing. The
// scanner compares the entries with vault-relative POSIX paths, so an entry written another way
// ("Secrets/", "./Private", "GM\Stuff", an absolute path inside the vault) would hide nothing.
const { readerFrom } = require('../vault-reader');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

// Normalizes backslashes, a trailing slash, a leading "./" and an absolute path inside the vault.
// An absolute path outside the vault is dropped (and `say` is told, naming the setting as `label`).
// Returns null for an entry that normalizes to nothing.
function normalizeExcludeDir(entry, vaultPath, say = () => {}, label = 'player_site.hide.folders') {
  let raw = String(entry).trim().replace(/\\/g, '/');
  if (!raw) return null;
  const looksAbsolute = raw.startsWith('/') || /^[A-Za-z]:\//.test(raw);
  if (looksAbsolute) {
    const resolved = path.resolve(raw);
    const vaultRoot = path.resolve(vaultPath);
    if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
      say(`${label} entry "${entry}" is outside the vault, so it is ignored.`);
      return null;
    }
    raw = path.relative(vaultRoot, resolved).split(path.sep).join('/');
  }
  raw = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  return raw || null;
}

// Normalizes each entry, then drops repeats ignoring case (first spelling wins).
function normalizeExcludeDirs(list, vaultPath, say = () => {}, label) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const normalized = normalizeExcludeDir(item, vaultPath, say, label);
    if (normalized == null) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

// ---- The site folder's own folders -------------------------------------------------------------
// What a build writes into and keeps. The build empties the output folder, so these are judged strictly.

// The path with every link in it followed. A folder that does not exist yet is judged by its nearest folder that does,
// with the rest of the path put back.
function realPath(p, deps) {
  const realpath = readerFrom(deps).realpath;
  const tail = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(realpath(cur), ...tail);
    } catch (err) {
      // Only a folder that is not there is walked past; a failure to look is an error (#424).
      if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(err.code)) throw err;
      const up = path.dirname(cur);
      if (up === cur) return p;
      tail.unshift(path.basename(cur));
      cur = up;
    }
  }
}

// Why `value` cannot be the output folder of a site in `siteDir`, or null. It must be text, inside the site folder,
// and not the site folder itself. Without a site folder only a relative path can be judged; an absolute one passes.
function outputProblem(value, siteDir, deps) {
  const rule = 'it must be a folder inside the site folder, not the site folder itself and not outside it';
  if (typeof value !== 'string' || value.trim() === '') return rule;
  const text = value.trim();
  if (siteDir) {
    const root = path.resolve(siteDir);
    const full = path.resolve(root, text);
    if (!(full !== root && full.startsWith(root + path.sep))) return rule;
    // A link inside the site folder that leads out of it (to the vault, say) is outside it, whatever it is called.
    const realRoot = realPath(root, deps);
    const realFull = realPath(full, deps);
    return realFull !== realRoot && realFull.startsWith(realRoot + path.sep) ? null : rule;
  }
  if (path.isAbsolute(text) || /^[A-Za-z]:/.test(text)) return null;
  const tidy = path.posix.normalize(text.replace(/\\/g, '/'));
  return tidy === '.' || tidy === '..' || tidy.startsWith('../') ? rule : null;
}

// Why `list` cannot be the folders to keep, or null: each entry is a plain folder name.
function keepProblem(list) {
  const bad = list.find((x) => x.trim() === '' || /[\\/]/.test(x) || x.includes('..'));
  return bad === undefined ? null : 'each entry must be a plain folder name: not empty, with no slash and no ".."';
}

// Whether two values of a checked folder setting are the same: an output folder written two ways (`docs`, `./docs/`)
// is one folder; a list is compared entry by entry.
function sameChecked(check, a, b, siteDir) {
  if (check === 'output' && typeof a === 'string' && typeof b === 'string') {
    return path.resolve(siteDir || path.sep, a.trim()) === path.resolve(siteDir || path.sep, b.trim());
  }
  return isDeepStrictEqual(a, b);
}

// The value a checked folder setting is used as: the text the check judged, trimmed (a name judged trimmed must be
// used trimmed, or " maps " would never match the folder `maps` and it would be deleted).
const tidyChecked = (check, value) => (check === 'output' ? value.trim() : value.map((x) => x.trim()));

module.exports = { normalizeExcludeDir, normalizeExcludeDirs, outputProblem, keepProblem, tidyChecked, sameChecked };
