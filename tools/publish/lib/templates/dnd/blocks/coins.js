const { escapeHtml } = require('../../../processor');
const { block, num } = require('../render');

function renderCoins(model) {
  const tiles = (model.coins || []).map(([d, v]) => `<div class="dnd5e-v"><span class="dnd5e-lbl">${escapeHtml(d)}</span>${num(v)}</div>`).join('');
  return block('coins', 'Coins', tiles ? `<div class="dnd5e-coins">${tiles}</div>` : '');
}

module.exports = { renderCoins };
