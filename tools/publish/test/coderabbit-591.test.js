'use strict';
// CodeRabbit's round on the legacy-settings removal (#591): an alias in a hiding list, a package.json that cannot be
// read, the package.json check beside --no-site-file, the pin read when update-pin says nothing, the doctor's JSON.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings } = require('../lib/settings');
const { runSettings } = require('../lib/settings/cli');
const { siteToolOlderThan } = require('../lib/settings/site-tool');
const { runSiteDoctor } = require('../lib/site-doctor');
const { writeSettings } = require('./helpers/vault-files');

let roots = [];
afterEach(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); roots = []; });

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cr591-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  const siteDir = path.join(root, 'site');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.mkdirSync(siteDir);
  fs.writeFileSync(path.join(siteDir, 'vault.config.json'), JSON.stringify({ vaultPath: '../vault' }));
  return { root, vault, siteDir };
}
const yamlIn = (s, text) => fs.writeFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), text);
const stops = (s, name) => readSettings({ vaultPath: s.vault }).faults.filter((f) => f.level === 'stop' && f.setting === name);

describe('an alias entry in a hiding list is checked as what it points at', () => {
  const name = 'player_site.hide.folders';
  for (const [anchored, readAs] of [['007', 'the number 7'], ['1e3', 'the number 1000'], ['true', 'true, not text']]) {
    it(`*alias to ${anchored} stops, naming the entry`, () => {
      const s = scratch();
      yamlIn(s, `player_site:\n  hide:\n    folders:\n      - &x ${anchored}\n      - *x\n  title: T\n`);
      const found = stops(s, name);
      assert.ok(found.length >= 1, 'a stop');
      assert.ok(found.every((f) => f.message.includes(`entry ${anchored} is read as ${readAs}`) && f.message.includes(`'${anchored}'`)));
    });
    it(`*alias alone (anchor elsewhere) to ${anchored} stops`, () => {
      const s = scratch();
      yamlIn(s, `player_site:\n  title: &x ${anchored}\n  hide:\n    folders:\n      - *x\n`);
      assert.ok(stops(s, name).length >= 1, 'a stop');
    });
  }
  it('*alias to quoted or plain text reads cleanly', () => {
    const s = scratch();
    yamlIn(s, `player_site:\n  hide:\n    sections:\n      - &q '007'\n    folders:\n      - *q\n      - &p Secrets\n      - *p\n`);
    assert.deepStrictEqual(stops(s, name), []);
    assert.ok(readSettings({ vaultPath: s.vault }).values.player_site.hide.folders.includes('007'));
  });
});

describe('the site folder package.json', () => {
  it('one that exists but cannot be read stops, naming the file', () => {
    const s = scratch();
    writeSettings(s.vault, { player_site: { title: 'T', folder: '../site' } });
    fs.mkdirSync(path.join(s.siteDir, 'package.json')); // reading a directory fails with EISDIR, not ENOENT
    const faults = readSettings({ vaultPath: s.vault, siteConfig: {}, siteDir: s.siteDir }).faults.filter((f) => f.source === 'package' && f.level === 'stop');
    assert.equal(faults.length, 1);
    assert.match(faults[0].message, /package\.json is not valid JSON \(it cannot be read: EISDIR\)/);
  });
  it('is still checked with --no-site-file', () => {
    const s = scratch();
    writeSettings(s.vault, { player_site: { title: 'T', folder: '../site' } });
    fs.writeFileSync(path.join(s.siteDir, 'package.json'), JSON.stringify({ scripts: { prebuild: 'echo hi' } }));
    const out = [];
    const rc = runSettings({ verb: 'check', args: [], vault: s.vault, json: true, noSiteFile: true }, { out: (l) => out.push(l), err: () => {} });
    const faults = JSON.parse(out.join('\n')).faults;
    assert.equal(rc, 1);
    assert.ok(faults.some((f) => f.source === 'package' && /prebuild/.test(f.message)), JSON.stringify(faults));
  });
});

describe('the pin is read from package.json when update-pin says nothing', () => {
  it('an old pinned tool is older', () => {
    const s = scratch();
    fs.writeFileSync(path.join(s.siteDir, 'package.json'), JSON.stringify({ dependencies: { 'gm-apprentice-publish': '^1.2.0' } }));
    const old = siteToolOlderThan(s.siteDir, '1.30.0', { pinCheck: () => null });
    assert.ok(old, 'older');
    assert.equal(old.ours, false);
  });
  it('a new enough pin, or none, is not older', () => {
    const s = scratch();
    fs.writeFileSync(path.join(s.siteDir, 'package.json'), JSON.stringify({ dependencies: { 'gm-apprentice-publish': '^1.40.0' } }));
    assert.equal(siteToolOlderThan(s.siteDir, '1.30.0', { pinCheck: () => null }), null);
    fs.rmSync(path.join(s.siteDir, 'package.json'));
    assert.equal(siteToolOlderThan(s.siteDir, '1.30.0', { pinCheck: () => null }), null);
  });
});

describe('doctor --site on a vault with an old file', () => {
  const run = async (s, json) => {
    const out = [];
    const rc = await runSiteDoctor({ configPath: path.join(s.siteDir, 'vault.config.json'), json }, { out: (l) => out.push(String(l)), detect: () => null });
    return { rc, text: out.join('\n') };
  };
  it('the old publish list is a finding in --json, naming the old file', async () => {
    const s = scratch();
    writeSettings(s.vault, { player_site: { title: 'T' } });
    fs.writeFileSync(path.join(s.vault, '_meta', 'publish-manifest.md'), '---\n---\n');
    const { rc, text } = await run(s, true);
    const report = JSON.parse(text);
    assert.equal(rc, 1);
    const f = report.findings.find((x) => /publish-manifest/.test(x.message || x.detail || JSON.stringify(x)));
    assert.ok(f, text);
    assert.equal(f.path, '_meta/publish-manifest.md');
  });
  it('the old settings file is labelled with its own path', async () => {
    const s = scratch();
    writeSettings(s.vault, { player_site: { title: 'T' } });
    fs.writeFileSync(path.join(s.vault, '_meta', 'vault-config.md'), '---\npublish:\n  site_title: Old\n---\n');
    const { text } = await run(s, true);
    const f = JSON.parse(text).findings.find((x) => /vault-config\.md is still beside/.test(JSON.stringify(x)));
    assert.ok(f, text);
    assert.equal(f.path, '_meta/vault-config.md');
  });
});
