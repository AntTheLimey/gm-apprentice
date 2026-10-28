const { escapeHtml, refMetaValue } = require('../processor');
const { baseShell, bodyHook, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg, headerValueText, connectionsSection, badgeSpan } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function itemTemplate(page, processedContent, navFor, config, imageMap, linkMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
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
  if (fm.item_type) badges.push(['item_type', headerValueText('item_type', fm.item_type)]);
  if (fm.rarity) badges.push(['rarity', headerValueText('rarity', fm.rarity)]);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(([f, b]) => badgeSpan(f, b)).join('\n')}</div>`
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

  const crumbs = generateBreadcrumbs(page.outputPath, { page });
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const graphHtml = connectionsSection(page, publishConfig);

  const mainContent = `${headerCard}\n${badgeHtml}\n${statBlock}\n${holderHtml}\n${originHtml}\n${bodyHook(processedContent.html)}\n${graphHtml}`;
  return baseShell({
    pageType: page.frontmatter.type,
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: mainContent,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { itemTemplate };
