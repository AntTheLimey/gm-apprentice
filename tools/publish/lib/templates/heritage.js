const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, confidenceBadge, portraitImg } = require('./base');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function heritageTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const linkMap = (context || {}).linkMap || {};
  const backlinks = (publishConfig._backlinks || {})[page.title] || [];
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  const badges = [];
  if (fm.notable_traits && Array.isArray(fm.notable_traits)) {
    fm.notable_traits.forEach(t => badges.push(t.replace(/_/g, ' ')));
  }
  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const statItems = [];
  if (fm.lifespan_range && Array.isArray(fm.lifespan_range) && fm.lifespan_range.length === 2) {
    statItems.push(`<dt>Lifespan</dt><dd>${fm.lifespan_range[0]}–${fm.lifespan_range[1]} years</dd>`);
  }
  if (fm.maturity_age) {
    statItems.push(`<dt>Maturity</dt><dd>${fm.maturity_age} years</dd>`);
  }
  if (fm.average_height) {
    statItems.push(`<dt>Height</dt><dd>${escapeHtml(fm.average_height)}</dd>`);
  }
  const statCard = statItems.length > 0
    ? `<dl class="heritage-stats">${statItems.join('\n')}</dl>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${confidenceBadge(fm)}</h1>
  ${statCard}
</div>`;

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const sidebar = renderContextSidebar({
    backlinks,
    relationships: normalizeRelationships(fm.relationships, linkMap),
    currentOutputPath: page.outputPath,
  });

  const graphSvg = ((publishConfig || {})._entityGraphs || {})[page.title];
  const graphHtml = graphSvg ? `<div class="relationship-graph"><h2>Connections</h2>${graphSvg}</div>` : '';

  const mainContent = `${headerCard}\n${badgeHtml}\n${processedContent.html}\n${processedContent.relationships}\n${graphHtml}`;
  const contentHtml = sidebar
    ? `<div class="content-with-sidebar"><div class="main">${mainContent}</div>${sidebar}</div>`
    : mainContent;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: contentHtml,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { heritageTemplate };
