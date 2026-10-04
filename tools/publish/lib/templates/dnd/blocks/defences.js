const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderDefences(model) {
  const lines = (model.defences || []).map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join('');
  return block('defences', 'Defences', lines ? `<div class="dnd5e-lines">${lines}</div>` : '');
}

module.exports = { renderDefences };
