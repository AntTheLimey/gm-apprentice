'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserSkip } = require('./helpers/browser');
const { rowsFor } = require('../lib/props/pages-cli');
const { propVault } = require('./helpers/prop-vault');
const { entry } = require('../lib/settings');

const offline = { prefetch: async () => {} };   // no network in tests: the font cache is left as it is

test('a two-sheet page prints as 2 pages', { skip: browserSkip() }, async (t) => {
  const v = propVault(t, { 'Documents/Plain.md': '---\ntype: document\n---\nJust a note.\n' });
  const out = path.join(v.siteDir, entry('player_site.output').default);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'two.html'),
    '<!doctype html><style>.sheet{break-after:page;height:200px}</style><div class="sheet">one</div><div class="sheet">two</div>');
  const [row] = await rowsFor(v.configPath, [{ address: 'two.html' }], offline);
  assert.equal(row.pages, 2);
});

test('a held styled prop with two sheets counts 2 pages, and nothing is written to the site', { skip: browserSkip() }, async (t) => {
  const v = propVault(t, {
    'Props/Note.md': '---\ntype: prop\nprop_style: letter\nprop_breaks: "PAGE TWO"\n---\nA note.\n\n## The Text\n\nDear friend,\n\nthe first sheet.\n\nPAGE TWO, and the second.\n',
  });
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Note.md' }], offline);
  assert.equal(row.pages, 2);
  assert.equal(row.why, null);
  assert.deepEqual(fs.readdirSync(v.siteDir), ['vault.config.json']);
});

test("a hand-made page is counted with its linked files and without its gm-only block", { skip: browserSkip() }, async (t) => {
  const v = propVault(t, { 'Props/Ledger.md': '---\ntype: prop\nprop_file: ledger.html\n---\nA ledger.\n' });
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'ledger.css'), '.sheet{break-after:page;height:200px}\n');
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'ledger.html'),
    '<!doctype html><link rel="stylesheet" href="ledger.css"><div class="sheet">one</div><div class="sheet">two</div>'
    + '<!-- gm-only --><div class="sheet">the keeper sheet</div><!-- /gm-only -->');
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Ledger.md' }], offline);
  assert.deepEqual(row, { note: 'Props/Ledger.md', pages: 2, why: null, warnings: [] });
});
