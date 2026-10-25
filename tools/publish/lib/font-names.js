'use strict';

// What a served font says about itself: its copyright (name ID 0) and the address of its
// licence (name ID 14), read from the `name` table of a cached WOFF2 file, and the licence
// that address names. NOTICE.txt carries both for every Google font a site serves. Only
// Node's own brotli is used: the `name` table is never transformed, so it is a plain slice
// of the one decompressed stream.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LICENSES_DIR = path.join(__dirname, '..', 'licenses');
// Each licence the tool can name, with the text it ships in licenses/.
const LICENCES = {
  'OFL-1.1': { name: 'SIL Open Font License, Version 1.1', file: 'OFL-1.1.txt' },
  'Apache-2.0': { name: 'Apache License, Version 2.0', file: 'Apache-2.0.txt' },
  'UFL-1.0': { name: 'Ubuntu Font Licence, Version 1.0', file: 'UFL-1.0.txt' },
};

// WOFF2's known-table index of `name`, and of glyf and loca, whose transform flags read the other way.
const NAME_INDEX = 5;
const GLYF_INDEX = 10;
const LOCA_INDEX = 11;
const HEADER_SIZE = 48;
// The most a font may unpack to, whatever size it says it holds.
const MAX_UNPACKED = 64 * 1024 * 1024;

function readBase128(buf, at) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[at.pos++];
    if (byte === undefined || (i === 0 && byte === 0x80)) throw new Error('bad UIntBase128');
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('bad UIntBase128');
}

// The `name` table's bytes, or null when the file is not a single-font WOFF2 holding one.
function nameTableOf(buf) {
  if (buf.length < HEADER_SIZE || buf.toString('latin1', 0, 4) !== 'wOF2') return null;
  if (buf.toString('latin1', 4, 8) === 'ttcf') return null;
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  const at = { pos: HEADER_SIZE };
  let offset = 0;
  let found = null;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[at.pos++];
    const index = flags & 0x3f;
    if (index === 63) at.pos += 4;
    const version = (flags >> 6) & 3;
    const length = readBase128(buf, at);
    const glyfOrLoca = index === GLYF_INDEX || index === LOCA_INDEX;
    const transformed = glyfOrLoca ? version !== 3 : version !== 0;
    const stored = transformed ? readBase128(buf, at) : length;
    if (index === NAME_INDEX) found = { offset, length };
    offset += stored;
  }
  if (!found) return null;
  // The stream unpacks to no more than MAX_UNPACKED: a crafted file that would unpack past it is
  // refused (and reads as null) rather than filling memory. The header's totalSfntSize is not the
  // limit: WOFF2 makes it reference information only, so a font that understates it still parses.
  const stream = zlib.brotliDecompressSync(buf.subarray(at.pos, at.pos + compressed), { maxOutputLength: MAX_UNPACKED });
  if (found.offset + found.length > stream.length) return null;
  return stream.subarray(found.offset, found.offset + found.length);
}

// One name record's text: Windows Unicode (US English first) before Mac Roman.
function nameRecord(table, nameId) {
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > table.length || table.readUInt16BE(r + 6) !== nameId) continue;
    const platform = table.readUInt16BE(r);
    const encoding = table.readUInt16BE(r + 2);
    const language = table.readUInt16BE(r + 4);
    const start = strings + table.readUInt16BE(r + 10);
    const bytes = table.subarray(start, start + table.readUInt16BE(r + 8));
    let rank;
    let text;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      rank = language === 0x409 ? 0 : 1;
      text = Buffer.from(bytes).swap16().toString('utf16le');
    } else if (platform === 0) {
      rank = 2;
      text = Buffer.from(bytes).swap16().toString('utf16le');
    } else if (platform === 1 && encoding === 0) {
      rank = 3;
      text = bytes.toString('latin1');
    } else continue;
    if (!best || rank < best.rank) best = { rank, text };
  }
  return best ? best.text.replace(/\s+/g, ' ').trim() : null;
}

// { copyright, licenceUrl } from a WOFF2 file's bytes; null when they cannot be read.
function fontNames(buf) {
  try {
    const table = nameTableOf(buf);
    if (!table || table.length < 6) return null;
    return { copyright: nameRecord(table, 0), licenceUrl: nameRecord(table, 14) };
  } catch {
    return null;
  }
}

function fontNamesOfFile(file) {
  try { return fontNames(fs.readFileSync(file)); } catch { return null; }
}

// The licence a licence address names: 'OFL-1.1', 'Apache-2.0', 'UFL-1.0', or null.
function licenceOf(url) {
  const u = String(url || '').toLowerCase();
  if (/scripts\.sil\.org\/ofl|openfontlicense\.org/.test(u)) return 'OFL-1.1';
  if (/apache\.org\/licenses\/license-2\.0(\.txt|\.html)?\/?$/.test(u)) return 'Apache-2.0';
  if (/ubuntu\.com\/(legal\/)?font-?licen[cs]e|font\.ubuntu\.com\/(ufl|licence)/.test(u)) return 'UFL-1.0';
  return null;
}

// A licence file's text with LF line ends: a checkout on Windows may give the tool's own files CRLF
// ends, and NOTICE.txt is written with LF, so a licence copied in as read would mix the two.
function readLicenceFile(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function licenceText(id) {
  return readLicenceFile(path.join(LICENSES_DIR, LICENCES[id].file));
}

module.exports = { LICENCES, fontNames, fontNamesOfFile, licenceOf, licenceText, readLicenceFile };
