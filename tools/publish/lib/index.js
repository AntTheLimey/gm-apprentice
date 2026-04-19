const { scanVault, buildLinkMap, scanAttachments, slugify, mapFolder } = require('./scanner');
const { processContent, extractSections, resolveWikiLinks, filterSections, stripDataview, stripLeadingH1, renderRelationships, relativePath, escapeHtml, resolveImageEmbeds } = require('./processor');
const templates = require('./templates/index');
const { build } = require('./build');

module.exports = {
  // High-level
  build,
  // Scanner
  scanVault,
  buildLinkMap,
  scanAttachments,
  slugify,
  mapFolder,
  // Processor
  processContent,
  extractSections,
  resolveWikiLinks,
  filterSections,
  stripDataview,
  stripLeadingH1,
  renderRelationships,
  relativePath,
  escapeHtml,
  resolveImageEmbeds,
  // Templates
  templates,
};
