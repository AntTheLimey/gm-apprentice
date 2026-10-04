const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderAttunement(model) {
  const rows = model.attunement || [];
  if (!rows.length) return null;
  const used = rows.filter(([, item]) => item).length;
  const lines = rows.map(([slot, item, itemHtml]) => `<p><strong>${escapeHtml(slot)}:</strong> ${item ? (itemHtml || escapeHtml(item)) : 'empty'}</p>`).join('');
  return block('attunement', 'Attunement', `<div class="dnd5e-lines">${lines}</div>`, `${used} of ${rows.length} used`);
}

module.exports = { renderAttunement };
