const { escapeHtml } = require('../../../processor');
const { block, marks } = require('../render');

function renderSlots(model) {
  const rows = (model.slots || []).map(s => `<div class="dnd5e-track"><span class="dnd5e-track-name">${escapeHtml(s.level)}</span>${marks(s.total, s.expended, 'Spell slots, ' + s.level)}</div>`).join('');
  return block('slots', 'Spell slots', rows);
}

module.exports = { renderSlots };
