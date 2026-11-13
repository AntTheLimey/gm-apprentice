'use strict';
// A hide list the vault wrote itself replaces the built-in one, so a built-in entry it lacks shows on the site. The reader
// warns, one fault per list (`hide-list-gap`), naming each missing entry and what it is for; declined silences an entry.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSettings, entry } = require('../lib/settings');
const { loadPublishConfig } = require('../lib/config');
const { writeNewConfig } = require('./helpers/settings-files');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
function vaultWith(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-gap-'));
  made.push(dir);
  writeNewConfig(dir, { version: 1, ...settings });
  return dir;
}
const gaps = (dir) => readSettings({ vaultPath: dir }).faults.filter((f) => f.kind === 'hide-list-gap');
const FIELDS = entry('player_site.hide.fields').default;
const SECTIONS = entry('player_site.hide.sections').default;

test('every built-in entry of both hide lists has a plain `why`', () => {
  for (const name of ['player_site.hide.fields', 'player_site.hide.sections']) {
    const e = entry(name);
    for (const d of e.default) assert.ok(typeof e.whys[d] === 'string' && e.whys[d].length > 8, `${name}: ${d}`);
    assert.deepEqual(Object.keys(e.whys).sort(), [...e.default].sort());
  }
});

test('a list of the vault\'s own that lacks built-in entries is one warning naming each with its why', () => {
  const dir = vaultWith({ player_site: { hide: { fields: FIELDS.filter((f) => f !== 'voice' && f !== 'reliability') } } });
  const found = gaps(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].level, 'warn');
  assert.deepEqual(found[0].entries, ['reliability', 'voice']);
  assert.equal(found[0].message,
    'player_site.hide.fields is your own list and lacks 2 built-in entries, so the site shows them on any page that has them: '
    + 'reliability (how sure a clue is, for the GM); voice (how a character or the campaign is told, for the GM only). '
    + 'Add them, or record the ones you mean to leave out in player_site.hide.declined');
  const printed = [];
  loadPublishConfig(dir, { vaultPath: dir }, (m) => printed.push(m));
  assert.deepEqual(printed.filter((m) => m.includes('your own list')), [found[0].message]);
});

test('sections and fields each get their own warning', () => {
  const dir = vaultWith({ player_site: { hide: { fields: ['secrets'], sections: ['GM Notes', 'Dormant Threads'] } } });
  const found = gaps(dir);
  assert.deepEqual(found.map((f) => f.setting).sort(), ['player_site.hide.fields', 'player_site.hide.sections']);
  const sections = found.find((f) => f.setting === 'player_site.hide.sections');
  assert.ok(sections.entries.includes('Source References'));
  assert.match(sections.message, /Source References \(where a note's facts came from\)/);
  assert.ok(!sections.entries.includes('Dormant Threads'));
});

test('a heading written another way still counts as present', () => {
  const dir = vaultWith({ player_site: { hide: { sections: SECTIONS.map((s) => s.toLowerCase()) } } });
  assert.deepEqual(gaps(dir), []);
});

test('declined silences the entry it names; a built-in-only list and the full list say nothing', () => {
  const dir = vaultWith({ player_site: { hide: { fields: FIELDS.filter((f) => f !== 'voice' && f !== 'reliability'), declined: ['voice'] } } });
  assert.deepEqual(gaps(dir).map((f) => f.entries), [['reliability']]);
  const both = vaultWith({ player_site: { hide: { fields: FIELDS.filter((f) => f !== 'voice'), declined: ['voice'] } } });
  assert.deepEqual(readSettings({ vaultPath: both }).faults, []);
  assert.deepEqual(readSettings({ vaultPath: vaultWith({}) }).faults, []);
  assert.deepEqual(readSettings({ vaultPath: vaultWith({ player_site: { hide: { fields: FIELDS, sections: SECTIONS } } }) }).faults, []);
});

test('a declined name that is no built-in entry is a quiet warning; with no list of its own the built-in entry is not a gap', () => {
  const dir = vaultWith({ player_site: { hide: { declined: ['voice', 'voicce'] } } });
  const faults = readSettings({ vaultPath: dir }).faults;
  assert.deepEqual(faults.map((f) => f.kind), ['dropped']);
  assert.match(faults[0].message, /^player_site\.hide\.declined holds "voicce", which is in neither built-in list .*it does nothing$/);
});

test('the code is in `settings check --json` and `settings get --json`, where campaign-qa reads faults', () => {
  const dir = vaultWith({ player_site: { hide: { fields: ['secrets'] } } });
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-gap-site-'));
  made.push(site);
  const config = path.join(site, 'vault.config.json');
  fs.writeFileSync(config, JSON.stringify({ vaultPath: dir }));
  const run = (...args) => spawnSync(process.execPath, [BIN, 'settings', ...args, '--config', config], { encoding: 'utf8', cwd: site });
  const check = JSON.parse(run('check', '--json').stdout);
  const f = check.faults.find((x) => x.kind === 'hide-list-gap');
  assert.equal(f.level, 'warn');
  assert.ok(f.entries.includes('voice'));
  assert.ok(JSON.parse(run('get', 'player_site.hide.fields', '--json').stdout).faults.some((x) => x.kind === 'hide-list-gap'));
});
