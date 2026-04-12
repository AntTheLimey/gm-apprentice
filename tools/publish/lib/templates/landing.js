const { escapeHtml } = require('../processor');
const { baseShell, DIR_LABELS } = require('./base');

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

  const tagline = config.landingTagline || 'Welcome to the campaign.';
  const params = config.landingParams || '';

  const content = `
<div class="hero">
  <h1>${escapeHtml(config.siteTitle)}</h1>
  <p class="tagline">${escapeHtml(tagline)}</p>
  ${params ? `<p class="params">${escapeHtml(params)}</p>` : ''}
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
    footer: config.footer,
  });
}

module.exports = { landingTemplate };
