'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../../lib/settings');
const { writeFromOldText } = require('../helpers/vault-files');

// A vault whose settings are what this old-style publish block stands for, read through readSettings.
function readBlock(publishYaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rb-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  writeFromOldText(dir, `---\npublish:\n${publishYaml}---\n`);
  try { return readSettings({ vaultPath: dir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a genre alias is read as its preset, and an unknown genre is a fault', () => {
  assert.equal(readBlock('  theme:\n    genre: Sci-Fi\n').values.player_site.theme.genre, 'scifi');
  assert.equal(readBlock('  theme:\n    genre: gothic\n').values.player_site.theme.genre, 'horror');
  const r = readBlock('  theme:\n    genre: steampunk\n');
  assert.equal(r.values.player_site.theme.genre, null);
  assert.ok(r.faults.some((f) => f.name === 'player_site.theme.genre'));
});

test('the sheet skin and frame are read in any case; an unknown one is null with a fault', () => {
  const r = readBlock('  sheet_skin: Console\n  sheet_frame: ring\n');
  assert.deepEqual([r.values.player_site.sheets.skin, r.values.player_site.sheets.frame], ['console', 'ring']);
  const bad = readBlock('  sheet_skin: vellum\n');
  assert.equal(bad.values.player_site.sheets.skin, null);
  assert.ok(bad.faults.some((f) => f.name === 'player_site.sheets.skin'));
  assert.equal(readBlock('').values.player_site.sheets.skin, null);
});

test('an unknown system id warns and is kept as written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  writeFromOldText(dir, '---\npublish:\n  system: starfinder\n  section_titles:\n    locatons: Places\n---\n');
  const r = readSettings({ vaultPath: dir });
  assert.equal(r.values.vault.system, 'starfinder');
  assert.equal(r.faults.find((f) => f.name === 'vault.system').level, 'warn');
  assert.equal(r.faults.find((f) => f.name === 'player_site.lists.section_titles.locatons').suggest, 'player_site.lists.section_titles.locations');
});

function readYaml(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  writeFromOldText(dir, `---\npublish:\n${yaml}---\n`);
  return readSettings({ vaultPath: dir });
}

test('a key written with nothing after it is not set', () => {
  const t = readYaml('  site_title:\n');
  assert.equal(t.values.player_site.title, null);
  assert.equal(t.origins['player_site.title'], 'default');
  assert.deepEqual(t.faults, []);
  const s = readYaml('  exclude_sections:\n');
  assert.deepEqual(s.values.player_site.hide.sections.slice(0, 2), ['GM Notes', 'DM Notes']);
  assert.equal(s.origins['player_site.hide.sections'], 'default');
  assert.deepEqual(s.faults, []);
  const m = readYaml('  mode:\n');
  assert.equal(m.values.player_site.hide.mode, undefined);
  assert.equal(m.origins['player_site.hide.mode'], undefined);
  assert.deepEqual(m.faults, []);
});

test('an empty switch is unreadable, so off', () => {
  const r = readYaml('  site_dir: ../site\n  site:\n');
  assert.equal(r.values.player_site.publish, false);
  assert.equal(r.origins['player_site.publish'], 'fault');
  assert.equal(r.faults.filter((f) => f.name === 'player_site.publish').length, 1);
});

test('hiding lists read a number that reads back as written as text, no fault; a boolean stops', () => {
  const r = readYaml('  exclude_sections: [Alpha, 3]\n');
  assert.deepEqual(r.values.player_site.hide.sections, ['Alpha', '3']);
  assert.deepEqual(r.faults.filter((f) => f.kind !== 'hide-list-gap'), []);
  const b = readYaml('  exclude_sections: [Alpha, true]\n');
  assert.deepEqual(b.faults.filter((f) => f.kind !== 'hide-list-gap').map((f) => [f.level, f.message]), [['stop', "player_site.hide.sections entry true is read as true, not text, so it would not match; write it in quotes: 'true'"]]);
});

test('an unknown image format is kept as written, and said', () => {
  const r = readYaml('  images:\n    format: png\n    quality: 150\n');
  assert.equal(r.values.player_site.images.format, 'png');
  assert.equal(r.values.player_site.images.quality, 150);
  assert.deepEqual(r.faults.map((f) => f.name), ['player_site.images.format']);
});
