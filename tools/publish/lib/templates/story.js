const { escapeHtml, relativeHref, encodeHref, renderInline } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');
const { linkSessions } = require('../story-sessions');
const { prologueHtml } = require('./prologue');

function storyNav(unit) {
  const prev = unit.prevHref
    ? `<a href="${encodeHref(relativeHref(unit.outputPath, unit.prevHref))}">&larr; Previous</a>` : '<span></span>';
  const next = unit.nextHref
    ? `<a href="${encodeHref(relativeHref(unit.outputPath, unit.nextHref))}">Next &rarr;</a>` : '<span></span>';
  return `<div class="story-nav">${prev}${next}</div>`;
}

// A wrap-up section on the Story page, after the recap: its heading as written (links and all), then its body.
function sectionHtml(s) {
  return `<section class="story-section"><h2 id="${escapeHtml(s.id)}">${renderInline(s.title)}</h2>${s.html}</section>`;
}

// The story (the recap, then the wrap-up's other sections in written order), Previous/Next, then the moments' cards
// and, on the GM site, what goes after them.
function storyPage(unit, config, publishConfig, navFor) {
  const content = `
    ${storyNav(unit)}
    <article class="story-prose">
      <p class="story-eyebrow">${escapeHtml(unit.chapterTitle)}</p>
      <h1 class="page-title">${escapeHtml(unit.title)}</h1>
      ${unit.recapHtml}
      ${(unit.sections || []).map(sectionHtml).join('\n')}
    </article>
    ${storyNav(unit)}
    ${unit.momentsHtml || ''}
    ${unit.afterHtml || ''}`;
  return baseShell({
    pageType: 'story',
    title: unit.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(unit.outputPath),
    navHtml: navFor(unit.outputPath, config),
    rootHref: rootPath(unit.outputPath),
    content,
    footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: clientScripts(unit.outputPath),
  });
}

function characterStoryPage(story, config, publishConfig, navFor) {
  const body = linkSessions(story.html);
  const sheetLink = story.sheetOutputPath
    ? `<p class="story-sheet-link"><a href="${encodeHref(relativeHref(story.outputPath, story.sheetOutputPath))}">View character sheet &rarr;</a></p>` : '';
  const content = `
    <article class="story-prose">
      <h1 class="page-title">${escapeHtml(story.title)}</h1>
      ${sheetLink}
      ${story.prologueHtml ? prologueHtml(story.title, story.prologueHtml) : ''}
      ${body}
    </article>`;
  return baseShell({
    pageType: 'story',
    title: story.title, siteTitle: config.siteTitle,
    cssHref: cssPath(story.outputPath), navHtml: navFor(story.outputPath, config),
    rootHref: rootPath(story.outputPath), content, footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: [...clientScripts(story.outputPath), ...(body !== story.html ? [rootPath(story.outputPath) + 'js/story-links.js'] : [])],
  });
}

module.exports = { storyPage, characterStoryPage };
