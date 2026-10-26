'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { countPdfPages, pdfPageTreeCount, rowsFor, formatLine, NO_CHROME, COULD_NOT_COUNT } = require('../../lib/props/pages-cli');
const { propVault } = require('../helpers/prop-vault');
const { entry } = require('../../lib/settings');

// Written by real PDF writers (pikepdf 10.17 for the object streams, then pypdf 6.21's incremental writer, which
// appends an edited page 1 to a two-page file); pypdf reads them as 3 and 2 pages.
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'pdf');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

// rowsFor reads an address against the site's output folder, here the default one.
const site = (t) => {
  const v = propVault(t, { 'Documents/Plain.md': '---\ntype: document\n---\nJust a note.\n' });
  const out = path.join(v.siteDir, entry('player_site.output').default);
  fs.mkdirSync(out, { recursive: true });
  return { ...v, out };
};

test('countPdfPages counts page objects, not the page tree', () => {
  const one = Buffer.from('<< /Type /Pages /Count 1 >> << /Type /Page /Parent 1 0 R >>', 'latin1');
  const two = Buffer.from('<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type\n/Page >>', 'latin1');
  assert.equal(countPdfPages(one), 1);
  assert.equal(countPdfPages(two), 2);
});

test('the page tree count is read from objects packed in an object stream', () => {
  assert.equal(pdfPageTreeCount(fixture('objstm-3-pages.pdf')), 3);
});

test('after an incremental update that repeats a page, the page tree still counts each page once', () => {
  assert.equal(pdfPageTreeCount(fixture('incremental-2-pages.pdf')), 2);
});

test('no readable page tree, or one that counts 0, is no count', () => {
  assert.equal(pdfPageTreeCount(Buffer.from('%PDF-1.4\n<< /Type /Page >>\n%%EOF\n', 'latin1')), null);
  assert.equal(pdfPageTreeCount(Buffer.from('%PDF-1.4\n<< /Type /Pages /Count 0 >>\n%%EOF\n', 'latin1')), null);
  assert.equal(pdfPageTreeCount(Buffer.from('%PDF-1.4\n<< /Type /Pages /Count 4 0 R >>\n%%EOF\n', 'latin1')), null);
  assert.equal(pdfPageTreeCount(Buffer.from('not a pdf', 'latin1')), null);
});

test('the root of the page tree is the node with no parent', () => {
  const pdf = '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] /Count 5 >> endobj\n'
    + '2 0 obj << /Type /Pages /Parent 1 0 R /Count 2 /Resources << /Font << >> >> >> endobj\n'
    + '3 0 obj << /Type /Pages /Parent 1 0 R /Count 3 >> endobj\n%%EOF\n';
  assert.equal(pdfPageTreeCount(Buffer.from(pdf, 'latin1')), 5);
});

test('a missing address says not built', async (t) => {
  const v = site(t);
  const [row] = await rowsFor(v.configPath, [{ address: 'props/nothing.html' }], { findChrome: () => '/bin/true' });
  assert.deepEqual(row, { address: 'props/nothing.html', pages: null, why: 'not built' });
  assert.equal(formatLine(row), 'props/nothing.html\tnot built');
});

test('no Chrome is not an error', async (t) => {
  const v = site(t);
  fs.writeFileSync(path.join(v.out, 'a.html'), '<p>x</p>');
  const rows = await rowsFor(v.configPath, [{ address: 'a.html' }], { findChrome: () => null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pages, null);
  assert.equal(rows[0].why, 'no Chrome or Chromium found; open the page and use print preview');
  assert.equal(formatLine(rows[0]), rows[0].why);
});

test('lines read 1 page and n pages', () => {
  assert.equal(formatLine({ address: 'a', pages: 1, why: null }), 'a\t1 page');
  assert.equal(formatLine({ address: 'a', pages: 3, why: null }), 'a\t3 pages');
});

test('a row with no count still names its warnings, with Chrome missing or failing', () => {
  assert.equal(formatLine({ note: 'P/N.md', pages: null, why: NO_CHROME, warnings: ['a hand'] }), 'P/N.md\tno count (warning: a hand)');
  assert.equal(formatLine({ note: 'P/N.md', pages: null, why: 'Chrome failed (1): x', warnings: ['a hand'] }), 'P/N.md\tChrome failed (1): x (warning: a hand)');
  assert.equal(formatLine({ note: 'P/N.md', pages: null, why: COULD_NOT_COUNT, warnings: [] }), `P/N.md\t${COULD_NOT_COUNT}`);
});

test('with no Chrome, a missing page is still named, then the one no-Chrome line', async (t) => {
  const v = site(t);
  fs.writeFileSync(path.join(v.out, 'a.html'), '<p>x</p>');
  const rows = await rowsFor(v.configPath, [{ address: 'gone.html' }, { address: 'a.html' }, { address: 'b.html' }], { findChrome: () => null });
  assert.deepEqual(rows.map((r) => r.why), ['not built', NO_CHROME, 'not built']);
});
