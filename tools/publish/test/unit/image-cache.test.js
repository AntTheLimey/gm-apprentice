const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { optimizeImages, imageCacheDir, ignoreCacheInGit, CACHE_FOLDER } = require('../../lib/image-optimize');
const { makePng } = require('../helpers/make-png');

const RESOLVED = { optimize: true, format: 'webp', max_width: 1600, quality: 82 };

// An encoder that counts its calls and writes bytes that depend on the settings, so a hit can be told from a miss.
function countingEncoder(name = 'fake', version = '1.0') {
  const enc = {
    name, version, calls: 0,
    encode(src, dest, cfg) {
      enc.calls++;
      fs.writeFileSync(dest, Buffer.from(`q${cfg.quality} w${cfg.maxWidth} ${fs.readFileSync(src).length}`));
    },
  };
  return enc;
}

describe('the image cache', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cache-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let n = 0;
  function fresh() {
    const root = path.join(dir, `case-${n++}`);
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(root, { recursive: true });
    const sourcePath = path.join(root, 'pic.png');
    fs.writeFileSync(sourcePath, makePng(2000, 400));
    const mapFor = () => ({ 'pic.png': { sourcePath, relPath: 'pic.png' } });
    return { root, cacheDir, sourcePath, mapFor };
  }

  it('a miss encodes and stores; a hit copies the stored file and encodes nothing', () => {
    const { cacheDir, mapFor } = fresh();
    const enc = countingEncoder();
    const first = mapFor();
    const s1 = optimizeImages(first, RESOLVED, null, { encoder: enc, cacheDir });
    assert.strictEqual(enc.calls, 1);
    assert.strictEqual(s1.encoded, 1);
    assert.strictEqual(first['pic.png'].relPath, 'pic.webp');
    const bytes = fs.readFileSync(first['pic.png'].encodedPath);

    const second = mapFor();
    const s2 = optimizeImages(second, RESOLVED, null, { encoder: enc, cacheDir });
    assert.strictEqual(enc.calls, 1, 'the second run encodes nothing');
    assert.strictEqual(s2.encoded, 0);
    assert.strictEqual(s2.converted, 1);
    assert.strictEqual(second['pic.png'].relPath, 'pic.webp');
    assert.deepStrictEqual(fs.readFileSync(second['pic.png'].encodedPath), bytes);
  });

  it('a changed setting misses', () => {
    const { cacheDir, mapFor } = fresh();
    const enc = countingEncoder();
    optimizeImages(mapFor(), RESOLVED, null, { encoder: enc, cacheDir });
    optimizeImages(mapFor(), { ...RESOLVED, quality: 50 }, null, { encoder: enc, cacheDir });
    optimizeImages(mapFor(), { ...RESOLVED, max_width: 800 }, null, { encoder: enc, cacheDir });
    assert.strictEqual(enc.calls, 3);
    const m = mapFor();
    optimizeImages(m, { ...RESOLVED, quality: 50 }, null, { encoder: enc, cacheDir });
    assert.strictEqual(enc.calls, 3, 'each setting keeps its own entry');
    assert.match(fs.readFileSync(m['pic.png'].encodedPath, 'utf8'), /^q50 /);
  });

  it('another encoder version misses', () => {
    const { cacheDir, mapFor } = fresh();
    const a = countingEncoder('fake', '1.0');
    const b = countingEncoder('fake', '2.0');
    optimizeImages(mapFor(), RESOLVED, null, { encoder: a, cacheDir });
    optimizeImages(mapFor(), RESOLVED, null, { encoder: b, cacheDir });
    assert.strictEqual(b.calls, 1);
  });

  it('a changed picture misses', () => {
    const { cacheDir, sourcePath, mapFor } = fresh();
    const enc = countingEncoder();
    optimizeImages(mapFor(), RESOLVED, null, { encoder: enc, cacheDir });
    fs.writeFileSync(sourcePath, makePng(1800, 300));
    const m = mapFor();
    optimizeImages(m, RESOLVED, null, { encoder: enc, cacheDir });
    assert.strictEqual(enc.calls, 2);
    assert.match(fs.readFileSync(m['pic.png'].encodedPath, 'utf8'), new RegExp(` ${fs.statSync(sourcePath).size}$`));
  });

  it('a stopped write leaves no hit', () => {
    const { cacheDir, mapFor } = fresh();
    // Writes half a file where it was told to, then dies, as a build stopped mid-encode would.
    const dying = { name: 'fake', version: '1.0', encode(src, dest) { fs.writeFileSync(dest, 'half'); throw new Error('stopped'); } };
    const s1 = optimizeImages(mapFor(), RESOLVED, null, { encoder: dying, cacheDir });
    assert.strictEqual(s1.failed, 1);
    const enc = countingEncoder();
    const m = mapFor();
    optimizeImages(m, RESOLVED, null, { encoder: enc, cacheDir });
    assert.strictEqual(enc.calls, 1, 'the half file was not taken for a hit');
    assert.match(fs.readFileSync(m['pic.png'].encodedPath, 'utf8'), /^q82 /);
  });

  it('a result no smaller than the picture is remembered, and the picture is still left as it is', () => {
    const { cacheDir, sourcePath, mapFor } = fresh();
    const big = { name: 'fake', version: '1.0', calls: 0, encode(src, dest) { big.calls++; fs.writeFileSync(dest, Buffer.alloc(fs.statSync(sourcePath).size + 1)); } };
    for (let i = 0; i < 2; i++) {
      const m = mapFor();
      const s = optimizeImages(m, RESOLVED, null, { encoder: big, cacheDir });
      assert.strictEqual(s.skipped, 1);
      assert.strictEqual(m['pic.png'].relPath, 'pic.png');
      assert.strictEqual(m['pic.png'].encodedPath, undefined);
    }
    assert.strictEqual(big.calls, 1);
  });
});

describe('imageCacheDir', () => {
  const site = path.join(os.tmpdir(), 'gm-site-x');
  it('is a folder in the site folder', () => {
    assert.strictEqual(imageCacheDir(site, { outputDirs: [path.join(site, 'docs')], vaultPath: path.join(os.tmpdir(), 'v') }),
      path.join(site, CACHE_FOLDER, 'image-cache'));
  });
  it('is none when the output folder would hold it', () => {
    assert.strictEqual(imageCacheDir(site, { outputDirs: [site], vaultPath: path.join(os.tmpdir(), 'v') }), null);
  });
  it('is none when the vault would hold it', () => {
    assert.strictEqual(imageCacheDir(site, { outputDirs: [path.join(site, 'docs')], vaultPath: os.tmpdir() }), null);
  });
});

describe('ignoreCacheInGit', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-ignore-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('adds the folder to a site .gitignore once, in its own line endings', () => {
    const file = path.join(dir, '.gitignore');
    fs.writeFileSync(file, 'node_modules/\r\nsite/');
    ignoreCacheInGit(dir);
    ignoreCacheInGit(dir);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), `node_modules/\r\nsite/\r\n${CACHE_FOLDER}/\r\n`);
  });

  it('makes no .gitignore where the site has none', () => {
    const bare = path.join(dir, 'bare');
    fs.mkdirSync(bare);
    ignoreCacheInGit(bare);
    assert.ok(!fs.existsSync(path.join(bare, '.gitignore')));
  });

  it('leaves a .gitignore that already names the folder', () => {
    const other = path.join(dir, 'named');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, '.gitignore'), `/${CACHE_FOLDER}\n`);
    ignoreCacheInGit(other);
    assert.strictEqual(fs.readFileSync(path.join(other, '.gitignore'), 'utf8'), `/${CACHE_FOLDER}\n`);
  });
});
