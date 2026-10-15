'use strict';
// `build` takes --site player|gm. No --site: the player site, then the GM site while gm_site.publish is on; with the
// player site switched off and the GM site on, the GM site alone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeNewConfig } = require('../helpers/settings-files');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// A vault with one note and a site folder. `player` and `gm` are merged into the two sites' settings.
function vaultSite({ player = {}, gm = null } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-site-')));
  made.push(root);
  const vault = path.join(root, 'vault');
  const site = path.join(root, 'campaign');
  const gmDir = path.join(root, 'campaign-gm');
  fs.mkdirSync(path.join(vault, 'NPCs'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'NPCs', 'Ada.md'), '---\ntype: npc\n---\n# Ada\n\nA clerk.\n');
  fs.mkdirSync(site);
  writeNewConfig(vault, {
    version: 1,
    player_site: { folder: site, title: 'T', folder_map: { NPCs: 'npcs' }, ...player },
    ...(gm ? { gm_site: { folder: gmDir, ...gm } } : {}),
  });
  fs.writeFileSync(path.join(site, 'vault.config.json'), JSON.stringify({ vaultPath: '../vault' }));
  return { site, playerOut: path.join(site, 'docs'), gmOut: gmDir };
}
const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, 'build', ...args], { encoding: 'utf8', cwd });

test('--site gm with the GM site off exits 1 naming gm_site.publish and builds nothing', () => {
  const s = vaultSite();
  const r = run(s.site, '--site', 'gm');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /The GM site is off for this vault \(gm_site\.publish\); nothing was built\./);
  assert.equal(fs.existsSync(s.playerOut), false);
  assert.equal(fs.existsSync(s.gmOut), false);
});

test('no --site with both sites on writes both folders', () => {
  const s = vaultSite({ gm: { publish: true } });
  const r = run(s.site);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(s.playerOut, 'index.html')));
  assert.ok(fs.existsSync(path.join(s.gmOut, 'gm-build.json')));
});

test('no --site with the GM site off writes only the player folder', () => {
  const s = vaultSite();
  const r = run(s.site);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(s.playerOut, 'index.html')));
  assert.equal(fs.existsSync(s.gmOut), false);
});

test('--site player writes only the player folder, though the GM site is on', () => {
  const s = vaultSite({ gm: { publish: true } });
  const r = run(s.site, '--site', 'player');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(s.playerOut, 'index.html')));
  assert.equal(fs.existsSync(s.gmOut), false);
});

test('--site gm writes only the GM folder', () => {
  const s = vaultSite({ gm: { publish: true } });
  const r = run(s.site, '--site', 'gm');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(s.gmOut, 'gm-build.json')));
  assert.equal(fs.existsSync(s.playerOut), false);
});

test('with the player site off and the GM site on, no --site builds the GM site alone', () => {
  const s = vaultSite({ player: { publish: false }, gm: { publish: true } });
  const r = run(s.site);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(s.gmOut, 'gm-build.json')));
  assert.equal(fs.existsSync(s.playerOut), false);
});

test('--site player with the player site off gives the off message and exits 1', () => {
  const s = vaultSite({ player: { publish: false }, gm: { publish: true } });
  const r = run(s.site, '--site', 'player');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Build failed: /);
  assert.equal(fs.existsSync(s.gmOut), false);
});

test('--site public exits 1 and names the two sites', () => {
  const s = vaultSite({ gm: { publish: true } });
  const r = run(s.site, '--site', 'public');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown site: public\. Use --site player or --site gm\./);
  assert.equal(fs.existsSync(s.playerOut), false);
});
