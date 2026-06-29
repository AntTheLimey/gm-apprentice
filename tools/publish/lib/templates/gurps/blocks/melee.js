const { escapeHtml } = require('../../../processor');
const { wide } = require('../render');

function renderMelee(model) {
  const attacks = model.melee || [];
  if (attacks.length === 0) return null;
  const rows = attacks.map(a =>
    `<tr><td class="nm">${escapeHtml(a.weapon || '')}</td>` +
    `<td class="num">${escapeHtml(a.skill || '')}</td>` +
    `<td class="num">${escapeHtml(a.parry || '')}</td>` +
    `<td class="num dmg">${escapeHtml(a.damage || '')}</td>` +
    `<td class="num">${escapeHtml(a.reach || '')}</td>` +
    `<td class="num">${escapeHtml(a.st || '')}</td>` +
    `<td>${escapeHtml(a.notes || '')}</td></tr>`).join('\n');
  const inner = `<table><thead><tr><th>Weapon/Mode</th><th class="num">Skill</th><th class="num">Parry</th><th class="num dmg">Damage</th><th class="num">Reach</th><th class="num">ST</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
  return wide('table', 'Melee Attacks', inner);
}

module.exports = { renderMelee };
