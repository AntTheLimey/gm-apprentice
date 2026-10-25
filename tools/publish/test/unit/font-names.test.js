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

  it('licence addresses map to the licences the tool ships', () => {
    assert.equal(licenceOf('https://openfontlicense.org'), 'OFL-1.1');
    assert.equal(licenceOf('http://www.apache.org/licenses/LICENSE-2.0'), 'Apache-2.0');
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
});
