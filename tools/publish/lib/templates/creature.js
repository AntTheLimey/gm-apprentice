const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function creatureTemplate(page, processedContent, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  // Build stat block from frontmatter fields
  const stats = [];
  if (fm.hp) stats.push({ label: 'HP', value: fm.hp });
  if (fm.dr) stats.push({ label: 'DR', value: fm.dr });
  if (fm.speed) stats.push({ label: 'Speed', value: fm.speed });
  if (fm.sm) stats.push({ label: 'SM', value: fm.sm });
  if (fm.st) stats.push({ label: 'ST', value: fm.st });
  if (fm.dx) stats.push({ label: 'DX', value: fm.dx });
  if (fm.iq) stats.push({ label: 'IQ', value: fm.iq });
  if (fm.ht) stats.push({ label: 'HT', value: fm.ht });

  const statBlock = stats.length > 0
    ? `<div class="stat-block">
        ${stats.map(s => `<div class="stat-item"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(String(s.value))}</span></div>`).join('\n')}
       </div>`
    : '';

  // Abilities list
  const abilities = Array.isArray(fm.abilities) && fm.abilities.length > 0
    ? `<div class="abilities"><h3>Abilities</h3><ul>${fm.abilities.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`
    : '';

  const weaknesses = Array.isArray(fm.weaknesses) && fm.weaknesses.length > 0
    ? `<div class="weaknesses"><h3>Weaknesses</h3><ul>${fm.weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`
    : '';

  // Metadata badges
  const badges = [];
  if (fm.creature_type) badges.push(fm.creature_type);
  if (fm.threat_level) badges.push(`Threat: ${fm.threat_level}`);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${badgeHtml}\n${statBlock}\n${abilities}\n${weaknesses}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { creatureTemplate };
