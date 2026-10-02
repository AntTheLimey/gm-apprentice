// A note body as the real extractSections returns it: [{ id, title, html }].
// Renderer tests feed stats through body markdown with this, so the input is
// what the build hands the renderer.
const { extractSections } = require('../../lib/processor');

function sectionsFromMarkdown(md) {
  return extractSections(String(md).replace(/^\n/, ''));
}

module.exports = { sectionsFromMarkdown };
