const { baseShell, cssPath, rootPath, clientScripts } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function timelineTemplate(timelineSvg, navFor, config, publishConfig) {
  const outputPath = 'timeline.html';
  const crumbs = generateBreadcrumbs(outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const content = `
<h1 class="page-title">Campaign Timeline</h1>
<div class="timeline-controls">
  <button onclick="zoomTimeline(1.5)">Zoom In</button>
  <button onclick="zoomTimeline(0.67)">Zoom Out</button>
  <button onclick="zoomTimeline(1)">Reset</button>
</div>
<div class="timeline-full" id="timeline-container">
  ${timelineSvg}
</div>
<script>
var currentZoom = 1;
function zoomTimeline(factor) {
  if (factor === 1) { currentZoom = 1; } else { currentZoom *= factor; }
  var svg = document.querySelector('#timeline-container svg');
  if (svg) svg.style.width = (currentZoom * 100) + '%';
}
</script>`;

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
