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
  // Base (unencumbered) Move/Dodge come from the None row (level 0); shown after
  // the live current value so the readout reads "cur / base".
  const base0 = enc[0] || {};
  const baseMove = base0.move ? ` / ${escapeHtml(base0.move)}` : '';
  const baseDodge = base0.dodge ? ` / ${escapeHtml(base0.dodge)}` : '';
  const readout = `<div class="gl-readout" hidden>` +
    `<span>Carried: <b id="gl-weight">—</b> lb</span>` +
    `<span>Enc: <b id="gl-level">—</b></span>` +
    `<span>Move: <b id="gl-move" data-gl-field="move">—</b>${baseMove}</span>` +
    `<span>Dodge: <b id="gl-dodge" data-gl-field="dodge">—</b>${baseDodge}</span>` +
    `<button type="button" id="gl-reset">Reset</button></div>`;
  return block('attr', 'Encumbrance', table + readout);
}

module.exports = { renderEncumbrance };
