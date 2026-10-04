const { escapeHtml } = require('../../../processor');
const { block, num } = require('../render');

function renderSenses(model) {
  const tiles = model.senses.map(([label, value]) => `<div class="dnd5e-v"><span class="dnd5e-lbl">${escapeHtml(label)}</span>${num(value)}</div>`).join('');
  return block('senses', 'Senses', tiles ? `<div class="dnd5e-kv">${tiles}</div>` : '');
}

module.exports = { renderSenses };
