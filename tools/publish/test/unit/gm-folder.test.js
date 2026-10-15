'use strict';
// tools/publish/test/unit/gm-folder.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gmFolderProblem, gmOutputReason, resolveGmFolder, defaultGmFolder, MARKER_FILE } = require('../../lib/gm-site');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-folder-')));
function layout() {
  const root = tmp();
  const site = path.join(root, 'campaign');
  const vault = path.join(root, 'vault');
  fs.mkdirSync(site); fs.mkdirSync(vault);
  return { root, site, vault };
}

test('a sibling folder is fine, made or not', () => {
  const { root, site, vault } = layout();
  assert.equal(gmFolderProblem(path.join(root, 'campaign-gm'), { playerSiteDir: site, vaultPath: vault }), null);
});

for (const [why, pick] of [
  ['the player site folder itself', (l) => l.site],
  ['a folder inside the player site folder', (l) => path.join(l.site, 'gm')],
  ['a folder holding the player site folder', (l) => l.root],
  ['the vault', (l) => l.vault],
  ['a folder inside the vault', (l) => path.join(l.vault, 'gm')],
]) {
  test(`refused: ${why}`, () => {
    const l = layout();
    assert.match(gmFolderProblem(pick(l), { playerSiteDir: l.site, vaultPath: l.vault }) || '', /^gm_site\.folder \(/);
  });
}

test('refused: a link that leads into the player site folder', () => {
  const l = layout();
  const link = path.join(l.root, 'sneaky');
  fs.symlinkSync(l.site, link, 'junction');
  assert.ok(gmFolderProblem(path.join(link, 'gm'), { playerSiteDir: l.site, vaultPath: l.vault }));
});

test('refused: a folder with files the GM build did not make; fine once it holds the marker', () => {
  const l = layout();
  const gm = path.join(l.root, 'campaign-gm');
  fs.mkdirSync(gm);
  fs.writeFileSync(path.join(gm, 'notes.txt'), 'mine');
  assert.match(gmFolderProblem(gm, { playerSiteDir: l.site, vaultPath: l.vault }), /files the GM site did not make/);
  fs.writeFileSync(path.join(gm, MARKER_FILE), '{}');
  assert.equal(gmFolderProblem(gm, { playerSiteDir: l.site, vaultPath: l.vault }), null);
});

test('a GM build that failed part-way (pages with the GM meta tag, no marker) is still the GM site\'s folder', () => {
  const l = layout();
  const gm = path.join(l.root, 'campaign-gm');
  fs.mkdirSync(path.join(gm, 'npcs'), { recursive: true });
  fs.writeFileSync(path.join(gm, 'npcs', 'a.html'), '<!doctype html><html><head><meta name="gm-apprentice-build" content="gm"></head></html>');
  assert.equal(gmOutputReason(gm), null);
  assert.equal(gmFolderProblem(gm, { playerSiteDir: l.site, vaultPath: l.vault }), null);
  // A page without the tag does not make it the GM site's.
  fs.writeFileSync(path.join(gm, 'npcs', 'a.html'), '<html><head><meta name="generator" content="x"></head></html>');
  assert.match(gmOutputReason(gm), /did not make/);
  assert.ok(gmFolderProblem(gm, { playerSiteDir: l.site, vaultPath: l.vault }));
});

test('refused: the filesystem root', () => {
  const l = layout();
  assert.ok(gmFolderProblem(path.parse(l.root).root, { playerSiteDir: l.site, vaultPath: l.vault }));
});

test('a relative folder is read from the player site folder; the default sits beside it', () => {
  assert.equal(resolveGmFolder('../campaign-gm', path.join(path.sep, 'a', 'campaign')), path.join(path.sep, 'a', 'campaign-gm'));
  assert.equal(defaultGmFolder(path.join(path.sep, 'a', 'campaign') + path.sep), path.join(path.sep, 'a', 'campaign-gm'));
});

test('a folder starting with ~/ is read from the home folder', () => {
  assert.equal(resolveGmFolder('~/gm', path.join(path.sep, 'a')), path.join(os.homedir(), 'gm'));
});
