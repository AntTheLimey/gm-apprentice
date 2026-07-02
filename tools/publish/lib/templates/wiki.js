const { escapeHtml, relativeHref } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, canonStatusBadge, metadataBadgesFor, portraitImg } = require('./base');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function wikiTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const linkMap = (context || {}).linkMap || {};
  const pages = (context || {}).pages || [];
  const backlinks = (publishConfig._backlinks || {})[page.title] || [];
  const extraSidebar = (context || {}).extraSidebar || {};
  const badges = metadataBadgesFor(fm);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  // Build extra sidebar sections for session/chapter pages
  const extraSections = [];

  if (extraSidebar.mentionedNPCs && extraSidebar.mentionedNPCs.length > 0) {
    const npcItems = extraSidebar.mentionedNPCs.map(n => {
      const href = relativeHref(page.outputPath, n.outputPath);
      return `<li><a href="${href}">${escapeHtml(n.displayTitle)}</a></li>`;
    });
    extraSections.push(`<h3>NPCs Appearing</h3>\n<ul>${npcItems.join('\n')}</ul>`);
  }

  if (extraSidebar.events && extraSidebar.events.length > 0) {
    const eventItems = extraSidebar.events.map(e => {
      const href = relativeHref(page.outputPath, e.outputPath);
      return `<li><a href="${href}">${escapeHtml(e.displayTitle)}</a></li>`;
    });
    extraSections.push(`<h3>Events</h3>\n<ul>${eventItems.join('\n')}</ul>`);
  }

  if (extraSidebar.constituentSessions && extraSidebar.constituentSessions.length > 0) {
    const sessionItems = extraSidebar.constituentSessions.map(s => {
      const href = relativeHref(page.outputPath, s.outputPath);
      return `<li><a href="${href}">${escapeHtml(s.displayTitle)}</a></li>`;
    });
    extraSections.push(`<h3>Sessions</h3>\n<ul>${sessionItems.join('\n')}</ul>`);
  }

  // Standard sidebar + extra sections
  const WRAP_UP_TYPES = new Set(['session-wrap-up', 'session_wrap', 'session-wrapup']);
  const isWrapUp = WRAP_UP_TYPES.has(fm.type);

  let sidebar = renderContextSidebar({
    backlinks: isWrapUp ? [] : backlinks,
    relationships: normalizeRelationships(fm.relationships, linkMap),
    currentOutputPath: page.outputPath,
  });

  // Append extra sections to sidebar
  if (extraSections.length > 0) {
    if (sidebar) {
      sidebar = sidebar.replace('</aside>', extraSections.join('\n') + '\n</aside>');
    } else {
      sidebar = `<aside class="context-sidebar">\n${extraSections.join('\n')}\n</aside>`;
    }
  }

  // Prev/next navigation for sessions and chapters
  let storyNav = '';
  if (fm.type === 'session' || fm.type === 'chapter') {
    const sameType = pages
      .filter(p => p.frontmatter.type === fm.type)
      .sort((a, b) => (a.frontmatter.sort_order || a.frontmatter.session_number || 0) - (b.frontmatter.sort_order || b.frontmatter.session_number || 0));
    const idx = sameType.findIndex(p => p.title === page.title);
    const prev = idx > 0 ? sameType[idx - 1] : null;
    const next = idx < sameType.length - 1 ? sameType[idx + 1] : null;
    const prevLink = prev ? `<a href="${relativeHref(page.outputPath, prev.outputPath)}">&larr; ${escapeHtml(prev.displayTitle)}</a>` : '<span></span>';
    const nextLink = next ? `<a href="${relativeHref(page.outputPath, next.outputPath)}">${escapeHtml(next.displayTitle)} &rarr;</a>` : '<span></span>';
    storyNav = `<div class="story-nav">${prevLink}${nextLink}</div>`;
  }

  const graphSvg = ((publishConfig || {})._entityGraphs || {})[page.title];
  const graphHtml = graphSvg ? `<div class="relationship-graph"><h2>Connections</h2>${graphSvg}</div>` : '';

  const bodyHtml = `<h1 class="page-title">${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>\n${portrait}\n${badges}\n${processedContent.html}\n${processedContent.relationships}\n${graphHtml}`;
  const mainContent = storyNav ? `${storyNav}\n${bodyHtml}\n${storyNav}` : bodyHtml;

  // A sparse sidebar (≤1 section) shouldn't reserve the full 18rem column and squeeze the
  // article into a narrow left strip with an empty right gutter. Flag it so the CSS can
  // collapse to a single, comfortably-wide column (B2). Each sidebar section is an <h3>.
  const sidebarSections = sidebar ? (sidebar.match(/<h3[\s>]/g) || []).length : 0;
  const sparseClass = sidebar && sidebarSections <= 1 ? ' content-sidebar-sparse' : '';
  const contentHtml = sidebar
    ? `<div class="content-with-sidebar${sparseClass}"><div class="main">${mainContent}</div>${sidebar}</div>`
    : mainContent;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: contentHtml,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { wikiTemplate };
