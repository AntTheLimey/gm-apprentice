'use strict';
// `props pages --note`: a prop counted from its note, as players would get it, before it is published.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rowsFor, formatLine, NO_CHROME, SUPPLIED_PDF } = require('../../lib/props/pages-cli');
const { propVault } = require('../helpers/prop-vault');

// No Chrome, and no network: the font prefetch is a spy that fetches nothing.
const noChrome = () => {
  const calls = [];
  return { calls, findChrome: () => null, prefetch: async (configPath) => { calls.push(configPath); } };
};
const PLAIN = { 'Documents/Plain.md': '---\ntype: document\n---\nJust a note.\n' };
// A vault style with no typeface of its own: the page's only font is the note's hand.
const HAND_STYLE = {
  '_meta/prop-styles/hand/layout.html': '<div style="font-family: {{prop_font|font}}">{{{body}}}</div>',
  '_meta/prop-styles/hand/style.css': 'div { color: black; }\n',
};
const HANDED = (hand) => `---\ntype: prop\nprop_style: hand\nprop_hand: ${hand}\n---\nA note.\n\n## The Text\n\nDear friend.\n`;
const STYLED = (fm = '') => `---\ntype: prop\nprop_style: letter\n${fm}---\nA note.\n\n## The Text\n\nDear friend.\n`;

test('a note that is not a prop says so', async (t) => {
  const v = propVault(t, PLAIN);
  const [row] = await rowsFor(v.configPath, [{ note: 'Documents/Plain.md' }], noChrome());
  assert.deepEqual(row, { note: 'Documents/Plain.md', pages: null, why: 'not a prop note', warnings: [] });
  assert.equal(formatLine(row), 'Documents/Plain.md\tnot a prop note');
});

test('a note that is not in the vault says so', async (t) => {
  const v = propVault(t, PLAIN);
  const [row] = await rowsFor(v.configPath, [{ note: 'Documents/Gone.md' }], noChrome());
  assert.deepEqual(row, { note: 'Documents/Gone.md', pages: null, why: 'no such note in the vault', warnings: [] });
});

test("a hand-made prop whose file is missing gives the build's reason", async (t) => {
  const v = propVault(t, { 'Props/Letter.md': '---\ntype: prop\nprop_file: letter.html\n---\nA letter.\n' });
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Letter.md' }], noChrome());
  assert.equal(row.pages, null);
  assert.equal(row.why, 'the prop file "letter.html" is not in Props');
});

test('a prop with no style and no file says what it lacks', async (t) => {
  const v = propVault(t, { 'Props/Coin.md': '---\ntype: prop\nprop_kind: object\n---\nA coin.\n' });
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Coin.md' }], noChrome());
  assert.equal(row.why, 'it names no prop_style or prop_file, so it has no page to print');
});

test('a held styled prop with no Chrome: the no-Chrome reason, and nothing written to the site', async (t) => {
  const v = propVault(t, { 'Props/Note.md': STYLED() });
  const rows = await rowsFor(v.configPath, [{ note: 'Props/Note.md' }, { note: 'Props/Missing.md' }], noChrome());
  assert.deepEqual(rows.map((r) => r.why), [NO_CHROME, 'no such note in the vault']);
  assert.deepEqual(fs.readdirSync(v.siteDir), ['vault.config.json']);
});

test('addresses and notes keep the order they were given', async (t) => {
  const v = propVault(t, PLAIN);
  const rows = await rowsFor(v.configPath, [{ address: 'props/a.html' }, { note: 'Documents/Plain.md' }], noChrome());
  assert.deepEqual(rows.map((r) => [r.address || r.note, r.why]), [['props/a.html', 'not built'], ['Documents/Plain.md', 'not a prop note']]);
});

test('a never-published prop and an unstyled container say why they are not counted', async (t) => {
  const v = propVault(t, {
    'Props/Secret.md': '---\ntype: prop\npublish: false\nprop_style: letter\n---\nA secret.\n\n## The Text\n\nHush.\n',
    'Props/Box.md': '---\ntype: prop\nprop_kind: container\n---\nA box.\n',
  });
  const rows = await rowsFor(v.configPath, [{ note: 'Props/Secret.md' }, { note: 'Props/Box.md' }], noChrome());
  assert.deepEqual(rows.map((r) => r.why), [
    'its note never publishes in full (publish: false, or a stub), so its prop never ships',
    "a container's page without a style uses the site's own look: count it once it is built",
  ]);
});

test('the fonts are fetched before any note is built, as a build does; a font still missing is a warning', async (t) => {
  const v = propVault(t, {
    ...HAND_STYLE,
    'Props/Note.md': HANDED('ann'),
    '_meta/prop-hands.json': '{"hands": {"ann": {"font": "Caveat"}}}\n',
  });
  const opts = noChrome();
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Note.md' }], opts);
  assert.deepEqual(opts.calls, [v.configPath]);
  assert.equal(row.warnings.length, 1);
  assert.deepEqual(row.warnings, ['"Caveat" is not in the vault\'s font cache, so the page is laid out in fallback type']);
});

test('only addresses: nothing is fetched', async (t) => {
  const v = propVault(t, PLAIN);
  const opts = noChrome();
  await rowsFor(v.configPath, [{ address: 'props/a.html' }], opts);
  assert.deepEqual(opts.calls, []);
});

test("an unknown hand is carried into the note's row", async (t) => {
  const v = propVault(t, { ...HAND_STYLE, 'Props/Note.md': HANDED('scrawl') });
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Note.md' }], noChrome());
  assert.deepEqual(row.warnings, ['prop_hand "scrawl" is not in _meta/prop-hands.json, so the style\'s own hand is used']);
});

test('a counted row names its warnings', () => {
  assert.equal(formatLine({ note: 'P/N.md', pages: 2, why: null, warnings: ['a', 'b'] }), 'P/N.md\t2 pages (warning: a; b)');
  assert.equal(formatLine({ note: 'P/N.md', pages: 1, why: null, warnings: [] }), 'P/N.md\t1 page');
});

test('a note path is read as vault-relative: ./, an absolute path inside the vault, backslashes; outside is refused', async (t) => {
  const v = propVault(t, { 'Props/Deed.md': '---\ntype: prop\nprop_file: deed.pdf\n---\nA deed.\n' });
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'deed.pdf'), '%PDF-1.4\n<< /Type /Pages /Count 1 >> << /Type /Page >>\n%%EOF\n');
  const given = ['./Props/Deed.md', path.join(v.vaultDir, 'Props', 'Deed.md'), 'Props\\Deed.md', '../outside.md'];
  const rows = await rowsFor(v.configPath, given.map((note) => ({ note })), noChrome());
  assert.deepEqual(rows.map((r) => [r.note, r.pages, r.why]), [
    ['Props/Deed.md', null, SUPPLIED_PDF], ['Props/Deed.md', null, SUPPLIED_PDF], ['Props/Deed.md', null, SUPPLIED_PDF],
    ['../outside.md', null, 'outside the vault'],
  ]);
});

const DEED = { 'Props/Deed.md': '---\ntype: prop\nprop_file: deed.pdf\n---\nA deed.\n' };
test('a supplied PDF is not counted: it keeps its own pages', async (t) => {
  const v = propVault(t, DEED);
  fs.writeFileSync(path.join(v.vaultDir, 'Props', 'deed.pdf'), '%PDF-1.4\n<< /Type /Pages /Count 3 >>\n%%EOF\n');
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Deed.md' }], noChrome());
  assert.deepEqual(row, { note: 'Props/Deed.md', pages: null, why: SUPPLIED_PDF, warnings: [] });
  assert.equal(formatLine(row), 'Props/Deed.md\ta supplied PDF keeps its own pages; open it to check');
});

test("the build's warning about the prop's page (a picture not in the vault) is carried into the row", async (t) => {
  const v = propVault(t, { 'Props/Map.md': STYLED().replace('Dear friend.', 'Dear friend.\n\n![[missing-map.png]]') });
  const [row] = await rowsFor(v.configPath, [{ note: 'Props/Map.md' }], noChrome());
  assert.equal(row.why, NO_CHROME);
  assert.deepEqual(row.warnings.filter((w) => /image embed not found — "missing-map\.png" \(props\/map-prop\.html\)/.test(w)).length, 1);
  assert.match(formatLine(row), /^Props\/Map\.md\tno count \(warning: .*missing-map\.png/);
});

test('a prop in a folder the site does not show names the folder and the fix', async (t) => {
  const v = propVault(t, { 'Props/Note.md': STYLED() });
  fs.mkdirSync(path.join(v.vaultDir, 'Chapters', 'Paris', 'Props'), { recursive: true });
  fs.writeFileSync(path.join(v.vaultDir, 'Chapters', 'Paris', 'Props', 'Paris Note.md'), STYLED());
  const [row] = await rowsFor(v.configPath, [{ note: 'Chapters/Paris/Props/Paris Note.md' }], noChrome());
  assert.equal(row.why, 'the site does not read this note: its folder Chapters/Paris/Props is not in player_site.folder_map');
});
