const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, confidenceBadge, portraitImg } = require('./base');

function itemTemplate(page, processedContent, navFor, config, imageMap, linkMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  // Build stat block
  const stats = [];
  if (fm.damage) stats.push({ label: 'Damage', value: fm.damage });
  if (fm.dr) stats.push({ label: 'DR', value: fm.dr });
  if (fm.weight) stats.push({ label: 'Weight', value: fm.weight });
  if (fm.cost) stats.push({ label: 'Cost', value: fm.cost });
  if (fm.tl) stats.push({ label: 'TL', value: fm.tl });

  const statBlock = stats.length > 0
    ? `<div class="stat-block">
        ${stats.map(s => `<div class="stat-item"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(String(s.value))}</span></div>`).join('\n')}
       </div>`
    : '';

  // Metadata badges
  const badges = [];
  if (fm.item_type) badges.push(fm.item_type);
  if (fm.rarity) badges.push(fm.rarity);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  // Current holder link
  let holderHtml = '';
  if (fm.current_holder) {
    const holderName = String(fm.current_holder).replace(/\[\[|\]\]/g, '').trim();
    const holderPath = linkMap?.[holderName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (holderPath) {
      const href = relativePath(currentDir, holderPath);
      holderHtml = `<p class="item-holder"><strong>Current Holder:</strong> <a href="${href}">${escapeHtml(holderName)}</a></p>`;
    } else {
      holderHtml = `<p class="item-holder"><strong>Current Holder:</strong> ${escapeHtml(holderName)}</p>`;
    }
  }

  // Origin link (similar pattern)
  let originHtml = '';
  if (fm.origin) {
    const originName = String(fm.origin).replace(/\[\[|\]\]/g, '').trim();
    const originPath = linkMap?.[originName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (originPath) {
      const href = relativePath(currentDir, originPath);
      originHtml = `<p class="item-origin"><strong>Origin:</strong> <a href="${href}">${escapeHtml(originName)}</a></p>`;
    } else {
      originHtml = `<p class="item-origin"><strong>Origin:</strong> ${escapeHtml(originName)}</p>`;
    }
  }

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${confidenceBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${badgeHtml}\n${statBlock}\n${holderHtml}\n${originHtml}\n${processedContent.html}\n${processedContent.relationships}`;

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

module.exports = { itemTemplate };
