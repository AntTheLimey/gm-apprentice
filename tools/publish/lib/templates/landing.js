const { escapeHtml, plainMetaValue } = require('../processor');
const { baseShell, cssPath, rootPath, DIR_LABELS, portraitImg, canonStatusBadge, clientScripts } = require('./base');
const {
  getLatestSession, getLatestWrapUp, extractRecap, getInitials, getPCs,
  getRecentEvents, getExploreDescriptions,
} = require('./landing-data');

function formatDate(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const FALLEN_STATUSES = new Set(['dead', 'deceased', 'retired', 'unknown', 'missing']);

function statusLabel(status) {
  if (!status) return 'Active';
  const s = String(status).toLowerCase();
  if (s === 'dead' || s === 'deceased') return 'KIA';
  if (s === 'missing' || s === 'unknown') return 'MIA';
  if (s === 'retired') return 'Retired';
  return 'Active';
}

// Resolve a wiki-link such as "[[Session 03 - Give Rest]]" to its session page by matching the
// page's source filename (page.title). Returns null when no matching session page is present.
function resolveSessionLink(link, pages) {
  if (!link) return null;
  const target = String(link).replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
  if (!target) return null;
  return pages.find(p => p.frontmatter.type === 'session' && p.title === target) || null;
}

function landingTemplate(pages, navFor, config, publishConfig, imageMap, corpus) {
  const outputPath = 'index.html';
  const theme = (publishConfig && publishConfig.theme) || {};
  const campaignImage = theme.campaign_image || null;
  const settingYear = publishConfig ? publishConfig.setting_year : null;
  const landingConfig = (publishConfig && publishConfig.landing) || {};
  const genre = publishConfig._genrePreset || null;
  // The full corpus (all scanned pages, pre-publish-filter) is available for context; fall back to
  // the published `pages` if a caller doesn't supply it. The _Campaign overview holds authoritative
  // campaign state (maintained by the session-wrapup skill: current_game_date, sessions_played,
  // last_session, last_play_date). Looked up by `type === 'campaign_overview'`, never by filename,
  // so name drift such as "Campaign_Overview_Updated" is tolerated.
  const corpusPages = (corpus && corpus.length) ? corpus : pages;
  const overviewFm = (corpusPages.find(p => p.frontmatter.type === 'campaign_overview') || {}).frontmatter || {};
  const inGameLabel = overviewFm.current_game_date || settingYear;

  // --- Zone 1: Hero ---
  const heroImgHtml = campaignImage
    ? `<img class="landing-hero-img" src="${escapeHtml(campaignImage)}" alt="${escapeHtml(config.siteTitle)}">`
    : '';
  const tagline = theme.tagline ? `<p class="hero-tagline">${escapeHtml(theme.tagline)}</p>` : '';
  const sessionCount = (overviewFm.sessions_played != null)
    ? overviewFm.sessions_played
    : (publishConfig && publishConfig.total_sessions != null)
      ? publishConfig.total_sessions
      : pages.filter(p => p.frontmatter.type === 'session' && (p.frontmatter.status === 'played' || p.frontmatter.status === 'reviewed')).length;
  const heroDateParts = [];
  if (inGameLabel) heroDateParts.push(`<span><span class="date-label">In-Game</span> ${escapeHtml(String(inGameLabel))}</span>`);
  heroDateParts.push(`<span><span class="date-label">Sessions</span> ${sessionCount}</span>`);
  const heroDates = heroDateParts.length > 0 ? `<div class="hero-dates">${heroDateParts.join('')}</div>` : '';

  const heroZone = `<div class="landing-hero">
  ${heroImgHtml}
  <h1>${escapeHtml(config.siteTitle)}</h1>
  ${tagline}
  ${heroDates}
</div>`;

  // --- Zone 2: Latest Session Recap ---
  // Prefer the overview's authoritative last_session pointer, resolved against the *published*
  // pages so the "Read full session" link always targets a rendered page. Fall back to scanning
  // when last_session is absent or points to a page that isn't itself published.
  const latestSession = resolveSessionLink(overviewFm.last_session, pages) || getLatestSession(pages);
  const latestWrapUp = getLatestWrapUp(pages, latestSession);
  let recapZone = '';
  if (latestSession) {
    const recapSource = latestWrapUp || latestSession;
    const recap = extractRecap(recapSource);
    const dateStr = formatDate(overviewFm.last_play_date || latestSession.frontmatter.play_date || latestSession.frontmatter.actual_date);
    const dateBadge = dateStr ? ` <span style="opacity:0.7;font-size:0.85rem"> — ${escapeHtml(dateStr)}</span>` : '';
    const linkTarget = latestWrapUp || latestSession;
    const recapLink = `<a class="recap-link" href="${escapeHtml(linkTarget.outputPath)}">Read full session &rarr;</a>`;
    recapZone = `<div class="dashboard-section">
  <h2>Latest Session${dateBadge}</h2>
  <div class="recap">${recap ? escapeHtml(recap) : '<em>No recap available.</em>'}
    <br>${recapLink}
  </div>
</div>`;
  }

  // --- Zone 3: The Team (active PCs) ---
  const allPCs = getPCs(pages);
  const activePCs = allPCs.filter(p => !FALLEN_STATUSES.has(String(p.frontmatter.status || '').toLowerCase()));
  const fallenPCs = allPCs.filter(p => FALLEN_STATUSES.has(String(p.frontmatter.status || '').toLowerCase()));

  let teamZone = '';
  if (activePCs.length > 0) {
    const pcCards = activePCs.map(pc => {
      const fm = pc.frontmatter;
      const initials = getInitials(pc.displayTitle);
      const portraitTag = fm.portrait ? portraitImg(fm, outputPath, imageMap || {}, config.attachmentsDir) : '';
      const portraitHtml = portraitTag
        ? `<div class="pc-portrait">${portraitTag}</div>`
        : `<div class="pc-portrait">${escapeHtml(initials)}</div>`;
      const occupation = fm.occupation ? `<div class="pc-traits">${escapeHtml(plainMetaValue(fm.occupation))}</div>` : '';
      const traits = fm.key_traits
        ? `<div class="pc-traits">${escapeHtml(Array.isArray(fm.key_traits) ? fm.key_traits.join(', ') : String(fm.key_traits))}</div>`
        : '';
      return `<a class="pc-card" href="${escapeHtml(pc.outputPath)}">
  ${portraitHtml}
  <h3>${escapeHtml(pc.displayTitle)}</h3>
  ${occupation}${traits}
</a>`;
    }).join('\n');
    teamZone = `<div class="dashboard-section">
  <h2>The Team</h2>
  <div class="pc-roster">${pcCards}</div>
</div>`;
  }

  // --- Zone 4: In Memoriam ---
  let memoriamZone = '';
  if (fallenPCs.length > 0) {
    const entries = fallenPCs.map(pc => {
      const status = statusLabel(pc.frontmatter.status);
      const context = pc.frontmatter.death_context || pc.frontmatter.retirement_context || '';
      const contextHtml = context ? ` <span class="memorial-context">${escapeHtml(context)}</span>` : '';
      return `<a href="${escapeHtml(pc.outputPath)}">${escapeHtml(pc.displayTitle)} (${escapeHtml(status)})</a>${contextHtml}`;
    }).join('\n');
    memoriamZone = `<div class="dashboard-section">
  <h2>In Memoriam</h2>
  <div class="in-memoriam">${entries}</div>
</div>`;
  }

  // --- Zone 5: NPCs in Play (recency-weighted) ---
  const recentNPCs = (publishConfig && publishConfig._recentNPCs) || [];
  let npcZone = '';
  if (recentNPCs.length > 0) {
    const npcTotal = pages.filter(p => p.frontmatter.type === 'npc').length;
    const npcCards = recentNPCs.map(({ page }) => {
      const fm = page.frontmatter;
      const initials = getInitials(page.displayTitle);
      const portraitTag = fm.portrait ? portraitImg(fm, outputPath, imageMap || {}, config.attachmentsDir) : '';
      const iconHtml = portraitTag
        ? `<div class="npc-icon">${portraitTag}</div>`
        : `<div class="npc-icon">${escapeHtml(initials)}</div>`;
      const role = fm.occupation ? `<div class="npc-role">${escapeHtml(plainMetaValue(fm.occupation))}</div>` : '';
      return `<a class="npc-card" href="${escapeHtml(page.outputPath)}">
  ${iconHtml}
  <div><h4>${escapeHtml(page.displayTitle)}</h4>${role}</div>
</a>`;
    }).join('\n');
    npcZone = `<div class="dashboard-section">
  <h2>NPCs in Play</h2>
  <div class="npc-grid">${npcCards}</div>
  <a class="recap-link" href="characters/npcs/index.html">View all ${npcTotal} NPCs &rarr;</a>
</div>`;
  }

  // --- Zone 6: Latest Locations (recency-weighted) ---
  const recentLocations = (publishConfig && publishConfig._recentLocations) || [];
  let locationZone = '';
  if (recentLocations.length > 0) {
    const locCards = recentLocations.map(({ page }) => {
      const fm = page.frontmatter;
      const subtitle = fm.location_type || '';
      return `<a class="entity-card" href="${escapeHtml(page.outputPath)}">
  <h4>${escapeHtml(page.displayTitle)}</h4>
  ${subtitle ? `<div class="card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
</a>`;
    }).join('\n');
    locationZone = `<div class="dashboard-section">
  <h2>Latest Locations</h2>
  <div class="location-grid">${locCards}</div>
</div>`;
  }

  // --- Zone 7: Latest Events ---
  const recentEvents = getRecentEvents(pages, landingConfig.max_events || 4);
  let eventZone = '';
  if (recentEvents.length > 0) {
    const eventCards = recentEvents.map(page => {
      const fm = page.frontmatter;
      const date = formatDate(fm.date) || '';
      const location = fm.location ? String(fm.location).replace(/\[\[|\]\]/g, '').replace(/_/g, ' ') : '';
      const outcome = fm.outcome || '';
      return `<a class="entity-card" href="${escapeHtml(page.outputPath)}">
  <h4>${escapeHtml(page.displayTitle)}</h4>
  ${date ? `<div class="card-subtitle">${escapeHtml(date)}${location ? ' — ' + escapeHtml(location) : ''}</div>` : ''}
  ${outcome ? `<div class="card-excerpt">${escapeHtml(outcome)}</div>` : ''}
</a>`;
    }).join('\n');
    eventZone = `<div class="dashboard-section">
  <h2>Latest Events</h2>
  <div class="card-grid">${eventCards}</div>
</div>`;
  }

  // --- Timeline Strip (between zone 7 and 8) ---
  const timelineStrip = (publishConfig && publishConfig._timelineStrip) || '';
  const timelineZone = timelineStrip
    ? `<div class="dashboard-section">
  <div class="timeline-strip">${timelineStrip}</div>
  <a class="recap-link" href="timeline.html">Full timeline &rarr;</a>
</div>`
    : '';

  // --- Zone 8: Explore the World ---
  const exploreDescs = getExploreDescriptions(genre, landingConfig.explore_descriptions);
  const exploreDirs = [
    { key: 'characters', label: 'Characters', dir: 'characters' },
    { key: 'locations', label: 'Locations', dir: 'locations' },
    { key: 'story', label: 'The Story', dir: 'chapters' },
    { key: 'factions', label: 'Factions', dir: 'factions' },
    { key: 'items', label: 'Items', dir: 'items' },
    { key: 'events', label: 'Events', dir: 'events' },
    { key: 'creatures', label: 'Creatures', dir: 'creatures' },
  ];
  const dirCounts = {};
  for (const page of pages) {
    const d = page.outputDir;
    for (const ed of exploreDirs) {
      if (d === ed.dir || d.startsWith(ed.dir + '/')) {
        dirCounts[ed.key] = (dirCounts[ed.key] || 0) + 1;
      }
    }
  }
  const exploreCards = exploreDirs
    .filter(ed => dirCounts[ed.key] > 0)
    .map(ed => {
      const desc = exploreDescs[ed.key] || '';
      const count = dirCounts[ed.key];
      return `<a class="explore-card" href="${escapeHtml(ed.dir)}/index.html">
  <h4>${escapeHtml(ed.label)}</h4>
  <div class="card-flavour">${escapeHtml(desc)}</div>
  <div class="count">${count} ${count === 1 ? 'entry' : 'entries'}</div>
</a>`;
    }).join('\n');
  const exploreZone = exploreCards
    ? `<div class="dashboard-section">
  <h2>Explore the World</h2>
  <div class="explore-grid">${exploreCards}</div>
</div>`
    : '';

  const content = [heroZone, recapZone, teamZone, memoriamZone, npcZone, locationZone, eventZone, timelineZone, exploreZone]
    .filter(Boolean)
    .join('\n');

  return baseShell({
    title: config.siteTitle,
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath, config),
    rootHref: rootPath(outputPath),
    content,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    scripts: clientScripts(outputPath),
  });
}

module.exports = { landingTemplate, formatDate };
