const { escapeHtml } = require('../../../processor');
const { block, cost, footnoteRegistry } = require('../render');

function renderSkills(model) {
  const skills = (model.skills || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (skills.length === 0) return null;
  const fn = footnoteRegistry();
  const rows = skills.map(s => {
    const marks = (s.markers || []).map(() => fn.note('includes', '')).join('');
    const cite = s.source ? ` <span class="cite">{p. ${escapeHtml(s.source)}}</span>` : '';
    const def = s.parry ? `<div class="subline">Parry: ${escapeHtml(s.parry)}</div>`
      : s.block ? `<div class="subline">Block: ${escapeHtml(s.block)}</div>` : '';
    return `<tr><td class="nm">${escapeHtml(s.name)}${cite}${def}</td>` +
      `<td class="num">${escapeHtml(s.level)}${marks}</td>` +
      `<td class="num rel">${escapeHtml(s.relative || '')}</td>` +
      `<td class="num">${cost(s.points)}</td></tr>`;
  }).join('\n');
  const inner = `<table><thead><tr><th>Name</th><th class="num">Lvl</th><th class="num">Rel</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table>${fn.legendHtml()}`;
  return block('skill', 'Skills', inner);
}

module.exports = { renderSkills };
