const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, confidenceBadge } = require('./base');

function indexTemplate(outputDir, title, pages, navFor, config) {
  const outputPath = outputDir ? `${outputDir}/index.html` : 'index.html';

  const cards = pages.length > 0
    ? `<div class="roster">${pages.map(p => {
        const fm = p.frontmatter;
        const subtitle = fm.occupation || fm.event_type || fm.faction_type || fm.location_type || fm.type || '';
        const currentDir = outputDir || '';
        const href = p.outputPath.startsWith(currentDir + '/')
          ? p.outputPath.substring(currentDir.length + 1)
          : relativePath(currentDir, p.outputPath);
        return `
<div class="roster-card">
  <h3><a href="${href}">${escapeHtml(p.displayTitle)}</a>${confidenceBadge(fm)}</h3>
  ${subtitle ? `<div class="role">${escapeHtml(subtitle)}</div>` : ''}
</div>`;
      }).join('\n')}</div>`
    : '<p>No entries yet.</p>';

  const content = `<h1 class="page-title">${escapeHtml(title)}</h1>\n${cards}`;

  return baseShell({
    title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath),
    rootHref: rootPath(outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { indexTemplate };
