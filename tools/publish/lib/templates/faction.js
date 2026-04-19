const { escapeHtml, relativePath } = require('../processor');
const { baseShell, cssPath, rootPath, stubBadge, portraitImg } = require('./base');

function factionTemplate(page, processedContent, navFor, config, imageMap, linkMap, allPages) {
  const fm = page.frontmatter;
  const portrait = portraitImg(fm, page.outputPath, imageMap || {}, config.attachmentsDir);

  // Metadata badges
  const badges = [];
  if (fm.faction_type) badges.push(fm.faction_type);
  if (fm.alignment) badges.push(fm.alignment);

  const badgeHtml = badges.length > 0
    ? `<div class="metadata-badges">${badges.map(b => `<span class="metadata-badge">${escapeHtml(b)}</span>`).join('\n')}</div>`
    : '';

  // Goals list
  const goals = fm.goals && Array.isArray(fm.goals)
    ? `<div class="goals"><h3>Goals</h3><ul>${fm.goals.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul></div>`
    : '';

  // Leadership link
  let leadershipHtml = '';
  if (fm.leadership) {
    const leaderName = String(fm.leadership).replace(/\[\[|\]\]/g, '').trim();
    const leaderPath = linkMap?.[leaderName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (leaderPath) {
      const href = relativePath(currentDir, leaderPath);
      leadershipHtml = `<p class="faction-leadership"><strong>Leadership:</strong> <a href="${href}">${escapeHtml(leaderName)}</a></p>`;
    } else {
      leadershipHtml = `<p class="faction-leadership"><strong>Leadership:</strong> ${escapeHtml(leaderName)}</p>`;
    }
  }

  // Territory link
  let territoryHtml = '';
  if (fm.territory) {
    const territoryName = String(fm.territory).replace(/\[\[|\]\]/g, '').trim();
    const territoryPath = linkMap?.[territoryName];
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    if (territoryPath) {
      const href = relativePath(currentDir, territoryPath);
      territoryHtml = `<p class="faction-territory"><strong>Territory:</strong> <a href="${href}">${escapeHtml(territoryName)}</a></p>`;
    } else {
      territoryHtml = `<p class="faction-territory"><strong>Territory:</strong> ${escapeHtml(territoryName)}</p>`;
    }
  }

  // Member rollup: find entities with member_of or assigned_to relationships pointing to this faction
  const factionTitle = page.title;
  const members = (allPages || []).filter(p => {
    const rels = p.frontmatter.relationships;
    if (!rels || !Array.isArray(rels)) return false;
    return rels.some(r => {
      const target = String(r.target || '').replace(/\[\[|\]\]/g, '').trim();
      return target === factionTitle && (r.type === 'member_of' || r.type === 'assigned_to');
    });
  });

  let membersHtml = '';
  if (members.length > 0) {
    const currentDir = page.outputPath.substring(0, page.outputPath.lastIndexOf('/'));
    const memberLinks = members.map(m => {
      const href = relativePath(currentDir, m.outputPath);
      return `<li><a href="${href}">${escapeHtml(m.title)}</a></li>`;
    }).join('\n');
    membersHtml = `<div class="members"><h3>Members</h3><ul>${memberLinks}</ul></div>`;
  }

  const headerCard = `
<div class="char-header">
  ${portrait}
  <h1>${escapeHtml(page.title)}${stubBadge(fm)}</h1>
</div>`;

  const content = `${headerCard}\n${badgeHtml}\n${leadershipHtml}\n${territoryHtml}\n${goals}\n${membersHtml}\n${processedContent.html}\n${processedContent.relationships}`;

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

module.exports = { factionTemplate };
