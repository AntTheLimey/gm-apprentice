const { escapeHtml } = require('./processor');

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

    // Only the known top-level directories get a generated index.html (see DIR_LABELS,
    // which build.js iterates to write indexes). Nested folders like a chapter subdirectory
    // have no index, so linking their segment to "index.html" dead-links — keep them plain.
    const dirHasIndex = Object.prototype.hasOwnProperty.call(DIR_LABELS, dir);
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
