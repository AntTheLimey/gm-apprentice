const { escapeHtml } = require('./processor');
// Authoritative set of output directories that actually get a generated index.html —
// the SAME map build.js iterates to write them (keyed on full output paths like
// "characters/npcs"). Used to decide which breadcrumb segments may link to index.html.
const { DIR_LABELS: INDEX_DIR_LABELS } = require('./templates/base');
const INDEX_DIRS = new Set(Object.keys(INDEX_DIR_LABELS));

// Friendly labels for individual path segments (note: this is segment-keyed, e.g. "npcs",
// unlike INDEX_DIR_LABELS which is full-path-keyed). Used only for display text.
const DIR_LABELS = {
  campaign: 'Campaign',
  characters: 'Characters',
  pcs: 'Player Characters',
  npcs: 'NPCs',
  factions: 'Factions',
  events: 'Events',
  locations: 'Locations',
  items: 'Items',
  documents: 'Documents',
  clues: 'Clues',
  chapters: 'Chapters',
  creatures: 'Creatures',
  sessions: 'Sessions',
};

function titleFromSlug(slug) {
  return slug
    .replace(/\.html$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function generateBreadcrumbs(outputPath, options = {}) {
  const parts = outputPath.split('/');
  const filename = parts[parts.length - 1];
  const isIndex = filename === 'index.html';
  const crumbs = [];

  const depthToRoot = parts.length - 1;
  const rootHref = '../'.repeat(depthToRoot) + 'index.html';

  crumbs.push({ label: 'Home', href: depthToRoot === 0 ? 'index.html' : rootHref });

  if (parts.length === 1) return crumbs;

  const dirs = parts.slice(0, -1);

  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    const label = DIR_LABELS[dir] || titleFromSlug(dir);
    const isLastDir = i === dirs.length - 1;

    // Link a segment to its index.html only if that exact directory PATH is one build.js
    // generates an index for. Checking the full path (not just the last segment) avoids
    // dead-links for dirs that look known but aren't index-bearing — e.g. a top-level
    // "sessions/" page, or a nested chapter subfolder, neither of which gets an index.
    const fullDirPath = dirs.slice(0, i + 1).join('/');
    const dirHasIndex = INDEX_DIRS.has(fullDirPath);
    if (isLastDir && !isIndex && dirHasIndex) {
      crumbs.push({ label, href: 'index.html' });
    } else {
      crumbs.push({ label, href: null });
    }
  }

  if (options.parentLocation && options.parentLocationHref) {
    crumbs.splice(crumbs.length, 0);
    const lastDirCrumb = crumbs[crumbs.length - 1];
    if (lastDirCrumb && lastDirCrumb.href === 'index.html') {
      crumbs.push({ label: options.parentLocation, href: options.parentLocationHref });
    }
  }

  if (!isIndex) {
    const entityName = titleFromSlug(filename);
    crumbs.push({ label: entityName, href: null });
  }

  return crumbs;
}

function renderBreadcrumbs(crumbs) {
  if (!crumbs || crumbs.length <= 1) return '';
  const parts = crumbs.map(c => {
    if (c.href) return `<a href="${c.href}">${escapeHtml(c.label)}</a>`;
    return escapeHtml(c.label);
  });
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${parts.join('<span class="sep">&rsaquo;</span>')}</nav>`;
}

module.exports = { generateBreadcrumbs, renderBreadcrumbs, DIR_LABELS };
