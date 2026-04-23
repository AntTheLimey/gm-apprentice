const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function locationTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  const badges = [];
  if (fm.location_type) badges.push(fm.location_type);
  if (fm.security_level) badges.push(`Security: ${fm.security_level}`);
  if (fm.atmosphere) badges.push(fm.atmosphere);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const breadcrumb = fm.parent_location
    ? `<div class="breadcrumb">${escapeHtml(fm.parent_location.replace(/\[\[|\]\]/g, '').replace(/_/g, ' '))} <span class="sep">&rsaquo;</span> ${escapeHtml(page.displayTitle)}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${breadcrumb}\n${badgeHtml}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { locationTemplate };
