const { escapeHtml } = require('../../../processor');
const { wide } = require('../render');
const { levelAtEnd } = require('../weapon-level');

function renderMelee(model) {
  const attacks = model.melee || [];
  if (attacks.length === 0) return null;
  const rows = attacks.map(a => {
    const skill = String(a.skill || '');
    const sm = levelAtEnd(skill);   // wrap the level the cell ends with (weapon-level.js)
    const skillHtml = sm
      ? `${escapeHtml(sm.before)}<span class="wp-tohit">${escapeHtml(sm.level)}</span>${escapeHtml(sm.after)}`
      : escapeHtml(skill);
    const parry = String(a.parry || '');
    const pm = parry.match(/^(\s*)(\d+)(.*)$/);     // wrap the LEADING number
    const parryHtml = pm
      ? `${escapeHtml(pm[1])}<span class="wp-parry">${escapeHtml(pm[2])}</span>${escapeHtml(pm[3])}`
      : escapeHtml(parry);
    return `<tr data-weapon-key="${escapeHtml(a.weapon || '')}"><td class="nm">${escapeHtml(a.weapon || '')}</td>` +
      `<td class="num">${skillHtml}</td>` +
      `<td class="num">${parryHtml}</td>` +
      `<td class="num dmg">${escapeHtml(a.damage || '')}</td>` +
      `<td class="num">${escapeHtml(a.reach || '')}</td>` +
      `<td class="num">${escapeHtml(a.st || '')}</td>` +
      `<td>${escapeHtml(a.notes || '')}</td></tr>`;
  }).join('\n');
  const inner = `<table><thead><tr><th>Weapon/Mode</th><th class="num">Skill</th><th class="num">Parry</th><th class="num dmg">Damage</th><th class="num">Reach</th><th class="num">ST</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
  return wide('table', 'Melee Attacks', inner);
}

module.exports = { renderMelee };
