const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderPoints(model) {
  const pts = model.points || [];
  if (pts.length === 0) return null;
  const rows = pts.map(p => {
    const cls = p.total ? ' class="total"' : p.unspent ? ' class="unspent"' : '';
    return `<tr${cls}><td class="nm">${escapeHtml(p.label)}</td><td class="num">${escapeHtml(String(p.value))}</td></tr>`;
  }).join('\n');
  const inner = `<table><tbody>${rows}</tbody></table>`;
  return block('points', 'Points Summary', inner);
}

module.exports = { renderPoints };
