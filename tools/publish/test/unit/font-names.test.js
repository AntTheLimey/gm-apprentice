'use strict';
// A served font's copyright and licence, read from its WOFF2 name table with Node's own brotli.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fontNames, licenceOf, licenceText, LICENCES } = require('../../lib/font-names');

const VT323 = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'vt323-subset.woff2'));

describe('a font file names its copyright and licence', () => {
  it('a real woff2 parses to its copyright and licence', () => {
    const names = fontNames(VT323);
    assert.deepEqual(names, { copyright: 'Copyright 2011, The VT323 Project Authors (peter.hull@oikoi.com)', licenceUrl: 'http://scripts.sil.org/OFL' });
    assert.equal(licenceOf(names.licenceUrl), 'OFL-1.1');
  });

  it('bytes that are not a woff2, or a cut-off one, read as null', () => {
    assert.equal(fontNames(Buffer.from('wOF2fake')), null);
    assert.equal(fontNames(VT323.subarray(0, 200)), null);
    assert.equal(fontNames(Buffer.alloc(0)), null);
  });

  it('a font that understates its totalSfntSize still parses, and a stream past the cap reads as null', () => {
    // WOFF2 makes totalSfntSize reference information only, never a limit on the stream.
    const small = Buffer.from(VT323);
    small.writeUInt32BE(64, 16);   // totalSfntSize: far less than the stream holds
    assert.deepEqual(fontNames(small), fontNames(VT323));
    assert.equal(fontNames(small).copyright, 'Copyright 2011, The VT323 Project Authors (peter.hull@oikoi.com)');
    // A stream that would unpack past the 64 MiB cap is refused before it is held in memory.
    const zlib = require('node:zlib');
    const bomb = zlib.brotliCompressSync(Buffer.alloc(80 * 1024 * 1024));
    const head = Buffer.alloc(48);
    head.write('wOF2', 0, 'latin1'); head.write('\0\x01\0\0', 4, 'latin1');
    head.writeUInt16BE(1, 12); head.writeUInt32BE(0xffffffff, 16); head.writeUInt32BE(bomb.length, 20);
    // One directory entry: `name` (index 5, no transform), 80 MiB long as a UIntBase128 (40 * 128^3).
    const dir = Buffer.from([0x05, 0xa8, 0x80, 0x80, 0x00]);
    assert.equal(fontNames(Buffer.concat([head, dir, bomb])), null);
  });

  it('licence addresses map to the licences the tool ships', () => {
    assert.equal(licenceOf('https://openfontlicense.org'), 'OFL-1.1');
    assert.equal(licenceOf('http://www.apache.org/licenses/LICENSE-2.0'), 'Apache-2.0');
    assert.equal(licenceOf('https://www.apache.org/licenses/LICENSE-2.0.html'), 'Apache-2.0');
    assert.equal(licenceOf('http://www.apache.org/licenses/LICENSE-1.1'), null, 'Apache 1.1 is not the 2.0 text');
    assert.equal(licenceOf('http://www.apache.org/licenses/'), null);
    assert.equal(licenceOf('http://font.ubuntu.com/ufl'), 'UFL-1.0');
    assert.equal(licenceOf('https://example.com/licence'), null);
    assert.equal(licenceOf(null), null);
  });

  it('each licence text ships with the tool', () => {
    for (const id of Object.keys(LICENCES)) assert.ok(licenceText(id).length > 2000, id);
    assert.match(licenceText('OFL-1.1'), /^-+\nSIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/);
    assert.match(licenceText('Apache-2.0'), /Apache License\s+Version 2\.0, January 2004/);
    assert.match(licenceText('UFL-1.0'), /UBUNTU FONT LICENCE Version 1\.0/);
  });

  it('a licence file checked out with CRLF ends reads with LF ends, and NOTICE.txt carries no CR', (t) => {
    // Git on Windows may check the tool's text files out with CRLF (or old-Mac CR) line ends.
    const real = fs.readFileSync;
    t.mock.method(fs, 'readFileSync', (file, ...rest) => {
      const text = real.call(fs, file, ...rest);
      return typeof text === 'string' && /LICENSE|licenses/.test(String(file)) ? text.replace(/\r?\n/g, '\r\n') : text;
    });
    assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'licenses', 'OFL-1.1.txt'), 'utf8'), /\r\n/, 'the mock gives CRLF');
    assert.match(licenceText('OFL-1.1'), /^-+\nSIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007\n/);
    for (const id of Object.keys(LICENCES)) assert.doesNotMatch(licenceText(id), /\r/, id);
    const { noticeText } = require('../../lib/notice');
    const notice = noticeText({ lunr: true, googleFonts: [{ family: 'VT323', folder: 'vt323', copyright: 'c', licence: 'OFL-1.1' }] });
    assert.doesNotMatch(notice, /\r/);
  });
});
