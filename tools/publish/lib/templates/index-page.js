const MarkdownIt = require('markdown-it');
const mdRenderer = new MarkdownIt({ html: false, typographer: true });
const { escapeHtml, relativePath, resolveWikiLinks } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts, portraitImg, getCanonStatus } = require('./base');
const { generateBreadcrumbs, renderBreadcrumbs } = require('../breadcrumbs');
const { getInitials } = require('./landing-data');

const GENRE_SECTION_TITLES = {
  military: {
    locations: 'Theater of Operations',
    factions: 'Intelligence Briefing',
    items: 'Armory & Acquisitions',
    creatures: 'Bestiary',
  },
  fantasy: { creatures: 'Bestiary' },
  horror: { creatures: 'Bestiary' },
};

const DEFAULT_SECTION_TITLES = {
  locations: 'Locations',
  factions: 'Factions & Organizations',
  items: 'Items & Artifacts',
  creatures: 'Creatures',
};

function sectionTitle(key, publishConfig) {
  const overrides = (publishConfig && publishConfig.section_titles) || {};
  const genre = (publishConfig && publishConfig._genrePreset) || null;
  const genreTitles = (genre && GENRE_SECTION_TITLES[genre]) || {};
  return overrides[key] || genreTitles[key] || DEFAULT_SECTION_TITLES[key];
}

function relHref(page, indexDir) {
  const out = page.outputPath;
  const prefix = indexDir + '/';
  if (out.startsWith(prefix)) return out.substring(prefix.length);
  return out.split('/').pop();
}

function buildPillFilters(pages, dir) {
  const pills = ['All'];
  if (dir === 'characters' || dir.startsWith('characters')) {
    const types = new Set();
    for (const p of pages) types.add(p.frontmatter.type);
    pills.push(...Array.from(types).sort());
  } else if (dir === 'locations') {
    const types = new Set();
    for (const p of pages) {
      if (p.frontmatter.location_type) types.add(p.frontmatter.location_type);
    }
    pills.push(...Array.from(types).sort());
  } else {
    const types = new Set();
    for (const p of pages) {
      if (p.frontmatter.type) types.add(p.frontmatter.type);
    }
    if (types.size > 1) pills.push(...Array.from(types).sort());
  }
  return pills;
}

function buildLocationTree(pages) {
  const nodes = pages.map(p => ({ page: p, children: [] }));
  const lookup = {};
  for (const n of nodes) lookup[n.page.title] = n;
  for (const n of nodes) {
    if (!(n.page.displayTitle in lookup)) lookup[n.page.displayTitle] = n;
  }
  const roots = [];
  for (const n of nodes) {
    const parentRef = n.page.frontmatter.parent_location;
    if (parentRef) {
      const parentTitle = String(parentRef).replace(/\[\[|\]\]/g, '').trim();
      const parentNode = lookup[parentTitle];
      if (parentNode && parentNode !== n) {
        parentNode.children.push(n);
        continue;
      }
    }
    roots.push(n);
  }
  return roots;
}

function renderLocationTreeHTML(nodes, depth, indexDir) {
  if (nodes.length === 0) return '';
  const items = nodes.slice()
    .sort((a, b) => a.page.displayTitle.localeCompare(b.page.displayTitle))
    .map(node => {
    const p = node.page;
    const childrenHtml = node.children.length > 0
      ? `<div class="location-tree-children">${renderLocationTreeHTML(node.children, depth + 1, indexDir)}</div>`
      : '';
    return `<div class="location-tree-item" style="padding-left:${depth * 1.5}rem">
  <a href="${escapeHtml(relHref(p, indexDir))}">${escapeHtml(p.displayTitle)}</a>
  ${p.frontmatter.location_type ? `<span class="sidebar-badge">${escapeHtml(p.frontmatter.location_type)}</span>` : ''}
</div>${childrenHtml}`;
  }).join('\n');
  return items;
}

function renderLocationsPage(pages, indexDir, imageMap = {}, attachmentsDir = '_attachments') {
  const roots = buildLocationTree(pages);

  // Group ROOT cards: by the (unpublished) parent name if one was
  // declared, else by location_type, else "Other" — same region
  // semantics as before, but only true roots get cards now.
  const byRegion = {};
  for (const node of roots) {
    const p = node.page;
    const parentRef = p.frontmatter.parent_location;
    const locType = String(p.frontmatter.location_type || '').trim();
    const region = parentRef
      ? String(parentRef).replace(/\[\[|\]\]/g, '').trim()
      : (locType || 'Other');
    if (!byRegion[region]) byRegion[region] = [];
    byRegion[region].push(node);
  }

  const regionOrder = Object.keys(byRegion).sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return byRegion[b].length - byRegion[a].length;
  });

  function renderLocationCard(node) {
    const p = node.page;
    const fm = p.frontmatter;
    const locType = fm.location_type || '';
    const firstSeen = fm.first_appearance || fm.createdSession || '';
    const firstSeenClean = String(firstSeen).replace(/\[\[|\]\]/g, '').trim();

    const childrenHtml = node.children.length > 0
      ? `<div class="loc-children">${renderLocationTreeHTML(node.children, 0, indexDir)}</div>`
      : '';

    const thumb = portraitImg(fm, indexDir + '/index.html', imageMap, attachmentsDir);

    return `<div class="loc-card">
  ${thumb ? `<div class="loc-card-thumb">${thumb}</div>` : ''}
  <div class="loc-card-main">
    <h3><a href="${escapeHtml(relHref(p, indexDir))}">${escapeHtml(p.displayTitle)}</a></h3>
    <div class="loc-card-meta">
      ${locType ? `<span class="loc-type-badge">${escapeHtml(locType)}</span>` : ''}
      ${firstSeenClean ? `<span class="loc-first-seen">${escapeHtml(firstSeenClean)}</span>` : ''}
    </div>
  </div>
  ${childrenHtml}
</div>`;
  }

  const sections = regionOrder.map(region => {
    const cards = byRegion[region]
      .sort((a, b) => a.page.displayTitle.localeCompare(b.page.displayTitle))
      .map(node => renderLocationCard(node))
      .join('\n');

    return `<section class="loc-region">
  <h2 class="loc-region-title">${escapeHtml(region)}</h2>
  <div class="loc-region-grid">${cards}</div>
</section>`;
  }).join('\n');

  return `<div class="locations-page">${sections}</div>`;
}

function renderChapterList(pages, indexDir) {
  const chapters = pages
    .filter(p => p.frontmatter.type === 'chapter')
    .sort((a, b) => (a.frontmatter.sort_order || 0) - (b.frontmatter.sort_order || 0));

  const sessions = pages
    .filter(p => p.frontmatter.type === 'session')
    .sort((a, b) => (a.frontmatter.session_number || 0) - (b.frontmatter.session_number || 0));

  if (chapters.length === 0 && sessions.length === 0) return '';

  function sessionsForChapter(chapter) {
    const chTitle = chapter.displayTitle.toLowerCase();
    const chFolder = chapter.outputPath.split('/').slice(0, -1).join('/');
    return sessions.filter(s => {
      const ref = String(s.frontmatter.chapter || '').replace(/\[\[|\]\]/g, '').toLowerCase();
      if (ref && chTitle.includes(ref.replace(/^chapter \d+\s*[-–—]\s*/i, '').trim().toLowerCase())) return true;
      if (ref && ref.includes(chapter.frontmatter.title ? chapter.frontmatter.title.toLowerCase() : '___')) return true;
      if (s.outputPath.startsWith(chFolder + '/')) return true;
      return false;
    });
  }

  function statusBadge(chapter, chSessions) {
    const allPlayed = chSessions.length > 0 && chSessions.every(s => s.frontmatter.status === 'played' || s.frontmatter.status === 'reviewed');
    const anyPlayed = chSessions.some(s => s.frontmatter.status === 'played' || s.frontmatter.status === 'reviewed');
    if (allPlayed) return '<span class="chapter-status chapter-complete">Complete</span>';
    if (anyPlayed) return '<span class="chapter-status chapter-active">In Progress</span>';
    const chStatus = String(chapter.frontmatter.status || '').toLowerCase();
    if (chStatus === 'complete' || chStatus === 'completed') return '<span class="chapter-status chapter-complete">Complete</span>';
    if (chStatus === 'active' || chStatus === 'in-progress' || chStatus === 'in_progress') return '<span class="chapter-status chapter-active">In Progress</span>';
    return '<span class="chapter-status chapter-upcoming">Upcoming</span>';
  }

  const chapterCards = chapters.map((ch, i) => {
    const num = ch.frontmatter.sort_order || i + 1;
    const title = ch.frontmatter.title || ch.displayTitle.replace(/^Chapter \d+\s*[-–—]\s*/i, '');
    const overview = ch.frontmatter.overview || '';
    const chSessions = sessionsForChapter(ch);
    const badge = statusBadge(ch, chSessions);

    const sessionItems = chSessions.map(s => {
      const sNum = s.frontmatter.session_number || '';
      const sTitle = s.displayTitle.replace(/^Session \d+\s*[-–—]\s*/i, '');
      const played = s.frontmatter.status === 'played' || s.frontmatter.status === 'reviewed';
      const statusIcon = played ? '&#10003;' : '&#9702;';
      const statusClass = played ? 'session-played' : 'session-pending';
      return `<li class="${statusClass}">
  <span class="session-icon">${statusIcon}</span>
  <a href="${escapeHtml(relHref(s, indexDir))}">${escapeHtml(`Session ${sNum}`)}${sTitle ? ` — ${escapeHtml(sTitle)}` : ''}</a>
</li>`;
    }).join('\n');

    const sessionList = sessionItems
      ? `<ol class="chapter-sessions">${sessionItems}</ol>`
      : '';

    return `<article class="chapter-card">
  <div class="chapter-card-header">
    <span class="chapter-number">${escapeHtml(String(num))}</span>
    <div class="chapter-card-title">
      <h2><a href="${escapeHtml(relHref(ch, indexDir))}">${escapeHtml(title)}</a></h2>
      ${badge}
    </div>
  </div>
  ${overview ? `<p class="chapter-overview">${escapeHtml(overview)}</p>` : ''}
  ${sessionList}
</article>`;
  }).join('\n');

  const orphanSessions = sessions.filter(s => {
    return !chapters.some(ch => sessionsForChapter(ch).includes(s));
  });
  let orphanHtml = '';
  if (orphanSessions.length > 0) {
    const items = orphanSessions.map(s => {
      const sNum = s.frontmatter.session_number || '';
      const sTitle = s.displayTitle.replace(/^Session \d+\s*[-–—]\s*/i, '');
      return `<li><a href="${escapeHtml(relHref(s, indexDir))}">${escapeHtml(`Session ${sNum}`)}${sTitle ? ` — ${escapeHtml(sTitle)}` : ''}</a></li>`;
    }).join('\n');
    orphanHtml = `<div class="chapter-card"><h3>Other Sessions</h3><ul>${items}</ul></div>`;
  }

  return `<div class="story-progression">${chapterCards}\n${orphanHtml}</div>`;
}

function renderBestiary(pages, indexDir) {
  const creatures = pages
    .filter(p => p.frontmatter.type === 'creature')
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  if (creatures.length === 0) return '<p class="text-muted">No creatures encountered yet.</p>';

  function threatLevel(fm) {
    const abilities = fm.abilities || [];
    if (abilities.length >= 5) return { label: 'EXTREME', cls: 'threat-extreme' };
    if (abilities.length >= 3) return { label: 'HIGH', cls: 'threat-high' };
    if (abilities.length >= 1) return { label: 'MODERATE', cls: 'threat-moderate' };
    return { label: 'UNKNOWN', cls: 'threat-unknown' };
  }

  function creatureStatus(fm) {
    const s = (fm.status || '').toLowerCase();
    if (s === 'dead' || s === 'killed' || s === 'destroyed') return { label: 'KILLED', cls: 'creature-killed' };
    if (s === 'alive' || s === 'active') return { label: 'ACTIVE', cls: 'creature-active' };
    return { label: 'UNKNOWN', cls: 'creature-unknown' };
  }

  const cards = creatures.map(p => {
    const fm = p.frontmatter;
    const threat = threatLevel(fm);
    const status = creatureStatus(fm);
    const creatureType = fm.creature_type || fm.subtype || '';
    const location = fm.location ? String(fm.location).replace(/\[\[|\]\]/g, '').trim() : '';
    const firstSeen = fm.first_appearance ? String(fm.first_appearance).replace(/\[\[|\]\]/g, '').trim() : '';

    const abilities = (fm.abilities || []).map(a =>
      `<span class="bestiary-ability">${escapeHtml(a)}</span>`
    ).join('\n');

    const weaknesses = (fm.weaknesses || []).map(w =>
      `<span class="bestiary-weakness">${escapeHtml(w)}</span>`
    ).join('\n');

    const metaItems = [];
    if (creatureType) metaItems.push(`<span class="bestiary-meta-item"><span class="label">Type</span> ${escapeHtml(creatureType)}</span>`);
    if (location) metaItems.push(`<span class="bestiary-meta-item"><span class="label">Location</span> ${escapeHtml(location)}</span>`);
    if (firstSeen) metaItems.push(`<span class="bestiary-meta-item"><span class="label">First Encountered</span> ${escapeHtml(firstSeen)}</span>`);

    return `<article class="bestiary-card">
  <div class="bestiary-header">
    <div class="bestiary-title-row">
      <h2><a href="${escapeHtml(relHref(p, indexDir))}">${escapeHtml(p.displayTitle)}</a></h2>
      <div class="bestiary-badges">
        <span class="threat-badge ${threat.cls}">Threat: ${threat.label}</span>
        <span class="creature-status-badge ${status.cls}">Status: ${status.label}</span>
      </div>
    </div>
    ${metaItems.length ? `<div class="bestiary-meta">${metaItems.join('\n')}</div>` : ''}
  </div>
  ${abilities ? `<div class="bestiary-section"><span class="bestiary-section-label">Abilities</span><div class="bestiary-pills">${abilities}</div></div>` : ''}
  ${weaknesses ? `<div class="bestiary-section"><span class="bestiary-section-label">Weaknesses</span><div class="bestiary-pills bestiary-pills-weak">${weaknesses}</div></div>` : ''}
</article>`;
  }).join('\n');

  return `<div class="bestiary">${cards}</div>`;
}

function renderFactions(pages, indexDir, imageMap = {}, attachmentsDir = '_attachments') {
  const factions = pages
    .filter(p => p.frontmatter.type === 'faction' || p.frontmatter.type === 'organization')
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  if (factions.length === 0) return '<p class="text-muted">No factions or organizations documented yet.</p>';

  const TYPE_LABELS = {
    military: 'Military Units',
    corporation: 'Corporations',
    government: 'Government Agencies',
  };

  const byType = {};
  for (const p of factions) {
    const ft = String(p.frontmatter.faction_type || p.frontmatter.factionType || 'other').toLowerCase();
    if (!byType[ft]) byType[ft] = [];
    byType[ft].push(p);
  }

  const typeOrder = ['military', 'corporation', 'government'];
  const remaining = Object.keys(byType).filter(t => !typeOrder.includes(t)).sort();
  const orderedTypes = [...typeOrder.filter(t => byType[t]), ...remaining];

  function typeBadgeClass(ft) {
    if (ft === 'military') return 'intel-type-military';
    if (ft === 'corporation') return 'intel-type-corporation';
    if (ft === 'government') return 'intel-type-government';
    return 'intel-type-other';
  }

  function renderCard(p) {
    const fm = p.frontmatter;
    const ft = String(fm.faction_type || fm.factionType || 'other').toLowerCase();
    const leadership = fm.leadership ? String(fm.leadership).replace(/\[\[|\]\]/g, '').trim() : '';
    const goals = Array.isArray(fm.goals) ? fm.goals.slice(0, 3) : [];
    const relationships = Array.isArray(fm.relationships) ? fm.relationships.slice(0, 4) : [];
    const canon = getCanonStatus(fm) || '';

    const leaderHtml = leadership
      ? `<div class="intel-leadership">Led by <strong>${escapeHtml(leadership)}</strong></div>`
      : '';

    const goalsHtml = goals.length > 0
      ? `<ul class="intel-goals">${goals.map(g => `<li>${escapeHtml(g)}</li>`).join('\n')}</ul>`
      : '';

    const connsHtml = relationships.length > 0
      ? `<div class="intel-connections">${relationships.map(r => {
          const target = String(r.target || '').replace(/\[\[|\]\]/g, '').trim();
          const relType = String(r.type || '').replace(/_/g, ' ');
          return `<span class="intel-conn"><span class="intel-conn-type">${escapeHtml(relType)}</span>${escapeHtml(target)}</span>`;
        }).join('\n')}</div>`
      : '';

    const canonHtml = canon
      ? `<span class="intel-canon-badge">${escapeHtml(canon)}</span>`
      : '';

    const thumb = portraitImg(fm, indexDir + '/index.html', imageMap, attachmentsDir);

    return `<article class="intel-card">
  <div class="intel-card-header">
    ${thumb ? `<div class="intel-card-thumb">${thumb}</div>` : ''}
    <h2><a href="${escapeHtml(relHref(p, indexDir))}">${escapeHtml(p.displayTitle)}</a></h2>
    <span class="intel-type-badge ${typeBadgeClass(ft)}">${escapeHtml(ft)}</span>
  </div>
  ${leaderHtml}
  ${goalsHtml}
  ${connsHtml}
  ${canonHtml}
</article>`;
  }

  const sections = orderedTypes.map(ft => {
    const label = TYPE_LABELS[ft] || (ft.charAt(0).toUpperCase() + ft.slice(1));
    const cards = byType[ft].map(renderCard).join('\n');
    return `<section class="intel-section">
  <h2 class="intel-section-title">${escapeHtml(label)}</h2>
  <div class="intel-section-grid">${cards}</div>
</section>`;
  }).join('\n');

  return `<div class="intel-briefing">${sections}</div>`;
}

function extractMdSections(markdown) {
  const sections = {};
  const lines = markdown.split('\n');
  let current = null;
  let buf = [];
  for (const line of lines) {
    const m = line.match(/^## (.+)/);
    if (m) {
      if (current) sections[current] = buf.join('\n').trim();
      current = m[1].trim();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections[current] = buf.join('\n').trim();
  return sections;
}

function renderCampaignDeepDive(pages, indexDir, publishConfig) {
  const overview = pages.find(p => p.frontmatter.type === 'campaign_overview');
  if (!overview) return '<p class="text-muted">No campaign overview found.</p>';

  const fm = overview.frontmatter;
  const rawSections = extractMdSections(overview.markdown);
  const linkMap = (publishConfig && publishConfig._linkMap) || {};
  const outputPath = indexDir + '/index.html';

  const sections = {};
  for (const [key, md] of Object.entries(rawSections)) {
    sections[key] = resolveWikiLinks(md, linkMap, outputPath);
  }

  const system = fm.game_system || '';
  const year = fm.setting_year || '';
  const points = fm.point_total || '';
  const gameDate = fm.current_game_date || '';
  const lastPlayed = fm.last_play_date || '';
  const genres = Array.isArray(fm.genre_tags) ? fm.genre_tags : [];

  const paramCards = [];
  if (system) paramCards.push(`<div class="cdd-param"><span class="cdd-param-label">System</span><span class="cdd-param-value">${escapeHtml(String(system))}</span></div>`);
  if (year) paramCards.push(`<div class="cdd-param"><span class="cdd-param-label">Setting Year</span><span class="cdd-param-value">${escapeHtml(String(year))}</span></div>`);
  if (gameDate) paramCards.push(`<div class="cdd-param"><span class="cdd-param-label">Game Date</span><span class="cdd-param-value">${escapeHtml(String(gameDate))}</span></div>`);
  if (points) paramCards.push(`<div class="cdd-param"><span class="cdd-param-label">Point Total</span><span class="cdd-param-value">${escapeHtml(String(points))}</span></div>`);
  if (lastPlayed) paramCards.push(`<div class="cdd-param"><span class="cdd-param-label">Last Played</span><span class="cdd-param-value">${escapeHtml(String(lastPlayed))}</span></div>`);

  const arcsPlanned = parseInt(fm.arcs_planned, 10) || 0;
  if (fm.current_arc) {
    const arcValue = arcsPlanned > 0
      ? `${escapeHtml(String(fm.current_arc))} (of ${arcsPlanned})`
      : escapeHtml(String(fm.current_arc));
    paramCards.push(`<div class="cdd-param"><span class="cdd-param-label">Current Arc</span><span class="cdd-param-value">${arcValue}</span></div>`);
  }

  const paramsHtml = paramCards.length > 0
    ? `<div class="cdd-params">${paramCards.join('\n')}</div>`
    : '';

  const genreHtml = genres.length > 0
    ? `<div class="cdd-genres">${genres.map(g => `<span class="cdd-genre">${escapeHtml(g)}</span>`).join('\n')}</div>`
    : '';

  const premiseMd = sections['Premise'] || '';
  const premiseHtml = premiseMd
    ? `<section class="cdd-section"><h2 class="cdd-section-title">Premise</h2><div class="cdd-prose">${mdRenderer.render(premiseMd)}</div></section>`
    : '';

  const settingMd = sections['Setting'] || '';
  const settingHtml = settingMd
    ? `<section class="cdd-section"><h2 class="cdd-section-title">Setting</h2><div class="cdd-prose">${mdRenderer.render(settingMd)}</div></section>`
    : '';

  const themesMd = sections['Key Themes'] || '';
  const themesHtml = themesMd
    ? `<section class="cdd-section"><h2 class="cdd-section-title">Key Themes</h2><div class="cdd-themes">${mdRenderer.render(themesMd)}</div></section>`
    : '';

  const factionsMd = sections['Key Factions'] || '';
  const factionsHtml = factionsMd
    ? `<section class="cdd-section"><h2 class="cdd-section-title">Key Factions</h2><div class="cdd-prose">${mdRenderer.render(factionsMd)}</div></section>`
    : '';

  const overviewHref = relHref(overview, indexDir);

  return `<div class="campaign-deep-dive">
  <div class="cdd-hero">
    ${paramsHtml}
    ${genreHtml}
  </div>
  ${premiseHtml}
  ${settingHtml}
  ${themesHtml}
  ${factionsHtml}
  <div class="cdd-full-link"><a href="${escapeHtml(overviewHref)}">Read full campaign overview &rarr;</a></div>
</div>`;
}

function renderArmory(pages, indexDir) {
  const items = pages
    .filter(p => p.frontmatter.type === 'item')
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  if (items.length === 0) return '<p class="text-muted">No items catalogued yet.</p>';

  const TYPE_LABELS = {
    weapon: 'Weapons',
    armor: 'Armor & Protection',
    artifact: 'Artifacts',
    artefact: 'Artifacts',
    device: 'Devices',
    'alien material': 'Alien Materials',
  };

  const byType = {};
  for (const p of items) {
    const raw = (p.frontmatter.item_type || p.frontmatter.itemType || '').toLowerCase();
    const key = raw || 'other';
    const normalized = (key === 'artefact') ? 'artifact' : key;
    if (!byType[normalized]) byType[normalized] = [];
    byType[normalized].push(p);
  }

  const typeOrder = ['weapon', 'armor', 'artifact', 'device', 'alien material'];
  const remaining = Object.keys(byType).filter(t => !typeOrder.includes(t)).sort();
  const orderedTypes = [...typeOrder.filter(t => byType[t]), ...remaining];

  function renderItem(p) {
    const fm = p.frontmatter;
    const itemType = (fm.item_type || fm.itemType || '').replace(/^\w/, c => c.toUpperCase());
    const holder = fm.current_holder ? String(fm.current_holder).replace(/\[\[|\]\]/g, '').trim() : '';
    const origin = fm.origin ? String(fm.origin).replace(/\[\[|\]\]/g, '').trim() : '';
    const tl = fm.tl ? String(fm.tl) : '';
    const canonStatus = (getCanonStatus(fm) || '').toUpperCase();
    const isDraft = canonStatus === 'DRAFT' || canonStatus === 'STUB';

    const metaParts = [];
    if (holder) metaParts.push(`<span><span class="armory-meta-label">Holder:</span> ${escapeHtml(holder)}</span>`);
    if (origin) metaParts.push(`<span><span class="armory-meta-label">Origin:</span> ${escapeHtml(origin)}</span>`);
    if (tl) metaParts.push(`<span class="armory-tl">TL${escapeHtml(tl)}</span>`);

    return `<div class="armory-item${isDraft ? ' armory-item-draft' : ''}">
  <span class="armory-item-name"><a href="${escapeHtml(relHref(p, indexDir))}">${escapeHtml(p.displayTitle)}</a></span>
  ${itemType ? `<span class="armory-item-type">${escapeHtml(itemType)}</span>` : ''}
  ${metaParts.length ? `<span class="armory-item-meta">${metaParts.join('\n')}</span>` : ''}
</div>`;
  }

  const sections = orderedTypes.map(type => {
    const label = TYPE_LABELS[type] || (type.charAt(0).toUpperCase() + type.slice(1));
    const itemsHtml = byType[type].map(renderItem).join('\n');
    return `<section class="armory-section">
  <h2 class="armory-section-title">${escapeHtml(label)}</h2>
  <div class="armory-list">${itemsHtml}</div>
</section>`;
  }).join('\n');

  return `<div class="armory">${sections}</div>`;
}

function cleanRef(str) {
  return String(str || '').replace(/\[\[|\]\]/g, '').replace(/_/g, ' ').trim();
}

function sessionSortKey(str) {
  const m = String(str || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function renderNPCTable(pages, dir, imageMap = {}, attachmentsDir = '_attachments') {
  const sorted = pages
    .filter(p => p.frontmatter.type === 'npc')
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  if (sorted.length === 0) return '';

  const statusPills = new Set();
  const sessionPills = new Set();
  for (const p of sorted) {
    if (p.frontmatter.status) statusPills.add(p.frontmatter.status);
    const session = cleanRef(p.frontmatter.asOfSession || p.frontmatter.lastUpdated || '');
    if (session) sessionPills.add(session);
  }

  const statusFilters = Array.from(statusPills).sort();
  const sessionFilters = Array.from(sessionPills).sort((a, b) => sessionSortKey(a) - sessionSortKey(b));

  let filterHtml = '<div class="npc-table-filters">';
  if (statusFilters.length > 1) {
    filterHtml += `<select class="npc-filter" data-col="status" aria-label="Filter by status">
  <option value="">All Statuses</option>
  ${statusFilters.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s.charAt(0).toUpperCase() + s.slice(1))}</option>`).join('\n')}
</select>`;
  }
  if (sessionFilters.length > 1) {
    filterHtml += `<select class="npc-filter" data-col="session" aria-label="Filter by session">
  <option value="">All Sessions</option>
  ${sessionFilters.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('\n')}
</select>`;
  }
  filterHtml += '</div>';

  const rows = sorted.map(p => {
    const fm = p.frontmatter;
    const occupation = fm.occupation || '';
    const status = fm.status || '';
    const firstApp = cleanRef(fm.first_appearance || '');
    const lastSession = cleanRef(fm.asOfSession || fm.lastUpdated || '');
    const canonStatus = getCanonStatus(fm) || '';
    const avatar = portraitImg(fm, dir + '/index.html', imageMap, attachmentsDir);
    const avatarHtml = avatar
      ? `<span class="npc-row-avatar">${avatar}</span>`
      : `<span class="npc-row-avatar npc-row-initials" aria-hidden="true">${escapeHtml(getInitials(p.displayTitle))}</span>`;

    return `<tr data-entity-type="npc" data-entity-name="${escapeHtml(p.displayTitle)}" data-entity-status="${escapeHtml(status)}" data-session="${escapeHtml(lastSession)}">
  <td data-sort="${escapeHtml(p.displayTitle.toLowerCase())}"><a class="npc-row-link" href="${escapeHtml(relHref(p, dir))}">${avatarHtml}${escapeHtml(p.displayTitle)}</a></td>
  <td>${escapeHtml(occupation)}</td>
  <td><span class="status-badge status-${escapeHtml(status.replace(/\s+/g, '-').toLowerCase())}">${escapeHtml(status ? status.charAt(0).toUpperCase() + status.slice(1) : '')}</span></td>
  <td>${escapeHtml(firstApp)}</td>
  <td data-sort="${sessionSortKey(lastSession)}">${escapeHtml(lastSession)}</td>
  <td><span class="sidebar-badge">${escapeHtml(canonStatus)}</span></td>
</tr>`;
  }).join('\n');

  return `${filterHtml}
<div class="npc-table-wrap">
<table class="npc-table sortable-table">
<thead>
<tr>
  <th data-sort-col="name" class="sort-active sort-asc">Name</th>
  <th data-sort-col="occupation">Role</th>
  <th data-sort-col="status">Status</th>
  <th data-sort-col="first">First Appearance</th>
  <th data-sort-col="session">Last Updated</th>
  <th data-sort-col="canon">Canon Status</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

function indexTemplate(dir, label, pages, navFor, config, publishConfig, imageMap = {}) {
  const outputPath = dir + '/index.html';
  const attachmentsDir = config.attachmentsDir || '_attachments';
  const crumbs = generateBreadcrumbs(outputPath, {});
  const breadcrumbsHtml = renderBreadcrumbs(crumbs);
  const total = pages.length;
  const isChapters = dir === 'chapters';
  const isLocations = dir === 'locations';
  const isNPCs = dir === 'characters/npcs';
  const isCharacters = dir === 'characters' || dir.startsWith('characters');

  const pills = buildPillFilters(pages, dir);
  const pillsHtml = (pills.length > 1 && !isNPCs)
    ? `<div class="pill-filters">${pills.map((p, i) => {
        const filterVal = p === 'All' ? 'all' : p;
        const active = i === 0 ? ' active' : '';
        return `<button class="pill-filter${active}" data-filter="${escapeHtml(filterVal)}">${escapeHtml(p === 'All' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1))}</button>`;
      }).join('\n')}</div>`
    : '';

  const nameFilterHtml = `<input class="name-filter" type="text" placeholder="Filter by name..." aria-label="Filter by name">`;
  const sortHtml = isNPCs ? '' : `<select class="sort-control" aria-label="Sort by">
  <option value="name">Sort: Name</option>
  <option value="type">Sort: Type</option>
  <option value="status">Sort: Status</option>
</select>`;

  const isCreatures = dir === 'creatures';
  const isFactions = dir === 'factions';
  const isItems = dir === 'items';
  const isCampaign = dir === 'campaign';

  let bodyContent;
  if (isNPCs) {
    bodyContent = renderNPCTable(pages, dir, imageMap, attachmentsDir);
  } else if (isChapters) {
    bodyContent = renderChapterList(pages, dir);
  } else if (isCreatures) {
    bodyContent = renderBestiary(pages, dir);
  } else if (isLocations) {
    bodyContent = renderLocationsPage(pages, dir, imageMap, attachmentsDir);
  } else if (isFactions) {
    bodyContent = renderFactions(pages, dir, imageMap, attachmentsDir);
  } else if (isItems) {
    bodyContent = renderArmory(pages, dir);
  } else if (isCampaign && pages.some(p => p.frontmatter.type === 'campaign_overview')) {
    // Only render the overview deep-dive (which surfaces the overview's prose) when the overview
    // is actually published. In player mode the overview is excluded as a spoiler doc, so fall
    // through to the normal card index of the published _Campaign pages rather than showing
    // "No campaign overview found".
    bodyContent = renderCampaignDeepDive(pages, dir, publishConfig);
  } else {
    const cardItems = pages.map(p => {
      const fm = p.frontmatter;
      const entityType = isLocations ? (fm.location_type || fm.type) : fm.type;
      const avatarShape = (fm.type === 'pc') ? 'border-radius:0.375rem' : 'border-radius:50%';
      const cardImg = portraitImg(fm, outputPath, imageMap, attachmentsDir);
      const portraitHtml = isCharacters && cardImg
        ? `<div class="npc-icon" style="${avatarShape}">${cardImg}</div>`
        : '';
      const subtitle = fm.occupation || fm.location_type || fm.faction_type || fm.factionType || '';
      return `<a class="entity-card" href="${escapeHtml(relHref(p, dir))}"
  data-entity-type="${escapeHtml(entityType || '')}"
  data-entity-name="${escapeHtml(p.displayTitle)}"
  data-entity-status="${escapeHtml(fm.status || '')}">
  ${portraitHtml}
  <h4>${escapeHtml(p.displayTitle)}</h4>
  ${subtitle ? `<div class="card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
</a>`;
    }).join('\n');
    bodyContent = `<div class="card-grid">${cardItems}</div>`;
  }

  let locationTreeHtml = '';

  let content;
  if (isChapters) {
    content = `
<div class="index-header">
  <h1 class="page-title">Story</h1>
</div>
${bodyContent}`;
  } else if (isCreatures) {
    content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(sectionTitle('creatures', publishConfig))}</h1>
  <span class="index-count">${total} creature${total !== 1 ? 's' : ''} encountered</span>
</div>
${bodyContent}`;
  } else if (isLocations) {
    content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(sectionTitle('locations', publishConfig))}</h1>
  <span class="index-count">${total} locations</span>
</div>
${bodyContent}`;
  } else if (isFactions) {
    content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(sectionTitle('factions', publishConfig))}</h1>
  <span class="index-count">${total} organizations</span>
</div>
${bodyContent}`;
  } else if (isItems) {
    content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(sectionTitle('items', publishConfig))}</h1>
  <span class="index-count">${total} items catalogued</span>
</div>
${bodyContent}`;
  } else if (isCampaign) {
    const overview = pages.find(p => p.frontmatter.type === 'campaign_overview');
    const campaignName = (overview && overview.frontmatter.campaign) || config.siteTitle || 'Campaign';
    content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(campaignName)}</h1>
</div>
${bodyContent}`;
  } else {
    content = `
<div class="index-header">
  <h1 class="page-title">${escapeHtml(label)}</h1>
  <span class="index-count">Showing ${total} of ${total}</span>
  ${sortHtml}
</div>
${pillsHtml}
${nameFilterHtml}
${locationTreeHtml}
${bodyContent}`;
  }

  return baseShell({
    title: label,
    siteTitle: config.siteTitle,
    cssHref: cssPath(outputPath),
    navHtml: navFor(outputPath, config),
    rootHref: rootPath(outputPath),
    content,
    footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    breadcrumbsHtml,
    scripts: [...clientScripts(outputPath), rootPath(outputPath) + 'js/filters.js'],
  });
}

module.exports = { indexTemplate, buildPillFilters, buildLocationTree, renderLocationsPage };
