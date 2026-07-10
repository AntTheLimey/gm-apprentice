const { escapeHtml, relativeHref } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');

function storyNav(unit) {
  const prev = unit.prevHref
    ? `<a href="${relativeHref(unit.outputPath, unit.prevHref)}">&larr; Previous</a>` : '<span></span>';
  const next = unit.nextHref
    ? `<a href="${relativeHref(unit.outputPath, unit.nextHref)}">Next &rarr;</a>` : '<span></span>';
  return `<div class="story-nav">${prev}${next}</div>`;
}

function storyPage(unit, config, publishConfig, navFor) {
  const refsHtml = unit.refsHtml
    ? `<aside class="story-refs"><h2>In this ${unit.kind === 'session' ? 'session' : 'chapter'}</h2>${unit.refsHtml}</aside>` : '';
  const content = `
    ${storyNav(unit)}
    <article class="story-prose">
      <p class="story-eyebrow">${escapeHtml(unit.chapterTitle)}</p>
      <h1 class="page-title">${escapeHtml(unit.title)}</h1>
      ${unit.recapHtml}
    </article>
    ${refsHtml}
    ${storyNav(unit)}`;
  return baseShell({
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
  const sheetLink = story.sheetOutputPath
    ? `<p class="story-sheet-link"><a href="${relativeHref(story.outputPath, story.sheetOutputPath)}">View character sheet &rarr;</a></p>` : '';
  const content = `
    <article class="story-prose">
      <h1 class="page-title">${escapeHtml(story.title)}</h1>
      ${sheetLink}
      ${story.html}
    </article>`;
  return baseShell({
    title: story.title, siteTitle: config.siteTitle,
    cssHref: cssPath(story.outputPath), navHtml: navFor(story.outputPath, config),
    rootHref: rootPath(story.outputPath), content, footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: clientScripts(story.outputPath),
  });
}

module.exports = { storyPage, characterStoryPage };
