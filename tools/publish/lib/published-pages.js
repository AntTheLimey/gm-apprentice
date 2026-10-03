'use strict';

// The pages a build publishes: story companions folded into their PC, then one verdict per
// page from decidePage, then those that publish. The build and the rename answer both ask
// this, so what the rename tool says the link map does cannot drift from what the build does.
const { pairStoryFiles } = require('./scanner');
const { decidePage, publishesPage } = require('./publish-decision');

// `pages` is spliced in place (pairStoryFiles). `relOf(page)` is the vault-relative path.
function publishedPages(pages, { vaultPath, publishConfig, manifest, relOf }) {
  pairStoryFiles(pages, vaultPath);
  const verdicts = new Map();
  for (const page of pages) {
    verdicts.set(page, decidePage(page, { rel: relOf(page), publishConfig, manifest }));
  }
  return { verdicts, published: pages.filter((p) => publishesPage(verdicts.get(p))) };
}

module.exports = { publishedPages };
