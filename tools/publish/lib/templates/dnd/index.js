const { parseDnd } = require('./parse');
const { buildSheet, buildCombat, buildSpells, buildEquipment, buildVitals } = require('./layout');
const { buildDndLiveData } = require('./live-data');
const { consumedTitleMatcher } = require('../sheet-parse');

// `## ` sections the sheet takes over from the accordion list. Each is on the
// page in full once the sheet renders (sheet-parse.js). Background is read for
// the header and stays in Story.
const CONSUMED_TITLES = ['stat sheet', 'skills', 'spellcasting', 'proficiencies', 'class features', 'species traits', 'feats', 'equipment', 'companions'];
const isDndConsumedTitle = consumedTitleMatcher(CONSUMED_TITLES);

function renderDnDSheet(frontmatter, sections, meta) {
  const model = parseDnd(frontmatter, sections);
  // What the page can keep live, worked out from the note. It rides the party board
  // with live off too; the marks are drawn tappable only when live is on.
  const liveData = meta ? buildDndLiveData(model, meta) : null;
  if (liveData) {
    model.warnings.push(...liveData.warnings);
    delete liveData.warnings;
    if (meta.live) {
      model.liveKeys = new Set(liveData.tracks.map(t => t.key));
      model.liveHp = liveData.hpMax !== null;
    }
  }
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
    liveData,
    warnings: model.warnings,
  };
}

module.exports = { renderDnDSheet, isDndConsumedTitle, CONSUMED_TITLES };
