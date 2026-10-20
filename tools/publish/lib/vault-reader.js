'use strict';

// The reads the scanner and the banner lookup make of a vault, behind one object so that a caller
// can hand in its own: `{ readFile(path) -> text, readdir(path) -> Dirent-likes, exists(path) -> bool }`
// (the way loadVaultConfig takes `deps.readFile`). A tool that predicts a build can then walk the
// vault with the build's own code, over a reader of its own.
//
// A read that fails is an error, never an empty answer: a vault on a share that drops part-way
// through must stop the scan, not publish fewer pages. The one soft answer is "not there": a
// file or folder that does not exist (ENOENT, or ENOTDIR for a path through a file) is absent.

const fs = require('fs');
const path = require('path');

const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (err) {
    if (ABSENT.has(err.code)) return false;
    throw err;
  }
}

// Whether anything is at the path, a link that leads nowhere included.
function lstatExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    if (ABSENT.has(err.code)) return false;
    throw err;
  }
}

function readerFrom(deps = {}) {
  return {
    readFile: deps.readFile || ((p) => fs.readFileSync(p, 'utf8')),
    readdir: deps.readdir || ((p) => fs.readdirSync(p, { withFileTypes: true })),
    exists: deps.exists || exists,
    lstatExists: deps.lstatExists || lstatExists,
    realpath: deps.realpath || ((p) => fs.realpathSync.native(p)),
  };
}

// `what` as the GM knows it (a vault-relative path), with the reason the read failed; the
// error keeps its code so a caller can tell a dropped share from a missing file.
function readError(what, err) {
  const wrapped = new Error(`could not read ${what}: ${err.message}`, { cause: err });
  if (err.code) wrapped.code = err.code;
  return wrapped;
}

// A note path as the vault spells it: `./` and `a/../` dropped, and each part's case as it is on disk (a disk that
// ignores case finds `npcs/a.md` for `NPCs/A.md`). Null when no note is there or the path leaves the vault.
function vaultSpelling(vaultPath, page) {
  const rel = path.posix.normalize(page);
  if (rel.startsWith('../') || rel === '..' || path.posix.isAbsolute(rel) || !fs.existsSync(path.join(vaultPath, rel))) return null;
  const parts = [];
  for (const part of rel.split('/')) {
    let names;
    try { names = fs.readdirSync(path.join(vaultPath, ...parts)); } catch { return null; }
    const nfc = part.normalize('NFC');
    const same = (n) => n.normalize('NFC') === nfc;
    parts.push(names.find(same) || names.find((n) => n.normalize('NFC').toLowerCase() === nfc.toLowerCase()) || part);
  }
  return parts.join('/');
}

module.exports = { readerFrom, readError, exists, vaultSpelling };
