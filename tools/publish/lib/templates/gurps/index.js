const { parseGurps } = require('./parse');
const { buildSheet, buildCombat, buildEquipment, renderRowNotes } = require('./layout');
const { buildLiveData } = require('./live-data');
const { buildTohitData, tohitMarkup } = require('./tohit-data');
const { renderStatusPanel } = require('./blocks/status-panel');
const { overflowNotes } = require('./tables');
const { GURPS_CONSUMED_TITLES, EQUIPMENT_SECTION_TITLES } = require('../consumed-titles');
const { RICH_COMBAT_TITLES } = require('./layout');

function renderGURPSSheet(frontmatter, sections, meta) {
  const model = parseGurps(frontmatter, sections);
  const liveData = meta ? buildLiveData(model, meta) : null;
  // The to-hit calculator rides the build's setting (meta.tohit); with it off, or with no weapon, nothing is made.
  // The rows it cannot fully read go to the build's Site Faults audit, not to this page's warnings.
  const tohitRows = [];
  const tohitData = meta && meta.tohit === true ? buildTohitData(model, meta, tohitRows) : null;
  const sheetHtml = buildSheet(model, overflowNotes(sections, [...GURPS_CONSUMED_TITLES, ...EQUIPMENT_SECTION_TITLES].filter(t => !RICH_COMBAT_TITLES.includes(t))));
  let equipmentHtml = buildEquipment(model);
  // With no sheet to carry them, the Equipment tab (which takes those sections off the page) lists their extra cells.
  const equipmentNotes = !sheetHtml && equipmentHtml ? renderRowNotes(overflowNotes(sections, [...EQUIPMENT_SECTION_TITLES])) : null;
  if (equipmentNotes) equipmentHtml += '\n' + equipmentNotes;
  return {
    sheetHtml,
    combatHtml: buildCombat(model, sections || [], tohitData ? tohitMarkup(tohitData) : ''),
    equipmentHtml,
    // Structural warnings (sections found but unread, hidden sub-tables, an
    // empty combat tab) — build.js prints them per page (#177).
    warnings: model.warnings,
    liveData,
    tohitData,
    tohitRows,
    // Panel rides the live-data island: only mount when the island exists AND
    // vitals resolved. Otherwise there is no gurps-live.js to drive it.
    statusPanelHtml: (liveData && liveData.vitals) ? renderStatusPanel(model, liveData.vitals) : null,
  };
}

module.exports = { renderGURPSSheet };
