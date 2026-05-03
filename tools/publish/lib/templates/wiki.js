const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, confidenceBadge, metadataBadgesFor, portraitImg } = require('./base');

function wikiTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const badges = metadataBadgesFor(fm);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  const content = `<h1 class="page-title">${escapeHtml(page.displayTitle)}${confidenceBadge(fm)}</h1>\n${portrait}\n${badges}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { wikiTemplate };
