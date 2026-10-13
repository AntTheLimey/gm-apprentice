'use strict';
// The one place a list of folders is tidied, for both layouts, on reading and on writing. The
// scanner compares the entries with vault-relative POSIX paths, so an entry written another way
// ("Secrets/", "./Private", "GM\Stuff", an absolute path inside the vault) would hide nothing.
const path = require('node:path');

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

module.exports = { normalizeExcludeDir, normalizeExcludeDirs };
