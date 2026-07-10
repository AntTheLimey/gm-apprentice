const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Only raster formats that reliably shrink when re-encoded. SVG is vector, GIF may be
// animated, and WebP/AVIF are already in a modern format — all pass through untouched.
const OPTIMIZABLE_EXT = /\.(png|jpe?g)$/i;

const SUPPORTED_FORMATS = new Set(['webp']);

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

function cwebpEncoder() {
  return {
    name: 'cwebp',
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
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
    return cwebpEncoder();
  } catch {
    return null;
  }
}

function resolveImageConfig(images) {
  const cfg = images || {};
  const maxWidth = cfg.max_width ?? cfg.maxWidth ?? 1600;
  return {
    optimize: cfg.optimize === true,
    format: String(cfg.format || 'webp').toLowerCase(),
    maxWidth: Number(maxWidth) || 0,
    quality: Number(cfg.quality ?? 82),
  };
}

/**
 * Re-encode every optimizable image in `imageMap` into `tmpDir`, in place.
 *
 * Mutates each converted entry: `relPath` gains the new extension (so templates emit the
 * converted reference at src-emission time, never by string-matching generated HTML) and
 * `encodedPath` points at the encoded bytes for the later copy pass. An entry whose encode
 * fails, or whose result is not actually smaller, is left completely untouched.
 *
 * @param {Record<string, {sourcePath: string, relPath: string, encodedPath?: string}>} imageMap
 * @param {object} imagesConfig - the `publish.images` block
 * @param {string} tmpDir - scratch directory the caller owns and cleans up
 * @param {{encoder?: {name: string, encode: Function}|null}} [options] - inject an encoder (tests)
 * @returns {{converted: number, skipped: number, failed: number, bytesBefore: number, bytesAfter: number, encoder: string|null, reason?: string}}
 */
function optimizeImages(imageMap, imagesConfig, tmpDir, options = {}) {
  const stats = { converted: 0, skipped: 0, failed: 0, bytesBefore: 0, bytesAfter: 0, encoder: null };
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

  // Two sources with the same stem in the same directory (`a.png` and `a.jpg`) would both
  // want `a.webp`. First one wins; the loser keeps its original bytes rather than silently
  // clobbering a sibling that other pages already reference.
  const claimedRelPaths = new Set(Object.values(imageMap).map(e => e.relPath.toLowerCase()));
  let counter = 0;

  for (const [basename, entry] of Object.entries(imageMap)) {
    if (!OPTIMIZABLE_EXT.test(basename)) { stats.skipped++; continue; }

    const targetRelPath = entry.relPath.replace(OPTIMIZABLE_EXT, `.${cfg.format}`);
    if (claimedRelPaths.has(targetRelPath.toLowerCase())) {
      console.warn(`  images: skipping "${basename}" — "${targetRelPath}" is already taken`);
      stats.skipped++;
      continue;
    }

    // Encoded filenames are ordinals, not the source basename: the scratch path never has
    // to survive spaces, non-ASCII, or a nested relPath.
    const encodedPath = path.join(tmpDir, `${counter++}.${cfg.format}`);
    try {
      encoder.encode(entry.sourcePath, encodedPath, cfg);
    } catch (e) {
      console.warn(`  images: failed to encode "${basename}" — ${e.message.split('\n')[0]}`);
      stats.failed++;
      continue;
    }

    if (!fs.existsSync(encodedPath)) { stats.failed++; continue; }

    const before = fs.statSync(entry.sourcePath).size;
    const after = fs.statSync(encodedPath).size;
    if (after >= before) {
      // Already well-compressed. Keeping the original is strictly better than shipping a
      // larger file in a format some older clients can't read.
      fs.rmSync(encodedPath, { force: true });
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
};
