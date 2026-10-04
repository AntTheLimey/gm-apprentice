const { block, asWritten } = require('../render');

function renderProficiencies(model) {
  const inner = (model.proficienciesHtml ? `<div class="dnd5e-lines">${model.proficienciesHtml}</div>` : '')
    + asWritten(model.asWritten.proficiencies);
  return block('proficiencies', 'Proficiencies', inner);
}

module.exports = { renderProficiencies };
