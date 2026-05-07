const { baseShell, cssPath, rootPath, clientScripts } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function timelineTemplate(timelineContent, navFor, config, publishConfig) {
  const outputPath = 'timeline.html';
  const crumbs = generateBreadcrumbs(outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const content = `
<h1 class="page-title">Campaign Timeline</h1>
<div class="timeline-full">
  ${timelineContent}
</div>`;

  return baseShell({
    title: 'Timeline',
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath, config),
    rootHref: rootPath(outputPath),
    content,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    breadcrumbsHtml,
    scripts: clientScripts(outputPath),
  });
}

module.exports = { timelineTemplate };
