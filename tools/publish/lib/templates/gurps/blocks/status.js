const { escapeHtml } = require('../../../processor');

function renderStatus(model) {
  const s = model.status || {};
  if (Object.keys(s).length === 0) return null;
  const pips = [];
  if (s.hp != null) pips.push(`<span class="pip"><abbr title="Hit Points">HP</abbr>: ${escapeHtml(String(s.hp))}</span>`);
  if (s.fp != null) pips.push(`<span class="pip"><abbr title="Fatigue Points">FP</abbr>: ${escapeHtml(String(s.fp))}</span>`);
  if (s.move != null) pips.push(`<span class="pip">Move: ${escapeHtml(String(s.move))}</span>`);
  if (s.enc != null) pips.push(`<span class="pip">Enc: ${escapeHtml(String(s.enc))}</span>`);
  const condition = s.condition ? `<span class="condition">${escapeHtml(s.condition)}</span>` : '';
  const location = s.location ? `<span class="location"><span class="status-label">Location:</span> ${escapeHtml(s.location)}</span>` : '';
  return `<div class="status">${pips.join('')}${condition}${location}</div>`;
}

module.exports = { renderStatus };
