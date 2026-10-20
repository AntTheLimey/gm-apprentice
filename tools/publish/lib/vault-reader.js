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

module.exports = { readerFrom, readError, exists };
