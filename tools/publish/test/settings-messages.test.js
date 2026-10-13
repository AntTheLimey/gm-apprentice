'use strict';
// A message to the GM names the settings file the vault is on, and a setting as that file writes it:
// player_site.publish in _meta/vault-config.yaml on the new layout, publish.site in
// _meta/vault-config.md on the old one. Each case below runs the same thing on both layouts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nameIn, fileLabel, nameInFor, fileLabelFor } = require('../lib/settings');
const { siteOffFor, assertNoStops, loadPublishConfig } = require('../lib/config');
const { seedVaultSettings } = require('../lib/init');
const { runSetupBackend } = require('../lib/setup-backend');
const { runSiteDoctor } = require('../lib/site-doctor');

const OLD = { file: '_meta/vault-config.md', body: '---\ntype: meta\npublish:\n  site: false\n---\n' };
const NEW = { file: '_meta/vault-config.yaml', body: 'version: 1\nplayer_site:\n  publish: false\n' };

// A site folder and its vault, the vault holding `layout`'s settings file ('none' holds no file).
function make(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-messages-'));
  const site = path.join(root, 'site');
  const vault = path.join(root, 'vault');
  fs.mkdirSync(site);
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Home.md'), '---\ntype: note\n---\nHome\n');
  fs.writeFileSync(path.join(site, 'vault.config.json'), JSON.stringify({ vaultPath: '../vault', outputDir: './docs' }));
  fs.writeFileSync(path.join(site, 'package.json'), JSON.stringify({ dependencies: { 'gm-apprentice-publish': 'file:../tool/1.0.0' } }));
  const kind = layout === 'old' ? OLD : layout === 'new' ? NEW : null;
  if (kind) fs.writeFileSync(path.join(vault, kind.file), kind.body);
  return { root, site, vault, configPath: path.join(site, 'vault.config.json') };
}
const done = (m) => fs.rmSync(m.root, { recursive: true, force: true });

test('the helpers: the old name and file on the old layout, the new ones otherwise', () => {
  assert.equal(nameInFor('legacy', 'player_site.publish'), 'publish.site');
  assert.equal(nameInFor('new', 'player_site.publish'), 'player_site.publish');
  assert.equal(nameInFor('none', 'player_site.publish'), 'player_site.publish');
  assert.equal(nameInFor('legacy', 'vault.kept_by'), 'vault.kept_by', 'a setting the old file never had keeps its name');
  assert.equal(fileLabelFor('legacy'), '_meta/vault-config.md');
  assert.equal(fileLabelFor('new'), '_meta/vault-config.yaml');
  assert.equal(fileLabelFor('none'), '_meta/vault-config.yaml');
  assert.equal(nameIn(undefined, 'player_site.publish'), 'player_site.publish');
  assert.equal(fileLabel(undefined), '_meta/vault-config.yaml');
});

test('a site that is off says so in the vault\'s own words', () => {
  const o = make('old');
  const n = make('new');
  try {
    assert.equal(siteOffFor(o.configPath), 'the site is off for this vault (publish.site in _meta/vault-config.md); nothing was built. Set publish.site: true to publish again.');
    assert.equal(siteOffFor(n.configPath), 'the site is off for this vault (player_site.publish in _meta/vault-config.yaml); nothing was built. Set player_site.publish: true to publish again.');
  } finally { done(o); done(n); }
});

test('a stop fault names the setting as the vault\'s file writes it', () => {
  const o = make('old');
  const n = make('new');
  fs.writeFileSync(path.join(o.vault, OLD.file), '---\ntype: meta\npublish:\n  exclude_sections: GM Notes\n---\n');
  fs.writeFileSync(path.join(n.vault, NEW.file), 'version: 1\nplayer_site:\n  hide:\n    sections: GM Notes\n');
  try {
    assert.throws(() => assertNoStops(loadPublishConfig(o.vault, {}, () => {}), 'build'), /publish\.exclude_sections/);
    assert.throws(() => assertNoStops(loadPublishConfig(n.vault, {}, () => {}), 'build'), (err) => /player_site\.hide\.sections/.test(err.message) && !/exclude_sections/.test(err.message));
  } finally { done(o); done(n); }
});

test('the live-stats warning names the sheets setting as the vault\'s file writes it', () => {
  const o = make('old');
  const n = make('new');
  fs.writeFileSync(path.join(o.vault, OLD.file), '---\ntype: meta\npublish:\n  character_sheets: false\n  live_stats: true\n---\n');
  fs.writeFileSync(path.join(n.vault, NEW.file), 'version: 1\nplayer_site:\n  sheets:\n    show: false\n  features:\n    live_stats: true\n');
  try {
    const said = (m) => { const out = []; loadPublishConfig(m.vault, {}, (x) => out.push(x)); return out.join('\n'); };
    assert.match(said(o), /publish\.live_stats is on but publish\.character_sheets is off/);
    assert.match(said(n), /player_site\.features\.live_stats is on but player_site\.sheets\.show is off/);
  } finally { done(o); done(n); }
});

test('init says which settings and which file it wrote', async () => {
  const o = make('old');
  const n = make('new');
  const fresh = make('none');
  fs.writeFileSync(path.join(o.vault, OLD.file), '---\ntype: meta\n---\n');
  fs.writeFileSync(path.join(n.vault, NEW.file), 'version: 1\n');
  const realLog = console.log;
  const logged = [];
  console.log = (x) => logged.push(String(x));
  const said = [];
  try {
    const { init } = require('../lib/init');
    // A vault still on the old file is not set up: the new site settings have no place in it.
    await assert.rejects(() => init(path.join(o.root, 'made'), { siteTitle: 'Camp', vaultPath: o.vault, verbose: true }),
      /This vault's settings are still in the old file\. Update the vault first/);
    for (const m of [n, fresh]) {
      logged.length = 0;
      await init(path.join(m.root, 'made'), { siteTitle: 'Camp', vaultPath: m.vault, verbose: true });
      said.push(logged.join('\n'));
    }
  } finally { console.log = realLog; }
  try {
    assert.match(said[0], /wrote [^\n]*player_site\.title[^\n]* to _meta\/vault-config\.yaml in /);
    assert.doesNotMatch(said[0], /publish\.site_title|vault-config\.md/);
    assert.match(said[1], /to _meta\/vault-config\.yaml in /);
  } finally { done(o); done(n); done(fresh); }
});

test('init says what it could not write in the vault\'s own words', async () => {
  const n = make('new');
  fs.writeFileSync(path.join(n.vault, NEW.file), 'player_site: [unclosed\n');
  const real = console.warn;
  const warned = [];
  console.warn = (x) => warned.push(String(x));
  try {
    const { init } = require('../lib/init');
    await init(path.join(n.root, 'made'), { vaultPath: n.vault });
  } finally { console.warn = real; }
  try {
    assert.match(warned[0], /Add these to _meta\/vault-config\.yaml: player_site\.publish, player_site\.folder/);
  } finally { done(n); }
});

test('seedVaultSettings still keys its answer by the list\'s names', () => {
  const o = make('old');
  try {
    fs.writeFileSync(path.join(o.vault, OLD.file), '---\ntype: meta\n---\n');
    const r = seedVaultSettings(o.vault, { 'player_site.title': 'A' });
    assert.deepEqual(r.written, ['player_site.title']);
  } finally { done(o); }
});

test('setup-backend\'s refusal for an off site, and for a file it cannot edit, names the vault\'s own file', async () => {
  const o = make('old');
  const n = make('new');
  fs.writeFileSync(path.join(o.vault, OLD.file), '---\ntype: meta\npublish: [unclosed\n---\n');
  fs.writeFileSync(path.join(n.vault, NEW.file), 'player_site: [unclosed\n');
  try {
    for (const [m, file] of [[o, '_meta/vault-config.md'], [n, '_meta/vault-config.yaml']]) {
      const lines = [];
      const rc = await runSetupBackend('inbox', { configPath: m.configPath }, { out: (l) => lines.push(l), runWrangler: () => { throw new Error('wrangler must not run'); } });
      assert.equal(rc, 1);
      assert.match(lines.join('\n'), /^cannot tell whether the site is on/);
      assert.ok(lines.join('\n').includes(file), `${file} is not named in: ${lines.join(' | ')}`);
    }
    fs.writeFileSync(path.join(n.vault, NEW.file), NEW.body);
    const lines = [];
    const rc = await runSetupBackend('inbox', { configPath: n.configPath }, { out: (l) => lines.push(l) });
    assert.equal(rc, 1);
    assert.match(lines.join('\n'), /player_site\.publish in _meta\/vault-config\.yaml\); nothing was set up/);
  } finally { done(o); done(n); }
});

test('doctor --site: the fix names the vault\'s file, and an old file adds no note to the report', async () => {
  const run = async (m) => {
    const out = [];
    await runSiteDoctor({ configPath: m.configPath, json: true }, { out: (l) => out.push(String(l)), detect: () => null });
    return JSON.parse(out.join('\n'));
  };
  const o = make('old');
  const n = make('new');
  const other = make('old');
  fs.writeFileSync(path.join(o.vault, OLD.file), '---\ntype: meta\npublish:\n  site: true\n  exclude_sections: GM Notes\n---\n');
  fs.writeFileSync(path.join(other.vault, OLD.file), '---\ntype: meta\npublish:\n  site: true\n---\n');
  fs.writeFileSync(path.join(n.vault, NEW.file), 'version: 1\nplayer_site:\n  publish: true\n  hide:\n    sections: GM Notes\n');
  fs.writeFileSync(path.join(n.vault, OLD.file), '---\ntype: meta\n---\n');
  try {
    const a = await run(o);
    const fault = a.findings.find((f) => f.code === 'SETTINGS_FAULT');
    assert.equal(fault.path, '_meta/vault-config.md');
    assert.match(fault.fix, /correct it in _meta\/vault-config\.md/);
    assert.equal(a.counts.errors, 1);
    assert.ok(!a.findings.some((f) => f.severity === 'info') && a.counts.notes === undefined);

    const b = await run(n);
    const left = b.findings.find((f) => f.code === 'SETTINGS_FAULT');
    assert.equal(left.path, '_meta/vault-config.yaml');
    assert.match(left.detail, /_meta\/vault-config\.md is left over/);

    // A clean old-file vault reads as it did, plus the one note that the next update moves it (when the site's tool is ours).
    const c = await run(other);
    assert.deepEqual(c.findings.filter((f) => f.code !== 'SETTINGS_FILE_OLD'), []);
  } finally { done(o); done(n); done(other); }
});

test('seedVaultSettings makes no settings file while the site file still holds settings, and makes one when it holds none', () => {
  const held = make('none');
  const bare = make('none');
  try {
    const refused = seedVaultSettings(held.vault, { 'player_site.title': 'A' }, { siteConfig: { vaultPath: '../v', siteTitle: 'Kept' } });
    assert.deepEqual(refused.written, []);
    assert.match(refused.skipped, /still holds this vault's settings, so none can be set yet\. Bring them into the vault first by running: gm-apprentice-publish settings move --vault .* --config/);
    assert.equal(fs.existsSync(path.join(held.vault, NEW.file)), false);
    const ok = seedVaultSettings(bare.vault, { 'player_site.title': 'A' }, { siteConfig: { host: 'github-pages', siteUrl: 'u', vaultPath: '../v', outputDir: './docs' } });
    assert.deepEqual(ok.written, ['player_site.title']);
    assert.equal(fs.existsSync(path.join(bare.vault, NEW.file)), true);
  } finally { done(held); done(bare); }
});
