const { TOGGLE_BUTTON, MOBILE_TOGGLE } = require('../color-mode');
const { relativePath, escapeHtml, encodeHref } = require('../processor');
const { DIR_LABELS, colorModeEnabled } = require('./base');

const NAV_GROUPS = [
  {
    name: 'Story',
    dirs: ['chapters', 'sessions', 'events'],
    labels: { chapters: 'Story', sessions: 'Sessions', events: 'Events' },
  },
  {
    name: 'Characters',
    dirs: ['characters/pcs', 'characters/npcs', 'creatures'],
    labels: { 'characters/pcs': 'Player Characters', 'characters/npcs': 'NPCs', creatures: 'Creatures' },
  },
  {
    name: 'World',
    dirs: ['world', 'heritages', 'locations', 'factions', 'items'],
    labels: { world: 'World Overview', heritages: 'Heritages', locations: 'Locations', factions: 'Factions & Organizations', items: 'Items & Artifacts' },
  },
  {
    name: 'Reference',
    dirs: ['documents', 'clues', 'campaign'],
    labels: { documents: 'Documents', clues: 'Clues', campaign: 'Campaign' },
  },
];

// `pc_roster` is the name; `player-characters` is an older one still found in vaults.
const ROSTER_TYPES = new Set(['pc_roster', 'player-characters']);
const isRoster = (page) => !!page.frontmatter && ROSTER_TYPES.has(page.frontmatter.type);

function generateNavGroups(pages, options = {}) {
  const populated = new Set();
  for (const page of pages) {
    populated.add(page.outputDir);
  }

  const pcRoster = pages.find(isRoster);
  // Only aim the Events link at the timeline when a timeline page is actually written, and
  // at wherever it is written. The timeline is generated at the root only when dated events
  // exist; otherwise it may be an authored page under its own folder — or absent, in which
  // case Events falls through to its own index.
  const overrides = {};
  if (options.timelineHref) overrides.events = options.timelineHref;
  if (pcRoster) overrides['characters/pcs'] = pcRoster.outputPath;

  return NAV_GROUPS
    .map(group => {
      const links = group.dirs
        .filter(dir => {
          for (const pop of populated) {
            if (pop === dir || pop.startsWith(dir + '/')) return true;
          }
          return false;
        })
        .map(dir => ({
          label: group.labels[dir] || DIR_LABELS[dir] || dir,
          href: overrides[dir] || (dir + '/index.html'),
        }));
      if (links.length === 0) return null;
      return { name: group.name, links };
    })
    .filter(Boolean);
}

function renderTopNav(pages, currentOutputPath, config, options = {}) {
  const groups = generateNavGroups(pages, options);
  const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));

  const hasStoryGroup = groups.some(g => g.name === 'Story');
  const standaloneStory = options.hasStory && !hasStoryGroup;
  const storyHref = encodeHref(relativePath(currentDir, 'story.html'));

  const desktopGroupsHtml = groups.map(group => {
    // The Story landing is the menu's first entry. The toggle stays a button: as a link
    // it loaded the landing on the click that opened the menu, so the menu never stayed open.
    const links = options.hasStory && group.name === 'Story'
      ? [{ label: 'Story so far', href: 'story.html' }, ...group.links]
      : group.links;
    const linksHtml = links.map(link => {
      const href = encodeHref(relativePath(currentDir, link.href));
      return `        <a href="${href}">${escapeHtml(link.label)}</a>`;
    }).join('\n');

    return `      <div class="nav-group">
        <button class="nav-group-toggle">${escapeHtml(group.name)}</button>
        <div class="nav-dropdown">
${linksHtml}
        </div>
      </div>`;
  }).join('\n');

  const standaloneDesktop = standaloneStory
    ? `      <div class="nav-group"><a class="nav-group-toggle" href="${storyHref}">Story</a></div>`
    : '';

  const groupsHtml = standaloneStory
    ? [standaloneDesktop, desktopGroupsHtml].filter(Boolean).join('\n')
    : desktopGroupsHtml;

  const rootHref = encodeHref(relativePath(currentDir, 'index.html')) || './index.html';

  const mobileGroupsHtml = groups.map(group => {
    const links = group.links.map(link => {
      const href = encodeHref(relativePath(currentDir, link.href));
      return `    <li><a href="${href}">${escapeHtml(link.label)}</a></li>`;
    }).join('\n');
    // When a Story section exists, the Story heading links to the landing (desktop reaches
    // it from the menu's first entry; a mobile heading opens nothing, so it can be the link).
    const heading = options.hasStory && group.name === 'Story'
      ? `<h3><a href="${storyHref}">${escapeHtml(group.name)}</a></h3>`
      : `<h3>${escapeHtml(group.name)}</h3>`;
    return `  ${heading}\n  <ul>\n${links}\n  </ul>`;
  }).join('\n');

  // Reuse the shared `.mobile-nav-overlay li a` structure (display:block, 44px tap target)
  // rather than a bespoke class with no stylesheet rule.
  const standaloneMobile = standaloneStory
    ? `  <ul>\n    <li><a href="${storyHref}">Story</a></li>\n  </ul>`
    : '';

  const mobileLinksHtml = standaloneStory
    ? [standaloneMobile, mobileGroupsHtml].filter(Boolean).join('\n')
    : mobileGroupsHtml;

  return `<header class="top-nav">
  <a href="${rootHref}" class="nav-brand">${escapeHtml(config.siteTitle)}</a>
  <nav class="nav-groups">
${groupsHtml}
  </nav>
  <button class="nav-search-btn" onclick="openSearch()" aria-label="Search" aria-haspopup="dialog" aria-expanded="false">Search <kbd class="search-kbd">⌘K</kbd></button>
  ${colorModeEnabled() ? TOGGLE_BUTTON : ''}
  <button class="nav-search-icon-btn" onclick="openSearch()" aria-label="Search" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg></button>
  <button class="nav-mobile-toggle" onclick="document.getElementById('mobile-nav').classList.add('open')" aria-label="Menu">&#9776;</button>
</header>
<div id="mobile-nav" class="mobile-nav-overlay">
  <button class="mobile-nav-close" onclick="document.getElementById('mobile-nav').classList.remove('open')" aria-label="Close">&times;</button>
${mobileLinksHtml}
  ${colorModeEnabled() ? MOBILE_TOGGLE : ''}
</div>`;
}

function generateNav(pages, options = {}) {
  return function navFor(currentOutputPath, config) {
    return renderTopNav(pages, currentOutputPath, config || { siteTitle: '' }, options);
  };
}

module.exports = { generateNav, generateNavGroups, renderTopNav, NAV_GROUPS, isRoster };
