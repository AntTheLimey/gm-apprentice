const { parseGurps } = require('./parse');
const { buildSheet, buildCombat, buildEquipment } = require('./layout');
const { buildLiveData } = require('./live-data');

function renderGURPSSheet(frontmatter, sections, meta) {
  const model = parseGurps(frontmatter, sections);
  return {
    sheetHtml: buildSheet(model),
    combatHtml: buildCombat(model, sections || []),
    equipmentHtml: buildEquipment(model),
    liveData: meta ? buildLiveData(model, meta) : null,
  };
}

module.exports = { renderGURPSSheet };
