const { escapeHtml } = require('../../../processor');
const { block, splitMarkers } = require('../render');

function renderReactions(model) {
  const r = model.reactions || {};
  if (Object.keys(r).length === 0) return null;
  const rows = Object.entries(r).map(([k, v]) => {
    const { value, markers } = splitMarkers(String(v));
    const marks = markers.map(g => `<sup class="fn">${escapeHtml(g)}</sup>`).join('');
    return `<tr><td class="nm">${escapeHtml(k)}</td><td class="num">${escapeHtml(value)}${marks}</td></tr>`;
  }).join('\n');
  const inner = `<table><tbody>${rows}</tbody></table>`;
  return block('social', 'Reaction Modifiers', inner);
}

module.exports = { renderReactions };
