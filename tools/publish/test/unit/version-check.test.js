const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectVersionDrift } = require('../../lib/version-check');

// Build a fake plugin cache: <root>/cache/gm-apprentice/gm-apprentice/<ver>/tools/publish/lib
function makeCache(root, versions) {
  const base = path.join(root, 'cache', 'gm-apprentice', 'gm-apprentice');
  for (const v of versions) {
    fs.mkdirSync(path.join(base, v, 'tools', 'publish', 'lib'), { recursive: true });
  }
  return (v) => path.join(base, v, 'tools', 'publish', 'lib');
}

describe('detectVersionDrift', () => {
  let work;
  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-version-check-'));
  });
  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('reports drift when a newer version is installed in the cache', () => {
    const libOf = makeCache(path.join(work, 'a'), ['1.7.0', '1.7.8']);
    const r = detectVersionDrift(libOf('1.7.0'));
    assert.ok(r, 'should return a result inside a cache');
    assert.strictEqual(r.pinned, '1.7.0');
    assert.strictEqual(r.latest, '1.7.8');
    assert.strictEqual(r.drift, true);
    assert.match(r.message, /1\.7\.0/);
    assert.match(r.message, /1\.7\.8/);
  });

  it('reports no drift when running the latest installed version', () => {
    const libOf = makeCache(path.join(work, 'b'), ['1.7.0', '1.7.8']);
    const r = detectVersionDrift(libOf('1.7.8'));
    assert.ok(r);
    assert.strictEqual(r.drift, false);
  });

  it('compares by semver, not lexically (1.7.10 > 1.7.9)', () => {
    const libOf = makeCache(path.join(work, 'c'), ['1.7.9', '1.7.10']);
    const r = detectVersionDrift(libOf('1.7.9'));
    assert.strictEqual(r.latest, '1.7.10');
    assert.strictEqual(r.drift, true);
  });

  it('returns null when not running from a plugin cache (e.g. dev checkout)', () => {
    const libDir = path.join(work, 'devrepo', 'tools', 'publish', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    assert.strictEqual(detectVersionDrift(libDir), null);
  });

  it('ignores non-semver sibling directories', () => {
    const base = path.join(work, 'd', 'cache', 'gm-apprentice', 'gm-apprentice');
    fs.mkdirSync(path.join(base, '1.7.0', 'tools', 'publish', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(base, 'scratch', 'tools', 'publish'), { recursive: true });
    const r = detectVersionDrift(path.join(base, '1.7.0', 'tools', 'publish', 'lib'));
    assert.ok(r);
    assert.strictEqual(r.latest, '1.7.0');
    assert.strictEqual(r.drift, false);
  });

  it('ignores partial/decorated version names (1.7.9-old, 01.7.0)', () => {
    const base = path.join(work, 'e', 'cache', 'gm-apprentice', 'gm-apprentice');
    for (const v of ['1.7.0', '1.7.9-old', '01.7.0']) {
      fs.mkdirSync(path.join(base, v, 'tools', 'publish', 'lib'), { recursive: true });
    }
    const r = detectVersionDrift(path.join(base, '1.7.0', 'tools', 'publish', 'lib'));
    assert.ok(r);
    assert.strictEqual(r.latest, '1.7.0', 'decorated names must not be treated as versions');
    assert.strictEqual(r.drift, false);
  });

  it('does not select a symlinked sibling as a version', () => {
    const base = path.join(work, 'f', 'cache', 'gm-apprentice', 'gm-apprentice');
    fs.mkdirSync(path.join(base, '1.7.0', 'tools', 'publish', 'lib'), { recursive: true });
    // A dangling/alias symlink named like a newer version must be ignored.
    fs.symlinkSync(path.join(base, 'nonexistent'), path.join(base, '1.9.0'));
    const r = detectVersionDrift(path.join(base, '1.7.0', 'tools', 'publish', 'lib'));
    assert.ok(r);
    assert.strictEqual(r.latest, '1.7.0');
    assert.strictEqual(r.drift, false);
  });
});
