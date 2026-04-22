const { escapeHtml } = require('../processor');
const { baseShell, DIR_LABELS } = require('./base');
const { getLatestSession, extractRecap, getInitials, getPCs, scoreNPCs } = require('./landing-data');

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusClass(status) {
  if (!status) return 'status-alive';
  const s = String(status).toLowerCase();
  if (s === 'dead' || s === 'deceased') return 'status-kia';
  if (s === 'missing' || s === 'unknown') return 'status-mia';
  return 'status-alive';
}

function statusLabel(status) {
  if (!status) return 'Active';
  const s = String(status).toLowerCase();
  if (s === 'dead' || s === 'deceased') return 'KIA';
  if (s === 'missing' || s === 'unknown') return 'MIA';
  return 'Active';
}

function landingTemplate(pages, navFor, config, publishConfig) {
  const outputPath = 'index.html';
  const theme = (publishConfig && publishConfig.theme) || {};
  const campaignImage = theme.campaign_image || null;
  const settingYear = publishConfig ? publishConfig.setting_year : null;

  // --- Hero ---
  const heroImageHtml = campaignImage
    ? `<img src="${escapeHtml(campaignImage)}" alt="${escapeHtml(config.siteTitle)}" class="hero-image">`
    : '';

  const latestSession = getLatestSession(pages);
  const lastPlayed = latestSession ? formatDate(latestSession.frontmatter.actual_date) : null;
  const inGameDate = settingYear ? `Spring ${settingYear}` : null;

  let heroDatesHtml = '';
  if (lastPlayed || inGameDate) {
    heroDatesHtml = '<div class="hero-dates">';
    if (lastPlayed) {
      heroDatesHtml += `<div><span class="date-label">Last Played</span>${escapeHtml(lastPlayed)}</div>`;
    }
    if (inGameDate) {
      heroDatesHtml += `<div><span class="date-label">In-Game Date</span>${escapeHtml(inGameDate)}</div>`;
    }
    heroDatesHtml += '</div>';
  }

  const taglineHtml = config.landingTagline
    ? `<p class="hero-tagline">${escapeHtml(config.landingTagline)}</p>`
    : '';

  const heroHtml = `
<div class="hero">
  ${heroImageHtml}
  <h1>${escapeHtml(config.siteTitle)}</h1>
  ${taglineHtml}
  ${heroDatesHtml}
</div>`;

  // --- Story So Far ---
  const recapText = extractRecap(latestSession);
  let recapHtml = '';
  if (recapText && latestSession) {
    const sessionLink = latestSession.outputPath || '#';
    recapHtml = `
<div class="dashboard-section">
  <h2>Story So Far</h2>
  <div class="recap">
    ${escapeHtml(recapText)}
    <br>
    <a href="${escapeHtml(sessionLink)}" class="recap-link">Read full session recap &rarr;</a>
  </div>
</div>`;
  }

  // --- The Team ---
  const pcs = getPCs(pages);
  let rosterHtml = '';
  if (pcs.length > 0) {
    const pcCards = pcs.map(pc => {
      const fm = pc.frontmatter;
      const initials = getInitials(pc.title);
      const attachPrefix = (config.attachmentsDir || '_attachments') + '/';
      const portraitStr = fm.portrait ? String(fm.portrait) : '';
      const portraitRel = portraitStr.startsWith(attachPrefix) ? portraitStr.slice(attachPrefix.length) : portraitStr;
      const portrait = fm.portrait
        ? `<div class="pc-portrait"><img src="images/${escapeHtml(portraitRel)}" alt="${escapeHtml(pc.title)}"></div>`
        : `<div class="pc-portrait">${escapeHtml(initials)}</div>`;
      const badge = `<span class="status-badge ${statusClass(fm.status)}">${statusLabel(fm.status)}</span>`;
      const traits = fm.key_traits
        ? fm.key_traits.join(' \u00b7 ')
        : (fm.occupation || '');
      const link = pc.outputPath || '#';
      return `
<div class="pc-card">
  ${portrait}
  <h3><a href="${escapeHtml(link)}">${escapeHtml(pc.title)}</a></h3>
  ${badge}
  <div class="pc-traits">${escapeHtml(traits)}</div>
</div>`;
    }).join('\n');

    rosterHtml = `
<div class="dashboard-section">
  <h2>The Team</h2>
  <div class="pc-roster">
    ${pcCards}
  </div>
</div>`;
  }

  // --- Key NPCs ---
  const scoredNPCs = scoreNPCs(pages);
  let npcHtml = '';
  if (scoredNPCs.length > 0) {
    const npcCards = scoredNPCs.map(({ page, role }) => {
      const fm = page.frontmatter;
      const initials = getInitials(page.title);
      const roleText = fm.occupation ? `${role} \u00b7 ${fm.occupation}` : role;
      const link = page.outputPath || '#';
      return `
<div class="npc-card">
  <div class="npc-icon">${escapeHtml(initials)}</div>
  <div class="npc-info">
    <h4><a href="${escapeHtml(link)}">${escapeHtml(page.title)}</a></h4>
    <span class="npc-role">${escapeHtml(roleText)}</span>
  </div>
</div>`;
    }).join('\n');

    npcHtml = `
<div class="dashboard-section">
  <h2>Key NPCs</h2>
  <div class="npc-grid">
    ${npcCards}
  </div>
</div>`;
  }

  // --- Explore ---
  const sectionOrder = [
    'campaign',
    'factions',
    'events',
    'locations',
    'items',
    'documents',
    'clues',
    'chapters',
    'creatures',
  ];

  const exploreCards = sectionOrder.map(dir => {
    const label = DIR_LABELS[dir];
    if (!label) return '';
    const dirPages = pages.filter(p => p.outputDir === dir || p.outputDir.startsWith(dir + '/'));
    if (dirPages.length === 0) return '';
    const countText = dirPages.length === 1 ? '1 entry' : `${dirPages.length} entries`;
    return `<a href="${dir}/index.html" class="explore-card"><h4>${escapeHtml(label)}</h4><span class="count">${countText}</span></a>`;
  }).filter(Boolean).join('\n');

  const exploreHtml = exploreCards ? `
<div class="dashboard-section">
  <h2>Explore</h2>
  <div class="explore-grid">
    ${exploreCards}
  </div>
</div>` : '';

  const content = `${heroHtml}${recapHtml}${rosterHtml}${npcHtml}${exploreHtml}`;

  return baseShell({
    title: 'Home',
    siteTitle: config.siteTitle,
    cssHref: 'css/style.css',
    navHtml: navFor(outputPath),
    rootHref: './',
    content,
    footer: config.footer,
  });
}

module.exports = { landingTemplate };
