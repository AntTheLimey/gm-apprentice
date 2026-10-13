'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, stops, formatFault, nearest } = require('../../lib/settings');

function vault(publishYaml, top = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\ntype: meta\n${top}publish:\n${publishYaml}---\n`);
  return dir;
}
const read = (yaml, siteConfig, top) => readSettings({ vaultPath: vault(yaml, top), siteConfig });
const fault = (r, name) => r.faults.find((f) => f.name === name);

test('a misspelt hiding setting stops, and names the right one', () => {
  const r = read('  exclude_sectoins: [GM Notes]\n');
  const f = fault(r, 'publish.exclude_sectoins');
  assert.equal(f.kind, 'unknown-name');
  assert.equal(f.level, 'stop');
  assert.equal(formatFault(f), 'publish.exclude_sectoins is not a setting. Did you mean publish.exclude_sections?');
  assert.equal(stops(r.faults).length, 1);
});

test('a misspelt look setting warns', () => {
  const f = fault(read('  link_preview: off\n'), 'publish.link_preview');
  assert.equal(f.level, 'warn');
  assert.match(formatFault(f), /Did you mean publish\.link_previews\?$/);
});

test('an unknown name with no near neighbour warns and suggests nothing', () => {
  const f = fault(read('  zebra: 1\n'), 'publish.zebra');
  assert.equal(f.level, 'warn');
  assert.equal(formatFault(f), 'publish.zebra is not a setting.');
});

test('a value a hiding setting cannot take stops, and the safe value is used', () => {
  const r = read('  mode: players\n');
  assert.equal(fault(r, 'publish.mode').level, 'stop');
  assert.equal(r.values.player_site.hide.mode, 'player');
  assert.equal(r.origins['player_site.hide.mode'], 'fault');
  assert.equal(formatFault(fault(r, 'publish.mode')), 'publish.mode is "players"; it takes player or full.');
});

test('a hiding list that is not a list stops and the built-in list is used', () => {
  const r = read('  exclude_sections: GM Notes\n');
  assert.equal(fault(r, 'publish.exclude_sections').level, 'stop');
  assert.deepEqual(r.values.player_site.hide.sections.slice(0, 2), ['GM Notes', 'DM Notes']);
});

// 'gothic' is an accepted name for the horror look, so a name the list does not know stands in.
test('a bad look value warns and the default is used', () => {
  const r = read('  theme:\n    genre: nonesuch\n  landing:\n    max_npcs: lots\n');
  assert.equal(fault(r, 'publish.theme.genre').level, 'warn');
  assert.equal(fault(r, 'publish.landing.max_npcs').level, 'warn');
  assert.equal(r.values.player_site.landing.max_npcs, 6);
});

test('a switch that cannot be read is off, never on', () => {
  const r = read('  site: maybe\n  site_dir: ../site\n  live_stats:\n');
  assert.equal(r.values.player_site.publish, false);
  assert.equal(r.values.player_site.features.live_stats, false);
  assert.equal(r.origins['player_site.publish'], 'fault');
});

test('keys under an open map are never unknown', () => {
  const r = read('  folder_map:\n    "My Folder": mine\n  banners:\n    locations: a.png\n  overrides:\n    fields:\n      "NPCs/Vex.md":\n        include: [secrets]\n  landing:\n    explore_descriptions:\n      anything: text\n  setup_progress:\n    host: cloudflare-pages\n    last_completed_step: 4\n');
  assert.deepEqual(r.faults, []);
});

test('an old name is read, and said', () => {
  const r = read('  backend:\n    statusBar: true\n');
  assert.equal(r.values.player_site.features.live_stats, true);
  assert.equal(r.origins['player_site.features.live_stats'], 'old-name');
  assert.equal(formatFault(fault(r, 'publish.backend.statusBar')), 'publish.backend.statusBar is an old name; use publish.live_stats.');
});

test('a retired setting warns and is not unknown', () => {
  const f = fault(read('  total_sessions: 12\n'), 'publish.total_sessions');
  assert.equal(f.kind, 'retired');
  assert.equal(formatFault(f), 'publish.total_sessions is no longer used; remove it.');
});

test('nearest finds one edit, a swap, and a missing letter, and nothing far away', () => {
  const names = ['exclude_sections', 'exclude_fields', 'link_previews'];
  assert.equal(nearest('exclude_sectoins', names), 'exclude_sections');
  assert.equal(nearest('link_preview', names), 'link_previews');
  assert.equal(nearest('zebra', names), null);
});

test('no file, and a file with no publish block, give every default and say so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  const r = readSettings({ vaultPath: dir });
  const { path: shown, ...rest } = r.file;
  assert.deepEqual(rest, { exists: false, hasPublish: false, inline: false, leftover: false });
  assert.ok(shown.endsWith('vault-config.md'));
  assert.equal(r.values.player_site.features.connections, 'tree');
  assert.deepEqual(r.faults, []);
});

test('invalid YAML throws one line naming the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), '---\npublish:\n  a: [1\n---\n');
  assert.throws(() => readSettings({ vaultPath: dir }), /^Error: _meta\/vault-config\.md frontmatter is not valid YAML: /);
});

test('a name that says it hides stops, whatever it is near', () => {
  for (const name of ['hide_sections', 'hidden_sections', 'exclude_headings', 'exclude_folders', 'Exclude_Stuff', 'hide']) {
    const f = fault(read(`  ${name}: [GM Notes]\n`), `publish.${name}`);
    assert.equal(f.level, 'stop', name);
  }
});

test('a stop with no hiding setting near suggests nothing, and never a setting that does not hide', () => {
  // `hide` is nearest to `site`, which does not hide, so a stop never offers it.
  assert.notEqual(fault(read('  hide: [GM Notes]\n'), 'publish.hide').suggest, 'publish.site');
  const f = fault(read('  hide_sections: [GM Notes]\n'), 'publish.hide_sections');
  assert.equal(f.suggest, null);
  assert.equal(formatFault(f), 'publish.hide_sections is not a setting.');
  assert.equal(fault(read('  exclude_sectoins: [A]\n'), 'publish.exclude_sectoins').suggest, 'publish.exclude_sections');
});

test('look names still warn; a name that says it hides stops at any depth', () => {
  assert.equal(fault(read('  link_preview: off\n'), 'publish.link_preview').level, 'warn');
  assert.equal(fault(read('  zebra: 1\n'), 'publish.zebra').level, 'warn');
  assert.equal(fault(read('  theme:\n    logo_size: 3\n'), 'publish.theme.logo_size').level, 'warn');
  assert.equal(fault(read('  theme:\n    hide_logo: true\n'), 'publish.theme.hide_logo').level, 'stop');
});

test('a hiding setting one level too deep stops and points at the right place', () => {
  const deep = [['theme', 'exclude_sections', '[Secrets]'], ['landing', 'exclude_drafts', 'true'],
    ['images', 'exclude_fields', '[x]'], ['theme', 'exclude_callouts', 'true'], ['landing', 'exclude_dirs', '[A]']];
  for (const [parent, name, value] of deep) {
    const f = fault(read(`  ${parent}:\n    ${name}: ${value}\n`), `publish.${parent}.${name}`);
    assert.equal(f.level, 'stop', name);
    assert.equal(f.suggest, `publish.${name}`, name);
    assert.equal(formatFault(f), `publish.${parent}.${name} is not a setting. Did you mean publish.${name}?`);
  }
  // No nearest-name guessing at depth: a near miss of a hiding setting only stops by its prefix.
  assert.equal(fault(read('  theme:\n    exclude_sectoins: [A]\n'), 'publish.theme.exclude_sectoins').suggest, null);
  // Names that do not say they hide are left alone at depth.
  assert.equal(fault(read('  theme:\n    sections: [A]\n'), 'publish.theme.sections').level, 'warn');
});

test('publish.overrides.exclude stops and says the only override is overrides.fields', () => {
  const f = fault(read('  overrides:\n    exclude: [a]\n'), 'publish.overrides.exclude');
  assert.equal(f.level, 'stop');
  assert.equal(formatFault(f), 'publish.overrides.exclude is not a setting. The only override is publish.overrides.fields.');
  // A near miss of the real one keeps its old suggestion.
  assert.equal(fault(read('  overrides:\n    feilds: {}\n'), 'publish.overrides.feilds').suggest, 'publish.overrides.fields');
});

test('a hiding setting written beside publish: stops, except mode and unrelated keys', () => {
  for (const [name, value] of [['exclude_sections', '[Secrets]'], ['exclude_drafts', 'true'], ['exclude_dirs', '[A]'], ['exclude_whatever', '1'], ['overrides', '{}']]) {
    const r = read('  mode: player\n', undefined, `${name}: ${value}\n`);
    const f = fault(r, name);
    assert.equal(f.kind, 'misplaced', name);
    assert.equal(f.level, 'stop', name);
    assert.equal(stops(r.faults).length, 1, name);
  }
  const f = fault(read('  mode: player\n', undefined, 'exclude_sections: [A]\n'), 'exclude_sections');
  assert.equal(formatFault(f), 'exclude_sections is written beside publish:; it belongs under it, as publish.exclude_sections.');
  assert.match(formatFault(fault(read('  mode: player\n', undefined, 'exclude_whatever: 1\n'), 'exclude_whatever')), /no setting has that name/);
  for (const ok of ['mode: full', 'hide_things: 1', 'system: coc', 'setting_year: 1920', 'sections: x']) {
    assert.deepEqual(stops(read('  mode: player\n', undefined, `${ok}\n`).faults), [], ok);
  }
  // A setting the old file holds, and the notes it keeps beside its settings, say nothing; any other top-level name is a warning (#375).
  for (const ok of ['setting_year: 1920', 'game_system: coc', 'description: x', 'session_naming: x']) {
    assert.deepEqual(read('  mode: player\n', undefined, `${ok}\n`).faults, [], ok);
  }
  const stray = fault(read('  mode: player\n', undefined, 'total_sessions: 4\n'), 'total_sessions');
  assert.equal(stray.level, 'warn');
  assert.equal(stray.kind, 'unknown-name');
});

test('hide does not suggest mode', () => {
  const f = fault(read('  hide: [GM Notes]\n'), 'publish.hide');
  assert.equal(f.level, 'stop');
  assert.equal(f.suggest, null);
});

test('a short stray name near mode only warns; a near-miss of mode still stops', () => {
  for (const name of ['notes', 'name', 'date']) {
    assert.equal(fault(read(`  ${name}: x\n`), `publish.${name}`).level, 'warn', name);
  }
  // `more` is one letter from `mode`, so the nearest-name rule stops it.
  for (const name of ['mod', 'mode_', 'more']) {
    const f = fault(read(`  ${name}: full\n`), `publish.${name}`);
    assert.equal(f.level, 'stop', name);
    assert.equal(f.suggest, 'publish.mode', name);
  }
  for (const name of ['exclude_sectoins', 'overide', 'hide_sections']) {
    assert.equal(fault(read(`  ${name}: [A]\n`), `publish.${name}`).level, 'stop', name);
  }
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
