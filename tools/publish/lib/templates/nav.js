const { relativePath, escapeHtml } = require('../processor');
const { DIR_LABELS } = require('./base');

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

function generateNavGroups(pages) {
  const populated = new Set();
  for (const page of pages) {
    populated.add(page.outputDir);
  }

  const pcRoster = pages.find(p => p.frontmatter && p.frontmatter.type === 'pc_roster');
  const overrides = { events: 'timeline.html' };
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
  const groups = generateNavGroups(pages);
  const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));

  const hasStoryGroup = groups.some(g => g.name === 'Story');
  const standaloneStory = options.hasStory && !hasStoryGroup;
  const storyHref = relativePath(currentDir, 'story.html');

  const desktopGroupsHtml = groups.map(group => {
    const linksHtml = group.links.map(link => {
      const href = relativePath(currentDir, link.href);
      return `        <a href="${href}">${escapeHtml(link.label)}</a>`;
    }).join('\n');

    const toggle = options.hasStory && group.name === 'Story'
      ? `<a class="nav-group-toggle" href="${relativePath(currentDir, 'story.html')}">${escapeHtml(group.name)}</a>`
      : `<button class="nav-group-toggle">${escapeHtml(group.name)}</button>`;

    return `      <div class="nav-group">
        ${toggle}
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

  const rootHref = relativePath(currentDir, 'index.html') || './index.html';

  const mobileGroupsHtml = groups.map(group => {
    const links = group.links.map(link => {
      const href = relativePath(currentDir, link.href);
      return `    <li><a href="${href}">${escapeHtml(link.label)}</a></li>`;
    }).join('\n');
    return `  <h3>${escapeHtml(group.name)}</h3>\n  <ul>\n${links}\n  </ul>`;
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
  <button class="nav-search-btn" onclick="openSearch()" aria-label="Search">Search <kbd class="search-kbd">⌘K</kbd></button>
  <button class="nav-mobile-toggle" onclick="document.getElementById('mobile-nav').classList.add('open')" aria-label="Menu">&#9776;</button>
</header>
<div id="mobile-nav" class="mobile-nav-overlay">
  <button class="mobile-nav-close" onclick="document.getElementById('mobile-nav').classList.remove('open')" aria-label="Close">&times;</button>
${mobileLinksHtml}
</div>`;
}

function generateNav(pages, options = {}) {
  return function navFor(currentOutputPath, config) {
    return renderTopNav(pages, currentOutputPath, config || { siteTitle: '' }, options);
  };
}

module.exports = { generateNav, generateNavGroups, renderTopNav, NAV_GROUPS };
