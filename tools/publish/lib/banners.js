const fs = require('fs');
const path = require('path');
const { escapeHtml, encodeImageUrl } = require('./processor');

// Ordered by preference: the first match wins when a section folder holds several.
const BANNER_EXTS = ['svg', 'webp', 'avif', 'png', 'jpg', 'jpeg', 'gif'];
const CONVENTION_BASENAME = '_banner';

function isSvg(p) {
  return /\.svg$/i.test(String(p));
}

/**
 * A banner is either a bare path or a { image, link, alt } object.
 * Anything else (a number, an object with no image) resolves to no banner.
 */
function normalizeEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return raw.trim() ? { image: raw.trim(), link: null, alt: null } : null;
  }
  if (typeof raw === 'object' && raw.image) {
    return {
      image: String(raw.image).trim(),
      link: raw.link ? String(raw.link).trim() : null,
      alt: raw.alt ? String(raw.alt) : null,
    };
  }
  return null;
}

/** The vault folder a generated index dir was built from, per folderMap. */
function sourceFolderFor(dir, folderMap) {
  for (const [folder, outDir] of Object.entries(folderMap || {})) {
    if (outDir === dir) return folder;
  }
  return null;
}

function findConventionBanner(vaultPath, folder) {
  if (!folder) return null;
  for (const ext of BANNER_EXTS) {
    const rel = `${folder}/${CONVENTION_BASENAME}.${ext}`;
    if (fs.existsSync(path.join(vaultPath, rel))) return rel;
  }
  return null;
}

/**
 * Resolve the banner for one section index, config first, then convention.
 *
 * @returns {{image: string, link: string|null, alt: string|null}|null} vault-relative paths
 */
function resolveBanner(dir, { vaultPath, folderMap, banners }) {
  const configured = normalizeEntry((banners || {})[dir]);
  if (configured) return configured;

  const conventional = findConventionBanner(vaultPath, sourceFolderFor(dir, folderMap));
  return conventional ? { image: conventional, link: null, alt: null } : null;
}

/** Alt text derived from a filename when the config supplies none. */
function defaultAlt(imagePath) {
  return path.basename(String(imagePath))
    .replace(/\.[^.]+$/, '')
    .replace(/^_/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/**
 * Render the banner block for a section index.
 *
 * An SVG with no link target is inlined rather than referenced through an `<img>`: only
 * inline SVG keeps its internal `<a>` links live, which is the whole point of shipping a
 * clickable star map. Wrapping it in an outer `<a>` would swallow those same links, so a
 * banner that declares a link target renders as a plain `<img>` inside the anchor instead —
 * that is the "raster display, full-size SVG behind it" shape.
 *
 * @param {{svg?: string, imageHref?: string, linkHref?: string|null, alt?: string}} banner
 * @returns {string}
 */
function renderBanner({ svg, imageHref, linkHref, alt }) {
  if (svg) {
    return `<figure class="section-banner section-banner-inline">${svg}</figure>`;
  }
  if (!imageHref) return '';

  const img = `<img src="${encodeImageUrl(imageHref)}" alt="${escapeHtml(alt || '')}" class="section-banner-img">`;
  const inner = linkHref
    ? `<a class="section-banner-link" href="${encodeImageUrl(linkHref)}">${img}</a>`
    : img;
  return `<figure class="section-banner">${inner}</figure>`;
}

module.exports = {
  resolveBanner, renderBanner, normalizeEntry, sourceFolderFor,
  findConventionBanner, defaultAlt, isSvg, BANNER_EXTS,
};
