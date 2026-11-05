'use strict';
// From plugin 1.11.0 the tool reads only the vault's settings file and the YAML publish list. Anything the old
// layout kept elsewhere (a key in the site folder's vault.config.json, a package.json build script, the old settings
// file, the old publish list) stops the build by name: dropping it quietly could publish what it hid.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { loadPublishList } = require('../lib/manifest');
const { renameRefs } = require('../lib/rename-refs');
const { writeSettings } = require('./helpers/vault-files');

const OLD_FILE_STOP = '_meta/vault-config.md is the old settings file, no longer read since plugin 1.11.0. Run the update with a 1.10 release, 1.10.134 or later, first.';
const OLD_LIST_STOP = '_meta/publish-manifest.md is the old publish list, no longer read since plugin 1.11.0. Run the update with a 1.10 release, 1.10.134 or later, first.';

let roots = [];
afterEach(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); roots = []; });

// A site folder and a vault with one published note. `site` is the site file's whole content (vaultPath added).
function site({ site: siteKeys = {}, settings = { player_site: { title: 'T' } }, oldFile = false, pkg = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-leftovers-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'NPCs'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'NPCs', 'Clerk.md'), '---\ntype: npc\n---\n\nA clerk.\n');
  if (settings) writeSettings(vault, settings);
  if (oldFile) {
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), '---\npublish:\n  site_title: Old\n---\n');
  }
  const siteDir = path.join(root, 'site');
  fs.mkdirSync(siteDir);
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault', ...siteKeys }));
  if (pkg) fs.writeFileSync(path.join(siteDir, 'package.json'), JSON.stringify(pkg));
  return { root, vault, siteDir, configPath };
}

function quietBuild(configPath) {
  const saved = { warn: console.warn, log: console.log };
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  console.log = (...a) => lines.push(a.join(' '));
  try {
    build({ configPath });
    return { error: null, lines };
  } catch (err) {
    return { error: err, lines };
  } finally {
    Object.assign(console, saved);
  }
}

const builtNothing = (s) => assert.ok(!fs.existsSync(path.join(s.siteDir, 'docs', 'index.html')), 'nothing was built');

describe('leftovers from before plugin 1.11.0 stop the build by name', () => {
  it('a leftover site key stops the build and names it with its new home', () => {
    const s = site({ site: { siteTitle: 'Old Title' } });
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    assert.match(error.message, /siteTitle \(now player_site\.title\)/);
    builtNothing(s);
  });

  it('every leftover key is named in one line', () => {
    const s = site({ site: { siteUrl: 'https://x.example', outputDir: 'out', folderMap: { NPCs: 'npcs' }, mystery: 1 } });
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    const line = error.message.split('\n').find((l) => l.includes('siteUrl'));
    assert.ok(line, error.message);
    for (const part of ['siteUrl (now player_site.url)', 'outputDir (now player_site.output)', 'folderMap (now player_site.folder_map)', 'mystery (not a setting)']) {
      assert.ok(line.includes(part), `${part} in: ${line}`);
    }
    assert.match(line, /leave only vaultPath/);
    builtNothing(s);
  });

  it('a hiding list left in the site file stops (was already a stop)', () => {
    const s = site({ site: { excludeSections: ['GM Notes'] } });
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    assert.match(error.message, /excludeSections \(now player_site\.hide\.sections\)/);
    builtNothing(s);
  });

  it('an old settings file stops naming it and the bridge', () => {
    const s = site({ settings: null, oldFile: true });
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    assert.ok(error.message.includes(OLD_FILE_STOP), error.message);
    builtNothing(s);
  });

  it('an old publish list stops naming it', () => {
    const s = site();
    fs.writeFileSync(path.join(s.vault, '_meta', 'publish-manifest.md'), '# Publish Manifest\n\n## Publishing\n\n- NPCs/Clerk.md\n');
    assert.throws(() => loadPublishList(s.vault, { warn: () => {} }), (err) => err.message.includes(OLD_LIST_STOP));
    assert.throws(() => renameRefs(s.vault, 'NPCs/Clerk.md', 'NPCs/Clerk2.md', s.configPath), (err) => err.message.includes(OLD_LIST_STOP));
    const { error } = quietBuild(s.configPath);
    assert.ok(error && error.message.includes(OLD_LIST_STOP), error ? error.message : 'built');
    builtNothing(s);
  });

  it('a set-aside old publish list (.converted) is not read and stops nothing', () => {
    const s = site();
    fs.writeFileSync(path.join(s.vault, '_meta', 'publish-manifest.md.converted'), '# Publish Manifest\n');
    assert.strictEqual(loadPublishList(s.vault, { warn: () => {} }), null);
  });

  it('a package.json prebuild stops naming its vault home', () => {
    const s = site({ pkg: { scripts: { prebuild: 'echo hi', postbuild: 'echo bye', build: 'gm-apprentice-publish build' } } });
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    assert.match(error.message, /prebuild \(now player_site\.before_build\), postbuild \(now player_site\.after_build\)/);
    builtNothing(s);
  });

  it('deploy stops on a package.json prebuild before it builds or runs anything', async () => {
    const { runDeploy } = require('../lib/deploy-cli');
    const s = site({ pkg: { scripts: { postbuild: 'echo bye' } } });
    const ran = [];
    const out = [];
    const deps = { out: (l) => out.push(String(l)), runCommand: (...a) => { ran.push(a); return { code: 0, stdout: '', stderr: '' }; }, runWrangler: (...a) => { ran.push(a); return { code: 0, stdout: '', stderr: '' }; }, build: async () => { ran.push('build'); } };
    await assert.rejects(runDeploy({ configPath: s.configPath }, deps), /postbuild \(now player_site\.after_build\)/);
    assert.deepStrictEqual(ran, []);
  });

  for (const [label, value] of [['a string', 'GM Secrets'], ['null', null], ['an empty list', []]]) {
    it(`a site-file hiding key given as ${label} stops the build and writes nothing`, () => {
      const s = site({ site: { excludeSections: value } });
      const { error } = quietBuild(s.configPath);
      assert.ok(error, 'the build stopped');
      assert.match(error.message, /holds keys that are no longer read there: excludeSections \(now player_site\.hide\.sections\)/);
      builtNothing(s);
    });
  }

  it('both settings files present stops, naming the old file and what to do', () => {
    const s = site({ oldFile: true });
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    assert.match(error.message, /_meta\/vault-config\.md/);
    assert.match(error.message, /remove or rename `_meta\/vault-config\.md` once you have checked its settings are in `_meta\/vault-config\.yaml`; plugin 1\.11\.0 no longer reads it/);
    builtNothing(s);
  });

  it('build --site gm on an old-only vault names the old settings file, not "GM site is off"', () => {
    const { spawnSync } = require('node:child_process');
    const s = site({ settings: null, oldFile: true });
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gm-publish.js'), 'build', '--site', 'gm', '--config', s.configPath], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes(OLD_FILE_STOP), r.stderr);
    assert.ok(!/GM site is off/.test(r.stderr), r.stderr);
  });

  it('an unparseable package.json in the site folder stops build and deploy, naming the file', async () => {
    const { runDeploy } = require('../lib/deploy-cli');
    const s = site();
    fs.writeFileSync(path.join(s.siteDir, 'package.json'), '{ "scripts": ');
    const { error } = quietBuild(s.configPath);
    assert.ok(error, 'the build stopped');
    assert.match(error.message, /package\.json is not valid JSON/);
    const ran = [];
    await assert.rejects(runDeploy({ configPath: s.configPath }, { out: () => {}, runCommand: (...a) => { ran.push(a); return { code: 0 }; }, runWrangler: (...a) => { ran.push(a); return { code: 0 }; }, build: async () => { ran.push('build'); } }), /package\.json is not valid JSON/);
    assert.deepStrictEqual(ran, []);
  });

  it('a site file with only vaultPath builds', () => {
    const s = site({ pkg: { scripts: { build: 'gm-apprentice-publish build' } } });
    const { error, lines } = quietBuild(s.configPath);
    assert.ifError(error);
    assert.ok(fs.existsSync(path.join(s.siteDir, 'docs', 'index.html')), lines.join('\n'));
  });
});

// `settings get` and `settings check` (what the Settings check and the update's gate read) carry every leftover the
// build stops on, each with the file it is in, so nothing the build refuses can pass the update as "moved".
describe('the settings commands report every leftover the build stops on', () => {
  const { runSettings } = require('../lib/settings/cli');
  function ask(s, verb = 'get') {
    const out = [];
    const err = [];
    const rc = runSettings({ verb, args: [], vault: s.vault, json: true }, { out: (l) => out.push(l), err: (l) => err.push(l) });
    return { rc, result: out.length ? JSON.parse(out.join('\n')) : null, err };
  }
  const named = (opts) => site({ ...opts, settings: { player_site: { title: 'T', folder: '../site' }, ...(opts.extra || {}) } });
  const leftovers = (r) => r.result.faults.filter((f) => f.level === 'stop' && f.leftover);

  it('a package.json prebuild is a stop leftover naming the package file', () => {
    const s = named({ pkg: { scripts: { prebuild: 'echo hi' } } });
    for (const verb of ['get', 'check']) {
      const [f] = leftovers(ask(s, verb));
      assert.ok(f, verb);
      assert.strictEqual(f.source, 'package');
      assert.match(f.message, /prebuild \(now player_site\.before_build\)/);
    }
  });

  it('an unparseable package.json is a stop leftover', () => {
    const s = named({});
    fs.writeFileSync(path.join(s.siteDir, 'package.json'), '{ "scripts": ');
    const [f] = leftovers(ask(s));
    assert.ok(f);
    assert.strictEqual(f.source, 'package');
    assert.match(f.message, /package\.json is not valid JSON/);
  });

  it('a site-folder key keeps its source, so the row names the site file', () => {
    const s = named({ site: { siteTitle: 'Old' } });
    const [f] = leftovers(ask(s));
    assert.strictEqual(f.source, 'site');
    assert.match(f.message, /siteTitle \(now player_site\.title\)/);
  });

  it('an unparseable site vault.config.json found through the vault is reported, not read as no file', () => {
    const s = named({});
    fs.writeFileSync(s.configPath, '{ "vaultPath": "../vault", }');
    const r = ask(s);
    const [f] = leftovers(r);
    assert.ok(f, JSON.stringify(r.result.faults));
    assert.strictEqual(f.source, 'site');
    assert.match(f.message, /vault\.config\.json could not be read as JSON/);
  });

  it('the old publish list is a stop leftover', () => {
    const s = named({});
    fs.writeFileSync(path.join(s.vault, '_meta', 'publish-manifest.md'), '# Publish Manifest\n');
    const [f] = leftovers(ask(s));
    assert.ok(f);
    assert.strictEqual(f.message, OLD_LIST_STOP);
  });

  it('both settings files present is a stop leftover', () => {
    const s = named({ oldFile: true });
    const [f] = leftovers(ask(s));
    assert.match(f.message, /is still beside _meta\/vault-config\.yaml/);
  });

  it('a moved vault with a clean site has no leftovers', () => {
    const s = named({ pkg: { scripts: { build: 'gm-apprentice-publish build' } } });
    assert.deepStrictEqual(leftovers(ask(s)), []);
  });
});
