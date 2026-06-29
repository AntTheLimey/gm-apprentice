const { escapeHtml } = require('../../../processor');
const { block, cost, footnoteRegistry } = require('../render');

function renderTraitList(model, key, category, title) {
  const list = ((model.traits || {})[key]) || [];
  if (list.length === 0) return null;
  const fn = footnoteRegistry();
  const rows = list.map(t => {
    const marks = (t.markers || []).map(() => fn.note('includes', '')).join('');
    const cite = t.source ? ` <span class="cite">{p. ${escapeHtml(t.source)}}</span>` : '';
    return `<tr><td class="nm">${escapeHtml(t.name)}${cite}</td><td class="num">${cost(t.cost)}${marks}</td></tr>`;
  }).join('\n');
  return block(category, title, `<table><tbody>${rows}</tbody></table>${fn.legendHtml()}`);
}

module.exports = { renderTraitList };
