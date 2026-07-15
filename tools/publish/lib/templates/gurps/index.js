const { parseGurps } = require('./parse');
const { buildSheet, buildCombat, buildEquipment } = require('./layout');
const { buildLiveData } = require('./live-data');
const { renderStatusPanel } = require('./blocks/status-panel');

function renderGURPSSheet(frontmatter, sections, meta) {
  const model = parseGurps(frontmatter, sections);
  const liveData = meta ? buildLiveData(model, meta) : null;
  return {
    sheetHtml: buildSheet(model),
    combatHtml: buildCombat(model, sections || []),
    equipmentHtml: buildEquipment(model),
    liveData,
    // Panel rides the live-data island: only mount when the island exists AND
    // vitals resolved. Otherwise there is no equipment-toggle.js to drive it.
    statusPanelHtml: (liveData && liveData.vitals) ? renderStatusPanel(model, liveData.vitals) : null,
  };
}

module.exports = { renderGURPSSheet };
