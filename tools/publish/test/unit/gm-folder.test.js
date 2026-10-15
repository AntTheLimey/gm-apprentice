'use strict';
// tools/publish/test/unit/gm-folder.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gmFolderProblem, gmOutputReason, resolveGmFolder, defaultGmFolder, MARKER_FILE, GM_META_TAG } = require('../../lib/gm-site');

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

test('a folder with GM pages but no marker file is refused, not emptied: pages are never the proof', () => {
  const l = layout();
  const gm = path.join(l.root, 'campaign-gm');
  fs.mkdirSync(path.join(gm, 'npcs'), { recursive: true });
  fs.writeFileSync(path.join(gm, 'npcs', 'a.html'), `<!doctype html><html><head>${GM_META_TAG}</head></html>`);
  assert.match(gmOutputReason(gm), /did not make/);
  assert.match(gmFolderProblem(gm, { playerSiteDir: l.site, vaultPath: l.vault }), /files the GM site did not make/);
  // Only the marker file at the folder's top level makes it the GM site's.
  fs.writeFileSync(path.join(gm, MARKER_FILE), '{}');
  assert.equal(gmOutputReason(gm), null);
  assert.equal(gmFolderProblem(gm, { playerSiteDir: l.site, vaultPath: l.vault }), null);
});

test('refused: the folder is, is inside or holds the player site\'s output folder, outside the site folder or not', () => {
  const l = layout();
  const out = path.join(l.root, 'www');
  fs.mkdirSync(out);
  const opts = { playerSiteDir: l.site, playerOutputDir: out, vaultPath: l.vault };
  assert.match(gmFolderProblem(out, opts), /output folder/);
  assert.match(gmFolderProblem(path.join(out, 'gm'), opts), /inside the player site's output folder/);
  assert.match(gmFolderProblem(l.root, { ...opts, vaultPath: undefined }), /holds the player site's/);
});

// A link to a place not made yet cannot be made on Windows without privileges.
const linkTest = process.platform === 'win32' ? test.skip : test;

linkTest('refused: a dangling link that points into the player site folder', () => {
  const l = layout();
  const link = path.join(l.root, 'dangle');
  fs.symlinkSync(path.join(l.site, 'notyet'), link);
  assert.match(gmFolderProblem(link, { playerSiteDir: l.site, vaultPath: l.vault }) || '', /^gm_site\.folder \(.*inside the player/);
});

linkTest('refused: a dangling link elsewhere, which cannot be made into a folder', () => {
  const l = layout();
  const link = path.join(l.root, 'dangle');
  fs.symlinkSync(path.join(l.root, 'nowhere'), link);
  assert.match(gmFolderProblem(link, { playerSiteDir: l.site, vaultPath: l.vault }) || '', /^gm_site\.folder \(.*leads nowhere/);
});

test('the meta tag deploy looks for is the one exported constant', () => {
  const { isGmOutput } = require('../../lib/gm-site');
  const l = layout();
  const gm = path.join(l.root, 'campaign-gm');
  fs.mkdirSync(gm);
  fs.writeFileSync(path.join(gm, 'a.html'), `<head>${GM_META_TAG}</head>`);
  assert.equal(isGmOutput(gm), true);
  assert.equal(GM_META_TAG, '<meta name="gm-apprentice-build" content="gm">');
});

test('refused: the filesystem root', () => {
  const l = layout();
  assert.ok(gmFolderProblem(path.parse(l.root).root, { playerSiteDir: l.site, vaultPath: l.vault }));
});

test('isGmOutput: true for the marker file (any content) or a tagged page; false for a player folder, an empty one, a missing one', () => {
  const { isGmOutput } = require('../../lib/gm-site');
  const l = layout();
  const marker = path.join(l.root, 'marker');
  fs.mkdirSync(marker);
  fs.writeFileSync(path.join(marker, MARKER_FILE), '{"build":"gm","tool":"1","built":null}\n');
  assert.equal(isGmOutput(marker), true);
  const garbled = path.join(l.root, 'garbled');
  fs.mkdirSync(garbled);
  fs.writeFileSync(path.join(garbled, MARKER_FILE), 'not json');
  assert.equal(isGmOutput(garbled), true);
  const tagged = path.join(l.root, 'tagged');
  fs.mkdirSync(path.join(tagged, 'npcs'), { recursive: true });
  fs.writeFileSync(path.join(tagged, 'npcs', 'a.html'), `<html><head>${GM_META_TAG}</head></html>`);
  assert.equal(isGmOutput(tagged), true);
  const player = path.join(l.root, 'player');
  fs.mkdirSync(player);
  fs.writeFileSync(path.join(player, 'index.html'), '<html><head></head></html>');
  assert.equal(isGmOutput(player), false);
  const empty = path.join(l.root, 'empty');
  fs.mkdirSync(empty);
  assert.equal(isGmOutput(empty), false);
  assert.equal(isGmOutput(path.join(l.root, 'missing')), false);
});

test('a relative folder is read from the player site folder; the default sits beside it', () => {
  const site = path.resolve(path.sep, 'a', 'campaign');
  const beside = path.resolve(path.sep, 'a', 'campaign-gm');
  assert.equal(resolveGmFolder('../campaign-gm', site), beside);
  assert.equal(defaultGmFolder(site + path.sep), beside);
});

test('a folder starting with ~/ is read from the home folder', () => {
  assert.equal(resolveGmFolder('~/gm', path.join(path.sep, 'a')), path.join(os.homedir(), 'gm'));
});
