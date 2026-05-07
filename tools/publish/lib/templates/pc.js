const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, portraitImg } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { getInitials } = require('./landing-data');

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

function extractFirstSentence(html) {
  const stripped = (html || '').replace(/<[^>]+>/g, '').trim();
  const match = stripped.match(/^(.+?[.!?])\s/);
  return match ? match[1] : stripped.slice(0, 200);
}

const EQUIPMENT_SECTION_TITLES = new Set(['equipment', 'gear', 'inventory', 'weapons', 'armour', 'armor', 'items', 'possessions', 'melee weapons', 'ranged weapons', 'encumbrance']);

function extractEquipment(frontmatter, sections) {
  if (Array.isArray(frontmatter.equipment) && frontmatter.equipment.length > 0) {
    const items = frontmatter.equipment.map(item => {
      if (typeof item === 'string') return `<div class="entity-card"><h4>${escapeHtml(item)}</h4></div>`;
      const name = item.name || 'Unknown';
      const desc = item.description || item.notes || '';
      const weight = item.weight ? ` <span class="sidebar-badge">${escapeHtml(String(item.weight))}</span>` : '';
      return `<div class="entity-card"><h4>${escapeHtml(name)}${weight}</h4>${desc ? `<div class="card-excerpt">${escapeHtml(desc)}</div>` : ''}</div>`;
    });
    return `<div class="card-grid">${items.join('\n')}</div>`;
  }

  const equipmentSections = sections.filter(s => EQUIPMENT_SECTION_TITLES.has(s.title.toLowerCase()));
  if (equipmentSections.length > 0) {
    return equipmentSections.map(s => `<h3>${escapeHtml(s.title)}</h3>\n${s.html}`).join('\n');
  }

  return '<p class="text-muted">No equipment data available.</p>';
}

function buildRouteMap(page, pages) {
  const storyPages = (pages || [])
    .filter(p => p.frontmatter.type === 'session' && (p.frontmatter.status === 'played' || p.frontmatter.status === 'reviewed'))
    .sort((a, b) => (a.frontmatter.session_number || 0) - (b.frontmatter.session_number || 0));

  const locations = [];
  const seen = new Set();
  for (const session of storyPages) {
    const loc = session.frontmatter.location;
    if (loc) {
      const locTitle = String(loc).replace(/\[\[|\]\]/g, '').split('|')[0].trim();
      if (!seen.has(locTitle) || locations[locations.length - 1] !== locTitle) {
        locations.push(locTitle);
        seen.add(locTitle);
      }
    }
  }

  if (locations.length < 2) return '';

  const spacing = 120;
  const width = (locations.length - 1) * spacing + 80;
  const height = 80;
  const y = 40;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:var(--font-body,system-ui)">`;
  svg += `<line x1="40" y1="${y}" x2="${40 + (locations.length - 1) * spacing}" y2="${y}" stroke="var(--border,#30363d)" stroke-width="2"/>`;
  locations.forEach((loc, i) => {
    const x = 40 + i * spacing;
    const display = loc.replace(/_/g, ' ');
    const label = display.length > 12 ? display.slice(0, 10) + '…' : display;
    svg += `<circle cx="${x}" cy="${y}" r="6" fill="var(--accent,#58a6ff)" stroke="var(--bg,#1a1f25)" stroke-width="2"/>`;
    svg += `<text x="${x}" y="${y + 22}" text-anchor="middle" font-size="10" fill="var(--text,#c9d1d9)">${escapeHtml(label)}</text>`;
  });
  svg += '</svg>';
  return `<div class="relationship-graph" style="margin-bottom:2rem"><h3>Campaign Route</h3>${svg}</div>`;
}

function tabScript() {
  return `
<script>
function switchTab(tab) {
  document.querySelectorAll('.pc-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
  history.replaceState(null, '', '#' + tab);
}
function openAccordion(id) {
  var el = document.getElementById(id);
  if (el && el.classList.contains('accordion')) {
    el.classList.add('open');
    var btn = el.querySelector('.accordion-header');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
document.addEventListener('click', function(e) {
  var link = e.target.closest('.section-nav a');
  if (link) {
    e.preventDefault();
    var id = link.getAttribute('href').slice(1);
    openAccordion(id);
  }
});
(function() {
  var hash = location.hash.slice(1);
  if (['sheet', 'equipment', 'story', 'journey'].includes(hash)) switchTab(hash);
  else if (hash) openAccordion(hash);
})();
</script>`;
}

function pcTemplate(page, processedContent, sections, navFor, config, imageMap, storyHtml, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const pages = (context || {}).pages || [];

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  // --- Cinematic Hero Banner ---
  const hasPortrait = fm.portrait && imageMap && imageMap[String(fm.portrait).split('/').pop()];
  const metaSpans = renderMetaSpans(fm);

  let heroBanner;
  if (hasPortrait) {
    const imgTag = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);
    const imgMatch = (imgTag || '').match(/src="([^"]+)"/);
    const imgUrl = imgMatch ? imgMatch[1] : '';
    heroBanner = `<div class="hero-cinematic">
  <img class="hero-cinematic-img" src="${imgUrl}" alt="${escapeHtml(page.displayTitle)}">
  <div class="hero-cinematic-overlay">
    <h1>${escapeHtml(page.displayTitle)}</h1>
    <div class="meta">
      <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
      ${metaSpans}
      <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
    </div>
  </div>
</div>`;
  } else {
    const initials = getInitials(page.displayTitle);
    heroBanner = `<div class="hero-cinematic hero-cinematic-no-img">
  <div class="pc-portrait" style="width:5rem;height:5rem;font-size:2rem;margin-bottom:1rem">${escapeHtml(initials)}</div>
  <h1>${escapeHtml(page.displayTitle)}</h1>
  <div class="meta">
    <span><span class="label">Player</span> ${escapeHtml(fm.player_name || '')}</span>
    ${metaSpans}
    <span><span class="label">Status</span> ${escapeHtml(fm.status || 'active')}</span>
  </div>
</div>`;
  }

  // --- Character Epithet ---
  let epithet = '';
  if (fm.key_traits) {
    const traitsText = Array.isArray(fm.key_traits) ? fm.key_traits.join(', ') : String(fm.key_traits);
    epithet = `<div class="pull-quote">${escapeHtml(traitsText)}</div>`;
  } else if (processedContent.html) {
    epithet = `<div class="pull-quote">${extractFirstSentence(processedContent.html)}</div>`;
  }

  // --- Sheet Tab ---
  const emptyRelPattern = /^\s*(<p><strong>Outgoing:<\/strong><\/p>\s*<p><strong>Incoming:<\/strong><\/p>)?\s*$/;
  const emptyAppearPattern = /^\s*(<p><em>Scenes and sessions where .+ appears\.<\/em><\/p>)?\s*$/;

  const sheetSections = sections.filter(s => {
    const lower = s.title.toLowerCase();
    if (EQUIPMENT_SECTION_TITLES.has(lower)) return false;
    if (lower === 'relationships' && emptyRelPattern.test(s.html.trim())) return false;
    if (lower === 'appearances' && emptyAppearPattern.test(s.html.trim())) return false;
    return true;
  });

  const sectionNav = sheetSections.length > 0
    ? `<nav class="section-nav" aria-label="Sheet sections">${sheetSections.map(s => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join('\n')}</nav>`
    : '';

  const accordions = sheetSections.map(s => `
<div class="accordion" id="${s.id}">
  <button class="accordion-header" aria-expanded="false" onclick="const o=this.parentElement.classList.toggle('open');this.setAttribute('aria-expanded',o)">${escapeHtml(s.title)}</button>
  <div class="accordion-body">
    ${s.html}
  </div>
</div>`).join('\n');

  const systemHtml = (context || {}).systemSheetHtml || null;
  let sheetContent;
  if (systemHtml) {
    sheetContent = `${systemHtml}\n${sectionNav}\n${accordions}\n${processedContent.relationships}`;
  } else {
    sheetContent = `${sectionNav}\n${accordions}\n${processedContent.relationships}`;
  }

  // --- Equipment Tab ---
  const equipmentContent = extractEquipment(fm, sections);

  // --- Story Tab ---
  const storyContent = storyHtml || '<p class="text-muted">No story content available.</p>';

  // --- Journey Tab ---
  const routeMap = buildRouteMap(page, pages);
  const graphSvg = (publishConfig._entityGraphs || {})[page.title] || '';
  const timelineStrip = publishConfig._timelineStrip || '';
  const timelineSection = timelineStrip ? `<h2>Timeline</h2>\n<div class="timeline-strip">${timelineStrip}</div>` : '';
  const graphSection = graphSvg ? `<h2>Connections</h2>\n<div class="relationship-graph">${graphSvg}</div>` : '';
  const journeyContent = [routeMap, timelineSection, graphSection].filter(Boolean).join('\n') || '<p class="text-muted">Journey data builds as the campaign progresses.</p>';

  // --- Assemble ---
  const body = `${heroBanner}
${epithet}
<div class="tab-bar">
  <button class="pc-tab active" data-tab="sheet" onclick="switchTab('sheet')">Character Sheet</button>
  <button class="pc-tab" data-tab="equipment" onclick="switchTab('equipment')">Equipment</button>
  <button class="pc-tab" data-tab="story" onclick="switchTab('story')">Story</button>
  <button class="pc-tab" data-tab="journey" onclick="switchTab('journey')">Journey</button>
</div>
<div class="tab-panel active" id="tab-sheet">
${sheetContent}
</div>
<div class="tab-panel" id="tab-equipment">
${equipmentContent}
</div>
<div class="tab-panel" id="tab-story">
  <div class="story-prose">
    ${storyContent}
  </div>
</div>
<div class="tab-panel" id="tab-journey">
${journeyContent}
</div>
${tabScript()}`;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: body,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { pcTemplate };
