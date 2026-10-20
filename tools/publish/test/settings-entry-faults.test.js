'use strict';
// A fault in what a list setting holds, entry by entry, is found by the settings reader, so the Settings check,
// `settings get --json` and the build all report it the same way; the build still leaves the bad entry out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSettings } = require('../lib/settings');
const { loadPublishConfig } = require('../lib/config');
const { writeNewConfig } = require('./helpers/settings-files');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function vaultWith(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-faults-'));
  made.push(dir);
  writeNewConfig(dir, { version: 1, ...settings });
  return dir;
}
const warnsOf = (faults, setting) => faults.filter((f) => f.setting === setting && f.level === 'warn').map((f) => f.message);

test('a blank build step is a warning on its setting, from the reader; the build drops the step and adds no second warning', () => {
  for (const slot of ['before_build', 'after_build']) {
    const dir = vaultWith({ player_site: { [slot]: ['echo hi', '   '] } });
    const found = warnsOf(readSettings({ vaultPath: dir }).faults, `player_site.${slot}`);
    assert.deepEqual(found, [`player_site.${slot} has a blank entry; it was left out`]);
    const printed = [];
    const config = loadPublishConfig(dir, { vaultPath: dir }, (m) => printed.push(m));
    assert.deepEqual(printed.filter((m) => m.includes(slot)), found);
    assert.deepEqual(config.steps[slot.split('_')[0]], ['echo hi']);
  }
});

test('a repeated menu entry is a warning from the reader; the build leaves the second out; a link to a note with no page is not a settings fault', () => {
  // Labels are compared as written; groups without regard to case.
  const dup = vaultWith({ player_site: { menu_extra: [
    { label: 'Gazetteer', link: 'a/index.html', group: 'World' },
    { label: 'Gazetteer', link: 'b/index.html', group: 'world' },
    { label: 'Gazetteer', link: 'c/index.html', group: 'Story' },
    { label: 'Other', link: 'a-note-with-no-page' },
  ] } });
  const faults = readSettings({ vaultPath: dup }).faults;
  assert.deepEqual(warnsOf(faults, 'player_site.menu_extra'), ['player_site.menu_extra lists "Gazetteer" twice under world; the second is left out']);
  const printed = [];
  const config = loadPublishConfig(dup, { vaultPath: dup }, (m) => printed.push(m));
  assert.equal(printed.filter((m) => m.includes('menu_extra')).length, 1);
  assert.deepEqual(config.menu_extra.map((m) => m.link), ['a/index.html', 'c/index.html', 'a-note-with-no-page']);
  assert.equal(faults.filter((f) => /no page/.test(f.message)).length, 0, 'a missing page is the build\'s to find');
});

test('a blank label or a missing link is a warning from the reader, naming the entry', () => {
  const dir = vaultWith({ player_site: { menu_extra: [{ label: 'Fine', link: 'a/index.html' }, { label: 'No link' }, { link: 'b/index.html' }] } });
  const found = warnsOf(readSettings({ vaultPath: dir }).faults, 'player_site.menu_extra');
  assert.equal(found.length, 2);
  assert.match(found[0], /"No link" is missing its `link`/);
  assert.match(found[1], /entry 3 is missing its `label`/);
});

test('a fallen word the GM wrote that is not out of play is a warning from the reader; a built-in one the GM narrowed away is not', () => {
  const dir = vaultWith({ vault: { statuses: { out_of_play: ['dead'], fallen: ['dead', ' Missing '] } } });
  const found = warnsOf(readSettings({ vaultPath: dir }).faults, 'vault.statuses.fallen');
  assert.deepEqual(found, ['vault.statuses.fallen holds "missing", which is not in vault.statuses.out_of_play; it does not count as fallen']);
  const printed = [];
  const config = loadPublishConfig(dir, { vaultPath: dir }, (m) => printed.push(m));
  assert.deepEqual(printed.filter((m) => m.includes('fallen')), found);
  assert.deepEqual([...config.statuses.fallen], ['dead']);

  const narrowed = vaultWith({ vault: { statuses: { out_of_play: ['dead'] } } });
  assert.deepEqual(readSettings({ vaultPath: narrowed }).faults, []);
  const quiet = [];
  const cfg = loadPublishConfig(narrowed, { vaultPath: narrowed }, (m) => quiet.push(m));
  assert.deepEqual(quiet, []);
  assert.deepEqual([...cfg.statuses.fallen], ['dead']);
});

test('`settings check` and `settings get --json` carry the three faults', () => {
  const dir = vaultWith({
    vault: { statuses: { out_of_play: ['dead'], fallen: ['missing'] } },
    player_site: { before_build: [' '], menu_extra: [{ label: 'A', link: 'x/index.html' }, { label: 'A', link: 'y/index.html' }] },
  });
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-faults-site-'));
  made.push(site);
  const config = path.join(site, 'vault.config.json');
  fs.writeFileSync(config, JSON.stringify({ vaultPath: dir }));
  const run = (...args) => spawnSync(process.execPath, [BIN, 'settings', ...args, '--config', config], { encoding: 'utf8', cwd: site });
  const check = run('check', '--json');
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout).faults.map((f) => f.setting).sort(), ['player_site.before_build', 'player_site.menu_extra', 'vault.statuses.fallen']);
  const plain = run('check');
  assert.doesNotMatch(plain.stdout, /reads cleanly/);
  assert.equal((plain.stdout.match(/^Warning:/gm) || []).length, 3);
});
