'use strict';
// A site whose five site-folder settings live only in the vault's settings file builds where the
// vault says, keeps what it says, and refuses to clean a folder it cannot trust.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../../lib/build');
const { writeNewConfig } = require('../helpers/settings-files');

const FIXTURE = path.join(__dirname, '../fixtures/with-landing-config');
const FOLDER_MAP = { 'Characters/NPCs': 'characters/npcs', Locations: 'locations', Sessions: 'sessions' };

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('build with the site-folder settings in the vault', () => {
  const roots = [];
  after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

  // A new-layout vault whose player_site holds `site`, and a site folder whose file holds only vaultPath.
  function setup(site) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-site-keys-'));
    roots.push(root);
    const vault = path.join(root, 'vault');
    fs.cpSync(FIXTURE, vault, { recursive: true });
    fs.rmSync(path.join(vault, '_meta'), { recursive: true, force: true });
    writeNewConfig(vault, {
      version: 1,
      vault: { attachments: '_attachments' },
      player_site: { title: 'Site Keys', folder_map: FOLDER_MAP, hide: { mode: 'player', folders: ['_meta'], sections: [] }, ...site },
    });
    const siteDir = path.join(root, 'site');
    fs.mkdirSync(siteDir, { recursive: true });
    const configPath = path.join(siteDir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault' }));
    return { root, siteDir, configPath };
  }

  function run(configPath, options = {}) {
    const original = { warn: console.warn, log: console.log };
    const lines = [];
    console.warn = (...a) => lines.push(a.join(' '));
    console.log = (...a) => lines.push(a.join(' '));
    try { build({ configPath, ...options }); } finally { Object.assign(console, original); }
    return lines;
  }

  it('builds into the named folder, keeps a kept folder byte for byte, and writes a 404 with the address\'s base path', () => {
    const s = setup({ url: 'https://example.github.io/camp', host: 'github-pages', output: 'public', keep: ['maps'] });
    const out = path.join(s.siteDir, 'public');
    fs.mkdirSync(path.join(out, 'maps'), { recursive: true });
    const sentinel = path.join(out, 'maps', 'world.txt');
    fs.writeFileSync(sentinel, 'not for the build to touch\n');
    fs.writeFileSync(path.join(out, 'stale.html'), 'old page');
    const before = hash(sentinel);
    run(s.configPath);
    assert.ok(fs.existsSync(path.join(out, 'index.html')), 'the site was written to the named folder');
    assert.ok(!fs.existsSync(path.join(s.siteDir, 'docs')), 'the built-in folder was not used');
    assert.ok(!fs.existsSync(path.join(out, 'stale.html')), 'the rest of the folder was cleaned');
    assert.strictEqual(hash(sentinel), before);
    const notFound = fs.readFileSync(path.join(out, '404.html'), 'utf8');
    assert.ok(notFound.includes('/camp/css/'), '404 links start at the address\'s base path');
  });

  it('with output outside the site folder: throws, and deletes nothing', () => {
    const s = setup({ url: 'https://example.github.io/camp', output: '../elsewhere' });
    const target = path.join(s.root, 'elsewhere');
    fs.mkdirSync(target, { recursive: true });
    const sentinel = path.join(target, 'precious.txt');
    fs.writeFileSync(sentinel, 'precious\n');
    const before = hash(sentinel);
    assert.throws(() => run(s.configPath), /settings have a fault|did not start/);
    assert.strictEqual(hash(sentinel), before);
    assert.deepStrictEqual(fs.readdirSync(target), ['precious.txt']);
  });

  it('with the faults let through (the GM-site build), it still will not clean a folder it cannot read', () => {
    const s = setup({ output: '../elsewhere' });
    const target = path.join(s.root, 'elsewhere');
    fs.mkdirSync(target, { recursive: true });
    const sentinel = path.join(target, 'precious.txt');
    fs.writeFileSync(sentinel, 'precious\n');
    const before = hash(sentinel);
    assert.throws(() => run(s.configPath, { allowFaults: true }),
      /The build did not start: it will not clean a folder while it cannot read where to build or what to keep\./);
    assert.strictEqual(hash(sentinel), before);
  });

  it('an output folder that is a link to the vault (or outside the site folder) stops the build, and the vault is untouched', () => {
    const s = setup({ output: 'vlink' });
    const vault = path.join(s.root, 'vault');
    fs.symlinkSync(vault, path.join(s.siteDir, 'vlink'), 'junction');
    const before = fs.readdirSync(vault).sort();
    assert.throws(() => run(s.configPath), /settings have a fault/);
    assert.throws(() => run(s.configPath, { allowFaults: true }), /did not start|Refusing|inside the vault|contains the vault/);
    assert.deepStrictEqual(fs.readdirSync(vault).sort(), before);
  });

  it('a kept folder is kept whatever the letter case of its name in the settings', () => {
    const s = setup({ output: 'public', keep: ['Gazetteer'] });
    const kept = path.join(s.siteDir, 'public', 'gazetteer');
    fs.mkdirSync(kept, { recursive: true });
    fs.writeFileSync(path.join(kept, 'map.txt'), 'mine\n');
    run(s.configPath);
    assert.ok(fs.existsSync(path.join(kept, 'map.txt')));
  });

  it('a fault in where to build or what to keep is not headed as one that could show players more', () => {
    const s = setup({ output: '../elsewhere' });
    let message = '';
    try { run(s.configPath); } catch (e) { message = e.message; }
    assert.match(message, /build stopped: .*(output|keep|folder)/);
    assert.doesNotMatch(message, /show players more than you meant/);
  });

  it('an unreadable keep list stops the build before anything is deleted', () => {
    const s = setup({ output: 'public', keep: ['maps/deep'] });
    const out = path.join(s.siteDir, 'public');
    fs.mkdirSync(out, { recursive: true });
    const sentinel = path.join(out, 'old.html');
    fs.writeFileSync(sentinel, 'old');
    const before = hash(sentinel);
    assert.throws(() => run(s.configPath, { allowFaults: true }), /did not start/);
    assert.throws(() => run(s.configPath), /settings have a fault/);
    assert.strictEqual(hash(sentinel), before);
  });
});
