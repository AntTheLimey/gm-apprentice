'use strict';
// `settings set gm_site.publish=on` makes the GM site's folder, and refuses a folder the GM site cannot use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { runSettings } = require('../lib/settings/cli.js');
const { readSettings } = require('../lib/settings');
const { writeNewConfig, writeOldConfig } = require('./helpers/settings-files');

const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function scratch(settings, { legacy = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-set-')));
  made.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  const site = path.join(root, 'campaign');
  fs.mkdirSync(site);
  const withFolder = (s) => ({ ...s, player_site: { folder: site, ...(s.player_site || {}) } });
  if (legacy) writeOldConfig(vault, { site_dir: site });
  else writeNewConfig(vault, { version: 1, ...withFolder(settings || {}) });
  return { root, vault, site };
}
function set(s, args) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb: 'set', vault: s.vault, args }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.join('\n').split('\n'), err };
}
const fileOf = (s) => YAML.parse(fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), 'utf8'));
const gmOf = (s) => (fileOf(s).gm_site || {});

test('1: on, with no folder named, writes <player folder>-gm, makes it and says so', () => {
  const s = scratch();
  const gm = `${s.site}-gm`;
  const { rc, out } = set(s, ['gm_site.publish=on']);
  assert.equal(rc, 0);
  assert.equal(gmOf(s).folder, gm);
  assert.equal(gmOf(s).publish, true);
  assert.ok(fs.statSync(gm).isDirectory());
  const wrote = out.indexOf('Wrote gm_site.publish.');
  assert.ok(wrote >= 0);
  assert.equal(out[wrote + 1], `Made the GM site's folder: ${gm} (gm_site.folder).`);
});

test('2: a folder named in the same command is used, and made when missing', () => {
  const s = scratch();
  const gm = path.join(s.root, 'elsewhere-gm');
  const { rc, out } = set(s, ['gm_site.publish=on', `gm_site.folder=${gm}`]);
  assert.equal(rc, 0);
  assert.equal(gmOf(s).folder, gm);
  assert.ok(fs.statSync(gm).isDirectory());
  assert.ok(out.includes(`Made the GM site's folder: ${gm} (gm_site.folder).`));
});

test('2b: a folder that is already there is kept as it is and not announced as made', () => {
  const s = scratch();
  const gm = path.join(s.root, 'ready');
  fs.mkdirSync(gm);
  const { rc, out } = set(s, ['gm_site.publish=on', `gm_site.folder=${gm}`]);
  assert.equal(rc, 0);
  assert.ok(!out.some((l) => l.startsWith("Made the GM site's folder")));
});

test('3: no player folder and no GM folder: nothing written, one error', () => {
  const s = scratch();
  writeNewConfig(s.vault, { version: 1 });
  const before = fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), 'utf8');
  const { rc, err } = set(s, ['gm_site.publish=on']);
  assert.equal(rc, 1);
  assert.deepEqual(err, ['Error: There is no player_site.folder to put the GM site beside. Name its folder too: settings set gm_site.publish=on gm_site.folder=/path/to/folder']);
  assert.equal(fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), 'utf8'), before);
});

test('3b: a missing parent for the folder gets the same error and nothing is made', () => {
  const s = scratch();
  const gm = path.join(s.root, 'nope', 'deeper');
  const { rc, err } = set(s, ['gm_site.publish=on', `gm_site.folder=${gm}`]);
  assert.equal(rc, 1);
  assert.match(err[0], /^Error: There is no player_site\.folder to put the GM site beside/);
  assert.ok(!fs.existsSync(path.join(s.root, 'nope')));
  assert.equal(gmOf(s).publish, undefined);
});

test('4: a vault kept by a player has no GM site', () => {
  const s = scratch({ vault: { kept_by: 'player' } });
  const { rc, err } = set(s, ['gm_site.publish=on']);
  assert.equal(rc, 1);
  assert.deepEqual(err, ['Error: This vault is kept by a player (vault.kept_by: player), so it has no GM site.']);
  assert.equal(gmOf(s).publish, undefined);
  assert.ok(!fs.existsSync(`${s.site}-gm`));
});

for (const [why, pick] of [
  ['equal to the player folder', (s) => s.site],
  ['inside the player folder', (s) => path.join(s.site, 'gm')],
  ['holding the player folder', (s) => s.root],
  ['inside the vault', (s) => path.join(s.vault, 'gm')],
]) {
  test(`5: a folder ${why} is refused with the rule's message; nothing written`, () => {
    const s = scratch();
    const { rc, err } = set(s, ['gm_site.publish=on', `gm_site.folder=${pick(s)}`]);
    assert.equal(rc, 1);
    assert.match(err[0], /^Error: gm_site\.folder \(/);
    assert.equal(gmOf(s).publish, undefined);
    assert.equal(gmOf(s).folder, undefined);
  });
}

test('5b: a folder that holds files the GM site did not make is refused; nothing written', () => {
  const s = scratch();
  const gm = path.join(s.root, 'full');
  fs.mkdirSync(gm);
  fs.writeFileSync(path.join(gm, 'mine.txt'), 'x');
  const { rc, err } = set(s, ['gm_site.publish=on', `gm_site.folder=${gm}`]);
  assert.equal(rc, 1);
  assert.match(err[0], /files the GM site did not make/);
  assert.equal(gmOf(s).publish, undefined);
});

test('6: a vault still on the old settings file is refused as every new-only setting is', () => {
  const s = scratch(null, { legacy: true });
  const { rc, err } = set(s, ['gm_site.publish=on']);
  assert.equal(rc, 1);
  assert.match(err[0], /needs the new settings file; run the update first/);
  assert.ok(!fs.existsSync(`${s.site}-gm`));
});

test('7: off writes the switch and touches no folder', () => {
  const s = scratch();
  const { rc, out } = set(s, ['gm_site.publish=off']);
  assert.equal(rc, 0);
  assert.equal(gmOf(s).publish, false);
  assert.ok(!out.some((l) => l.startsWith("Made the GM site's folder")));
  assert.ok(!fs.existsSync(`${s.site}-gm`));
});

test('the settings check warns when gm_site.folder breaks the rules', () => {
  const s = scratch();
  writeNewConfig(s.vault, { version: 1, player_site: { folder: s.site }, gm_site: { publish: true, folder: path.join(s.site, 'gm') } });
  const faults = readSettings({ vaultPath: s.vault }).faults.filter((f) => f.setting === 'gm_site.folder');
  assert.equal(faults.length, 1);
  assert.equal(faults[0].level, 'warn');
  assert.match(faults[0].message, /^gm_site\.folder \(/);
  writeNewConfig(s.vault, { version: 1, player_site: { folder: s.site }, gm_site: { publish: true, folder: `${s.site}-gm` } });
  assert.deepEqual(readSettings({ vaultPath: s.vault }).faults.filter((f) => f.setting === 'gm_site.folder'), []);
});
