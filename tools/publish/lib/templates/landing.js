const { escapeHtml } = require('../processor');
const { baseShell, DIR_LABELS } = require('./base');

function landingTemplate(pages, navFor, config, publishConfig) {
  const outputPath = 'index.html';
  const theme = (publishConfig && publishConfig.theme) || {};
  const campaignImage = theme.campaign_image || null;

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
    const dirPages = pages.filter(p => p.outputDir === dir || p.outputDir.startsWith(dir + '/'));
    if (dirPages.length === 0) return '';
    const links = dirPages.map(p => `<li><a href="${p.outputPath}">${escapeHtml(p.title)}</a></li>`).join('\n');
    return `
<div class="nav-card">
  <h3><a href="${dir}/index.html">${escapeHtml(label)}</a> <span class="count">(${dirPages.length})</span></h3>
  <ul>${links}</ul>
</div>`;
  }).filter(Boolean).join('\n');

  const tagline = config.landingTagline || '';
  const heroImageHtml = campaignImage
    ? `<img src="${escapeHtml(campaignImage)}" alt="${escapeHtml(config.siteTitle)}" class="hero-image">`
    : '';

  const content = `
<div class="hero">
  ${heroImageHtml}
  <h1>${escapeHtml(config.siteTitle)}</h1>
  ${tagline ? `<p class="tagline">${escapeHtml(tagline)}</p>` : ''}
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
