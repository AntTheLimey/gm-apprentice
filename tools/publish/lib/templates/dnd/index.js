const { parseDnd } = require('./parse');
const { buildSheet, buildCombat, buildSpells, buildEquipment, buildVitals } = require('./layout');
const { consumedTitleMatcher } = require('../sheet-parse');

// `## ` sections the sheet takes over from the accordion list. Each is on the
// page in full once the sheet renders (sheet-parse.js). Background is read for
// the header and stays in Story.
const CONSUMED_TITLES = ['stat sheet', 'skills', 'spellcasting', 'proficiencies', 'class features', 'species traits', 'feats', 'equipment'];
const isDndConsumedTitle = consumedTitleMatcher(CONSUMED_TITLES);

function renderDnDSheet(frontmatter, sections) {
  const model = parseDnd(frontmatter, sections);
  const sheetHtml = buildSheet(model);
  // Combat, spells and equipment ride the sheet: with no sheet their sections
  // stay where the page puts them today.
  if (!sheetHtml) return { sheetHtml: null, warnings: model.warnings };
  return {
    sheetHtml,
    combatHtml: buildCombat(model),
    spellsHtml: buildSpells(model),
    equipmentHtml: buildEquipment(model),
    vitalsHtml: buildVitals(model),
    warnings: model.warnings,
  };
}

module.exports = { renderDnDSheet, isDndConsumedTitle, CONSUMED_TITLES };
