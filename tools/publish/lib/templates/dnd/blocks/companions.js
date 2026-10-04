const { block, num, entry, asWritten } = require('../render');

const stat = (label, value) => (value ? `<span class="dnd5e-stat"><span class="dnd5e-lbl">${label}</span> ${num(value)}</span>` : '');

function renderCompanions(model) {
  const entries = (model.companions || []).map(c => entry({
    nameHtml: c.nameHtml,
    tags: [c.kind],
    bigHtml: stat('AC', c.ac) + stat('HP', c.hp) + stat('Speed', c.speed),
    summaryHtml: c.notesHtml,
  })).join('');
  return block('companions', 'Companions', entries + asWritten(model.asWritten.companions));
}

module.exports = { renderCompanions };
