const { relativePath, escapeHtml } = require('./processor');

const DIR_LABELS = {
  'campaign': 'Campaign',
  'characters/pcs': 'Player Characters',
  'characters/npcs': 'NPCs',
  'factions': 'Factions & Organizations',
  'events': 'Events',
  'locations': 'Locations',
  'items': 'Items & Artifacts',
  'documents': 'Documents',
  'clues': 'Clues',
  'chapters': 'Chapters',
};

function cssPath(outputPath) {
  const depth = outputPath.split('/').length - 1;
  return '../'.repeat(depth) + 'css/style.css';
}

function rootPath(outputPath) {
  const depth = outputPath.split('/').length - 1;
  return '../'.repeat(depth) || './';
}

function generateNav(pages) {
  const sections = {};

  for (const page of pages) {
    const dir = page.outputDir || 'campaign';
    if (!sections[dir]) sections[dir] = [];
    sections[dir].push(page);
  }

  // Return a function that produces nav HTML relative to a given page
  return function navFor(currentOutputPath) {
    let html = '';
    for (const [dir, label] of Object.entries(DIR_LABELS)) {
      const dirPages = sections[dir];
      if (!dirPages || dirPages.length === 0) continue;
      html += `<h2>${escapeHtml(label)}</h2>\n<ul>\n`;
      for (const p of [...dirPages].sort((a, b) => a.title.localeCompare(b.title))) {
        const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
        const href = relativePath(currentDir, p.outputPath);
        html += `<li><a href="${href}">${escapeHtml(p.title)}</a></li>\n`;
      }
      html += `</ul>\n`;
    }
    return html;
  };
}

function baseShell({ title, siteTitle, cssHref, navHtml, rootHref, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${escapeHtml(siteTitle)}</title>
  <link rel="stylesheet" href="${cssHref}">
</head>
<body>

<header class="site-header">
  <button class="menu-toggle" onclick="document.getElementById('nav').classList.add('open')" aria-label="Menu">&#9776;</button>
  <h1><a href="${rootHref}index.html">${escapeHtml(siteTitle)}</a></h1>
</header>

<nav id="nav" class="site-nav">
  <button class="nav-close" onclick="document.getElementById('nav').classList.remove('open')" aria-label="Close">&times;</button>
  ${navHtml}
</nav>

<main class="content">
${content}
</main>

<footer class="site-footer">
  GURPS is a trademark of Steve Jackson Games. Fan creation for personal use. GURPS 4th Edition.
</footer>

<script>
document.querySelectorAll('.site-nav a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('nav').classList.remove('open'));
});
</script>

</body>
</html>`;
}

function stubBadge(frontmatter) {
  if (frontmatter.canon_status === 'STUB') {
    return ' <span class="stub-badge">Stub</span>';
  }
  return '';
}

// Maps entity types to frontmatter fields that should render as metadata badges.
// Wiki-link values like `[[Foo]]` are stripped to `Foo` for display.
const TYPE_BADGE_FIELDS = {
  organization: ['faction_type'],
  faction: ['faction_type'],
  event: ['event_type', 'date', 'location'],
  item: ['item_type', 'tl', 'origin'],
  creature: ['creature_type', 'location'],
  clue: ['clue_type', 'reliability', 'found_by'],
  document: ['document_type', 'author', 'classification', 'date_written'],
  session: ['session_number', 'actual_date', 'status', 'stage'],
  scene: ['scene_type', 'status'],
  chapter: ['sort_order'],
};

function metadataBadgesFor(frontmatter) {
  const fields = TYPE_BADGE_FIELDS[frontmatter.type];
  if (!fields) return '';

  const badges = [];
  for (const field of fields) {
    const raw = frontmatter[field];
    if (raw === undefined || raw === null || raw === '') continue;
    // Strip wiki-link brackets if present
    const value = String(raw).replace(/\[\[|\]\]/g, '').trim();
    if (!value) continue;
    badges.push(`<span class="metadata-badge">${escapeHtml(value)}</span>`);
  }

  if (badges.length === 0) return '';
  return `<div class="metadata-badges">${badges.join('\n')}</div>`;
}

function portraitImg(frontmatter, outputPath, imageMap) {
  const portrait = frontmatter.portrait;
  if (!portrait) return '';

  // Strip "_attachments/" prefix if present
  const relPath = String(portrait).replace(/^_attachments\//, '');
  const basename = relPath.split('/').pop();

  // Verify the image was actually discovered by the scanner
  if (!imageMap[basename]) return '';

  const currentDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  const imgPath = 'images/' + relPath;
  const relativeImgPath = relativePath(currentDir, imgPath);
  const alt = escapeHtml(frontmatter.aliases?.[0] || basename.replace(/\.[^.]+$/, ''));
  return `<img src="${relativeImgPath}" alt="${alt}" class="portrait">`;
}

function pcTemplate(page, processedContent, sections, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const traits = fm.key_traits ? escapeHtml(fm.key_traits.join(', ')) : '';
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});
  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}</h1>
  <p class="concept">${traits}</p>
  <div class="meta">
    <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
    <span><span class="label">Points</span> ${escapeHtml(String(fm.point_total || 200))}/200</span>
    <span><span class="label">Background</span> ${escapeHtml(fm.occupation || '')}</span>
    <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
  </div>
</div>`;

  const sectionNav = sections.length > 0
    ? `<nav class="section-nav" aria-label="Sheet sections">${sections.map(s => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('\n')}</nav>`
    : '';

  const accordions = sections.map(s => `
<div class="accordion" id="${s.id}">
  <button class="accordion-header" aria-expanded="false" onclick="const o=this.parentElement.classList.toggle('open');this.setAttribute('aria-expanded',o)">${escapeHtml(s.title)}</button>
  <div class="accordion-body">
    ${s.html}
  </div>
</div>`).join('\n');

  const content = `${headerCard}\n${sectionNav}\n${accordions}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
  });
}

function npcTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
  <div class="meta">
    ${fm.occupation ? `<span><span class="label">Role</span> ${escapeHtml(fm.occupation)}</span>` : ''}
    ${fm.nationality ? `<span><span class="label">Nationality</span> ${escapeHtml(fm.nationality)}</span>` : ''}
    ${fm.status ? `<span><span class="label">Status</span> ${escapeHtml(fm.status)}</span>` : ''}
    ${fm.age ? `<span><span class="label">Age</span> ${escapeHtml(String(fm.age))}</span>` : ''}
    ${fm.rank ? `<span><span class="label">Rank</span> ${escapeHtml(fm.rank)}</span>` : ''}
  </div>
</div>`;

  const content = `${headerCard}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
  });
}

function locationTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const badges = [];
  if (fm.location_type) badges.push(fm.location_type);
  if (fm.security_level) badges.push(`Security: ${fm.security_level}`);
  if (fm.atmosphere) badges.push(fm.atmosphere);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const breadcrumb = fm.parent_location
    ? `<div class="breadcrumb">${escapeHtml(fm.parent_location.replace(/\[\[|\]\]/g, ''))} <span class="sep">&rsaquo;</span> ${escapeHtml(page.title)}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${breadcrumb}\n${badgeHtml}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
  });
}

function wikiTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const badges = metadataBadgesFor(fm);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const content = `<h1 class="page-title">${escapeHtml(page.title)}${stubBadge(fm)}</h1>\n${portrait}\n${badges}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
  });
}

function indexTemplate(outputDir, title, pages, navFor, config) {
  const outputPath = outputDir ? `${outputDir}/index.html` : 'index.html';

  const cards = pages.length > 0
    ? `<div class="roster">${pages.map(p => {
        const fm = p.frontmatter;
        const subtitle = fm.occupation || fm.event_type || fm.faction_type || fm.location_type || fm.type || '';
        const currentDir = outputDir || '';
        const href = p.outputPath.startsWith(currentDir + '/')
          ? p.outputPath.substring(currentDir.length + 1)
          : relativePath(currentDir, p.outputPath);
        return `
<div class="roster-card">
  <h3><a href="${href}">${escapeHtml(p.title)}</a>${stubBadge(fm)}</h3>
  ${subtitle ? `<div class="role">${escapeHtml(subtitle)}</div>` : ''}
</div>`;
      }).join('\n')}</div>`
    : '<p>No entries yet.</p>';

  const content = `<h1 class="page-title">${escapeHtml(title)}</h1>\n${cards}`;

  return baseShell({
    title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath),
    rootHref: rootPath(outputPath),
    content,
  });
}

function landingTemplate(pages, navFor, config) {
  const outputPath = 'index.html';

  // Order chosen to put high-traffic sections first on the landing page
  const sectionOrder = [
    'characters/pcs',
    'characters/npcs',
    'campaign',
    'factions',
    'events',
    'locations',
    'items',
    'documents',
    'clues',
    'chapters',
  ];
  const sectionLabels = Object.fromEntries(sectionOrder.map(k => [k, DIR_LABELS[k]]));

  const navCards = Object.entries(sectionLabels).map(([dir, label]) => {
    const dirPages = pages.filter(p => p.outputDir === dir);
    const links = dirPages.map(p => `<li><a href="${p.outputPath}">${escapeHtml(p.title)}</a></li>`).join('\n');
    return `
<div class="nav-card">
  <h3><a href="${dir}/index.html">${escapeHtml(label)}</a></h3>
  <ul>${links || '<li>No entries yet</li>'}</ul>
</div>`;
  }).join('\n');

  const content = `
<div class="hero">
  <h1>${escapeHtml(config.siteTitle)}</h1>
  <p class="tagline">2019. Meteor fragments grant superhuman abilities. You do NOT have a fragment.</p>
  <p class="params">GURPS 4th Edition &bull; 200 points &bull; TL8 + experimental</p>
</div>

<div class="nav-grid">
${navCards}
</div>`;

  return baseShell({
    title: 'Home',
    siteTitle: config.siteTitle,
    cssHref: 'css/style.css',
    navHtml: navFor(outputPath),
    rootHref: './',
    content,
  });
}

module.exports = {
  generateNav, baseShell, pcTemplate, npcTemplate, locationTemplate,
  wikiTemplate, indexTemplate, landingTemplate, escapeHtml, metadataBadgesFor,
  portraitImg, DIR_LABELS,
};
