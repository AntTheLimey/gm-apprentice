'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { countPdfPages, rowsFor, formatLine, NO_CHROME, SUPPLIED_PDF } = require('../../lib/props/pages-cli');
const { propVault } = require('../helpers/prop-vault');
const { entry } = require('../../lib/settings');

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
  assert.equal(formatLine({ note: 'P/N.md', pages: null, why: SUPPLIED_PDF, warnings: [] }), `P/N.md\t${SUPPLIED_PDF}`);
});

test('with no Chrome, a missing page is still named, then the one no-Chrome line', async (t) => {
  const v = site(t);
  fs.writeFileSync(path.join(v.out, 'a.html'), '<p>x</p>');
  const rows = await rowsFor(v.configPath, [{ address: 'gone.html' }, { address: 'a.html' }, { address: 'b.html' }], { findChrome: () => null });
  assert.deepEqual(rows.map((r) => r.why), ['not built', NO_CHROME, 'not built']);
});

test('a Chrome print with no countable pages is no count, never 0 pages', { skip: process.platform === 'win32' && 'a shell script stands in for Chrome' }, async (t) => {
  const v = site(t);
  fs.writeFileSync(path.join(v.out, 'a.html'), '<p>x</p>');
  // Stands in for Chrome: writes a PDF with no page objects where --print-to-pdf points.
  const fake = path.join(v.root, 'fake-chrome');
  fs.writeFileSync(fake, '#!/bin/sh\nfor a; do case "$a" in --print-to-pdf=*) printf \'%%PDF-1.4\\n%%%%EOF\\n\' > "${a#--print-to-pdf=}";; esac; done\n');
  fs.chmodSync(fake, 0o755);
  const [row] = await rowsFor(v.configPath, [{ address: 'a.html' }], { findChrome: () => fake });
  assert.equal(row.pages, null);
  assert.match(row.why, /^Chrome printed no pages it could count/);
  assert.doesNotMatch(formatLine(row), /0 pages/);
});
