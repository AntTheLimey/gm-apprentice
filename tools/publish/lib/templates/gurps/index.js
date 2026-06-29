const { parseGurps } = require('./parse');
const { buildSheet } = require('./layout');

function renderGURPSSheet(frontmatter, sections) {
  const model = parseGurps(frontmatter, sections);
  return { sheetHtml: buildSheet(model) };
}

module.exports = { renderGURPSSheet };
