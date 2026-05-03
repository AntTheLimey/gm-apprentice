const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, confidenceBadge, metadataBadgesFor, portraitImg } = require('./base');
const { renderContextSidebar } = require('./context-sidebar');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function wikiTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const linkMap = (context || {}).linkMap || {};
  const backlinks = (publishConfig._backlinks || {})[page.title] || [];
  const badges = metadataBadgesFor(fm);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const sidebar = renderContextSidebar({
    backlinks,
    relationships: (fm.relationships || []).map(r => ({
      type: r.type,
      target: String(r.target).replace(/\[\[|\]\]/g, ''),
      targetPath: linkMap[String(r.target).replace(/\[\[|\]\]/g, '')] || null,
    })),
    currentOutputPath: page.outputPath,
  });

  const mainContent = `<h1 class="page-title">${escapeHtml(page.displayTitle)}${confidenceBadge(fm)}</h1>\n${portrait}\n${badges}\n${processedContent.html}\n${processedContent.relationships}`;
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

module.exports = { wikiTemplate };
