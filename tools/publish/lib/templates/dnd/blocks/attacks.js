const { escapeHtml } = require('../../../processor');
const { block, num, entry } = require('../render');

function renderAttacks(model) {
  const entries = (model.attacks || []).map(a => entry({
    nameHtml: a.nameHtml,
    bigHtml: (a.hit ? `<span class="dnd5e-lbl">Hit</span> ${num(a.hit)} ` : '')
      + `<span class="dnd5e-dmg">${escapeHtml(a.damage)}</span>`,
    summaryHtml: a.notesHtml,
  })).join('');
  return block('attacks', 'Attacks', entries);
}

module.exports = { renderAttacks };
