'use strict';

// The House Rules page (house-rules.html): the standing changes the table has made to the game's rules, as the
// Campaign Overview's `## House Rules` section lists them. `html` is that section, already rendered by the build.
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');

const OUT = 'house-rules.html';

function houseRulesTemplate(html, navFor, config, publishConfig) {
  return baseShell({
    pageType: 'house-rules',
    title: 'House Rules',
    siteTitle: config.siteTitle,
    cssHref: cssPath(OUT),
    navHtml: navFor(OUT, config),
    rootHref: rootPath(OUT),
    content: `<h1 class="page-title">House Rules</h1>\n<div class="house-rules">\n${html}\n</div>`,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    scripts: clientScripts(OUT),
  });
}

module.exports = { houseRulesTemplate, HOUSE_RULES_OUT: OUT };
