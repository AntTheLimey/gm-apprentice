const { renderStatus } = require('./blocks/status');
const { renderAttributes } = require('./blocks/attributes');
const { renderSenses } = require('./blocks/senses');
const { renderDefenses } = require('./blocks/defenses');
const { renderEncumbrance } = require('./blocks/encumbrance');
const { renderReactions } = require('./blocks/reactions');
const { renderCultural, renderLanguages } = require('./blocks/social');
const { renderTraitList } = require('./blocks/traits');
const { renderSkills } = require('./blocks/skills');
const { renderSpells } = require('./blocks/spells');
const { renderPoints } = require('./blocks/points');
const { renderMelee } = require('./blocks/melee');
const { renderRanged } = require('./blocks/ranged');
const { renderGrimoire } = require('./blocks/grimoire');

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
    renderSkills(model), renderSpells(model), renderPoints(model),
  ].filter(Boolean);
  const wideBlocks = [renderMelee(model), renderRanged(model), renderGrimoire(model)].filter(Boolean);
  if (flow.length === 0 && wideBlocks.length === 0 && !status) return null;
  return (status || '') + `<div class="gurps-sheet"><div class="flow">${flow.join('\n')}</div>${wideBlocks.join('\n')}</div>`;
}

module.exports = { buildSheet };
