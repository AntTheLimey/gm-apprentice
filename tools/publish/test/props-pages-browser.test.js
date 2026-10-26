'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findChrome } = require('../lib/chrome');
const { pagesFor } = require('../lib/props/pages-cli');

test('a two-sheet page prints as 2 pages', { skip: findChrome() ? false : 'no Chrome or Chromium found' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-pages-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'two.html'),
    '<!doctype html><style>.sheet{break-after:page;height:200px}</style><div class="sheet">one</div><div class="sheet">two</div>');
  const [row] = pagesFor(dir, ['two.html']);
  assert.equal(row.pages, 2);
});

const { rowsFor } = require('../lib/props/pages-cli');
const { propVault } = require('./helpers/prop-vault');
const noChrome = findChrome() ? false : 'no Chrome or Chromium found';

test('a held styled prop with two sheets counts 2 pages, and nothing is written to the site', { skip: noChrome }, (t) => {
  const v = propVault(t, {
    'Props/Note.md': '---\ntype: prop\nprop_style: letter\nprop_breaks: "PAGE TWO"\n---\nA note.\n\n## The Text\n\nDear friend,\n\nthe first sheet.\n\nPAGE TWO, and the second.\n',
  });
  const [row] = rowsFor(v.configPath, [{ note: 'Props/Note.md' }]);
  assert.deepEqual(row, { note: 'Props/Note.md', pages: 2, why: null });
  assert.deepEqual(fs.readdirSync(v.siteDir), ['vault.config.json']);
});

test("a hand-made page is counted with its linked files and without its gm-only block", { skip: noChrome }, (t) => {
  const v = propVault(t, { 'Props/Ledger.md': '---\ntype: prop\nprop_file: ledger.html\n---\nA ledger.\n' });
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'ledger.css'), '.sheet{break-after:page;height:200px}\n');
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'ledger.html'),
    '<!doctype html><link rel="stylesheet" href="ledger.css"><div class="sheet">one</div><div class="sheet">two</div>'
    + '<!-- gm-only --><div class="sheet">the keeper sheet</div><!-- /gm-only -->');
  const [row] = rowsFor(v.configPath, [{ note: 'Props/Ledger.md' }]);
  assert.deepEqual(row, { note: 'Props/Ledger.md', pages: 2, why: null });
});
