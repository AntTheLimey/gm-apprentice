const { escapeHtml } = require('../../../processor');
const { block, cost } = require('../render');

function renderCultural(model) {
  const list = (model.social || {}).cultural || [];
  if (list.length === 0) return null;
  const rows = list.map(c =>
    `<tr><td class="nm">${escapeHtml(c.name)}</td><td class="num">${cost(c.cost)}</td></tr>`).join('\n');
  return block('social', 'Cultural Familiarities', `<table><tbody>${rows}</tbody></table>`);
}

function renderLanguages(model) {
  const list = (model.social || {}).languages || [];
  if (list.length === 0) return null;
  const rows = list.map(l =>
    `<tr><td class="nm">${escapeHtml(l.name)}</td><td>${escapeHtml(l.spoken || '')}</td><td>${escapeHtml(l.written || '')}</td><td class="num">${cost(l.points || '0')}</td></tr>`).join('\n');
  const inner = `<table><thead><tr><th>Language</th><th>Spoken</th><th>Written</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  return block('social', 'Languages', inner);
}

module.exports = { renderCultural, renderLanguages };
