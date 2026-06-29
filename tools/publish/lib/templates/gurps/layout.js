const { renderStatus } = require('./blocks/status');
const { renderAttributes } = require('./blocks/attributes');
const { renderSenses } = require('./blocks/senses');
const { renderDefenses } = require('./blocks/defenses');
const { renderEncumbrance } = require('./blocks/encumbrance');
const { renderReactions } = require('./blocks/reactions');
const { renderCultural, renderLanguages } = require('./blocks/social');
const { renderTraitList } = require('./blocks/traits');
const { renderSkills } = require('./blocks/skills');
const { renderTechniques } = require('./blocks/techniques');
const { renderSpells } = require('./blocks/spells');
const { renderPoints } = require('./blocks/points');
const { renderMelee } = require('./blocks/melee');
const { renderRanged } = require('./blocks/ranged');
const { renderGrimoire } = require('./blocks/grimoire');
const { renderChains } = require('./blocks/chains');
const { renderReference } = require('./blocks/reference');
const { renderEquipment } = require('./blocks/equipment');

function buildSheet(model) {
  const status = renderStatus(model);
  const flow = [
    renderAttributes(model), renderSenses(model), renderDefenses(model), renderEncumbrance(model),
    renderReactions(model), renderCultural(model), renderLanguages(model),
    renderTraitList(model, 'templates', 'trait', 'Templates & Meta-Traits'),
    renderTraitList(model, 'advantages', 'trait', 'Advantages'),
    renderTraitList(model, 'perks', 'trait', 'Perks'),
    renderTraitList(model, 'disadvantages', 'trait', 'Disadvantages'),
    renderTraitList(model, 'quirks', 'trait', 'Quirks'),
    renderSkills(model), renderTechniques(model), renderSpells(model), renderPoints(model),
  ].filter(Boolean);
  const wideBlocks = [renderMelee(model), renderRanged(model), renderGrimoire(model)].filter(Boolean);
  if (flow.length === 0 && wideBlocks.length === 0 && !status) return null;
  return (status || '') + `<div class="gurps-sheet"><div class="flow">${flow.join('\n')}</div>${wideBlocks.join('\n')}</div>`;
}

function buildCombat(model) {
  const parts = [
    renderStatus(model),
    renderDefenses(model),
    renderMelee(model),
    renderRanged(model),
    renderChains(model),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `<div class="gurps-combat">${parts.join('\n')}${renderReference()}</div>`;
}

function buildEquipment(model) {
  return renderEquipment(model);
}

module.exports = { buildSheet, buildCombat, buildEquipment };
