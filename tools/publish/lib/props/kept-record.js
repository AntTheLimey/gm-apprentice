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
const keptRecordPath = (siteDir) => path.join(siteDir, CACHE_FOLDER, FILE);
const hashOf = (data) => crypto.createHash('sha256').update(data).digest('hex');

// The recorded files: { out: hash }. A missing or unreadable record is an empty one (a site built before the record).
function readKeptRecord(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const files = data && typeof data.files === 'object' && !Array.isArray(data.files) ? data.files : {};
    return Object.fromEntries(Object.entries(files).filter(([out, h]) => typeof out === 'string' && typeof h === 'string'));
  } catch (e) {
    return {};
  }
}

function writeKeptRecord(file, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, files: sorted }, null, 2) + '\n');
}

module.exports = { keptRecordPath, readKeptRecord, writeKeptRecord, hashOf };
