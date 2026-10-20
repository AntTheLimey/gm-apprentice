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

// A reader holding these files only.
const reader = (files) => ({
  exists: (p) => p in files,
  readFile: (p) => { if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files[p]; },
});

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
    const deps = { exists: (p) => p === OLD, readFile: () => { throw eio(); } };
    assert.throws(() => readSettings({ vaultPath: '/v', deps }), /EIO/);
  });

  it('readSettings throws when the left-over old file cannot be looked for', () => {
    const deps = { exists: (p) => { if (p === OLD) throw eio(); return p === NEW; }, readFile: () => 'player_site:\n  title: T\n' };
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
});
