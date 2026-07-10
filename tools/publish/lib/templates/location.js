const { escapeHtml, relativeHref, parseWikiRef, publishedSource } = require('../processor');
const { baseShell, cssPath, rootPath, canonStatusBadge, portraitImg, clientScripts } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { getInitials } = require('./landing-data');
const { excerptFromMarkdown } = require('../excerpt');

function matchesRef(refValue, title) {
  if (!refValue) return false;
  const cleaned = String(refValue).replace(/\[\[|\]\]/g, '').split('|')[0].replace(/_/g, ' ').trim();
  const normalTitle = String(title || '').replace(/_/g, ' ').trim();
  return cleaned === normalTitle;
}

function locationTemplate(page, processedContent, navFor, config, imageMap, context) {
  const { pages, linkMap, publishConfig } = context || {};
  const fm = page.frontmatter;
  const backlinks = ((publishConfig || {})._backlinks || {})[page.title] || [];

  // Parse `[[Target|Alias]]` once: target keeps underscores for the linkMap lookup, label
  // is the alias or the humanized target. Reused by the breadcrumb and the sidebar below.
  const parent = fm.parent_location ? parseWikiRef(fm.parent_location) : null;
  const parentTarget = parent && linkMap ? linkMap[parent.target] : null;
  const crumbs = generateBreadcrumbs(page.outputPath, parent ? {
    parentLocation: parent.label,
    // Breadcrumb hrefs are relative to the current page; linkMap holds the root-relative
    // output path, so make it relative or it resolves under the current dir and 404s.
    parentLocationHref: parentTarget ? relativeHref(page.outputPath, parentTarget) : null,
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
    <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
    <div class="meta">${badgeHtml}</div>
  </div>
</div>`;
  } else {
    heroBanner = `<div class="hero-banner hero-banner-no-img">
  <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
  <div class="meta">${badgeHtml}</div>
</div>`;
  }

  // --- Zone 2: Atmosphere pull-quote ---
  const quoteText = excerptFromMarkdown(publishedSource(page));
  const pullQuote = quoteText ? `<div class="pull-quote">${escapeHtml(quoteText)}</div>` : '';

  // --- Zone 3: Body content ---
  const bodyContent = processedContent.html || '';

  // --- Zone 4: Sub-location cards ("Places Within") ---
  const childLocations = (pages || []).filter(p =>
    p.frontmatter.type === 'location' && matchesRef(p.frontmatter.parent_location, page.title)
  );
  let subLocationsHtml = '';
  if (childLocations.length > 0) {
    const cards = childLocations.map(child => {
      const href = relativeHref(page.outputPath, child.outputPath);
      const excerpt = excerptFromMarkdown(publishedSource(child),
        { excludeSections: (publishConfig && publishConfig.exclude_sections) || [] });
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
      const href = relativeHref(page.outputPath, npc.outputPath);
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
    const da = new Date(a.frontmatter.in_game_date || a.frontmatter.date || 0).getTime();
    const db = new Date(b.frontmatter.in_game_date || b.frontmatter.date || 0).getTime();
    return (isNaN(da) ? 0 : da) - (isNaN(db) ? 0 : db);
  });
  let timelineHtml = '';
  if (locEvents.length > 0) {
    const nodes = locEvents.map(ev => {
      const href = relativeHref(page.outputPath, ev.outputPath);
      const date = ev.frontmatter.in_game_date || ev.frontmatter.date || '';
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
    parentEntity: parent ? {
      name: parent.label,
      path: parentTarget,
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
    overridesCss: (publishConfig || {})._overridesCss,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { locationTemplate };
