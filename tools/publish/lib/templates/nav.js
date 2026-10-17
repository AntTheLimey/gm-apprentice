const { TOGGLE_BUTTON, MOBILE_TOGGLE } = require('../color-mode');
const { relativePath, escapeHtml, encodeHref } = require('../processor');
const { DIR_LABELS, colorModeEnabled } = require('./base');

// A link reads as base.js's DIR_LABELS names its folder; `labels` holds only a word the menu
// says differently.
const NAV_GROUPS = [
  {
    name: 'Story',
    dirs: ['chapters', 'sessions', 'events'],
    labels: {},
  },
  {
    name: 'Characters',
    dirs: ['characters/pcs', 'characters/npcs', 'creatures'],
    labels: {},
  },
  {
    name: 'World',
    dirs: ['world', 'heritages', 'locations', 'factions', 'items'],
    labels: { world: 'World Overview' },
  },
  {
    name: 'Reference',
    dirs: ['documents', 'clues', 'campaign'],
    labels: {},
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

  const built = NAV_GROUPS
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
      return { name: group.name, links };
    });

  // The GM's own entries (`player_site.menu_extra`, already resolved by the build) join their group after
  // its own links. A group of the menu with no page of its own is shown when an entry names it; a name that is
  // none of the four makes a group after them. An entry with no group is not a group's: renderTopNav stands it alone.
  const groups = built.slice();
  for (const item of (options.extra || []).filter(x => x.group)) {
    const key = item.group.trim().toLowerCase();
    const at = NAV_GROUPS.findIndex(g => g.name.toLowerCase() === key);
    let target = at >= 0 ? groups[at] : groups.slice(NAV_GROUPS.length).find(g => g.name.toLowerCase() === key);
    if (!target) {
      target = { name: at >= 0 ? NAV_GROUPS[at].name : item.group.trim(), links: [] };
      if (at >= 0) groups[at] = target; else groups.push(target);
    }
    target.links.push({ label: item.label, href: item.href, external: !!item.external });
  }
  return groups.filter(g => g && g.links.length > 0);
}

// One link of the menu: a note's or section's page is made relative to the page that shows it; an outside
// address is left as written and does not hand the new tab to the page that opened it.
function navLink(link, currentDir, before, cls = '') {
  const label = escapeHtml(link.label);
  const attr = cls ? ` class="${cls}"` : '';
  if (link.external) return `${before}<a${attr} href="${escapeHtml(link.href)}" rel="noopener">${label}</a>`;
  // A `?query` or `#fragment` of a GM's address stays as written; only the path is made relative and encoded.
  const cut = link.href.search(/[?#]/);
  const tail = cut < 0 ? '' : escapeHtml(link.href.slice(cut));
  const path = cut < 0 ? link.href : link.href.slice(0, cut);
  return `${before}<a${attr} href="${encodeHref(relativePath(currentDir, path))}${tail}">${label}</a>`;
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
    const linksHtml = links.map(link => navLink(link, currentDir, '        ')).join('\n');

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

  // The GM's entries that name no group stand alone after the groups, the way the Story link does.
  const alone = (options.extra || []).filter(x => !x.group);
  const aloneDesktop = alone.map(link => `${navLink(link, currentDir, '      <div class="nav-group">', 'nav-group-toggle')}</div>`);
  const groupsHtml = [standaloneStory ? standaloneDesktop : '', desktopGroupsHtml, ...aloneDesktop].filter(Boolean).join('\n');

  const rootHref = encodeHref(relativePath(currentDir, 'index.html')) || './index.html';

  const mobileGroupsHtml = groups.map(group => {
    const links = group.links.map(link => `${navLink(link, currentDir, '    <li>')}</li>`).join('\n');
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

  const aloneMobile = alone.length
    ? `  <ul>\n${alone.map(link => `${navLink(link, currentDir, '    <li>')}</li>`).join('\n')}\n  </ul>`
    : '';
  const mobileLinksHtml = [standaloneStory ? standaloneMobile : '', mobileGroupsHtml, aloneMobile].filter(Boolean).join('\n');

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
