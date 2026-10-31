const { readerFrom } = require('./vault-reader');
const path = require('path');
const { escapeHtml, encodeImageUrl } = require('./processor');

// Ordered by preference: the first match wins when a section folder holds several.
const BANNER_EXTS = ['svg', 'webp', 'avif', 'png', 'jpg', 'jpeg', 'gif'];
const CONVENTION_BASENAME = '_banner';

function isSvg(p) {
  return /\.svg$/i.test(String(p));
}

/**
 * A banner is either a bare path or a { image, link, alt } object. A path may be written as a wikilink or an embed
 * (`[[Harbour.png]]`), which is read as the path inside it.
 * Anything else (a number, an object with no image) resolves to no banner.
 */
function normalizeEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return linkTarget(raw) ? { image: linkTarget(raw), link: null, alt: null } : null;
  }
  if (typeof raw === 'object' && raw.image && linkTarget(raw.image)) {
    return {
      image: linkTarget(raw.image),
      link: raw.link ? linkTarget(raw.link) : null,
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

function findConventionBanner(vaultPath, folder, deps) {
  const rd = readerFrom(deps);
  if (!folder) return null;
  for (const ext of BANNER_EXTS) {
    const rel = `${folder}/${CONVENTION_BASENAME}.${ext}`;
    if (rd.exists(path.join(vaultPath, rel))) return rel;
  }
  return null;
}

/**
 * Resolve the banner for one section index, config first, then convention.
 *
 * @returns {{image: string, link: string|null, alt: string|null}|null} vault-relative paths
 */
function resolveBanner(dir, { vaultPath, folderMap, banners, deps }) {
  const configured = normalizeEntry((banners || {})[dir]);
  if (configured) return configured;

  const conventional = findConventionBanner(vaultPath, sourceFolderFor(dir, folderMap), deps);
  return conventional ? { image: conventional, link: null, alt: null } : null;
}

/**
 * The folder a section's banner files are copied into on the site, and the files an entry
 * copies (the inline SVG with no link is content, not a file). One definition: the copy and
 * the check of copied file names both ask it.
 */
function bannerSlug(dir) {
  return String(dir).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function copiedBannerFiles(entry) {
  return [entry.image, entry.link].filter((file) => file && !(file === entry.image && isSvg(file) && !entry.link));
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
function renderBanner({ svg, imageHref, linkHref, alt }, { page = false } = {}) {
  // A note's own page carries the same markup as a section list's banner, plus `page-banner` (#362).
  const more = page ? ' page-banner' : '';
  if (svg) {
    return `<figure class="section-banner section-banner-inline${more}">${svg}</figure>`;
  }
  if (!imageHref) return '';

  const img = `<img src="${encodeImageUrl(imageHref)}" alt="${escapeHtml(alt || '')}" class="section-banner-img">`;
  const inner = linkHref
    ? `<a class="section-banner-link" href="${encodeImageUrl(linkHref)}">${img}</a>`
    : img;
  return `<figure class="section-banner${more}">${inner}</figure>`;
}

// The inside of a wikilink or embed (`[[Harbour.png]]`, `![[maps/Harbour.png|600]]`, `[[x.png#y]]`): its path. Any
// other text is returned trimmed. A banner may be written either way, in a note or in a setting.
function linkTarget(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const link = /^!?\[\[([^\]]*)\]\]$/.exec(text);
  return link ? link[1].split('|')[0].split('#')[0].trim() : text;
}

/**
 * The attachment a note's `banner:` names: { name, path }. `name` is its file name, which the attachments are keyed
 * by; `path` is the folder path as written, without a leading `./` (null for a bare name), which must lead to that
 * attachment. Takes what a GM writes for a picture: a path (`_attachments/maps/Harbour.png`), a bare name, a wikilink
 * (`[[Harbour.png]]`) or an embed (`![[Harbour.png|600]]`). null when there is no name in it.
 */
function attachmentRef(raw) {
  const text = linkTarget(raw).replace(/^(?:\.\/)+/, '');
  const name = text.split('/').pop().trim();
  if (!name) return null;
  return { name, path: text.includes('/') ? text : null };
}

// A web address (`https://…`, `//host/…`) or any other address with a scheme (`data:`, `file:`): never a file in the
// vault.
const isAddress = (raw) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(linkTarget(raw));

module.exports = {
  bannerSlug,
  copiedBannerFiles,
  resolveBanner, renderBanner, normalizeEntry, sourceFolderFor,
  findConventionBanner, defaultAlt, isSvg, attachmentRef, linkTarget, isAddress, BANNER_EXTS,
};
