const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { entry } = require('./settings/registry');
const { ensureIgnored } = require('./gitignore');

// Only raster formats that reliably shrink when re-encoded. SVG is vector, GIF may be
// animated, and WebP/AVIF are already in a modern format — all pass through untouched.
const OPTIMIZABLE_EXT = /\.(png|jpe?g)$/i;

const SUPPORTED_FORMATS = new Set(entry('player_site.images.format').values);

/**
 * Read an image's pixel width straight from its header.
 *
 * Cheaper and far more portable than shelling out to `sips`/`identify` just to learn
 * whether a resize is needed: cwebp's `-resize` has no shrink-only mode and will happily
 * upscale an image that is already narrower than maxWidth.
 *
 * @returns {number|null} width in pixels, or null if the header can't be read
 */
function probeWidth(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(2);
    if (fs.readSync(fd, head, 0, 2, 0) < 2) return null;

    // PNG: 8-byte signature, then a 4-byte chunk length, 'IHDR', width (uint32 BE).
    if (head[0] === 0x89 && head[1] === 0x50) {
      const buf = Buffer.alloc(4);
      if (fs.readSync(fd, buf, 0, 4, 16) < 4) return null;
      return buf.readUInt32BE(0) || null;
    }

    // JPEG: walk the marker chain to a Start-Of-Frame segment, whose payload is
    // precision(1) height(2) width(2).
    if (head[0] === 0xff && head[1] === 0xd8) {
      const { size } = fs.fstatSync(fd);
      let offset = 2;
      const seg = Buffer.alloc(9);
      while (offset + 9 <= size) {
        if (fs.readSync(fd, seg, 0, 9, offset) < 9) return null;
        if (seg[0] !== 0xff) return null; // desynced from the marker chain
        const marker = seg[1];
        // Standalone markers carry no length payload.
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
        const segLength = seg.readUInt16BE(2);
        if (segLength < 2) return null;
        // SOF0-3, SOF5-7, SOF9-11, SOF13-15. DHT (c4), JPG (c8) and DAC (cc) are not frames.
        const isSOF = marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) return seg.readUInt16BE(7) || null;
        offset += 2 + segLength;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

/**
 * Assemble the cwebp argv for one image.
 *
 * `-resize W 0` scales to width W preserving aspect ratio — but it enlarges as readily as
 * it shrinks, and cwebp has no shrink-only flag. So the resize is only requested once the
 * source is known to be wider than the cap; an unreadable header means no resize at all.
 *
 * @param {{src: string, dest: string, maxWidth: number, quality: number, width: number|null}} spec
 * @returns {string[]}
 */
function buildCwebpArgs({ src, dest, maxWidth, quality, width }) {
  const args = ['-quiet', '-q', String(quality)];
  if (maxWidth > 0 && width && width > maxWidth) args.push('-resize', String(maxWidth), '0');
  args.push(src, '-o', dest);
  return args;
}

function cwebpEncoder(version) {
  return {
    name: 'cwebp',
    version,
    encode(src, dest, { maxWidth, quality }) {
      const args = buildCwebpArgs({ src, dest, maxWidth, quality, width: probeWidth(src) });
      execFileSync('cwebp', args, { stdio: 'ignore' });
    },
  };
}

/**
 * Pick an available encoder.
 *
 * cwebp (libwebp) rather than `sharp`, for two reasons. This tool vendors its runtime deps
 * into a git-tracked node_modules so they survive the copy into the plugin cache, and
 * sharp's per-platform native binaries are not viable to vendor. And sharp's API is
 * promise-only, which would make the whole synchronous build pipeline async for a feature
 * that is off by default.
 *
 * @returns {{name: string, encode: Function}|null}
 */
function detectEncoder() {
  try {
    // The version is part of the image cache's key: another libwebp may encode other bytes.
    const version = execFileSync('cwebp', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return cwebpEncoder(version);
  } catch {
    return null;
  }
}

// The site folder's own folder for what the tool keeps between builds. Never published: the output folder is elsewhere.
const CACHE_FOLDER = '.gm-apprentice';

/**
 * Where the image cache lives: in the site folder, beside the output folder. None (no cache, encode
 * every build) when the output folder or the vault would hold it: the output folder is emptied and
 * published, and the vault is the GM's.
 *
 * @param {string} siteDir
 * @param {{outputDirs: string[], vaultPath: string}} where
 * @returns {string|null}
 */
function imageCacheDir(siteDir, { outputDirs, vaultPath }) {
  const dir = path.resolve(siteDir, CACHE_FOLDER, 'image-cache');
  // Through links: an output folder or vault reached by a symlink is the same folder.
  const { real } = require('./gm-site');
  const realDir = real(dir);
  const within = (outer) => {
    const rel = path.relative(real(outer), realDir);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  return [...outputDirs, vaultPath].some(within) ? null : dir;
}

/**
 * Add the cache folder to the site folder's .gitignore, when it has one and it does not name the folder yet.
 * In the file's own line endings; a site with no .gitignore gets none.
 */
function ignoreCacheInGit(siteDir) {
  // A .gitignore that cannot be written (read-only) must not stop the build; the cache still works.
  ensureIgnored(siteDir, [`${CACHE_FOLDER}/`], 'the image cache folder');
}

// The way this tool asks the encoder for a picture (buildCwebpArgs, the width probe). Raise it whenever
// either changes, so a cache made by an older tool is never served: nothing else would tell them apart.
const ENCODE_RECIPE = 1;

// One cache entry per picture: its bytes, and everything that changes what the encoder makes of them.
function cacheKey(sourcePath, cfg, encoder, recipe = ENCODE_RECIPE) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({
    recipe,
    format: cfg.format, quality: cfg.quality, maxWidth: cfg.maxWidth,
    encoder: encoder.name, version: encoder.version || null,
  }));
  hash.update('\0');
  hash.update(fs.readFileSync(sourcePath));
  return hash.digest('hex');
}

// A build stopped while encoding leaves its .tmp- file behind; it is never read as a picture. Remove
// ones more than an hour old, so a build running at the same moment keeps its own. The cache itself
// is never pruned: an entry costs disk, never a wrong picture, and a picture that comes back is free.
function removeOldTempFiles(cacheDir, now = Date.now()) {
  for (const name of fs.readdirSync(cacheDir)) {
    if (!name.startsWith('.tmp-')) continue;
    const full = path.join(cacheDir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > 60 * 60 * 1000) fs.rmSync(full, { force: true });
    } catch { /* gone already, or another build has it */ }
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function resolveImageConfig(cfg) {
  return {
    optimize: cfg.optimize,
    format: String(cfg.format).toLowerCase(),
    maxWidth: cfg.max_width,
    quality: clamp(cfg.quality, 0, 100),
  };
}

/**
 * Re-encode every optimizable image in `imageMap` into `tmpDir`, in place; or, given
 * `options.cacheDir`, take each from the image cache and encode only what it does not hold.
 *
 * Mutates each converted entry: `relPath` gains the new extension (so templates emit the
 * converted reference at src-emission time, never by string-matching generated HTML) and
 * `encodedPath` points at the encoded bytes for the later copy pass. An entry whose encode
 * fails, or whose result is not actually smaller, is left completely untouched.
 *
 * @param {Record<string, {sourcePath: string, relPath: string, encodedPath?: string}>} imageMap
 * @param {object} imagesConfig - the `publish.images` block
 * @param {string|null} tmpDir - scratch directory the caller owns and cleans up; unused with a cache
 * @param {{encoder?: {name: string, version?: string, encode: Function}|null, cacheDir?: string|null, claimed?: Iterable<string>}} [options]
 *   - inject an encoder (tests); the image cache folder (imageCacheDir); addresses another copy step writes, which
 *     an encoded name must not take (compared as `relPath` is, without case)
 * @returns {{converted: number, skipped: number, failed: number, encoded: number, bytesBefore: number, bytesAfter: number, encoder: string|null, reason?: string}}
 */
function optimizeImages(imageMap, imagesConfig, tmpDir, options = {}) {
  const stats = { converted: 0, skipped: 0, failed: 0, encoded: 0, bytesBefore: 0, bytesAfter: 0, encoder: null };
  const cacheDir = options.cacheDir || null;
  const cfg = resolveImageConfig(imagesConfig);
  if (!cfg.optimize) return { ...stats, reason: 'disabled' };

  if (!SUPPORTED_FORMATS.has(cfg.format)) {
    return { ...stats, reason: `unsupported format "${cfg.format}" (supported: webp)` };
  }

  const encoder = 'encoder' in options ? options.encoder : detectEncoder();
  if (!encoder) {
    return { ...stats, reason: 'cwebp not found on PATH — install libwebp (brew install webp / apt install webp)' };
  }
  stats.encoder = encoder.name;
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true });
    removeOldTempFiles(cacheDir);
  }

  // Two sources with the same stem in the same directory (`a.png` and `a.jpg`) would both
  // want `a.webp`. First one wins; the loser keeps its original bytes rather than silently
  // clobbering a sibling that other pages already reference.
  const claimedRelPaths = new Set([...Object.values(imageMap).map(e => e.relPath), ...(options.claimed || [])].map(r => r.toLowerCase()));
  let counter = 0;

  for (const [basename, entry] of Object.entries(imageMap)) {
    if (!OPTIMIZABLE_EXT.test(basename)) { stats.skipped++; continue; }

    const targetRelPath = entry.relPath.replace(OPTIMIZABLE_EXT, `.${cfg.format}`);
    if (claimedRelPaths.has(targetRelPath.toLowerCase())) {
      console.warn(`  images: skipping "${basename}" — "${targetRelPath}" is already taken`);
      stats.skipped++;
      continue;
    }

    let encodedPath;
    if (cacheDir) {
      // The cache: one file per picture's bytes and encoding settings. A hit is the file a
      // build encoded before, so the output is the same bytes without running the encoder.
      encodedPath = path.join(cacheDir, `${cacheKey(entry.sourcePath, cfg, encoder)}.${cfg.format}`);
      if (!fs.existsSync(encodedPath)) {
        // Encoded beside the entry and renamed into place: a build stopped mid-encode
        // leaves a temp file, never a half entry that a later build takes for a hit.
        const temp = path.join(cacheDir, `.tmp-${process.pid}-${counter++}.${cfg.format}`);
        try {
          encoder.encode(entry.sourcePath, temp, cfg);
          if (!fs.existsSync(temp)) throw new Error('the encoder wrote nothing');
          fs.renameSync(temp, encodedPath);
        } catch (e) {
          fs.rmSync(temp, { force: true });
          console.warn(`  images: failed to encode "${basename}" — ${e.message.split('\n')[0]}`);
          stats.failed++;
          continue;
        }
        stats.encoded++;
      }
    } else {
      // Encoded filenames are ordinals, not the source basename: the scratch path never has
      // to survive spaces, non-ASCII, or a nested relPath.
      encodedPath = path.join(tmpDir, `${counter++}.${cfg.format}`);
      try {
        encoder.encode(entry.sourcePath, encodedPath, cfg);
      } catch (e) {
        console.warn(`  images: failed to encode "${basename}" — ${e.message.split('\n')[0]}`);
        stats.failed++;
        continue;
      }
      if (!fs.existsSync(encodedPath)) { stats.failed++; continue; }
      stats.encoded++;
    }

    const before = fs.statSync(entry.sourcePath).size;
    const after = fs.statSync(encodedPath).size;
    if (after >= before) {
      // Already well-compressed. Keeping the original is strictly better than shipping a
      // larger file in a format some older clients can't read. A cached result stays in
      // the cache, so the next build does not encode it again to learn the same thing.
      if (!cacheDir) fs.rmSync(encodedPath, { force: true });
      stats.skipped++;
      continue;
    }

    claimedRelPaths.add(targetRelPath.toLowerCase());
    entry.encodedPath = encodedPath;
    entry.relPath = targetRelPath;
    stats.converted++;
    stats.bytesBefore += before;
    stats.bytesAfter += after;
  }

  return stats;
}

module.exports = {
  optimizeImages, detectEncoder, resolveImageConfig, probeWidth, buildCwebpArgs, OPTIMIZABLE_EXT,
  imageCacheDir, ignoreCacheInGit, CACHE_FOLDER, cacheKey, removeOldTempFiles, ENCODE_RECIPE,
};
