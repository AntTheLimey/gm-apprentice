const { escapeHtml } = require('../../../processor');
const { block, splitMarkers } = require('../render');

function renderSenses(model) {
  const s = model.senses || {};
  if (Object.keys(s).length === 0) return null;
  const rows = Object.entries(s).map(([k, v]) => {
    const { value, markers } = splitMarkers(String(v));
    const marks = markers.map(g => `<sup class="fn">${escapeHtml(g)}</sup>`).join('');
    return `<tr><td class="nm">${escapeHtml(k)}</td><td class="num">${escapeHtml(value)}${marks}</td></tr>`;
  }).join('\n');
  const inner = `<table><tbody>${rows}</tbody></table>`;
  return block('attr', 'Senses & Checks', inner);
}

module.exports = { renderSenses };
