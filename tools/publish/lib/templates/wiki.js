const { escapeHtml, relativeHref, encodeHref } = require('../processor');
const { baseShell, bodyHook, cssPath, rootPath, clientScripts, canonStatusBadge, metadataBadgesFor, portraitImg, connectionsSection } = require('./base');
const { orderedSessions } = require('../story-spine');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { propLinkHtml } = require('./prop-bar');

function wikiTemplate(page, processedContent, navFor, config, imageMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const pages = (context || {}).pages || [];
  const partyBoardHtml = (context || {}).partyBoardHtml || null;
  const partyDataScript = (context || {}).partyDataScript || null;
  const partyClientScripts = (context || {}).partyClientScripts || [];
  const badges = metadataBadgesFor(fm);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});

  const crumbs = generateBreadcrumbs(page.outputPath, { page });
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  // Prev/next navigation for sessions and chapters
  let storyNav = '';
  if (fm.type === 'session' || fm.type === 'chapter') {
    // Sessions follow the story spine's order: numbering restarts per chapter, so sorting
    // by session_number would interleave chapters.
    const sameType = fm.type === 'session'
      ? orderedSessions(pages)
      : pages
        .filter(p => p.frontmatter.type === fm.type)
        .sort((a, b) => (a.frontmatter.sort_order || a.frontmatter.session_number || 0) - (b.frontmatter.sort_order || b.frontmatter.session_number || 0));
    // By identity: two chapters can each have a "Session 01", and a title lookup gave
    // Ch2's page Ch1's neighbours. outputPath is unique per page, for a caller whose
    // `pages` holds copies rather than this very object.
    let idx = sameType.indexOf(page);
    if (idx === -1) idx = sameType.findIndex(p => p.outputPath === page.outputPath);
    const prev = idx > 0 ? sameType[idx - 1] : null;
    const next = idx < sameType.length - 1 ? sameType[idx + 1] : null;
    const prevLink = prev ? `<a href="${encodeHref(relativeHref(page.outputPath, prev.outputPath))}">&larr; ${escapeHtml(prev.displayTitle)}</a>` : '<span></span>';
    const nextLink = next ? `<a href="${encodeHref(relativeHref(page.outputPath, next.outputPath))}">${escapeHtml(next.displayTitle)} &rarr;</a>` : '<span></span>';
    storyNav = `<div class="story-nav">${prevLink}${nextLink}</div>`;
  }

  const graphHtml = connectionsSection(page, publishConfig);

  // A prop note links its prop under the title (`propHref`: relative, encoded).
  const propLink = (context || {}).propHref ? `\n${propLinkHtml(context.propHref)}` : '';
  const bodyHtml = `<h1 class="page-title">${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>${propLink}\n${portrait}\n${badges}\n${bodyHook(processedContent.html)}\n${graphHtml}`;
  const mainContent = storyNav ? `${storyNav}\n${bodyHtml}\n${storyNav}` : bodyHtml;

  return baseShell({
    pageType: page.frontmatter.type,
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath, config),
    rootHref: rootPath(page.outputPath),
    content: (partyBoardHtml ? partyBoardHtml + '\n' : '') + mainContent + (partyDataScript ? '\n' + partyDataScript : ''),
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    breadcrumbsHtml,
    scripts: [
      ...clientScripts(page.outputPath),
      ...(partyBoardHtml ? partyClientScripts.map(s => rootPath(page.outputPath) + 'js/' + s) : []),
    ],
  });
}

module.exports = { wikiTemplate };
