const { escapeHtml, renderMetaValue } = require('../processor');
const { baseShell, bodyHook, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function worldDomainTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const linkMap = (context || {}).linkMap || publishConfig._linkMap || {};
  const meta = v => renderMetaValue(v, linkMap, page.outputPath);

  let rulesHtml = '';
  const publishRules = fm.publish_rules !== false;
  if (publishRules && Array.isArray(fm.rules) && fm.rules.length > 0) {
    // A rule is a sentence, or an object carrying one under `rule` (or only an `id`).
    const text = (r) => (typeof r === 'string' ? r : (r && typeof r === 'object' && (r.rule || r.id)) || '');
    const items = fm.rules.map(text).filter(t => typeof t === 'string' && t.trim())
      .map(t => `<li>${meta(t)}</li>`).join('\n');
    if (items) rulesHtml = `<section class="world-rules"><h2>World Rules</h2><ul>${items}</ul></section>`;
  }

  const summaryHtml = fm.summary
    ? `<p class="world-domain-summary">${meta(fm.summary)}</p>`
    : '';

  // Render `portrait:` like every other entity template. That invariant is what lets the
  // processor safely drop an inline embed of the same image as a duplicate (#88).
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const headerHtml = `<h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>${summaryHtml}${portrait}`;

  const crumbs = generateBreadcrumbs(page.outputPath, { page });
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const mainContent = [headerHtml, rulesHtml, bodyHook(processedContent.html)].filter(Boolean).join('\n');
  return baseShell({
    pageType: page.frontmatter.type,
    banner: processedContent.bannerHtml,
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

module.exports = { worldDomainTemplate };
