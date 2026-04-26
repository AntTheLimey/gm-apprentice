const { escapeHtml } = require('../processor');
const { baseShell, cssPath, rootPath, portraitImg } = require('./base');

const DEFAULT_META_FIELDS = ['occupation', 'age', 'nationality'];

function formatLabel(fieldName) {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function renderMetaSpans(fm) {
  const fields = Array.isArray(fm.display_meta) ? fm.display_meta : DEFAULT_META_FIELDS;
  return fields
    .filter(field => fm[field] != null && fm[field] !== '')
    .map(field => `<span><span class="label">${escapeHtml(formatLabel(field))}</span> ${escapeHtml(String(fm[field]))}</span>`)
    .join('\n    ');
}

function tabScript() {
  return `
<script>
function switchTab(tab) {
  document.querySelectorAll('.pc-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
  history.replaceState(null, '', '#' + tab);
}
(function() {
  if (location.hash === '#story') switchTab('story');
})();
</script>`;
}

function pcTemplate(page, processedContent, sections, navFor, config, imageMap, storyHtml) {
  const fm = page.frontmatter;
  const traits = fm.key_traits
    ? escapeHtml(Array.isArray(fm.key_traits) ? fm.key_traits.join(', ') : String(fm.key_traits))
    : '';
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);
  const metaSpans = renderMetaSpans(fm);
  const hasTabs = !!storyHtml;

  const headerCard = `
<div class="char-header${hasTabs ? ' char-header-tabbed' : ''}">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}</h1>
  <p class="concept">${traits}</p>
  <div class="meta">
    <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
    ${metaSpans}
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

  const sheetContent = `${sectionNav}\n${accordions}\n${processedContent.relationships}`;

  let body;
  if (hasTabs) {
    body = `${headerCard}
<div class="tab-bar">
  <button class="pc-tab active" data-tab="sheet" onclick="switchTab('sheet')">Character Sheet</button>
  <button class="pc-tab" data-tab="story" onclick="switchTab('story')">Story</button>
</div>
<div class="tab-panel active" id="tab-sheet">
${sheetContent}
</div>
<div class="tab-panel" id="tab-story">
  <div class="story-prose">
    ${storyHtml}
  </div>
</div>
${tabScript()}`;
  } else {
    body = `${headerCard}\n${sheetContent}`;
  }

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content: body,
    footer: config.footer,
  });
}

module.exports = { pcTemplate };
