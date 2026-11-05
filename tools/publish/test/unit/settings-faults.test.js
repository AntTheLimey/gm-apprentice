'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, stops, formatFault, nearest } = require('../../lib/settings');

// `yaml` is the text of _meta/vault-config.yaml.
function vault(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.yaml'), yaml);
  return dir;
}
const read = (yaml) => readSettings({ vaultPath: vault(yaml) });
const fault = (r, name) => r.faults.find((f) => f.name === name);

test('a misspelt hiding setting stops, and names the right one', () => {
  const r = read('player_site:\n  hide:\n    sectoins: [GM Notes]\n');
  const f = fault(r, 'player_site.hide.sectoins');
  assert.equal(f.kind, 'unknown-name');
  assert.equal(f.level, 'stop');
  assert.equal(formatFault(f), 'player_site.hide.sectoins is not a setting. Did you mean player_site.hide.sections?');
  assert.equal(stops(r.faults).length, 1);
});

test('a misspelt look setting warns', () => {
  const f = fault(read('player_site:\n  features:\n    link_preview: off\n'), 'player_site.features.link_preview');
  assert.equal(f.level, 'warn');
  assert.match(formatFault(f), /Did you mean player_site\.features\.link_previews\?$/);
});

test('an unknown name with no near neighbour warns and suggests nothing', () => {
  const f = fault(read('player_site:\n  features:\n    zebra: 1\n'), 'player_site.features.zebra');
  assert.equal(f.level, 'warn');
  assert.equal(formatFault(f), 'player_site.features.zebra is not a setting.');
});

test('a hiding list that is not a list stops and the built-in list is used', () => {
  const r = read('player_site:\n  hide:\n    sections: GM Notes\n');
  assert.equal(fault(r, 'player_site.hide.sections').level, 'stop');
  assert.deepEqual(r.values.player_site.hide.sections.slice(0, 2), ['GM Notes', 'DM Notes']);
});

// 'gothic' is an accepted name for the horror look, so a name the list does not know stands in.
test('a bad look value warns and the default is used', () => {
  const r = read('player_site:\n  theme:\n    genre: nonesuch\n  landing:\n    max_npcs: lots\n');
  assert.equal(fault(r, 'player_site.theme.genre').level, 'warn');
  assert.equal(fault(r, 'player_site.landing.max_npcs').level, 'warn');
  assert.equal(r.values.player_site.landing.max_npcs, 6);
});

test('a switch that cannot be read is off, never on', () => {
  const r = read('player_site:\n  publish: maybe\n  folder: ../site\n  features:\n    live_stats:\n');
  assert.equal(r.values.player_site.publish, false);
  assert.equal(r.values.player_site.features.live_stats, false);
  assert.equal(r.origins['player_site.publish'], 'fault');
});

test('keys under an open map are never unknown', () => {
  const r = read('player_site:\n  folder_map:\n    "My Folder": mine\n  lists:\n    banners:\n      locations: a.png\n  hide:\n    field_exceptions:\n      "NPCs/Vex.md":\n        include: [secrets]\n  landing:\n    explore_descriptions:\n      anything: text\n');
  assert.deepEqual(r.faults, []);
});

test('nearest finds one edit, a swap, and a missing letter, and nothing far away', () => {
  const names = ['exclude_sections', 'exclude_fields', 'link_previews'];
  assert.equal(nearest('exclude_sectoins', names), 'exclude_sections');
  assert.equal(nearest('link_preview', names), 'link_previews');
  assert.equal(nearest('zebra', names), null);
});

test('saysHiding is one rule: a hiding last part, or an exclude/hid prefix; mode is an everyday word; beside the block only exclude_ counts', () => {
  const { saysHiding, hidingLasts } = require('../../lib/settings/faults');
  const lasts = hidingLasts(['player_site.hide.sections', 'player_site.hide.mode', 'publish.exclude_dirs']);
  assert.equal(saysHiding('sections', lasts), true);
  assert.equal(saysHiding('exclude_dirs', lasts), true);
  assert.equal(saysHiding('Excluded', lasts), true);
  assert.equal(saysHiding('hidden', lasts), true);
  assert.equal(saysHiding('mode', lasts), false);
  assert.equal(saysHiding('title', lasts), false);
  assert.equal(saysHiding('hidden', lasts, { beside: true }), false);
  assert.equal(saysHiding('exclude_x', lasts, { beside: true }), true);
  assert.equal(saysHiding('sections', lasts, { beside: true }), true);
});
