const { escapeHtml } = require('../../../processor');
const { block, num } = require('../render');

function renderCasting(model) {
  const tiles = (model.casting || []).map(([label, value]) => `<div class="dnd5e-v"><span class="dnd5e-lbl">${escapeHtml(label)}</span>${num(value)}</div>`).join('');
  return block('casting', 'Spellcasting', tiles ? `<div class="dnd5e-kv">${tiles}</div>` : '');
}

module.exports = { renderCasting };
