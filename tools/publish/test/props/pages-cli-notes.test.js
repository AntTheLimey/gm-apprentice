'use strict';
// `props pages --note`: a prop counted from its note, as players would get it, before it is published.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rowsFor, formatLine, NO_CHROME } = require('../../lib/props/pages-cli');
const { propVault } = require('../helpers/prop-vault');

const noChrome = { findChrome: () => null };

test('a note that is not a prop says so', (t) => {
  const v = propVault(t, { 'Documents/Plain.md': '---\ntype: document\n---\nJust a note.\n' });
  const [row] = rowsFor(v.configPath, [{ note: 'Documents/Plain.md' }], noChrome);
  assert.deepEqual(row, { note: 'Documents/Plain.md', pages: null, why: 'not a prop note' });
  assert.equal(formatLine(row), 'Documents/Plain.md\tnot a prop note');
});

test('a note that is not in the vault says so', (t) => {
  const v = propVault(t, { 'Documents/Plain.md': '---\ntype: document\n---\nJust a note.\n' });
  const [row] = rowsFor(v.configPath, [{ note: 'Documents/Gone.md' }], noChrome);
  assert.deepEqual(row, { note: 'Documents/Gone.md', pages: null, why: 'no such note in the vault' });
});

test("a hand-made prop whose file is missing gives the build's reason", (t) => {
  const v = propVault(t, { 'Props/Letter.md': '---\ntype: prop\nprop_file: letter.html\n---\nA letter.\n' });
  const [row] = rowsFor(v.configPath, [{ note: 'Props/Letter.md' }], noChrome);
  assert.equal(row.pages, null);
  assert.equal(row.why, 'the prop file "letter.html" is not in Props');
});

test('a prop with no style and no file says what it lacks', (t) => {
  const v = propVault(t, { 'Props/Coin.md': '---\ntype: prop\nprop_kind: object\n---\nA coin.\n' });
  const [row] = rowsFor(v.configPath, [{ note: 'Props/Coin.md' }], noChrome);
  assert.equal(row.why, 'it names no prop_style or prop_file, so it has no page to print');
});

test('a held styled prop with no Chrome: the no-Chrome reason, and nothing written to the site', (t) => {
  const v = propVault(t, { 'Props/Note.md': '---\ntype: prop\nprop_style: letter\n---\nA note.\n\n## The Text\n\nDear friend.\n' });
  const rows = rowsFor(v.configPath, [{ note: 'Props/Note.md' }, { note: 'Props/Missing.md' }], noChrome);
  assert.deepEqual(rows.map((r) => r.why), [NO_CHROME, 'no such note in the vault']);
  assert.deepEqual(fs.readdirSync(v.siteDir), ['vault.config.json']);
});

test('a hand-made PDF is counted without Chrome', (t) => {
  const v = propVault(t, { 'Props/Deed.md': '---\ntype: prop\nprop_file: deed.pdf\n---\nA deed.\n' });
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'deed.pdf'), '%PDF-1.4\n<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type /Page >>\n%%EOF\n');
  const [row] = rowsFor(v.configPath, [{ note: 'Props/Deed.md' }], noChrome);
  assert.deepEqual(row, { note: 'Props/Deed.md', pages: 2, why: null });
});

test('addresses and notes keep the order they were given', (t) => {
  const v = propVault(t, { 'Documents/Plain.md': '---\ntype: document\n---\nJust a note.\n' });
  const rows = rowsFor(v.configPath, [{ address: 'props/a.html' }, { note: 'Documents/Plain.md' }], noChrome);
  assert.deepEqual(rows.map((r) => [r.address || r.note, r.why]), [['props/a.html', 'not built'], ['Documents/Plain.md', 'not a prop note']]);
});

test('a never-published prop and an unstyled container say why they are not counted', (t) => {
  const v = propVault(t, {
    'Props/Secret.md': '---\ntype: prop\npublish: false\nprop_style: letter\n---\nA secret.\n\n## The Text\n\nHush.\n',
    'Props/Box.md': '---\ntype: prop\nprop_kind: container\n---\nA box.\n',
  });
  const rows = rowsFor(v.configPath, [{ note: 'Props/Secret.md' }, { note: 'Props/Box.md' }], noChrome);
  assert.deepEqual(rows.map((r) => r.why), [
    'its note never publishes in full (publish: false, or a stub), so its prop never ships',
    "a container's page without a style uses the site's own look: count it once it is built",
  ]);
});
