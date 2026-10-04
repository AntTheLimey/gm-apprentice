const { escapeHtml } = require('../../processor');
const { block, asWritten } = require('./render');
const { renderVitals } = require('./blocks/vitals');
const { renderAbilities } = require('./blocks/abilities');
const { renderSkills } = require('./blocks/skills');
const { renderSenses } = require('./blocks/senses');
const { renderProficiencies } = require('./blocks/proficiencies');
const { renderFeatures } = require('./blocks/features');
const { renderAttacks } = require('./blocks/attacks');
const { renderActions } = require('./blocks/actions');
const { renderDefences } = require('./blocks/defences');
const { renderTracks } = require('./blocks/tracks');
const { renderCasting } = require('./blocks/casting');
const { renderSlots } = require('./blocks/slots');
const { renderSpells } = require('./blocks/spells');
const { renderGear } = require('./blocks/gear');
const { renderAttunement } = require('./blocks/attunement');
const { renderCoins } = require('./blocks/coins');

const wrap = (cls, parts) => {
  const kept = parts.filter(Boolean);
  return kept.length ? `<div class="dnd5e-sheet ${cls}">${kept.join('\n')}</div>` : null;
};

function headerLine(model) {
  const h = model.header;
  const bits = [h.level ? `Level ${h.level}` : '', h.classes, h.species, h.background].filter(Boolean);
  return bits.length ? `<div class="dnd5e-header">${bits.map(b => `<span>${escapeHtml(b)}</span>`).join('')}</div>` : '';
}

function buildSheet(model) {
  const abilities = renderAbilities(model);
  const blocks = [
    abilities, renderSkills(model), renderSenses(model), renderProficiencies(model),
    renderFeatures(model, 'class', 'Class features'),
    renderFeatures(model, 'species', 'Species traits'),
    renderFeatures(model, 'feats', 'Feats'),
  ].filter(Boolean);
  // A header line alone is not a sheet, nor is loose Stat Sheet prose alone.
  // A table of the author's own, or numbers placed in the vitals strip, are
  // something the page can show (as before 1.13.0), so the note has a sheet.
  if (!blocks.length) {
    const loose = block('statsheet', 'Stat sheet', asWritten(model.asWritten.statSheet));
    if (loose && /<table[ >]/.test(loose)) return wrap('dnd5e-tab-sheet', [headerLine(model), loose]);
    if (!renderVitals(model)) return null;
    // Numbers in the vitals strip make a sheet; the header and any loose prose still go on it.
    return wrap('dnd5e-tab-sheet', [headerLine(model), loose]) || '<div class="dnd5e-sheet dnd5e-tab-sheet"></div>';
  }
  // Loose Stat Sheet prose with no ability rows is still shown, as written.
  const loose = abilities ? null : block('statsheet', 'Stat sheet', asWritten(model.asWritten.statSheet));
  return wrap('dnd5e-tab-sheet', [headerLine(model), loose, ...blocks]);
}

const buildCombat = model => wrap('dnd5e-tab-combat', [renderAttacks(model), ...renderActions(model), renderDefences(model), renderTracks(model)]);
const buildSpells = model => (model.hasSpellcasting
  ? wrap('dnd5e-tab-spells', [renderCasting(model), renderSlots(model), ...renderSpells(model)]) : null);
const buildEquipment = model => wrap('dnd5e-tab-equipment', [renderGear(model), renderAttunement(model), renderCoins(model)]);
const buildVitals = model => renderVitals(model);

module.exports = { buildSheet, buildCombat, buildSpells, buildEquipment, buildVitals };
