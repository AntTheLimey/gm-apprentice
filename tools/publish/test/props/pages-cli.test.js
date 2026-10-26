'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { countPdfPages, pagesFor, formatLine } = require('../../lib/props/pages-cli');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('countPdfPages counts page objects, not the page tree', () => {
  const one = Buffer.from('<< /Type /Pages /Count 1 >> << /Type /Page /Parent 1 0 R >>', 'latin1');
  const two = Buffer.from('<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type\n/Page >>', 'latin1');
  assert.equal(countPdfPages(one), 1);
  assert.equal(countPdfPages(two), 2);
});

test('a missing address says not built', (t) => {
  const dir = tmp(t);
  const [row] = pagesFor(dir, ['props/nothing.html'], { findChrome: () => '/bin/true' });
  assert.deepEqual(row, { address: 'props/nothing.html', pages: null, why: 'not built' });
  assert.equal(formatLine(row), 'props/nothing.html\tnot built');
});

test('no Chrome is not an error', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'a.html'), '<p>x</p>');
  const rows = pagesFor(dir, ['a.html'], { findChrome: () => null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pages, null);
  assert.equal(rows[0].why, 'no Chrome or Chromium found; open the page and use print preview');
  assert.equal(formatLine(rows[0]), rows[0].why);
});

test('lines read 1 page and n pages', () => {
  assert.equal(formatLine({ address: 'a', pages: 1, why: null }), 'a\t1 page');
  assert.equal(formatLine({ address: 'a', pages: 3, why: null }), 'a\t3 pages');
});
