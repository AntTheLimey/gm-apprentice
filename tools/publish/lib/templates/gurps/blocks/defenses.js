const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderDefenses(model) {
  const d = model.defenses || {};
  const hasData = (d.parry && d.parry.length > 0) || (d.block && d.block.length > 0) ||
    d.dodge != null || (d.hitLocations && d.hitLocations.length > 0);
  if (!hasData) return null;

  const chips = [];
  for (const p of (d.parry || [])) chips.push(`<span class="def-chip"><span class="def-chip-label">${escapeHtml(p.label)}</span> ${escapeHtml(p.value)}</span>`);
  for (const b of (d.block || [])) chips.push(`<span class="def-chip"><span class="def-chip-label">${escapeHtml(b.label)}</span> ${escapeHtml(b.value)}</span>`);
  if (d.dodge != null) chips.push(`<span class="def-chip"><span class="def-chip-label">Dodge</span> ${escapeHtml(String(d.dodge))}</span>`);
  const defRow = chips.length > 0 ? `<div class="defrow">${chips.join('')}</div>` : '';

  let locTable = '';
  if (d.hitLocations && d.hitLocations.length > 0) {
    const rows = d.hitLocations.map(l =>
      `<tr><td>${escapeHtml(l.location)}</td><td class="num">${escapeHtml(String(l.dr))}</td></tr>`).join('\n');
    locTable = `<table class="hit-loc"><thead><tr><th>Location</th><th class="num">DR</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  return block('def', 'Active Defenses', defRow + locTable);
}

module.exports = { renderDefenses };
