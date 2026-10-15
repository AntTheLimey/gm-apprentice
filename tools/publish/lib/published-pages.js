'use strict';

// The pages a build publishes: story companions folded into their PC, then one verdict per
// page from decidePage, then those that publish. The build and the rename answer both ask
// this, so what the rename tool says the link map does cannot drift from what the build does.
const { pairStoryFiles } = require('./scanner');
const { decidePage, decideGmPage, publishesPage } = require('./publish-decision');

// `pages` is spliced in place (pairStoryFiles). `relOf(page)` is the vault-relative path.
// `site: 'gm'` asks decideGmPage (with `playerConfig`, `show`, `hiddenFolders`); `playerPublished`
// is what the player site publishes, and on the player site it is `published`.
function publishedPages(pages, { vaultPath, publishConfig, manifest, relOf, site = 'player', playerConfig, show, hiddenFolders }) {
  pairStoryFiles(pages, vaultPath);
  const verdicts = new Map();
  const gm = site === 'gm';
  for (const page of pages) {
    const options = { rel: relOf(page), publishConfig, manifest };
    verdicts.set(page, gm
      ? decideGmPage(page, { ...options, playerConfig, show, hiddenFolders })
      : decidePage(page, options));
  }
  const published = pages.filter((p) => publishesPage(verdicts.get(p)));
  const playerPublished = gm ? pages.filter((p) => publishesPage(verdicts.get(p).player)) : published;
  return { verdicts, published, playerPublished };
}

module.exports = { publishedPages };
