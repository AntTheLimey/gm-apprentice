const { escapeHtml } = require('../../../processor');
const { wide } = require('../render');

function renderGrimoire(model) {
  const spells = model.grimoire || [];
  if (spells.length === 0) return null;
  const rows = spells.map(g =>
    `<tr><td class="nm">${escapeHtml(g.name || '')}</td>` +
    `<td class="num">${escapeHtml(g.skill || '')}</td>` +
    `<td>${escapeHtml(g.class || '')}</td>` +
    `<td>${escapeHtml(g.time || '')}</td>` +
    `<td>${escapeHtml(g.duration || '')}</td>` +
    `<td class="num">${escapeHtml(g.cost || '')}</td>` +
    `<td>${escapeHtml(g.college || '')}</td>` +
    `<td class="cite">${escapeHtml(g.page || '')}</td></tr>`).join('\n');
  const inner = `<table><thead><tr><th>Spell</th><th class="num">Skill</th><th>Class</th><th>Time</th><th>Duration</th><th class="num">Cost</th><th>College</th><th>Page</th></tr></thead><tbody>${rows}</tbody></table>`;
  return wide('table', 'Grimoire', inner);
}

module.exports = { renderGrimoire };
