const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { layoutOf } = require('../../lib/settings/layout');
const { readSettings } = require('../../lib/settings/read');
const { loadPublishConfig } = require('../../lib/config');

// #424 (settings): the settings readers go through the same reader as the scanner. A read that
// fails stops them; only a file that is not there reads as absent.
const eio = () => Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
const NEW = '/v/_meta/vault-config.yaml';
const OLD = '/v/_meta/vault-config.md';

const same = (a, b) => path.resolve(a) === path.resolve(b);

// A reader holding these files only. Paths are compared resolved, so '/v/...' matches on Windows too.
const reader = (files) => {
  const held = new Map(Object.entries(files).map(([k, v]) => [path.resolve(k), v]));
  return {
    exists: (p) => held.has(path.resolve(p)),
    readFile: (p) => { if (!held.has(path.resolve(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return held.get(path.resolve(p)); },
  };
};

describe('the settings readers read through deps, and a read error stops them (#424)', () => {
  it('layoutOf asks the reader which file exists', () => {
    assert.strictEqual(layoutOf('/v', reader({ [NEW]: 'x' })), 'new');
    assert.strictEqual(layoutOf('/v', reader({ [OLD]: 'x' })), 'legacy');
    assert.strictEqual(layoutOf('/v', reader({})), 'none');
  });

  it('layoutOf throws when the reader cannot tell, instead of answering "none"', () => {
    assert.throws(() => layoutOf('/v', { exists: () => { throw eio(); } }), /EIO/);
  });

  it('readSettings reads a new-layout vault behind the reader', () => {
    const read = readSettings({ vaultPath: '/v', deps: reader({ [NEW]: 'player_site:\n  title: Behind The Reader\n' }) });
    assert.strictEqual(read.layout, 'new');
    assert.strictEqual(read.values.player_site.title, 'Behind The Reader');
  });

  it('readSettings throws when the settings file cannot be read', () => {
    const deps = { exists: () => true, readFile: () => { throw eio(); } };
    assert.throws(() => readSettings({ vaultPath: '/v', deps }), /EIO/);
  });

  it('readSettings throws when the old settings file cannot be read', () => {
    const deps = { exists: (p) => same(p, OLD), readFile: () => { throw eio(); } };
    assert.throws(() => readSettings({ vaultPath: '/v', deps }), /EIO/);
  });

  it('readSettings throws when the left-over old file cannot be looked for', () => {
    const deps = { exists: (p) => { if (same(p, OLD)) throw eio(); return same(p, NEW); }, readFile: () => 'player_site:\n  title: T\n' };
    assert.throws(() => readSettings({ vaultPath: '/v', deps }), /EIO/);
  });

  it('loadPublishConfig takes the reader', () => {
    const deps = reader({ [NEW]: 'player_site:\n  title: Behind The Reader\n' });
    const config = loadPublishConfig('/v', {}, () => {}, { quietStops: true, deps });
    assert.strictEqual(config.site_title, 'Behind The Reader');
    assert.throws(() => loadPublishConfig('/v', {}, () => {}, { quietStops: true, deps: { exists: () => { throw eio(); } } }), /EIO/);
  });

  it('a vault with no settings file, or a path through a file, is still "none"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-absent-'));
    try {
      assert.strictEqual(layoutOf(dir), 'none');
      fs.writeFileSync(path.join(dir, '_meta'), 'a file where the folder should be');
      assert.strictEqual(layoutOf(dir), 'none');   // ENOTDIR reads as absent
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a folder that cannot be searched is an error, not "none"', (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('root can search any folder');
    if (process.platform === 'win32') return t.skip('Windows ignores chmod 000 on a folder');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-eacces-'));
    try {
      fs.mkdirSync(path.join(dir, '_meta'));
      fs.writeFileSync(path.join(dir, '_meta', 'vault-config.yaml'), 'player_site:\n  title: T\n');
      fs.chmodSync(path.join(dir, '_meta'), 0o000);
      assert.throws(() => layoutOf(dir), /EACCES/);
    } finally {
      fs.chmodSync(path.join(dir, '_meta'), 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The folder checks and the entry faults read through the same reader (#424 completeness).
  const GM = 'player_site:\n  title: T\n  folder: /site\ngm_site:\n  publish: true\n  folder: /site-gm\n';
  it('readSettings hands its reader to the GM folder check, so a folder that cannot be probed stops it', () => {
    const seen = [];
    const deps = { ...reader({ [NEW]: GM }), realpath: (p) => { seen.push(p); throw eio(); } };
    assert.throws(() => readSettings({ vaultPath: '/v', deps }), /EIO/);
    assert.ok(seen.length > 0);
  });

  it('readSettings hands its reader to the output folder check', () => {
    const seen = [];
    const files = { [NEW]: 'player_site:\n  output: docs\n' };
    const deps = { ...reader(files), realpath: (p) => { seen.push(p); throw eio(); } };
    assert.throws(() => readSettings({ vaultPath: '/v', siteDir: '/site', deps }), /EIO/);
  });

  it('a folder that does not exist is still judged by its nearest folder that does', () => {
    const deps = { ...reader({ [NEW]: GM }), realpath: (p) => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } };
    assert.doesNotThrow(() => readSettings({ vaultPath: '/v', deps }));
  });

  it('the settings command reads through the reader too, and says a failed read', () => {
    const { runSettings } = require('../../lib/settings/cli');
    const errs = [];
    const deps = { ...reader({ [NEW]: 'player_site:\n  title: T\n' }), exists: () => { throw eio(); }, out: () => {}, err: (m) => errs.push(m) };
    assert.strictEqual(runSettings({ verb: 'check', vault: '/v', noSiteFile: true }, deps), 1);
    assert.match(errs.join('\n'), /EIO/);
    const good = [];
    const ok = { ...reader({ [NEW]: 'player_site:\n  title: Via Reader\n' }), out: (m) => good.push(m), err: () => {} };
    assert.strictEqual(runSettings({ verb: 'get', vault: '/v', noSiteFile: true, args: ['player_site.title'] }, ok), 0);
    assert.match(good.join('\n'), /Via Reader/);
  });
});
