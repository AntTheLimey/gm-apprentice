const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function npcTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${stubBadge(fm)}</h1>
  <div class="meta">
    ${fm.occupation ? `<span><span class="label">Role</span> ${escapeHtml(fm.occupation)}</span>` : ''}
    ${fm.nationality ? `<span><span class="label">Nationality</span> ${escapeHtml(fm.nationality)}</span>` : ''}
    ${fm.status ? `<span><span class="label">Status</span> ${escapeHtml(fm.status)}</span>` : ''}
    ${fm.age ? `<span><span class="label">Age</span> ${escapeHtml(String(fm.age))}</span>` : ''}
    ${fm.rank ? `<span><span class="label">Rank</span> ${escapeHtml(fm.rank)}</span>` : ''}
  </div>
</div>`;

  const content = `${headerCard}\n${processedContent.html}\n${processedContent.relationships}`;

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

module.exports = { npcTemplate };
