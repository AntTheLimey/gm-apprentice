const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function parseParticipant(raw) {
  const str = String(raw).trim();
  const wikiMatch = str.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*(?:\((.+)\))?$/);
  if (wikiMatch) {
    const target = wikiMatch[1].trim();
    const display = (wikiMatch[2] || wikiMatch[1]).trim();
    const annotation = wikiMatch[3] ? wikiMatch[3].trim() : '';
    return { target, display, annotation, isLink: true };
  }
  const plainMatch = str.match(/^(.+?)\s*\((.+)\)$/);
  if (plainMatch) {
    return { target: '', display: plainMatch[1].trim(), annotation: plainMatch[2].trim(), isLink: false };
  }
  return { target: '', display: str.trim(), annotation: '', isLink: false };
}

function eventTemplate(page, processedContent, navFor, config, imageMap, linkMap) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);
  const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));

  const badges = [];
  if (fm.event_type) badges.push(fm.event_type);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  const metaItems = [];
  if (fm.date) {
    metaItems.push(`<span><span class="label">Date</span> ${escapeHtml(fm.date)}</span>`);
  }
  if (fm.location) {
    const locRaw = String(fm.location).trim();
    const locMatch = locRaw.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    const locTarget = locMatch ? locMatch[1].trim() : locRaw.replace(/\[\[|\]\]/g, '').trim();
    const locDisplay = locMatch ? (locMatch[2] || locMatch[1]).trim() : locTarget;
    const locPath = linkMap?.[locTarget];
    if (locPath) {
      const href = relativePath(currentDir, locPath);
      metaItems.push(`<span><span class="label">Location</span> <a href="${href}">${escapeHtml(locDisplay)}</a></span>`);
    } else {
      metaItems.push(`<span><span class="label">Location</span> ${escapeHtml(locDisplay)}</span>`);
    }
  }

  const metaHtml = metaItems.length > 0
    ? `<div class="meta">${metaItems.join('\n')}</div>`
    : '';

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.displayTitle)}${stubBadge(fm)}</h1>
  ${metaHtml}
</div>`;

  let outcomeHtml = '';
  if (fm.outcome) {
    outcomeHtml = `<div class="event-outcome"><strong>Outcome:</strong> ${escapeHtml(fm.outcome)}</div>`;
  }

  let participantsHtml = '';
  if (Array.isArray(fm.participants) && fm.participants.length > 0) {
    const items = fm.participants.map(raw => {
      const p = parseParticipant(raw);
      let nameHtml;
      if (p.isLink) {
        const resolved = linkMap?.[p.target];
        if (resolved) {
          const href = relativePath(currentDir, resolved);
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

  const content = `${headerCard}\n${badgeHtml}\n${outcomeHtml}\n${participantsHtml}\n${processedContent.html}\n${processedContent.relationships}`;

  return baseShell({
    title: page.displayTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(page.outputPath),
    navHtml: navFor(page.outputPath),
    rootHref: rootPath(page.outputPath),
    content,
    footer: config.footer,
  });
}

module.exports = { eventTemplate, parseParticipant };
