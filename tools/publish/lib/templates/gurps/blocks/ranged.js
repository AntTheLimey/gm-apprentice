const { escapeHtml } = require('../../../processor');
const { wide } = require('../render');

function renderRanged(model) {
  const attacks = model.ranged || [];
  if (attacks.length === 0) return null;
  const rows = attacks.map(a =>
    `<tr><td class="nm">${escapeHtml(a.weapon || '')}</td>` +
    `<td class="num">${escapeHtml(a.skill || '')}</td>` +
    `<td class="num dmg">${escapeHtml(a.damage || '')}</td>` +
    `<td class="num">${escapeHtml(a.acc || '')}</td>` +
    `<td class="num">${escapeHtml(a.range || '')}</td>` +
    `<td class="num">${escapeHtml(a.rof || '')}</td>` +
    `<td class="num">${escapeHtml(a.shots || '')}</td>` +
    `<td class="num">${escapeHtml(a.st || '')}</td>` +
    `<td class="num">${escapeHtml(a.bulk || '')}</td>` +
    `<td class="num">${escapeHtml(a.rcl || '')}</td>` +
    `<td>${escapeHtml(a.notes || '')}</td></tr>`).join('\n');
  const inner = `<table><thead><tr><th>Weapon</th><th class="num">Skill</th><th class="num dmg">Damage</th><th class="num">Acc</th><th class="num">Range</th><th class="num">RoF</th><th class="num">Shots</th><th class="num">ST</th><th class="num">Bulk</th><th class="num">Rcl</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
  return wide('table', 'Ranged Attacks', inner);
}

module.exports = { renderRanged };
