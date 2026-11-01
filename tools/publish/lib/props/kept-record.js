'use strict';
// The record of what the build wrote into kept folders (#506). A kept folder is never cleaned, so a prop file the
// build put there would outlive its note when the note is deleted, stops being a prop, or moves its prop_address:
// the plan no longer knows the old path. The build keeps, beside the site (never in it, never in the vault), each
// kept-folder file it wrote and the hash of its bytes; a later full build removes a recorded file it did not write
// again only while that file still holds exactly those bytes. A file the record does not name, or one the GM has
// changed since, is never touched.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE_FOLDER } = require('../image-optimize');

const FILE = 'kept-writes.json';
const VERSION = 1;
const keptRecordPath = (siteDir) => path.join(siteDir, CACHE_FOLDER, FILE);
const hashOf = (data) => crypto.createHash('sha256').update(data).digest('hex');
// A site path the record may name: forward slashes, no empty, '.' or '..' part, not from the root.
const plainOut = (out) => typeof out === 'string' && !out.includes('\\') && out.split('/').every((p) => p && p !== '.' && p !== '..');

// { files: { out: hash }, problem }. A missing record (a site built before there was one) is empty, with no problem;
// one that cannot be read, is not JSON, or is of another version is empty with `problem` saying why. An entry that is
// not a plain site path with a hash is left out.
function readKeptRecord(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { files: {}, problem: null };
    if (!e.code) throw e;
    return { files: {}, problem: e.code };
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { return { files: {}, problem: 'it is not JSON' }; }
  if (!data || typeof data !== 'object' || data.version !== VERSION) {
    return { files: {}, problem: `it is not a version ${VERSION} record` };
  }
  const files = data.files && typeof data.files === 'object' && !Array.isArray(data.files) ? data.files : {};
  return { files: Object.fromEntries(Object.entries(files).filter(([out, h]) => plainOut(out) && typeof h === 'string')), problem: null };
}

// Written whole or not at all: to a temporary file beside it, then renamed over it.
function writeKeptRecord(file, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, files: sorted }, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

module.exports = { keptRecordPath, readKeptRecord, writeKeptRecord, hashOf };
