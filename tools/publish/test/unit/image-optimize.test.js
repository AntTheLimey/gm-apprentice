const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  optimizeImages, detectEncoder, resolveImageConfig, probeWidth, buildCwebpArgs,
} = require('../../lib/image-optimize');
const { makePng, makeJpegHeader } = require('../helpers/make-png');

const hasCwebp = detectEncoder() !== null;

// Encoders that write a chosen number of bytes, so the size-comparison, failure and
// no-encoder branches are exercised on any machine — libwebp installed or not.
function fakeEncoder(bytes, name = 'fake') {
  return { name, encode: (src, dest) => fs.writeFileSync(dest, Buffer.alloc(bytes, 1)) };
}
const throwingEncoder = {
  name: 'fake',
  encode: () => { throw new Error('encoder exploded\nstack line'); },
};

describe('resolveImageConfig', () => {
  it('is off with no config at all', () => {
    assert.strictEqual(resolveImageConfig(undefined).optimize, false);
    assert.strictEqual(resolveImageConfig({}).optimize, false);
  });

  it('requires optimize to be exactly true, not merely truthy', () => {
    assert.strictEqual(resolveImageConfig({ optimize: 'yes' }).optimize, false);
    assert.strictEqual(resolveImageConfig({ optimize: 1 }).optimize, false);
    assert.strictEqual(resolveImageConfig({ optimize: true }).optimize, true);
  });

  it('defaults format, width and quality', () => {
    const cfg = resolveImageConfig({ optimize: true });
    assert.strictEqual(cfg.format, 'webp');
    assert.strictEqual(cfg.maxWidth, 1600);
    assert.strictEqual(cfg.quality, 82);
  });

  it('accepts camelCase maxWidth as well as snake_case max_width', () => {
    assert.strictEqual(resolveImageConfig({ maxWidth: 800 }).maxWidth, 800);
    assert.strictEqual(resolveImageConfig({ max_width: 900 }).maxWidth, 900);
    // snake_case wins when a config sets both
    assert.strictEqual(resolveImageConfig({ max_width: 900, maxWidth: 800 }).maxWidth, 900);
  });

  it('treats maxWidth 0 as "do not resize" rather than falling back to the default', () => {
    assert.strictEqual(resolveImageConfig({ max_width: 0 }).maxWidth, 0);
  });

  it('allows quality 0 without silently substituting 82', () => {
    assert.strictEqual(resolveImageConfig({ quality: 0 }).quality, 0);
  });
});

describe('buildCwebpArgs', () => {
  const base = { src: '/in.png', dest: '/out.webp', maxWidth: 1600, quality: 82 };

  it('resizes a source wider than the cap', () => {
    const args = buildCwebpArgs({ ...base, width: 2400 });
    assert.deepStrictEqual(args, ['-quiet', '-q', '82', '-resize', '1600', '0', '/in.png', '-o', '/out.webp']);
  });

  it('never enlarges a source narrower than the cap', () => {
    assert.ok(!buildCwebpArgs({ ...base, width: 300 }).includes('-resize'));
  });

  it('never resizes a source exactly at the cap', () => {
    assert.ok(!buildCwebpArgs({ ...base, width: 1600 }).includes('-resize'));
  });

  it('skips the resize when the width could not be probed', () => {
    assert.ok(!buildCwebpArgs({ ...base, width: null }).includes('-resize'));
  });

  it('skips the resize when maxWidth is 0', () => {
    assert.ok(!buildCwebpArgs({ ...base, maxWidth: 0, width: 9000 }).includes('-resize'));
  });
});

describe('probeWidth', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-probe-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads width from a PNG IHDR', () => {
    const p = path.join(dir, 'a.png');
    fs.writeFileSync(p, makePng(320, 100));
    assert.strictEqual(probeWidth(p), 320);
  });

  it('reads width from a JPEG SOF0 frame, skipping the APP0 segment', () => {
    const p = path.join(dir, 'a.jpg');
    fs.writeFileSync(p, makeJpegHeader(1234, 567));
    assert.strictEqual(probeWidth(p), 1234);
  });

  it('returns null for a file that is not a PNG or JPEG', () => {
    const p = path.join(dir, 'a.txt');
    fs.writeFileSync(p, 'definitely not an image');
    assert.strictEqual(probeWidth(p), null);
  });

  it('returns null rather than throwing on a missing file', () => {
    assert.strictEqual(probeWidth(path.join(dir, 'nope.png')), null);
  });

  it('returns null on a truncated JPEG instead of looping', () => {
    const p = path.join(dir, 'trunc.jpg');
    fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff]));
    assert.strictEqual(probeWidth(p), null);
  });
});

describe('optimizeImages', () => {
  let dir, tmpDir;

  function imageMapWith(entries) {
    const map = {};
    for (const [name, spec] of Object.entries(entries)) {
      const { width = 2000, height = 400, relPath = name, bytes } = spec || {};
      const sourcePath = path.join(dir, name);
      fs.writeFileSync(sourcePath, bytes || makePng(width, height));
      map[name] = { sourcePath, relPath };
    }
    return map;
  }

  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-opt-src-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Fresh scratch dir per test so encoded-file ordinals never collide across cases.
  const withTmp = fn => () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-opt-tmp-'));
    try { return fn(); } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  };

  it('does nothing when optimize is off', withTmp(() => {
    const map = imageMapWith({ 'off.png': {} });
    const stats = optimizeImages(map, { optimize: false }, tmpDir, { encoder: fakeEncoder(1) });
    assert.strictEqual(stats.reason, 'disabled');
    assert.strictEqual(stats.converted, 0);
    assert.strictEqual(map['off.png'].relPath, 'off.png');
    assert.strictEqual(map['off.png'].encodedPath, undefined);
  }));

  it('refuses an unsupported target format and changes nothing', withTmp(() => {
    const map = imageMapWith({ 'fmt.png': {} });
    const stats = optimizeImages(map, { optimize: true, format: 'avif' }, tmpDir, { encoder: fakeEncoder(1) });
    assert.match(stats.reason, /unsupported format "avif"/);
    assert.strictEqual(map['fmt.png'].relPath, 'fmt.png');
  }));

  it('reports a missing encoder instead of throwing', withTmp(() => {
    const map = imageMapWith({ 'noenc.png': {} });
    const stats = optimizeImages(map, { optimize: true }, tmpDir, { encoder: null });
    assert.match(stats.reason, /cwebp not found/);
    assert.strictEqual(map['noenc.png'].relPath, 'noenc.png');
  }));

  it('leaves non-raster and already-modern formats alone', withTmp(() => {
    const map = {};
    for (const name of ['vector.svg', 'anim.gif', 'already.webp']) {
      map[name] = { sourcePath: path.join(dir, name), relPath: name };
      fs.writeFileSync(map[name].sourcePath, 'x');
    }
    const stats = optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(1) });
    assert.strictEqual(stats.converted, 0);
    assert.strictEqual(stats.skipped, 3);
    assert.strictEqual(map['vector.svg'].relPath, 'vector.svg');
    assert.strictEqual(map['already.webp'].relPath, 'already.webp');
  }));

  it('converts a PNG and swaps relPath to .webp', withTmp(() => {
    const map = imageMapWith({ 'portrait.png': {} });
    const stats = optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(10) });

    assert.strictEqual(stats.converted, 1);
    assert.strictEqual(stats.encoder, 'fake');
    assert.strictEqual(map['portrait.png'].relPath, 'portrait.webp');
    assert.ok(fs.existsSync(map['portrait.png'].encodedPath));
  }));

  it('keys stay the original basename so portrait: and ![[embeds]] still resolve', withTmp(() => {
    const map = imageMapWith({ 'Rock Lavey.png': {} });
    optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(10) });
    assert.ok(map['Rock Lavey.png'], 'lookup key must not change');
    assert.strictEqual(map['Rock Lavey.png'].relPath, 'Rock Lavey.webp');
  }));

  it('preserves the subdirectory when swapping the extension', withTmp(() => {
    const map = imageMapWith({ 'nested.png': { relPath: 'characters/nested.png' } });
    optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(10) });
    assert.strictEqual(map['nested.png'].relPath, 'characters/nested.webp');
  }));

  it('keeps the original when the re-encode is not actually smaller', withTmp(() => {
    const map = imageMapWith({ 'big.png': { width: 4, height: 4 } });
    const original = fs.statSync(map['big.png'].sourcePath).size;
    const stats = optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(original + 1) });

    assert.strictEqual(stats.converted, 0);
    assert.strictEqual(stats.skipped, 1);
    assert.strictEqual(map['big.png'].relPath, 'big.png');
    assert.strictEqual(map['big.png'].encodedPath, undefined);
    assert.strictEqual(fs.readdirSync(tmpDir).length, 0, 'oversized encode should be cleaned up');
  }));

  it('keeps the original when the encoder throws, and counts it as failed', withTmp(() => {
    const map = imageMapWith({ 'boom.png': {} });
    const stats = optimizeImages(map, { optimize: true }, tmpDir, { encoder: throwingEncoder });

    assert.strictEqual(stats.failed, 1);
    assert.strictEqual(stats.converted, 0);
    assert.strictEqual(map['boom.png'].relPath, 'boom.png');
    assert.strictEqual(map['boom.png'].encodedPath, undefined);
  }));

  it('will not let two sources collide on one .webp path', withTmp(() => {
    const map = imageMapWith({ 'clash.png': {}, 'clash.jpg': {} });
    const stats = optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(10) });

    const relPaths = Object.values(map).map(e => e.relPath);
    assert.strictEqual(new Set(relPaths).size, 2, `relPaths must stay distinct: ${relPaths}`);
    assert.strictEqual(stats.converted, 1);
    assert.strictEqual(stats.skipped, 1);
  }));

  it('does not convert onto a .webp path an existing source already occupies', withTmp(() => {
    const map = imageMapWith({ 'held.png': {} });
    map['held.webp'] = { sourcePath: path.join(dir, 'held-real.webp'), relPath: 'held.webp' };
    fs.writeFileSync(map['held.webp'].sourcePath, 'pretend webp');

    optimizeImages(map, { optimize: true }, tmpDir, { encoder: fakeEncoder(1) });
    assert.strictEqual(map['held.png'].relPath, 'held.png', 'must not clobber the real held.webp');
  }));
});

describe('optimizeImages with the real cwebp encoder', { skip: !hasCwebp }, () => {
  let dir, tmpDir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cwebp-src-'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cwebp-tmp-'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('really shrinks a wide PNG and writes a valid WebP', () => {
    const sourcePath = path.join(dir, 'wide.png');
    fs.writeFileSync(sourcePath, makePng(2400, 600));
    const map = { 'wide.png': { sourcePath, relPath: 'wide.png' } };

    const stats = optimizeImages(map, { optimize: true, max_width: 1000 }, tmpDir);

    assert.strictEqual(stats.encoder, 'cwebp');
    assert.strictEqual(stats.converted, 1);
    assert.ok(stats.bytesAfter < stats.bytesBefore, `${stats.bytesAfter} !< ${stats.bytesBefore}`);
    assert.strictEqual(map['wide.png'].relPath, 'wide.webp');

    const header = fs.readFileSync(map['wide.png'].encodedPath).subarray(0, 12);
    assert.strictEqual(header.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.strictEqual(header.subarray(8, 12).toString('ascii'), 'WEBP');
  });
});
