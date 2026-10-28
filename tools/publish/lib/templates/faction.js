const { escapeHtml, refMetaValue } = require('../processor');
const { baseShell, bodyHook, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg, headerValueText, connectionsSection, badgeSpan } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function factionTemplate(page, processedContent, navFor, config, imageMap, linkMap, allPages, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  // Metadata badges
  const badges = [];
  if (fm.faction_type) badges.push(['faction_type', headerValueText('faction_type', fm.faction_type)]);
  if (fm.alignment) badges.push(['alignment', headerValueText('alignment', fm.alignment)]);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(([f, b]) => badgeSpan(f, b)).join('\n')}</div>`
    : '';

  // Goals list
  const goals = fm.goals && Array.isArray(fm.goals)
    ? `<div class="goals"><h3>Goals</h3><ul>${fm.goals.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul></div>`
    : '';

  // Leadership and territory: a name links to its page; running text shows its links as labels.
  const leadershipHtml = fm.leadership
    ? `<p class="faction-leadership"><strong>Leadership:</strong> ${refMetaValue(fm.leadership, linkMap, page.outputPath)}</p>`
    : '';
  const territoryHtml = fm.territory
    ? `<p class="faction-territory"><strong>Territory:</strong> ${refMetaValue(fm.territory, linkMap, page.outputPath)}</p>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
</div>`;

  const crumbs = generateBreadcrumbs(page.outputPath, { page });
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const graphHtml = connectionsSection(page, publishConfig);

  const mainContent = `${headerCard}\n${badgeHtml}\n${leadershipHtml}\n${territoryHtml}\n${goals}\n${bodyHook(processedContent.html)}\n${graphHtml}`;
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

module.exports = { factionTemplate };
