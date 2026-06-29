const { escapeHtml } = require('../../../processor');
const { block, cost, footnoteRegistry } = require('../render');

function renderTechniques(model) {
  const techs = (model.techniques || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (techs.length === 0) return null;
  const fn = footnoteRegistry();
  const rows = techs.map(t => {
    const marks = (t.markers || []).map(() => fn.note('includes', '')).join('');
    const cite = t.source ? ` <span class="cite">{p. ${escapeHtml(t.source)}}</span>` : '';
    return `<tr><td class="nm">${escapeHtml(t.name)}${cite}</td>` +
      `<td class="nm">${escapeHtml(t.def || '')}</td>` +
      `<td class="num">${escapeHtml(t.level || '')}${marks}</td>` +
      `<td class="num">${cost(t.points || '')}</td></tr>`;
  }).join('\n');
  const inner = `<table><thead><tr><th>Name</th><th>Default</th><th class="num">Lvl</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table>${fn.legendHtml()}`;
  return block('skill', 'Techniques', inner);
}

module.exports = { renderTechniques };
