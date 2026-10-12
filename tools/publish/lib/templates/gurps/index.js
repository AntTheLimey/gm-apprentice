const { parseGurps } = require('./parse');
const { buildSheet, buildCombat, buildEquipment } = require('./layout');
const { buildLiveData } = require('./live-data');
const { renderStatusPanel } = require('./blocks/status-panel');
const { overflowNotes } = require('./tables');
const { GURPS_CONSUMED_TITLES, EQUIPMENT_SECTION_TITLES } = require('../consumed-titles');
const { RICH_COMBAT_TITLES } = require('./layout');

function renderGURPSSheet(frontmatter, sections, meta) {
  const model = parseGurps(frontmatter, sections);
  const liveData = meta ? buildLiveData(model, meta) : null;
  return {
    sheetHtml: buildSheet(model, overflowNotes(sections, [...GURPS_CONSUMED_TITLES, ...EQUIPMENT_SECTION_TITLES].filter(t => !RICH_COMBAT_TITLES.includes(t)))),
    combatHtml: buildCombat(model, sections || []),
    equipmentHtml: buildEquipment(model),
    // Structural warnings (sections found but unread, hidden sub-tables, an
    // empty combat tab) — build.js prints them per page (#177).
    warnings: model.warnings,
    liveData,
    // Panel rides the live-data island: only mount when the island exists AND
    // vitals resolved. Otherwise there is no gurps-live.js to drive it.
    statusPanelHtml: (liveData && liveData.vitals) ? renderStatusPanel(model, liveData.vitals) : null,
  };
}

module.exports = { renderGURPSSheet };
