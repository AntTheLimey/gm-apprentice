const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, portraitImg } = require('./base');

function pcTemplate(page, processedContent, sections, navFor, config, imageMap) {
  const fm = page.frontmatter;
  const traits = fm.key_traits
    ? escapeHtml(Array.isArray(fm.key_traits) ? fm.key_traits.join(', ') : String(fm.key_traits))
    : '';
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);
  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}</h1>
  <p class="concept">${traits}</p>
  <div class="meta">
    <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
    <span><span class="label">Points</span> ${escapeHtml(String(fm.point_total || 200))}/200</span>
    <span><span class="label">Background</span> ${escapeHtml(fm.occupation || '')}</span>
    <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
  </div>
</div>`;

  const sectionNav = sections.length > 0
    ? `<nav class="section-nav" aria-label="Sheet sections">${sections.map(s => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('\n')}</nav>`
    : '';

  const accordions = sections.map(s => `
<div class="accordion" id="${s.id}">
  <button class="accordion-header" aria-expanded="false" onclick="const o=this.parentElement.classList.toggle('open');this.setAttribute('aria-expanded',o)">${escapeHtml(s.title)}</button>
  <div class="accordion-body">
    ${s.html}
  </div>
</div>`).join('\n');

  const content = `${headerCard}\n${sectionNav}\n${accordions}\n${processedContent.relationships}`;

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

module.exports = { pcTemplate };
