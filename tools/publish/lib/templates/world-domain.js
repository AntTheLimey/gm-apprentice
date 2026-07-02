const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, canonStatusBadge } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function worldDomainTemplate(page, processedContent, navFor, config, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};

  let rulesSidebar = '';
  const publishRules = fm.publish_rules !== false;
  if (publishRules && fm.rules && Array.isArray(fm.rules) && fm.rules.length > 0) {
    const rulesHtml = fm.rules.map(r => {
      const desc = escapeHtml(r.rule || r.id || '');
      return `<li>${desc}</li>`;
    }).join('\n');
    rulesSidebar = `<aside class="world-rules-sidebar"><h3>World Rules</h3><ul>${rulesHtml}</ul></aside>`;
  }

  const summaryHtml = fm.summary
    ? `<p class="world-domain-summary">${escapeHtml(fm.summary)}</p>`
    : '';

  const headerHtml = `<h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>${summaryHtml}`;

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const mainContent = `${headerHtml}\n${processedContent.html}`;
  const contentHtml = rulesSidebar
    ? `<div class="content-with-sidebar"><div class="main">${mainContent}</div>${rulesSidebar}</div>`
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

module.exports = { worldDomainTemplate };
