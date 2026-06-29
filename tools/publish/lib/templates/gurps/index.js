const { parseGurps } = require('./parse');
const { buildSheet, buildCombat, buildEquipment } = require('./layout');

function renderGURPSSheet(frontmatter, sections) {
  const model = parseGurps(frontmatter, sections);
  return {
    sheetHtml: buildSheet(model),
    combatHtml: buildCombat(model, sections || []),
    equipmentHtml: buildEquipment(model),
  };
}

module.exports = { renderGURPSSheet };
