const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, confidenceBadge, portraitImg, clientScripts } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { getInitials } = require('./landing-data');

function extractFirstSentence(html) {
  const stripped = (html || '').replace(/<[^>]+>/g, '').trim();
  const match = stripped.match(/^(.+?[.!?])\s/);
  return match ? match[1] : stripped.slice(0, 200);
}

function matchesRef(refValue, title) {
  if (!refValue) return false;
  const cleaned = String(refValue).replace(/\[\[|\]\]/g, '').trim();
  return cleaned === title;
}

function locationTemplate(page, processedContent, navFor, config, imageMap, context) {
  const { pages, linkMap, publishConfig } = context || {};
  const fm = page.frontmatter;
  const backlinks = ((publishConfig || {})._backlinks || {})[page.title] || [];

  const crumbs = generateBreadcrumbs(page.outputPath, fm.parent_location ? {
    parentLocation: String(fm.parent_location).replace(/\[\[|\]\]/g, '').replace(/_/g, ' '),
    parentLocationHref: linkMap ? (linkMap[String(fm.parent_location).replace(/\[\[|\]\]/g, '').trim()] || null) : null,
  } : {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  // --- Zone 1: Hero Banner ---
  const hasPortrait = fm.portrait && imageMap && imageMap[String(fm.portrait).split('/').pop()];
  const badges = [];
  if (fm.location_type) badges.push(fm.location_type);
  if (fm.atmosphere) badges.push(fm.atmosphere);
  const badgeHtml = badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('');

  let heroBanner;
  if (hasPortrait) {
    const imgSrc = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);
    const imgMatch = (imgSrc || '').match(/src="([^"]+)"/);
    const imgUrl = imgMatch ? imgMatch[1] : '';
    heroBanner = `<div class="hero-banner">
  <img class="hero-banner-img" src="${imgUrl}" alt="${escapeHtml(page.displayTitle)}">
  <div class="hero-banner-overlay">
    <h1>${escapeHtml(page.displayTitle)}${confidenceBadge(fm)}</h1>
    <div class="meta">${badgeHtml}</div>
  </div>
</div>`;
  } else {
    heroBanner = `<div class="hero-banner hero-banner-no-img">
  <h1>${escapeHtml(page.displayTitle)}${confidenceBadge(fm)}</h1>
  <div class="meta">${badgeHtml}</div>
</div>`;
  }

  // --- Zone 2: Atmosphere pull-quote ---
  const pullQuote = processedContent.html
    ? `<div class="pull-quote">${extractFirstSentence(processedContent.html)}</div>`
    : '';

  // --- Zone 3: Body content ---
  const bodyContent = processedContent.html || '';

  // --- Zone 4: Sub-location cards ("Places Within") ---
  const childLocations = (pages || []).filter(p =>
    p.frontmatter.type === 'location' && matchesRef(p.frontmatter.parent_location, page.title)
  );
  let subLocationsHtml = '';
  if (childLocations.length > 0) {
    const cards = childLocations.map(child => {
      const href = relativePath(page.outputPath, child.outputPath);
      const excerpt = extractFirstSentence(child.markdown || '').replace(/<[^>]+>/g, '');
      return `<a class="entity-card" href="${href}">
  <h4>${escapeHtml(child.displayTitle)}</h4>
  ${excerpt ? `<div class="card-excerpt">${escapeHtml(excerpt)}</div>` : ''}
</a>`;
    }).join('\n');
    subLocationsHtml = `<div class="sub-locations">
  <h2>Places Within</h2>
  <div class="card-grid">${cards}</div>
</div>`;
  }

  // --- Zone 5: Who's Here ("Known Figures") ---
  const locNPCs = (pages || []).filter(p =>
    (p.frontmatter.type === 'npc' || p.frontmatter.type === 'creature') &&
    matchesRef(p.frontmatter.location, page.title)
  );
  let whosHereHtml = '';
  if (locNPCs.length > 0) {
    const npcCards = locNPCs.map(npc => {
      const href = relativePath(page.outputPath, npc.outputPath);
      const initials = getInitials(npc.displayTitle);
      const role = npc.frontmatter.occupation || '';
      return `<a class="npc-card" href="${href}">
  <div class="npc-icon">${escapeHtml(initials)}</div>
  <div><h4>${escapeHtml(npc.displayTitle)}</h4>${role ? `<div class="npc-role">${escapeHtml(role)}</div>` : ''}</div>
</a>`;
    }).join('\n');
    whosHereHtml = `<div class="whos-here">
  <h2>Known Figures</h2>
  <div class="npc-grid">${npcCards}</div>
</div>`;
  }

  // --- Zone 6: Location event timeline ("What Happened Here") ---
  const locEvents = (pages || []).filter(p =>
    p.frontmatter.type === 'event' && matchesRef(p.frontmatter.location, page.title)
  ).sort((a, b) => {
    const da = new Date(a.frontmatter.date || 0).getTime();
    const db = new Date(b.frontmatter.date || 0).getTime();
    return (isNaN(da) ? 0 : da) - (isNaN(db) ? 0 : db);
  });
  let timelineHtml = '';
  if (locEvents.length > 0) {
    const nodes = locEvents.map(ev => {
      const href = relativePath(page.outputPath, ev.outputPath);
      const date = ev.frontmatter.date || '';
      const outcome = ev.frontmatter.outcome || '';
      return `<div class="timeline-node">
  <span class="timeline-date">${escapeHtml(date)}</span>
  <a href="${href}">${escapeHtml(ev.displayTitle)}</a>
  ${outcome ? `<div class="timeline-summary">${escapeHtml(outcome)}</div>` : ''}
</div>`;
    }).join('\n');
    timelineHtml = `<div class="whos-here">
  <h2>What Happened Here</h2>
  <div class="entity-timeline">${nodes}</div>
</div>`;
  }

  // --- Context Sidebar ---
  const sidebar = renderContextSidebar({
    backlinks,
    parentEntity: fm.parent_location ? {
      name: String(fm.parent_location).replace(/\[\[|\]\]/g, '').replace(/_/g, ' '),
      path: linkMap ? linkMap[String(fm.parent_location).replace(/\[\[|\]\]/g, '').trim()] : null,
    } : null,
    relationships: normalizeRelationships(fm.relationships, linkMap),
    currentOutputPath: page.outputPath,
  });

  const graphSvg = ((publishConfig || {})._entityGraphs || {})[page.title];
  const graphHtml = graphSvg ? `<div class="relationship-graph"><h2>Connections</h2>${graphSvg}</div>` : '';

  const mainContent = [heroBanner, pullQuote, bodyContent, processedContent.relationships, subLocationsHtml, whosHereHtml, timelineHtml, graphHtml]
    .filter(Boolean).join('\n');

  const contentHtml = sidebar
    ? `<div class="content-with-sidebar"><div class="main">${mainContent}</div>${sidebar}</div>`
    : mainContent;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: contentHtml,
    footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { locationTemplate };
