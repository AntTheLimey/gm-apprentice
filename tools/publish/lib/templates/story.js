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
    scripts: clientScripts(unit.outputPath),
  });
}

module.exports = { storyPage };
