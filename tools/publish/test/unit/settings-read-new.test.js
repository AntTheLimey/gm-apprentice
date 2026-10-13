'use strict';
// Reading the new settings file, rule by rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, stops, REGISTRY, entry } = require('../../lib/settings');
const { writeNewConfig, writeOldConfig } = require('../helpers/settings-files');

const vault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'read-new-'));
const read = (text, siteConfig) => {
  const v = vault();
  writeNewConfig(v, text);
  return readSettings({ vaultPath: v, siteConfig });
};
const fault = (r, name) => r.faults.find((f) => f.name === name);
const nested = (name, valueText) => {
  const segs = name.split('.');
  return segs.map((s, i) => `${'  '.repeat(i)}${s}:${i === segs.length - 1 ? ` ${valueText}` : ''}`).join('\n') + '\n';
};

// 1
test('a document with errors throws one line naming the file', () => {
  const v = vault();
  writeNewConfig(v, 'player_site:\n  title: [a\n');
  assert.throws(() => readSettings({ vaultPath: v }), (e) => /^_meta\/vault-config\.yaml is not valid YAML: [^\n]+$/.test(e.message));
});

test('a repeated key is not valid YAML here either', () => {
  assert.throws(() => read('player_site:\n  title: A\n  title: B\n'), /is not valid YAML/);
});

test('a file that is a list, not settings, throws', () => {
  assert.throws(() => read('- a\n- b\n'), /must hold settings/);
});

test('an empty file reads every default', () => {
  const r = read('');
  assert.equal(r.layout, 'new');
  assert.equal(r.values.player_site.features.connections, 'tree');
  assert.deepEqual(r.faults, []);
  assert.equal(r.origins['player_site.features.connections'], 'default');
});

test('a value is read from the file and says so', () => {
  const r = read('player_site:\n  features:\n    connections: web\n  hide:\n    sections: [Rumours]\n');
  assert.equal(r.values.player_site.features.connections, 'web');
  assert.equal(r.origins['player_site.features.connections'], 'file');
  assert.deepEqual(r.values.player_site.hide.sections, ['Rumours']);
  assert.deepEqual(r.faults, []);
});

// 2
test('the site file is not merged; each setting key still in it is a warning naming the new setting', () => {
  const r = read('version: 1\n', { vaultPath: './v', siteTitle: 'Old', excludeSections: ['X'], backend: { inbox: true }, outputDir: 'docs' });
  assert.equal(r.values.player_site.title, null);
  assert.equal(r.values.player_site.features.inbox, false);
  assert.deepEqual(r.values.player_site.hide.sections, entry('player_site.hide.sections').default);
  const olds = r.faults.filter((f) => f.kind === 'old-name');
  assert.deepEqual(olds.map((f) => f.name).sort(), ['backend.inbox', 'excludeSections', 'siteTitle']);
  for (const f of olds) assert.equal(f.level, 'warn');
  assert.equal(fault(r, 'siteTitle').message, "siteTitle in the site folder's vault.config.json is no longer read; it is player_site.title in the vault's settings.");
  assert.equal(fault(r, 'siteTitle').use, 'player_site.title');
});

test('a site file with only deploy keys says nothing', () => {
  assert.deepEqual(read('version: 1\n', { vaultPath: './v', outputDir: 'docs', host: 'github-pages' }).faults, []);
});

// 3
test('a top-level name that is not known stops, with the nearest suggested', () => {
  const r = read('vualt:\n  system: coc\n');
  const f = fault(r, 'vualt');
  assert.equal(f.level, 'stop');
  assert.equal(f.suggest, 'vault');
  assert.match(f.message, /is not a setting\. Did you mean vault\?/);
});

test('publish at the top level says this is the old block, and stops', () => {
  const r = read('publish:\n  mode: player\n');
  const f = fault(r, 'publish');
  assert.equal(f.level, 'stop');
  assert.equal(f.message, 'this file uses the new names; publish is the old block');
  assert.equal(stops(r.faults).length, 1);
});

test('the four known top-level names are quiet', () => {
  assert.deepEqual(read('version: 1\nvault: {}\nplayer_site: {}\ngm_site: {}\n').faults, []);
});

// 4
test('version absent reads as 1 with no fault', () => {
  assert.deepEqual(read('vault:\n  system: coc\n').faults, []);
});

test('version 1 is fine; above 1 throws the newer-plugin line', () => {
  assert.deepEqual(read('version: 1\n').faults, []);
  assert.throws(() => read('version: 2\n'), /^Error: this vault's settings were written by a newer gm-apprentice; update the plugin$/);
});

test('a version that is not a whole number stops', () => {
  for (const text of ['version: 1.5', 'version: abc', 'version: 0', 'version: "1"', 'version:', 'version: [1]']) {
    const r = read(`${text}\n`);
    const f = fault(r, 'version');
    assert.ok(f, text);
    assert.equal(f.level, 'stop', text);
  }
});

// 5
test('an unknown name directly under vault or player_site, or anywhere under player_site.hide, stops', () => {
  for (const [text, name] of [
    ['vault:\n  sistem: coc\n', 'vault.sistem'],
    ['player_site:\n  titel: A\n', 'player_site.titel'],
    ['player_site:\n  hide:\n    zzz: 1\n', 'player_site.hide.zzz'],
    ['player_site:\n  hide:\n    sectons: [A]\n', 'player_site.hide.sectons'],
  ]) {
    const f = fault(read(text), name);
    assert.ok(f, name);
    assert.equal(f.kind, 'unknown-name', name);
    assert.equal(f.level, 'stop', name);
  }
  assert.equal(fault(read('vault:\n  sistem: coc\n'), 'vault.sistem').suggest, 'vault.system');
  assert.equal(fault(read('player_site:\n  hide:\n    sectons: [A]\n'), 'player_site.hide.sectons').suggest, 'player_site.hide.sections');
});

test('an unknown name deeper elsewhere warns, and is kept as written', () => {
  const r = read('player_site:\n  landing:\n    tagline_x: A\n');
  const f = fault(r, 'player_site.landing.tagline_x');
  assert.equal(f.level, 'warn');
  assert.equal(r.values.player_site.landing.tagline_x, 'A');
});

test('a deeper name that says it hides, or is the last part of a hiding setting, stops', () => {
  for (const key of ['exclude_x', 'hidden', 'hide_this', 'sections', 'fields', 'folders', 'drafts', 'callouts']) {
    const f = fault(read(`player_site:\n  landing:\n    ${key}: [A]\n`), `player_site.landing.${key}`);
    assert.equal(f.level, 'stop', key);
  }
});

test('mode is an everyday word deeper down: it only warns', () => {
  assert.equal(fault(read('player_site:\n  theme:\n    mode: dark\n'), 'player_site.theme.mode').level, 'warn');
});

test('a hiding group that is not a map stops; a group left empty is quiet', () => {
  assert.equal(fault(read('player_site:\n  hide: yes\n'), 'player_site.hide').level, 'stop');
  assert.deepEqual(read('player_site:\n  hide:\n').faults, []);
  assert.equal(fault(read('player_site:\n  landing: yes\n'), 'player_site.landing').level, 'warn');
});

// 6
test('an old name written in the new file is named, never read, and stops when it hides', () => {
  const r = read('player_site:\n  exclude_sections: [Mine]\n');
  const f = fault(r, 'player_site.exclude_sections');
  assert.equal(f.kind, 'old-name');
  assert.equal(f.use, 'player_site.hide.sections');
  assert.equal(f.level, 'stop');
  assert.deepEqual(r.values.player_site.hide.sections, entry('player_site.hide.sections').default);
  assert.equal(r.origins['player_site.hide.sections'], 'default');
});

test('an old name for a setting that hides nothing warns, and is not read', () => {
  const r = read('player_site:\n  search: false\nvault:\n  attachments_dir: Pics\n');
  assert.equal(fault(r, 'player_site.search').level, 'warn');
  assert.equal(fault(r, 'player_site.search').use, 'player_site.features.search');
  assert.equal(r.values.player_site.features.search, true);
  assert.equal(fault(r, 'vault.attachments_dir').use, 'vault.attachments');
  assert.equal(fault(r, 'vault.attachments_dir').level, 'warn');
  assert.notEqual(r.values.vault.attachments, 'Pics');
});

test('a top-level setting_year is the old name of vault.setting_year', () => {
  const f = fault(read('setting_year: 1920\n'), 'setting_year');
  assert.equal(f.kind, 'old-name');
  assert.equal(f.use, 'vault.setting_year');
});

// 7
test('anything under gm_site is one warning for the group', () => {
  const r = read('gm_site:\n  title: A\n  theme:\n    mode: dark\n');
  const found = r.faults.filter((f) => f.name === 'gm_site');
  assert.equal(found.length, 1);
  assert.equal(found[0].level, 'warn');
  assert.equal(found[0].message, 'the GM site is not built yet; nothing under gm_site is read');
  assert.equal(r.faults.length, 1);
  assert.equal(r.values.gm_site, undefined);
});

// 8
test('vault.campaign unset is the vault folder name, from the default', () => {
  const v = vault();
  writeNewConfig(v, 'version: 1\n');
  const r = readSettings({ vaultPath: v });
  assert.equal(r.values.vault.campaign, path.basename(v));
  assert.equal(r.origins['vault.campaign'], 'default');
  writeNewConfig(v, 'vault:\n  campaign: The Long Night\n');
  const again = readSettings({ vaultPath: v });
  assert.equal(again.values.vault.campaign, 'The Long Night');
  assert.equal(again.origins['vault.campaign'], 'file');
});

// 9
test('both files present: the old one is not read, and one warning says it is left over', () => {
  const v = vault();
  writeOldConfig(v, { mode: 'full', site_title: 'Old' });
  writeNewConfig(v, 'player_site:\n  title: New\n');
  const r = readSettings({ vaultPath: v });
  assert.equal(r.file.leftover, true);
  assert.equal(r.values.player_site.title, 'New');
  assert.equal(r.values.player_site.hide.mode, 'player');
  const left = r.faults.filter((f) => f.level === 'warn' && /left over/.test(f.message));
  assert.equal(left.length, 1);
  assert.equal(left[0].message, '_meta/vault-config.md is left over from before the update and is not read; the Settings check removes it');
  assert.equal(r.faults.length, 1);
});

test('one file only: not left over, and the file says where it is', () => {
  const v = vault();
  writeNewConfig(v, 'version: 1\n');
  const r = readSettings({ vaultPath: v });
  assert.equal(r.file.leftover, false);
  assert.equal(r.file.exists, true);
  assert.equal(r.file.path, path.join(v, '_meta', 'vault-config.yaml'));
});

// 10
test('an empty key is not set', () => {
  const r = read('player_site:\n  title:\n  features:\n    connections:\n');
  assert.equal(r.values.player_site.title, null);
  assert.equal(r.origins['player_site.title'], 'default');
  assert.equal(r.values.player_site.features.connections, 'tree');
  assert.deepEqual(r.faults, []);
});

test('an empty key on the four switches is off, with a fault', () => {
  const switches = ['player_site.publish', 'player_site.sheets.show', 'player_site.features.live_stats', 'player_site.features.inbox'];
  assert.deepEqual(switches.filter((n) => entry(n).onFault === false).sort(), [...switches].sort());
  for (const name of switches) {
    const r = read(nested(name, ''));
    assert.equal(name.split('.').reduce((o, k) => o[k], r.values), false, name);
    assert.equal(r.origins[name], 'fault', name);
    assert.equal(fault(r, name).kind, 'not-allowed', name);
  }
});

// 11
test('every switch reads all six words, quoted and not', () => {
  const words = { true: true, yes: true, on: true, false: false, no: false, off: false };
  const switches = REGISTRY.filter((e) => e.type === 'switch');
  assert.ok(switches.length >= 7);
  for (const e of switches) {
    for (const [word, want] of Object.entries(words)) {
      for (const text of [word, `"${word}"`, `"${word.toUpperCase()}"`]) {
        const r = read(nested(e.name, text));
        assert.equal(e.name.split('.').reduce((o, k) => o[k], r.values), want, `${e.name}: ${text}`);
        assert.deepEqual(r.faults, [], `${e.name}: ${text}`);
      }
    }
    const bad = read(nested(e.name, 'sideways'));
    assert.equal(fault(bad, e.name).kind, 'not-allowed', e.name);
  }
});

test('types, lists as text, and maps with keys read as the old file read them', () => {
  const r = read('player_site:\n  hide:\n    sections: [A, 3, true]\n  images:\n    max_width: "900"\n    quality: lots\n  theme:\n    fonts:\n      sourcee: google\n');
  assert.deepEqual(r.values.player_site.hide.sections, ['A', '3', 'true']);
  assert.equal(r.values.player_site.images.max_width, 900);
  assert.equal(r.origins['player_site.images.quality'], 'fault');
  assert.equal(r.values.player_site.images.quality, entry('player_site.images.quality').default);
  assert.equal(fault(r, 'player_site.images.quality').level, 'warn');
  assert.ok(fault(r, 'player_site.theme.fonts.sourcee'));
});

test('a hiding value that cannot be read stops and the safe value is used', () => {
  const r = read('player_site:\n  hide:\n    mode: players\n    sections: GM Notes\n');
  assert.equal(fault(r, 'player_site.hide.mode').level, 'stop');
  assert.equal(r.values.player_site.hide.mode, 'player');
  assert.equal(fault(r, 'player_site.hide.sections').level, 'stop');
  assert.equal(fault(r, 'player_site.hide.sections').message.startsWith('player_site.hide.sections is "GM Notes"'), true);
});

test('the site switch is on when a folder is set and nothing else says', () => {
  assert.equal(read('player_site:\n  folder: ../site\n').values.player_site.publish, true);
  assert.equal(read('player_site:\n  folder: ../site\n  publish: no\n').values.player_site.publish, false);
  assert.equal(read('version: 1\n').values.player_site.publish, false);
});

test('a fault on an entry that exists only in the old file carries no new name', () => {
  const v = vault();
  writeOldConfig(v, { backend: 'yes', total_sessions: 4, overrides: 'x' });
  const r = readSettings({ vaultPath: v });
  const named = r.faults.filter((f) => ['publish.backend', 'publish.total_sessions', 'publish.overrides'].includes(f.name));
  assert.equal(named.length, 3);
  for (const f of named) assert.equal(f.setting, null, f.name);
});
