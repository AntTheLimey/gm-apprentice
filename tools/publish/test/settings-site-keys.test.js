'use strict';
// The five keys a site folder's vault.config.json used to hold (siteUrl, host, outputDir,
// cloudflarePagesProject, preserveDirs) are settings now: player_site.url, .host, .output,
// .cloudflare_project and .keep. Each rule is tested on both layouts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../lib/settings');
const { DEPLOY_KEYS } = require('../lib/settings/legacy');
const { resolveConfig } = require('../lib/config');
const { writeNewConfig, writeOldConfig } = require('./helpers/settings-files');

const KEYS = [
  ['siteUrl', 'player_site.url'],
  ['host', 'player_site.host'],
  ['outputDir', 'player_site.output'],
  ['cloudflarePagesProject', 'player_site.cloudflare_project'],
  ['preserveDirs', 'player_site.keep'],
];
const NAMES = KEYS.map(([, name]) => name);
const SHORT = (name) => name.split('.').pop();

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'site-keys-'));
}

// A vault and a site folder. `layout` 'legacy' keeps the five keys in the site file (the only place the old
// layout has for them); 'new' puts them in the vault's own file under player_site.
function site(layout, given = {}) {
  const root = tmp();
  const vault = path.join(root, 'vault');
  const siteDir = path.join(root, 'site');
  // A value may be a function of the site folder (an absolute path to somewhere in it).
  const values = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, typeof v === 'function' ? v(siteDir) : v]));
  fs.mkdirSync(siteDir, { recursive: true });
  const byKey = Object.fromEntries(KEYS.filter(([key]) => key in values).map(([key]) => [key, values[key]]));
  if (layout === 'new') {
    const player = Object.fromEntries(KEYS.filter(([key]) => key in values).map(([key, name]) => [SHORT(name), values[key]]));
    writeNewConfig(vault, { version: 1, player_site: player });
    return { vault, siteDir, siteConfig: { vaultPath: '../vault' }, root };
  }
  writeOldConfig(vault, { mode: 'player' });
  return { vault, siteDir, siteConfig: { vaultPath: '../vault', ...byKey }, root };
}
const read = (s, extra = {}) => readSettings({ vaultPath: s.vault, siteConfig: s.siteConfig, siteDir: s.siteDir, ...extra });
const faultsOn = (r, name) => r.faults.filter((f) => f.setting === name);

const FULL = { siteUrl: 'https://x.example/camp', host: 'cloudflare-pages', outputDir: 'public', cloudflarePagesProject: 'proj', preserveDirs: ['keep', 'extra'] };

for (const layout of ['legacy', 'new']) {
  test(`${layout}: left out, the five settings take their built-in values`, () => {
    const r = read(site(layout));
    assert.equal(r.values.player_site.url, null);
    assert.equal(r.values.player_site.host, 'github-pages');
    assert.equal(r.values.player_site.output, 'docs');
    assert.equal(r.values.player_site.cloudflare_project, null);
    assert.deepEqual(r.values.player_site.keep, []);
    for (const name of NAMES) assert.equal(r.origins[name], 'default', name);
  });

  test(`${layout}: a host that is neither is a warning, and github-pages is used`, () => {
    const r = read(site(layout, { host: 'netlify' }));
    assert.equal(r.values.player_site.host, 'github-pages');
    const f = faultsOn(r, 'player_site.host').filter((x) => x.kind === 'not-allowed');
    assert.equal(f.length, 1);
    assert.equal(f[0].level, 'warn');
  });

  test(`${layout}: output inside the site folder is read; outside it, or the folder itself, is a stop`, () => {
    for (const good of ['public', './public', 'a/b']) {
      const r = read(site(layout, { outputDir: good }));
      assert.equal(r.values.player_site.output, good);
      assert.deepEqual(faultsOn(r, 'player_site.output').filter((f) => f.level === 'stop'), [], good);
    }
    // An absolute path is judged against the site folder it is built for.
    const insideAbs = site(layout, { outputDir: (dir) => path.join(dir, 'built') });
    assert.deepEqual(faultsOn(read(insideAbs), 'player_site.output'), []);
    const outsideAbs = site(layout, { outputDir: path.join(tmp(), 'elsewhere') });
    assert.equal(faultsOn(read(outsideAbs), 'player_site.output').filter((f) => f.level === 'stop').length, 1);
    for (const bad of ['..', '../elsewhere', 'a/../..', '.', './', '', 7]) {
      const r = read(site(layout, { outputDir: bad }));
      const stops = faultsOn(r, 'player_site.output').filter((f) => f.level === 'stop');
      assert.equal(stops.length, 1, `${JSON.stringify(bad)}: ${JSON.stringify(r.faults)}`);
      assert.equal(r.values.player_site.output, 'docs', 'the built-in folder stands in, and the build stops');
    }
  });

  test(`${layout}: keep takes plain folder names; anything else is a stop`, () => {
    const ok = read(site(layout, { preserveDirs: ['keep', 'Maps 2'] }));
    assert.deepEqual(ok.values.player_site.keep, ['keep', 'Maps 2']);
    assert.deepEqual(faultsOn(ok, 'player_site.keep'), []);
    const none = read(site(layout, { preserveDirs: [] }));
    assert.deepEqual(none.values.player_site.keep, []);
    for (const bad of [['a/b'], ['a\\b'], ['..'], ['a..b'], [''], ['  '], 'keep', 5, { a: 1 }, [['x']]]) {
      const r = read(site(layout, { preserveDirs: bad }));
      const stops = faultsOn(r, 'player_site.keep').filter((f) => f.level === 'stop');
      assert.equal(stops.length, 1, JSON.stringify(bad));
      assert.deepEqual(r.values.player_site.keep, [], 'nothing kept, and the build stops');
    }
  });

  test(`${layout}: output and keep are used trimmed, as they are checked`, () => {
    const r = read(site(layout, { outputDir: ' public ', preserveDirs: [' maps ', 'keep'] }));
    assert.equal(r.values.player_site.output, 'public');
    assert.deepEqual(r.values.player_site.keep, ['maps', 'keep']);
    assert.deepEqual(r.faults.filter((f) => f.level === 'stop'), []);
  });
}

test('old layout: each key is read from the site file as today, with origin site-file and no fault', () => {
  const r = read(site('legacy', FULL));
  assert.equal(r.values.player_site.url, 'https://x.example/camp');
  assert.equal(r.values.player_site.host, 'cloudflare-pages');
  assert.equal(r.values.player_site.output, 'public');
  assert.equal(r.values.player_site.cloudflare_project, 'proj');
  assert.deepEqual(r.values.player_site.keep, ['keep', 'extra']);
  for (const name of NAMES) {
    assert.equal(r.origins[name], 'site-file', name);
    assert.deepEqual(faultsOn(r, name), [], name);
  }
  assert.equal(r.faults.filter((f) => KEYS.some(([key]) => f.name === key)).length, 0);
});

test('new layout, the vault sets it: the vault wins, and a different value in the site file is a warning naming both', () => {
  const s = site('new', FULL);
  s.siteConfig = { vaultPath: '../vault', siteUrl: 'https://old.example', host: 'github-pages', outputDir: 'old', cloudflarePagesProject: 'old', preserveDirs: ['old'] };
  const r = read(s);
  assert.equal(r.values.player_site.url, 'https://x.example/camp');
  assert.equal(r.values.player_site.host, 'cloudflare-pages');
  assert.equal(r.values.player_site.output, 'public');
  assert.equal(r.values.player_site.cloudflare_project, 'proj');
  assert.deepEqual(r.values.player_site.keep, ['keep', 'extra']);
  for (const [key, name] of KEYS) {
    assert.equal(r.origins[name], 'file', name);
    const f = r.faults.filter((x) => x.name === key);
    assert.equal(f.length, 1, key);
    assert.equal(f[0].level, 'warn');
    assert.ok(f[0].message.includes(key) && f[0].message.includes(name), f[0].message);
    assert.ok(f[0].message.includes(JSON.stringify(s.siteConfig[key])), f[0].message);
  }
});

test('new layout, the vault sets it and the site file says the same: nothing to warn about', () => {
  const s = site('new', FULL);
  s.siteConfig = { vaultPath: '../vault', ...FULL };
  assert.deepEqual(read(s).faults, []);
});

test('new layout, the vault sets none and the site file holds one: the site file value is used, with a warning', () => {
  const s = site('new');
  s.siteConfig = { vaultPath: '../vault', ...FULL };
  const r = read(s);
  assert.equal(r.values.player_site.url, 'https://x.example/camp');
  assert.equal(r.values.player_site.host, 'cloudflare-pages');
  assert.equal(r.values.player_site.output, 'public');
  assert.equal(r.values.player_site.cloudflare_project, 'proj');
  assert.deepEqual(r.values.player_site.keep, ['keep', 'extra']);
  for (const name of NAMES) assert.equal(r.origins[name], 'site-file', name);
  const f = r.faults.filter((x) => x.name === 'siteUrl');
  assert.equal(f.length, 1);
  assert.equal(f[0].level, 'warn');
  assert.equal(f[0].message, "`siteUrl` in the site folder's vault.config.json moves to `player_site.url` at the next update");
  assert.equal(r.faults.filter((x) => x.level === 'stop').length, 0);
});

test('new layout: a site-file value that cannot be read is judged the same way', () => {
  const s = site('new');
  s.siteConfig = { vaultPath: '../vault', outputDir: '../out', preserveDirs: ['a/b'], host: 'netlify' };
  const r = read(s);
  assert.equal(faultsOn(r, 'player_site.output').filter((f) => f.level === 'stop').length, 1);
  assert.equal(faultsOn(r, 'player_site.keep').filter((f) => f.level === 'stop').length, 1);
  assert.equal(r.values.player_site.host, 'github-pages');
});

test('a null in the site file is the same as leaving the key out', () => {
  const s = site('new');
  s.siteConfig = { vaultPath: '../vault', siteUrl: null, preserveDirs: null };
  const r = read(s);
  assert.equal(r.origins['player_site.url'], 'default');
  assert.equal(r.origins['player_site.keep'], 'default');
  assert.deepEqual(r.faults, []);
});

test('the resolved config carries the five keys under their old spellings, from the settings', () => {
  for (const layout of ['legacy', 'new']) {
    const s = site(layout, FULL);
    const { config, publishConfig } = resolveConfig(s.siteConfig, s.vault, () => {}, { siteDir: s.siteDir });
    assert.equal(config.siteUrl, 'https://x.example/camp', layout);
    assert.equal(config.host, 'cloudflare-pages');
    assert.equal(config.outputDir, 'public');
    assert.equal(config.cloudflarePagesProject, 'proj');
    assert.deepEqual(config.preserveDirs, ['keep', 'extra']);
    assert.deepEqual(publishConfig.site, { url: 'https://x.example/camp', host: 'cloudflare-pages', output: 'public', cloudflare_project: 'proj', keep: ['keep', 'extra'] });
  }
});

test('the resolved config says the built-in host and folder when nothing is set, and leaves the others out', () => {
  const s = site('new');
  const { config } = resolveConfig(s.siteConfig, s.vault, () => {}, { siteDir: s.siteDir });
  assert.equal(config.host, 'github-pages');
  assert.equal(config.outputDir, 'docs');
  assert.deepEqual(config.preserveDirs, []);
  assert.ok(!('siteUrl' in config));
  assert.ok(!('cloudflarePagesProject' in config));
});

test('on the new layout the resolved config does not take the raw site file where the vault sets nothing: it falls back with a warning', () => {
  const s = site('new');
  s.siteConfig = { vaultPath: '../vault', outputDir: 'out' };
  const warned = [];
  const { config } = resolveConfig(s.siteConfig, s.vault, (m) => warned.push(m), { siteDir: s.siteDir });
  assert.equal(config.outputDir, 'out');
  assert.ok(warned.some((m) => m.includes('outputDir') && m.includes('player_site.output')), warned.join('\n'));
});

test('doctor --site: a key still in the site file of a moved vault is a note, not a fault', async () => {
  const { runSiteDoctor } = require('../lib/site-doctor');
  const s = site('new');
  fs.writeFileSync(path.join(s.vault, 'Home.md'), '---\ntype: note\n---\nHome\n');
  const configPath = path.join(s.siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault', siteUrl: 'https://x.example/camp' }));
  const out = [];
  const rc = await runSiteDoctor({ configPath, json: true }, { out: (l) => out.push(String(l)), detect: () => null });
  const report = JSON.parse(out.join('\n'));
  const rows = report.findings.filter((f) => f.code === 'SETTINGS_FAULT');
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].severity, 'info');
  assert.match(rows[0].detail, /siteUrl is still in vault\.config\.json; it moves to player_site\.url at the next update/);
  assert.equal(rc, 0);
  assert.equal(report.counts.notes, 1);
  assert.equal(report.counts.warnings, 0);
});

test('the site file holds only vaultPath as far as the tool is concerned', () => {
  assert.deepEqual(DEPLOY_KEYS, ['vaultPath']);
});
