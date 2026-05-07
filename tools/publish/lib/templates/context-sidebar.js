const { escapeHtml, relativePath } = require('../processor');

function normalizeRelationships(raw, linkMap) {
  if (!raw) return [];
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'object') {
    list = [];
    for (const [type, targets] of Object.entries(raw)) {
      const arr = Array.isArray(targets) ? targets : [targets];
      for (const t of arr) list.push({ target: t, type });
    }
  } else {
    return [];
  }
  return list.map(r => {
    const target = String(r.target).replace(/\[\[|\]\]/g, '');
    return {
      type: r.type,
      target,
      targetPath: linkMap ? linkMap[target] : null,
    };
  });
}

function renderContextSidebar({ backlinks, relationships, parentEntity, events, currentOutputPath }) {
  const sections = [];
  const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));

  if (parentEntity) {
    const href = parentEntity.path ? relativePath(currentDir, parentEntity.path) : null;
    const link = href
      ? `<a href="${href}">${escapeHtml(parentEntity.name)}</a>`
      : escapeHtml(parentEntity.name);
    sections.push(`<h3>Parent</h3>\n<p>${link}</p>`);
  }

  if (relationships && relationships.length > 0) {
    const items = relationships.map(r => {
      const href = r.targetPath ? relativePath(currentDir, r.targetPath) : null;
      const name = escapeHtml(r.target.replace(/_/g, ' '));
      const link = href ? `<a href="${href}">${name}</a>` : name;
      const type = escapeHtml(r.type.replace(/_/g, ' '));
      return `<li>${link} <span class="sidebar-badge">${type}</span></li>`;
    });
    sections.push(`<h3>Relationships</h3>\n<ul>${items.join('\n')}</ul>`);
  }

  if (backlinks && backlinks.length > 0) {
    const items = backlinks.map(b => {
      const href = relativePath(currentDir, b.outputPath);
      return `<li><a href="${href}">${escapeHtml(b.displayTitle)}</a> <span class="sidebar-badge">${escapeHtml(b.type)}</span></li>`;
    });
    sections.push(`<h3>Mentioned In</h3>\n<ul>${items.join('\n')}</ul>`);
  }

  if (events && events.length > 0) {
    const items = events.map(e => {
      const href = relativePath(currentDir, e.outputPath);
      return `<li><a href="${href}">${escapeHtml(e.displayTitle)}</a></li>`;
    });
    sections.push(`<h3>Events</h3>\n<ul>${items.join('\n')}</ul>`);
  }

  if (sections.length === 0) return '';
  return `<aside class="context-sidebar">\n${sections.join('\n')}\n</aside>`;
}

module.exports = { renderContextSidebar, normalizeRelationships };
