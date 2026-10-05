const { escapeHtml } = require('../../../processor');
const { block, marks } = require('../render');
const { liveKey, liveOf, shown } = require('../live-key');

function renderSlots(model) {
  const rows = (model.slots || []).map(s => `<div class="dnd5e-track"><span class="dnd5e-track-name">${escapeHtml(s.level)}</span>${marks(s.total, s.expended, 'Spell slots, ' + s.level, liveOf(model, liveKey('slot', shown(s.level))))}</div>`).join('');
  return block('slots', 'Spell slots', rows);
}

module.exports = { renderSlots };
