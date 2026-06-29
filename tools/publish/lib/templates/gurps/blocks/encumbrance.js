const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderEncumbrance(model) {
  const enc = model.encumbrance || [];
  if (enc.length === 0) return null;
  const rows = enc.map((e, i) => {
    const cls = `e${i}` + (e.current ? ' cur' : '');
    return `<tr class="${cls}"><td>${escapeHtml(e.level)}</td><td class="num">${escapeHtml(e.weight || '')}</td><td class="num">${escapeHtml(e.move || '')}</td><td class="num">${escapeHtml(e.dodge || '')}</td></tr>`;
  }).join('\n');
  const inner = `<table class="enc"><thead><tr><th>Level</th><th class="num">Max Wt</th><th class="num">Move</th><th class="num">Dodge</th></tr></thead><tbody>${rows}</tbody></table>`;
  return block('attr', 'Encumbrance', inner);
}

module.exports = { renderEncumbrance };
