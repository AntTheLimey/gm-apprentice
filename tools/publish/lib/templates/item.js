const { backlinksOf } = require('../backlinks');
const { escapeHtml, refMetaValue } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg, headerValueText } = require('./base');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function itemTemplate(page, processedContent, navFor, config, imageMap, linkMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const backlinks = backlinksOf(publishConfig._backlinks, page);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  // Build stat block
  const stats = [];
  if (fm.damage) stats.push({ label: 'Damage', value: fm.damage });
  if (fm.dr) stats.push({ label: 'DR', value: fm.dr });
  if (fm.weight) stats.push({ label: 'Weight', value: fm.weight });
  if (fm.cost) stats.push({ label: 'Cost', value: fm.cost });
  if (fm.tl) stats.push({ label: 'TL', value: fm.tl });

  const statBlock = stats.length > 0
    ? `<div class="stat-block">
        ${stats.map(s => `<div class="stat-item"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(String(s.value))}</span></div>`).join('\n')}
       </div>`
    : '';

  // Metadata badges
  const badges = [];
  if (fm.item_type) badges.push(headerValueText('item_type', fm.item_type));
  if (fm.rarity) badges.push(headerValueText('rarity', fm.rarity));

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  // Holder and origin: a name links to its page when the site has one; running text shows
  // its links as their labels (refMetaValue). The card's "Held by" reads the same rule.
  const holderHtml = fm.current_holder
    ? `<p class="item-holder"><strong>Current Holder:</strong> ${refMetaValue(fm.current_holder, linkMap, page.outputPath)}</p>`
    : '';
  const originHtml = fm.origin
    ? `<p class="item-origin"><strong>Origin:</strong> ${refMetaValue(fm.origin, linkMap, page.outputPath)}</p>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
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

  const mainContent = `${headerCard}\n${badgeHtml}\n${statBlock}\n${holderHtml}\n${originHtml}\n${processedContent.html}\n${processedContent.relationships}\n${graphHtml}`;
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
    overridesCss: publishConfig._overridesCss,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { itemTemplate };
