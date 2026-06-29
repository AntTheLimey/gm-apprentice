const { escapeHtml } = require('../../../processor');
const { block, cost } = require('../render');

function renderSpells(model) {
  const spells = (model.spells || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (spells.length === 0) return null;
  const rows = spells.map(s => {
    const marks = (s.markers || []).map(g => `<sup class="fn">${escapeHtml(g)}</sup>`).join('');
    const cite = s.source ? ` <span class="cite">{p. ${escapeHtml(s.source)}}</span>` : '';
    return `<tr><td class="nm">${escapeHtml(s.name)}${cite}</td>` +
      `<td class="num">${escapeHtml(s.level || '')}${marks}</td>` +
      `<td class="num">${cost(s.points || '0')}</td></tr>`;
  }).join('\n');
  const inner = `<table><thead><tr><th>Spell</th><th class="num">Lvl</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  return block('spell', 'Spells', inner);
}

module.exports = { renderSpells };
