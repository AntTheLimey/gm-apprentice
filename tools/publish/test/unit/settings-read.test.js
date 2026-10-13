'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, movedKeys } = require('../../lib/settings');
const { cases } = require('../helpers/settings-matrix');
const { vaultFor } = require('../../scripts/capture-settings-golden');

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/settings-golden.json'), 'utf8'));
const CASES = new Map(cases().map((c) => [c.id, c]));

// Reads a golden case's vault and site file through readSettings; returns the result and the golden.
function both(id) {
  const c = CASES.get(id);
  assert.ok(c, `no case ${id}`);
  const dir = vaultFor(c);
  const r = readSettings({ vaultPath: dir, siteConfig: c.siteConfig || {} });
  const sub = (v) => JSON.parse(JSON.stringify(v).split(dir).join('<vault>'));
  return { values: sub(r.values.player_site), legacy: sub(r.legacy), golden: GOLDEN[id].publishConfig, r };
}

test('the moved-key table is rebuilt from the list, in the old order', () => {
  assert.deepEqual(movedKeys(), [
    { json: 'siteTitle', publish: 'site_title', kind: 'scalar' },
    { json: 'footer', publish: 'footer', kind: 'scalar' },
    { json: 'searchEnabled', publish: 'search', kind: 'scalar' },
    { json: 'folderMap', publish: 'folder_map', kind: 'map' },
    { json: 'attachmentsDir', publish: 'attachments_dir', kind: 'scalar' },
    { json: 'system', publish: 'system', kind: 'scalar' },
    { json: 'excludeDirs', publish: 'exclude_dirs', kind: 'list' },
    { json: 'excludeSections', publish: 'exclude_sections', kind: 'list' },
    { json: 'excludeFields', publish: 'exclude_fields', kind: 'list' },
    { json: 'excludeCallouts', publish: 'exclude_callouts', kind: 'scalar' },
    { json: 'sheet_crest', publish: 'sheet_crest', kind: 'scalar' },
    { json: 'landing', publish: 'landing', kind: 'map' },
    { json: 'images', publish: 'images', kind: 'map' },
    { json: 'banners', publish: 'banners', kind: 'map' },
    { json: 'locations', publish: 'locations', kind: 'map' },
  ]);
});

// A vault with only this publish block, read through readSettings.
function readBlock(publishYaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-rb-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\npublish:\n${publishYaml}---\n`);
  try { return readSettings({ vaultPath: dir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a genre alias is read as its preset, and an unknown genre is a fault', () => {
  assert.equal(readBlock('  theme:\n    genre: Sci-Fi\n').values.player_site.theme.genre, 'scifi');
  assert.equal(readBlock('  theme:\n    genre: gothic\n').values.player_site.theme.genre, 'horror');
  const r = readBlock('  theme:\n    genre: steampunk\n');
  assert.equal(r.values.player_site.theme.genre, null);
  assert.ok(r.faults.some((f) => f.name === 'publish.theme.genre'));
});

test('the sheet skin and frame are read in any case; an unknown one is null with a fault', () => {
  const r = readBlock('  sheet_skin: Console\n  sheet_frame: ring\n');
  assert.deepEqual([r.values.player_site.sheets.skin, r.values.player_site.sheets.frame], ['console', 'ring']);
  const bad = readBlock('  sheet_skin: vellum\n');
  assert.equal(bad.values.player_site.sheets.skin, null);
  assert.ok(bad.faults.some((f) => f.name === 'publish.sheet_skin'));
  assert.equal(readBlock('').values.player_site.sheets.skin, null);
});

test('a vault list and a site list: the vault entries first, then what only the site has', () => {
  const { values, legacy, golden } = both('exclude_sections-two-entries-with-site-list');
  assert.deepEqual(values.hide.sections, ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(values.hide.sections, golden.exclude_sections);
  assert.deepEqual(legacy, golden.legacy);
});

test('a vault list that is a bare string, with a site list', () => {
  const { values, legacy, golden, r } = both('exclude_sections-bare-string-with-site-list');
  assert.deepEqual(values.hide.sections, golden.exclude_sections);
  assert.deepEqual(legacy, golden.legacy);
  assert.equal(r.faults.find((f) => f.name === 'publish.exclude_sections').level, 'stop');
});

test('exclude_callouts [note] in the vault, true in the site file: true', () => {
  const { values, legacy, golden } = both('exclude_callouts-list-site-true');
  assert.equal(values.hide.callouts, true);
  assert.equal(values.hide.callouts, golden.exclude_callouts);
  assert.deepEqual(legacy, golden.legacy);
});

test('landing in both files: the site file adds the sub-key the vault lacks', () => {
  const { values, legacy, golden, r } = both('landing-site-extra-subkey');
  assert.deepEqual(values.landing, { ...golden.landing, max_events: 4, explore_descriptions: null, featured_npcs: [], featured_locations: [], quick_links: [] });
  assert.equal(values.landing.max_npcs, 3);
  assert.equal(values.landing.max_locations, 2);
  assert.deepEqual(legacy, golden.legacy);
  assert.equal(r.origins['player_site.landing.max_locations'], 'site-file');
  assert.equal(r.origins['player_site.landing.max_npcs'], 'file');
});

test('exclude_dirs spelt Secrets/ in one file and Secrets in the other is one entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), '---\npublish:\n  exclude_dirs: [Secrets/]\n---\n');
  const r = readSettings({ vaultPath: dir, siteConfig: { excludeDirs: ['Secrets', 'Other'] } });
  assert.deepEqual(r.values.player_site.hide.folders, ['Secrets', 'Other']);
  assert.deepEqual(r.legacy[0].stillApplied, ['Other']);
});

test('a site-file value reads as the site file, and an unset switch as the default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  const r = readSettings({ vaultPath: dir, siteConfig: { siteTitle: 'Gone South', backend: { inbox: true } } });
  assert.equal(r.values.player_site.title, 'Gone South');
  assert.equal(r.origins['player_site.title'], 'site-file');
  assert.equal(r.values.player_site.features.inbox, true);
  assert.equal(r.origins['player_site.features.inbox'], 'old-name');
  assert.equal(r.origins['player_site.features.search'], 'default');
});

test('a site is on when site_dir is set and nothing else says', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  const at = (yaml) => { fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\npublish:\n${yaml}---\n`); return readSettings({ vaultPath: dir }); };
  assert.equal(at('  site_dir: ../site\n').values.player_site.publish, true);
  assert.equal(at('  site_dir: ../site\n').origins['player_site.publish'], 'default');
  assert.equal(at('  site_dir:\n').values.player_site.publish, false);
  assert.equal(at('  site_dir: ../site\n  site: false\n').values.player_site.publish, false);
});

test('an inline publish map is noticed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), '---\npublish: {mode: full}\n---\n');
  const r = readSettings({ vaultPath: dir });
  assert.ok(r.file.exists && r.file.hasPublish && r.file.inline && !r.file.leftover);
  assert.equal(r.values.player_site.hide.mode, 'full');
});

test('an unknown system id warns and is kept as written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), '---\npublish:\n  system: starfinder\n  section_titles:\n    locatons: Places\n---\n');
  const r = readSettings({ vaultPath: dir });
  assert.equal(r.values.vault.system, 'starfinder');
  assert.equal(r.faults.find((f) => f.name === 'publish.system').level, 'warn');
  assert.equal(r.faults.find((f) => f.name === 'publish.section_titles.locatons').suggest, 'publish.section_titles.locations');
});

function readYaml(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\npublish:\n${yaml}---\n`);
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
  assert.equal(m.values.player_site.hide.mode, 'player');
  assert.equal(m.origins['player_site.hide.mode'], 'default');
  assert.deepEqual(m.faults, []);
});

test('an empty switch is unreadable, so off', () => {
  const r = readYaml('  site_dir: ../site\n  site:\n');
  assert.equal(r.values.player_site.publish, false);
  assert.equal(r.origins['player_site.publish'], 'fault');
  assert.equal(r.faults.filter((f) => f.name === 'publish.site').length, 1);
});

test('hiding lists with numbers and booleans read as text, no fault', () => {
  const r = readYaml('  exclude_sections: [Alpha, 3, true]\n');
  assert.deepEqual(r.values.player_site.hide.sections, ['Alpha', '3', 'true']);
  assert.deepEqual(r.faults, []);
});

test('an unknown image format is kept as written, and said', () => {
  const r = readYaml('  images:\n    format: png\n    quality: 150\n');
  assert.equal(r.values.player_site.images.format, 'png');
  assert.equal(r.values.player_site.images.quality, 150);
  assert.deepEqual(r.faults.map((f) => f.name), ['publish.images.format']);
});
