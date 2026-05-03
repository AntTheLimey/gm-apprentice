const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, portraitImg } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function buildPillFilters(pages, dir) {
  const pills = ['All'];
  if (dir === 'characters' || dir.startsWith('characters')) {
    const types = new Set();
    for (const p of pages) types.add(p.frontmatter.type);
    pills.push(...Array.from(types).sort());
  } else if (dir === 'locations') {
    const types = new Set();
    for (const p of pages) {
      if (p.frontmatter.location_type) types.add(p.frontmatter.location_type);
    }
    pills.push(...Array.from(types).sort());
  } else {
    const types = new Set();
    for (const p of pages) {
      if (p.frontmatter.type) types.add(p.frontmatter.type);
    }
    if (types.size > 1) pills.push(...Array.from(types).sort());
  }
  return pills;
}

function buildLocationTree(pages) {
  const byTitle = {};
  for (const p of pages) byTitle[p.title] = { page: p, children: [] };

  const roots = [];
  for (const p of pages) {
    const parentRef = p.frontmatter.parent_location;
    if (parentRef) {
      const parentTitle = String(parentRef).replace(/\[\[|\]\]/g, '').trim();
      if (byTitle[parentTitle]) {
        byTitle[parentTitle].children.push(byTitle[p.title]);
        continue;
      }
    }
    roots.push(byTitle[p.title]);
  }
  return roots;
}

function renderLocationTreeHTML(nodes, depth) {
  if (nodes.length === 0) return '';
  const items = nodes.map(node => {
    const p = node.page;
    const childrenHtml = node.children.length > 0
      ? `<div class="location-tree-children">${renderLocationTreeHTML(node.children, depth + 1)}</div>`
      : '';
    return `<div class="location-tree-item" style="padding-left:${depth * 1.5}rem">
  <a href="${escapeHtml(p.outputPath.split('/').pop())}">${escapeHtml(p.displayTitle)}</a>
  ${p.frontmatter.location_type ? `<span class="sidebar-badge">${escapeHtml(p.frontmatter.location_type)}</span>` : ''}
</div>${childrenHtml}`;
  }).join('\n');
  return items;
}

function renderChapterList(pages) {
  const sorted = pages
    .filter(p => p.frontmatter.type === 'chapter')
    .sort((a, b) => (a.frontmatter.sort_order || 0) - (b.frontmatter.sort_order || 0));

  if (sorted.length === 0) return '';
  const items = sorted.map((p, i) => {
    const num = p.frontmatter.sort_order || i + 1;
    const sessionCount = p.frontmatter.sessions ? p.frontmatter.sessions.length : '';
    const sessionBadge = sessionCount ? `<span class="sidebar-badge">${sessionCount} sessions</span>` : '';
    return `<div class="story-list-item">
  <span class="chapter-number">${escapeHtml(String(num))}</span>
  <div>
    <a href="${escapeHtml(p.outputPath.split('/').pop())}" style="font-weight:500;color:var(--text)">${escapeHtml(p.displayTitle)}</a>
    ${sessionBadge}
  </div>
</div>`;
  }).join('\n');
  return `<div class="story-list">${items}</div>`;
}

function indexTemplate(dir, label, pages, navFor, config, publishConfig) {
  const outputPath = dir + '/index.html';
  const crumbs = generateBreadcrumbs(outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);
  const total = pages.length;
  const isChapters = dir === 'chapters';
  const isLocations = dir === 'locations';
  const isCharacters = dir === 'characters' || dir.startsWith('characters');

  const pills = buildPillFilters(pages, dir);
  const pillsHtml = pills.length > 1
    ? `<div class="pill-filters">${pills.map((p, i) => {
        const filterVal = p === 'All' ? 'all' : p;
        const active = i === 0 ? ' active' : '';
        return `<button class="pill-filter${active}" data-filter="${escapeHtml(filterVal)}">${escapeHtml(p === 'All' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1))}</button>`;
      }).join('\n')}</div>`
    : '';

  const nameFilterHtml = `<input class="name-filter" type="text" placeholder="Filter by name..." aria-label="Filter by name">`;
  const sortHtml = `<select class="sort-control" aria-label="Sort by">
  <option value="name">Sort: Name</option>
  <option value="type">Sort: Type</option>
  <option value="status">Sort: Status</option>
</select>`;

  let bodyContent;
  if (isChapters) {
    bodyContent = renderChapterList(pages);
  } else {
    const cardItems = pages.map(p => {
      const fm = p.frontmatter;
      const entityType = isLocations ? (fm.location_type || fm.type) : fm.type;
      const avatarShape = (fm.type === 'pc') ? 'border-radius:0.375rem' : 'border-radius:50%';
      const portraitHtml = isCharacters && fm.portrait
        ? `<div class="npc-icon" style="${avatarShape}"><img src="${escapeHtml(fm.portrait)}" alt=""></div>`
        : '';
      const subtitle = fm.occupation || fm.location_type || fm.faction_type || '';
      return `<a class="entity-card" href="${escapeHtml(p.outputPath.split('/').pop())}"
  data-entity-type="${escapeHtml(entityType || '')}"
  data-entity-name="${escapeHtml(p.displayTitle)}"
  data-entity-status="${escapeHtml(fm.status || '')}">
  ${portraitHtml}
  <h4>${escapeHtml(p.displayTitle)}</h4>
  ${subtitle ? `<div class="card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
</a>`;
    }).join('\n');
    bodyContent = `<div class="card-grid">${cardItems}</div>`;
  }

  let locationTreeHtml = '';
  if (isLocations) {
    const tree = buildLocationTree(pages);
    const treeContent = renderLocationTreeHTML(tree, 0);
    locationTreeHtml = `<div class="location-tree" style="display:none">${treeContent}</div>
<button class="pill-filter" onclick="var g=document.querySelector('.card-grid'),t=document.querySelector('.location-tree');if(g.style.display==='none'){g.style.display='';t.style.display='none';this.textContent='Tree View'}else{g.style.display='none';t.style.display='';this.textContent='Grid View'}">Tree View</button>`;
  }

  const content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(label)}</h1>
  <span class="index-count">Showing ${total} of ${total}</span>
  ${sortHtml}
</div>
${pillsHtml}
${isChapters ? '' : nameFilterHtml}
${locationTreeHtml}
${bodyContent}`;

  return baseShell({
    title: label,
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath, config),
    rootHref: rootPath(outputPath),
    content,
    footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    breadcrumbsHtml,
    scripts: [...clientScripts(outputPath), rootPath(outputPath) + 'js/filters.js'],
  });
}

module.exports = { indexTemplate, buildPillFilters, buildLocationTree };
