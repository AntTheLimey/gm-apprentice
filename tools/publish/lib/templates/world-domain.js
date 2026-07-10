const { escapeHtml, renderMetaValue } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function worldDomainTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const linkMap = (context || {}).linkMap || publishConfig._linkMap || {};
  const meta = v => renderMetaValue(v, linkMap, page.outputPath);

  let rulesSidebar = '';
  const publishRules = fm.publish_rules !== false;
  if (publishRules && fm.rules && Array.isArray(fm.rules) && fm.rules.length > 0) {
    const rulesHtml = fm.rules.map(r => {
      const desc = meta(r.rule || r.id || '');
      return `<li>${desc}</li>`;
    }).join('\n');
    rulesSidebar = `<aside class="world-rules-sidebar"><h3>World Rules</h3><ul>${rulesHtml}</ul></aside>`;
  }

  const summaryHtml = fm.summary
    ? `<p class="world-domain-summary">${meta(fm.summary)}</p>`
    : '';

  // Render `portrait:` like every other entity template. That invariant is what lets the
  // processor safely drop an inline embed of the same image as a duplicate (#88).
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const headerHtml = `<h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>${summaryHtml}${portrait}`;

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
    overridesCss: publishConfig._overridesCss,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { worldDomainTemplate };
