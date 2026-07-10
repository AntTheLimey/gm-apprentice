const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg } = require('./base');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function creatureTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const linkMap = (context || {}).linkMap || {};
  const backlinks = (publishConfig._backlinks || {})[page.title] || [];
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  // Build stat block from frontmatter fields
  const stats = [];
  if (fm.hp) stats.push({ label: 'HP', value: fm.hp });
  if (fm.dr) stats.push({ label: 'DR', value: fm.dr });
  if (fm.speed) stats.push({ label: 'Speed', value: fm.speed });
  if (fm.sm) stats.push({ label: 'SM', value: fm.sm });
  if (fm.st) stats.push({ label: 'ST', value: fm.st });
  if (fm.dx) stats.push({ label: 'DX', value: fm.dx });
  if (fm.iq) stats.push({ label: 'IQ', value: fm.iq });
  if (fm.ht) stats.push({ label: 'HT', value: fm.ht });

  const statBlock = stats.length > 0
    ? `<div class="stat-block">
        ${stats.map(s => `<div class="stat-item"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(String(s.value))}</span></div>`).join('\n')}
       </div>`
    : '';

  // Abilities list
  const abilities = Array.isArray(fm.abilities) && fm.abilities.length > 0
    ? `<div class="abilities"><h3>Abilities</h3><ul>${fm.abilities.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`
    : '';

  const weaknesses = Array.isArray(fm.weaknesses) && fm.weaknesses.length > 0
    ? `<div class="weaknesses"><h3>Weaknesses</h3><ul>${fm.weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`
    : '';

  // Metadata badges
  const badges = [];
  if (fm.creature_type) badges.push(fm.creature_type);
  if (fm.threat_level) badges.push(`Threat: ${fm.threat_level}`);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
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

  const mainContent = `${headerCard}\n${badgeHtml}\n${statBlock}\n${abilities}\n${weaknesses}\n${processedContent.html}\n${processedContent.relationships}\n${graphHtml}`;
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

module.exports = { creatureTemplate };
