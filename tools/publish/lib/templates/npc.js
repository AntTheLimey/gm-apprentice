const { escapeHtml, relativeHref, renderMetaValue, publishedSource } = require('../processor');
const { baseShell, cssPath, rootPath, canonStatusBadge, portraitImg, clientScripts } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { getInitials } = require('./landing-data');
const { excerptFromMarkdown } = require('../excerpt');

function npcTemplate(page, processedContent, navFor, config, imageMap, context) {
  const { pages, linkMap, publishConfig } = context || {};
  const fm = page.frontmatter;
  const backlinks = ((publishConfig || {})._backlinks || {})[page.title] || [];

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  // --- Zone 1: Portrait header banner ---
  const hasPortrait = fm.portrait && imageMap && imageMap[String(fm.portrait).split('/').pop()];
  const metaParts = [];
  const meta = v => renderMetaValue(v, linkMap || {}, page.outputPath);
  if (fm.occupation) metaParts.push(`<span><span class="label">Role</span> ${meta(fm.occupation)}</span>`);
  if (fm.nationality) metaParts.push(`<span><span class="label">Nationality</span> ${meta(fm.nationality)}</span>`);
  if (fm.status) metaParts.push(`<span><span class="label">Status</span> ${escapeHtml(fm.status)}</span>`);
  if (fm.age) metaParts.push(`<span><span class="label">Age</span> ${escapeHtml(String(fm.age))}</span>`);
  if (fm.rank) metaParts.push(`<span><span class="label">Rank</span> ${meta(fm.rank)}</span>`);
  const metaHtml = metaParts.join('\n');

  let heroBanner;
  if (hasPortrait) {
    const imgTag = portraitImg(fm, page.outputPath, imageMap || {});
    const imgMatch = (imgTag || '').match(/src="([^"]+)"/);
    const imgUrl = imgMatch ? imgMatch[1] : '';
    heroBanner = `<div class="hero-cinematic">
  <img class="hero-cinematic-img" src="${imgUrl}" alt="${escapeHtml(page.displayTitle)}">
  <div class="hero-cinematic-overlay">
    <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
    <div class="meta">${metaHtml}</div>
  </div>
</div>`;
  } else {
    const initials = getInitials(page.displayTitle);
    heroBanner = `<div class="hero-banner hero-banner-no-img">
  <div class="pc-portrait" style="width:4rem;height:4rem;font-size:1.5rem;margin-bottom:0.75rem">${escapeHtml(initials)}</div>
  <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
  <div class="meta">${metaHtml}</div>
</div>`;
  }

  // --- Zone 2: First impression quote ---
  // Excerpt from the published markdown, not the rendered HTML: the source already has
  // gm-only blocks and excluded sections cut, and taking prose from markdown avoids
  // re-parsing the renderer's own output to find the sentence.
  const quoteText = excerptFromMarkdown(publishedSource(page));
  const pullQuote = quoteText ? `<div class="pull-quote">${escapeHtml(quoteText)}</div>` : '';

  // --- Zone 3: Body content ---
  const bodyContent = processedContent.html || '';

  // --- Zone 4: Where to find them (compact location card) ---
  let locationCardHtml = '';
  if (fm.location) {
    const locTitle = String(fm.location).replace(/\[\[|\]\]/g, '').trim();
    const locDisplay = locTitle.replace(/_/g, ' ');
    const locPath = linkMap ? linkMap[locTitle] : null;
    if (locPath) {
      const href = relativeHref(page.outputPath, locPath);
      locationCardHtml = `<a class="npc-location-card" href="${href}">
  <div><span class="loc-label">Location</span><br><strong>${escapeHtml(locDisplay)}</strong></div>
</a>`;
    } else {
      locationCardHtml = `<div class="npc-location-card">
  <div><span class="loc-label">Location</span><br><strong>${escapeHtml(locDisplay)}</strong></div>
</div>`;
    }
  }

  // --- Zone 5: Relationship web ("Connections") as visual cards ---
  const rels = normalizeRelationships(fm.relationships, linkMap);
  let relCardsHtml = '';
  if (rels.length > 0) {
    const cards = rels.map(r => {
      const target = String(r.target).replace(/\[\[|\]\]/g, '').trim();
      const display = target.replace(/_/g, ' ');
      const relType = (r.type || '').replace(/_/g, ' ');
      const targetPath = linkMap ? linkMap[target] : null;
      const href = targetPath ? relativeHref(page.outputPath, targetPath) : null;
      const tag = href ? 'a' : 'div';
      const hrefAttr = href ? ` href="${href}"` : '';
      return `<${tag} class="rel-card"${hrefAttr}>
  <div class="rel-type">${escapeHtml(relType)}</div>
  <div class="rel-name">${escapeHtml(display)}</div>
</${tag}>`;
    }).join('\n');
    relCardsHtml = `<div class="whos-here">
  <h2>Connections</h2>
  <div class="relationship-cards">${cards}</div>
</div>`;
  }

  // --- Zone 6: Story arc timeline (session appearances) ---
  const sessionBacklinks = backlinks
    .filter(b => b.type === 'session')
    .sort((a, b) => {
      const na = (String(a.displayTitle).match(/(\d+)/) || [])[1];
      const nb = (String(b.displayTitle).match(/(\d+)/) || [])[1];
      return (na ? +na : 0) - (nb ? +nb : 0);
    });
  let arcTimelineHtml = '';
  if (sessionBacklinks.length > 0) {
    const nodes = sessionBacklinks.map(b => {
      const href = relativeHref(page.outputPath, b.outputPath);
      return `<div class="timeline-node">
  <a href="${href}">${escapeHtml(b.displayTitle)}</a>
</div>`;
    }).join('\n');
    arcTimelineHtml = `<div class="whos-here">
  <h2>Story Arc</h2>
  <div class="entity-timeline">${nodes}</div>
</div>`;
  }

  // --- Context Sidebar ---
  const sidebar = renderContextSidebar({
    backlinks,
    relationships: rels,
    currentOutputPath: page.outputPath,
  });

  const graphSvg = ((publishConfig || {})._entityGraphs || {})[page.title];
  const graphHtml = graphSvg ? `<div class="relationship-graph"><h2>Connections Graph</h2>${graphSvg}</div>` : '';

  const mainContent = [heroBanner, pullQuote, bodyContent, processedContent.relationships, locationCardHtml, relCardsHtml, arcTimelineHtml, graphHtml]
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

module.exports = { npcTemplate };
