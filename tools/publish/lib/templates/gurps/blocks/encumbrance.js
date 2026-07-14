const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderEncumbrance(model) {
  const enc = model.encumbrance || [];
  if (enc.length === 0) return null;
  const rows = enc.map((e, i) => {
    const cls = `e${i}` + (e.current ? ' cur' : '');
    return `<tr class="${cls}" data-level="${i}"><td>${escapeHtml(e.level)}</td>` +
      `<td class="num">${escapeHtml(e.weight || '')}</td>` +
      `<td class="num">${escapeHtml(e.move || '')}</td>` +
      `<td class="num">${escapeHtml(e.dodge || '')}</td></tr>`;
  }).join('\n');
  const table = `<table class="enc"><thead><tr><th>Level</th><th class="num">Max Wt</th><th class="num">Move</th><th class="num">Dodge</th></tr></thead><tbody>${rows}</tbody></table>`;
  const readout = `<div class="gl-readout" hidden>` +
    `<span>Carried: <b id="gl-weight">—</b> lb</span>` +
    `<span>Enc: <b id="gl-level">—</b></span>` +
    `<span>Move: <b id="gl-move">—</b></span>` +
    `<span>Dodge: <b id="gl-dodge">—</b></span>` +
    `<button type="button" id="gl-reset">Reset</button></div>`;
  return block('attr', 'Encumbrance', table + readout);
}

module.exports = { renderEncumbrance };
