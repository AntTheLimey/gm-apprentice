const { backlinksOf } = require('../backlinks');
const { escapeHtml, relativePath, wikiTargetLabel, encodeHref, renderMetaValue, refMetaValue } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, canonStatusBadge, portraitImg, headerValueText } = require('./base');
const { renderContextSidebar, normalizeRelationships } = require('./context-sidebar');
const { WIKILINK_SOURCE, parseWikilink } = require('../wikilink');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');

function parseParticipant(raw) {
  const str = String(raw).trim();
  const wikiMatch = str.match(new RegExp('^' + WIKILINK_SOURCE + String.raw`\s*(?:\((.+)\))?$`));
  if (wikiMatch) {
    const link = parseWikilink(wikiMatch[1]);
    const target = link.raw.trim();
    // Keep an explicit |alias verbatim; otherwise humanize the slug so participant links
    // don't show raw underscores (Adrien_de_Montferrand → Adrien de Montferrand).
    const display = link.display.trim() ? link.display.trim() : wikiTargetLabel(target);
    const annotation = wikiMatch[2] ? wikiMatch[2].trim() : '';
    return { target, display, annotation, isLink: true };
  }
  const plainMatch = str.match(/^(.+?)\s*\((.+)\)$/);
  if (plainMatch) {
    return { target: '', display: plainMatch[1].trim(), annotation: plainMatch[2].trim(), isLink: false };
  }
  return { target: '', display: str.trim(), annotation: '', isLink: false };
}

function eventTemplate(page, processedContent, navFor, config, imageMap, linkMap, context) {
  const fm = page.frontmatter;
  const publishConfig = (context || {}).publishConfig || {};
  const backlinks = backlinksOf(publishConfig._backlinks, page);
  const portrait = portraitImg(fm, page.outputPath, imageMap || {});
  const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));

  const badges = [];
  if (fm.event_type) badges.push(headerValueText('event_type', fm.event_type));

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const metaItems = [];
  const dateVal = fm.in_game_date || fm.date;
  if (dateVal) {
    metaItems.push(`<span><span class="label">Date</span> ${escapeHtml(headerValueText('date', dateVal))}</span>`);
  }
  if (fm.location) {
    metaItems.push(`<span><span class="label">Location</span> ${refMetaValue(fm.location, linkMap, page.outputPath)}</span>`);
  }

  const metaHtml = metaItems.length > 0
    ? `<div class="meta">${metaItems.join('\n')}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${canonStatusBadge(fm)}</h1>
  ${metaHtml}
</div>`;

  let outcomeHtml = '';
  if (fm.outcome) {
    outcomeHtml = `<div class="event-outcome"><strong>Outcome:</strong> ${renderMetaValue(fm.outcome, linkMap, page.outputPath)}</div>`;
  }

  let participantsHtml = '';
  if (Array.isArray(fm.participants) && fm.participants.length > 0) {
    const items = fm.participants.map(raw => {
      const p = parseParticipant(raw);
      let nameHtml;
      if (p.isLink) {
        const resolved = linkMap?.[p.target];
        if (resolved) {
          const href = encodeHref(relativePath(currentDir, resolved));
          nameHtml = `<a href="${href}">${escapeHtml(p.display)}</a>`;
        } else {
          nameHtml = escapeHtml(p.display);
        }
      } else {
        nameHtml = escapeHtml(p.display);
      }
      if (p.annotation) {
        return `<li>${nameHtml} — ${escapeHtml(p.annotation)}</li>`;
      }
      return `<li>${nameHtml}</li>`;
    }).join('\n');
    participantsHtml = `<div class="event-participants"><h3>Participants</h3><ul>${items}</ul></div>`;
  }

  const crumbs = generateBreadcrumbs(page.outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);

  const sidebar = renderContextSidebar({
    backlinks,
    relationships: normalizeRelationships(fm.relationships, linkMap),
    currentOutputPath: page.outputPath,
  });

  const graphSvg = ((publishConfig || {})._entityGraphs || {})[page.title];
  const graphHtml = graphSvg ? `<div class="relationship-graph"><h2>Connections</h2>${graphSvg}</div>` : '';

  const mainContent = `${headerCard}\n${badgeHtml}\n${outcomeHtml}\n${participantsHtml}\n${processedContent.html}\n${processedContent.relationships}\n${graphHtml}`;
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
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    breadcrumbsHtml,
    scripts: clientScripts(page.outputPath),
  });
}

module.exports = { eventTemplate, parseParticipant };
