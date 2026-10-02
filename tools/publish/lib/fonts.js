'use strict';

// theme.fonts.source: 'self-host' (#270). At build time, fetch each non-generic font family
// from Google Fonts ONCE, keep the woff2 files in a cache inside the vault, and serve them
// from the site itself — so visitors' browsers never contact Google (no IP leak, no GDPR
// consent question).
//
// Cache location: <vault>/_meta/font-cache/<family-slug>/. _meta/ is already the vault's
// tool-owned directory (vault-config.md, publish-manifest.md), the publisher always
// excludes it from the site (publish-decision ALWAYS_EXCLUDE_DIRS), and it travels with
// the vault, so a later build on the same vault works offline and reproduces the same
// site. Fonts are OFL; the files are stored and served unmodified (no subsetting, no
// renaming — Reserved Font Name clauses).
//
// build() stays synchronous: prefetching is a separate async step (ensureFontCache /
// buildWithFonts) that populates the cache; build() only ever READS the cache.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GENERIC_FAMILIES = new Set([
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
]);

// Requested axes, most to least specific. Regular + bold, roman + italic, so bold and
// italic body text never faux-renders. A family without italics (or without a 700) makes
// Google answer 400, so we step down to the next candidate.
const AXIS_CANDIDATES = [
  'ital,wght@0,400;0,700;1,400;1,700',
  'wght@400;700',
  null, // family default
];

const CACHE_DIR = '_meta/font-cache';
const FETCH_TIMEOUT_MS = 15000;
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const GSTATIC_HOST = 'fonts.gstatic.com';
// A modern browser UA: Google serves woff2 (with unicode-range subsets) only to those.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,63}$/;

function isValidFamily(name) {
  return typeof name === 'string' && FAMILY_RE.test(name) && !name.includes('  ');
}

function slugFor(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Families this config needs self-hosted, in heading, body, then preset order, deduped.
function selfHostFamilies(fonts, extraFamilies = []) {
  const names = [fonts && fonts.heading, fonts && fonts.body, ...extraFamilies]
    .filter(f => f && !GENERIC_FAMILIES.has(f));
  return names.filter((v, i, a) => a.indexOf(v) === i);
}

// Family names a genre preset's own stylesheet pulls from Google (scifi's Rajdhani).
function presetImportFamilies(css) {
  const out = [];
  const importRe = /^@import\s+url\(['"]?(https?:\/\/fonts\.googleapis\.com\/[^)'"]*)['"]?\)\s*;/gm;
  let m;
  while ((m = importRe.exec(css || ''))) {
    const famRe = /[?&]family=([^&:;]+)/g;
    let f;
    while ((f = famRe.exec(m[1]))) {
      const name = decodeURIComponent(f[1].replace(/\+/g, ' '));
      if (isValidFamily(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function familyDir(vaultPath, family) {
  const root = path.resolve(vaultPath, CACHE_DIR);
  if (!isValidFamily(family) || !slugFor(family)) {
    throw new Error(`Refusing unsafe font family name: ${JSON.stringify(family)}`);
  }
  const dir = path.resolve(root, slugFor(family));
  if (!dir.startsWith(root + path.sep)) {
    throw new Error(`Refusing unsafe font family name: ${JSON.stringify(family)}`);
  }
  return dir;
}

// Parses Google's CSS2 response into faces. Only fonts.gstatic.com https URLs and
// well-formed descriptors survive; anything else is dropped rather than trusted.
function parseFontFaces(css, family) {
  const faces = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    const body = m[1];
    const prop = (name) => {
      const r = new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+)`, 'i').exec(body);
      return r ? r[1].trim() : null;
    };
    const fam = (prop('font-family') || '').replace(/^['"]|['"]$/g, '');
    if (fam.toLowerCase() !== family.toLowerCase()) continue;
    const style = prop('font-style') || 'normal';
    const weight = prop('font-weight') || '400';
    const range = prop('unicode-range');
    const srcUrl = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*format\(\s*['"]woff2['"]\s*\)/i.exec(prop('src') || '');
    if (!srcUrl) continue;
    let u;
    try { u = new URL(srcUrl[1]); } catch { continue; }
    if (u.protocol !== 'https:' || u.hostname !== GSTATIC_HOST) continue;
    if (!/^(normal|italic|oblique)$/.test(style)) continue;
    if (!/^\d{3}(\s\d{3})?$/.test(weight)) continue;
    if (range && !/^[Uu+0-9A-Fa-f,\s?-]+$/.test(range)) continue;
    faces.push({ url: u.href, style, weight, unicodeRange: range || null });
  }
  return faces;
}

function googleCssUrl(family, axes) {
  const fam = family.replace(/ /g, '+') + (axes ? `:${axes}` : '');
  return `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;
}

const CSS_HOST = 'fonts.googleapis.com';

// Fetches `url` and enforces, AFTER redirects, that the response still comes from
// `expectedHost` (response.url is the final URL; a mock with no url is not checked).
async function fetchWithTimeout(fetchImpl, url, timeoutMs, expectedHost) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (expectedHost && res.url) {
    let host = null;
    try { host = new URL(res.url).hostname; } catch { /* unparseable: refuse below */ }
    if (host !== expectedHost) {
      throw new Error(`response for ${url} was redirected to ${host || 'an unparseable URL'}, not ${expectedHost}`);
    }
  }
  return res;
}

// Reads a family's cache, or null when absent or incomplete (a missing file = a miss).
function readFamilyCache(vaultPath, family) {
  let dir;
  try { dir = familyDir(vaultPath, family); } catch { return null; }
  try {
    const faces = JSON.parse(fs.readFileSync(path.join(dir, 'faces.json'), 'utf8'));
    if (!Array.isArray(faces) || faces.length === 0) return null;
    for (const f of faces) {
      if (!/^[0-9a-f]{16}\.woff2$/.test(f.file)) return null;
      if (!fs.existsSync(path.join(dir, f.file))) return null;
    }
    return faces;
  } catch {
    return null;
  }
}

async function downloadFamily(vaultPath, family, { fetch: fetchImpl, timeoutMs }) {
  const dir = familyDir(vaultPath, family);
  let faces = [];
  let lastErr = null;
  for (const axes of AXIS_CANDIDATES) {
    const res = await fetchWithTimeout(fetchImpl, googleCssUrl(family, axes), timeoutMs, CSS_HOST);
    if (res.status === 400 || res.status === 404) {
      lastErr = new Error(`Google Fonts has no ${axes || 'default'} styles for "${family}" (HTTP ${res.status})`);
      continue;
    }
    if (!res.ok) throw new Error(`Google Fonts returned HTTP ${res.status} for "${family}"`);
    faces = parseFontFaces(await res.text(), family);
    if (faces.length > 0) break;
    lastErr = new Error(`Google Fonts returned no usable font files for "${family}"`);
  }
  if (faces.length === 0) throw lastErr || new Error(`no font files for "${family}"`);

  fs.mkdirSync(dir, { recursive: true });
  const byUrl = new Map();
  const out = [];
  for (const face of faces) {
    let file = byUrl.get(face.url);
    if (!file) {
      file = crypto.createHash('sha1').update(face.url).digest('hex').slice(0, 16) + '.woff2';
      const res = await fetchWithTimeout(fetchImpl, face.url, timeoutMs, GSTATIC_HOST);
      if (!res.ok) throw new Error(`font download failed (HTTP ${res.status}) for "${family}"`);
      // Refuse before buffering: a declared length over the cap never gets read.
      const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
      if (declared > MAX_FONT_BYTES) throw new Error(`font file for "${family}" is too large (${declared} bytes)`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_FONT_BYTES || buf.subarray(0, 4).toString('latin1') !== 'wOF2') {
        throw new Error(`downloaded file for "${family}" is not a woff2 font`);
      }
      fs.writeFileSync(path.join(dir, file), buf);
      byUrl.set(face.url, file);
    }
    out.push({ style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, file });
  }
  // faces.json is written last: its presence means every file above landed.
  fs.writeFileSync(path.join(dir, 'faces.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

// Populates the cache for every family not already cached. Never throws for network
// trouble: it warns loudly and leaves the family uncached (build() then falls back to
// the CSS stack — never to a Google import).
async function ensureFontCache(vaultPath, families, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  const warn = opts.warn || console.warn;
  const log = opts.log || console.log;
  for (const family of families) {
    if (!isValidFamily(family)) continue; // build() reports the bad name
    if (readFamilyCache(vaultPath, family)) continue;
    try {
      const faces = await downloadFamily(vaultPath, family, { fetch: fetchImpl, timeoutMs });
      log(`  self-hosted font "${family}": ${faces.length} face(s) cached in ${CACHE_DIR}/${slugFor(family)}/`);
    } catch (err) {
      warn(`  WARNING: could not download font "${family}" for self-hosting (${err.message}). `
        + 'The site will use the fallback font stack instead; rebuild with network access to fetch it.');
    }
  }
}

// Sync, cache-only. Returns { css, files } where files are the cached fonts to copy to the
// output; families with no cache warn and contribute nothing.
function selfHostedFontFaces(vaultPath, families, warn = console.warn) {
  const rules = [];
  const files = [];
  for (const family of families) {
    if (!isValidFamily(family)) {
      warn(`  WARNING: font "${family}" is not a valid Google Fonts family name — cannot self-host it; using the fallback stack.`);
      continue;
    }
    const faces = readFamilyCache(vaultPath, family);
    if (!faces) {
      warn(`  WARNING: font "${family}" is not in the vault's font cache (${CACHE_DIR}/${slugFor(family)}) and could not be downloaded — `
        + 'using the fallback font stack. Rebuild with network access. Google Fonts is NOT used in self-host mode.');
      continue;
    }
    const slug = slugFor(family);
    const dir = familyDir(vaultPath, family);
    for (const f of faces) {
      const range = f.unicodeRange ? `\n  unicode-range: ${f.unicodeRange};` : '';
      rules.push(`@font-face {\n  font-family: '${family}';\n  font-style: ${f.style};\n  font-weight: ${f.weight};\n  font-display: swap;\n  src: url('../fonts/${slug}/${f.file}') format('woff2');${range}\n}`);
      const rel = `${slug}/${f.file}`;
      if (!files.some(x => x.rel === rel)) files.push({ from: path.join(dir, f.file), rel });
    }
  }
  return { css: rules.length ? rules.join('\n') + '\n\n' : '', files };
}

function presetFamiliesFor(theme) {
  const { resolveGenrePreset } = require('./theme');
  const preset = resolveGenrePreset(theme.genre);
  // The preset CSS is linked and copied even when a custom palette is set, so its
  // font imports ship either way.
  if (!preset) return [];
  try {
    return presetImportFamilies(fs.readFileSync(path.join(__dirname, `../css/themes/${preset}.css`), 'utf8'));
  } catch {
    return [];
  }
}

// Prefetch for a vault.config.json path, then the caller builds. Mirrors what build()
// will resolve (same config, same preset families) so the cache is warm.
async function prefetchForConfig(configPath, opts = {}) {
  const { resolveConfig } = require('./config');
  const resolved = path.resolve(configPath || './vault.config.json');
  const config = require(resolved);
  const vaultPath = path.resolve(path.dirname(resolved), config.vaultPath);
  const { publishConfig } = resolveConfig(config, vaultPath);
  const fonts = publishConfig.theme.fonts || {};
  if (fonts.source !== 'self-host') return;
  await ensureFontCache(vaultPath, selfHostFamilies(fonts, presetFamiliesFor(publishConfig.theme)), opts);
}

async function buildWithFonts(options = {}, opts = {}) {
  await prefetchForConfig(options.configPath, opts);
  return require('./build').build(options);
}

const GOOGLE_WARNING = (names) => `Custom fonts ${names} are loaded from Google Fonts at page load. `
  + "Visitors' IP addresses are sent to Google; some jurisdictions (e.g. the EU under GDPR) require consent for this. "
  + 'Set theme.fonts.source: self-host to serve them from your site instead, or use a system font.';

module.exports = {
  GENERIC_FAMILIES, CACHE_DIR, AXIS_CANDIDATES, GOOGLE_WARNING,
  isValidFamily, slugFor, selfHostFamilies, presetImportFamilies, parseFontFaces,
  readFamilyCache, ensureFontCache, selfHostedFontFaces, prefetchForConfig, presetFamiliesFor, buildWithFonts,
};
