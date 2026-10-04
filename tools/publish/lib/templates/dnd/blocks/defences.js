const { escapeHtml } = require('../../../processor');
const { block, linkOr } = require('../render');

function renderDefences(model) {
  const lines = (model.defences || []).map(([label, value, html]) => `<p><strong>${escapeHtml(label)}:</strong> ${linkOr(html, value)}</p>`).join('');
  return block('defences', 'Defences', lines ? `<div class="dnd5e-lines">${lines}</div>` : '');
}

module.exports = { renderDefences };
