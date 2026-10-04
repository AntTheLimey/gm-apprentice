const { block, tile } = require('../render');

// Carried weight, capacity and encumbrance as the note has them (dnd_sheet.py fills them).
function renderCarrying(model) {
  const tiles = (model.carrying || []).map(([label, value]) => tile(label, value, model)).join('');
  return block('carrying', 'Carrying', tiles ? `<div class="dnd5e-kv">${tiles}</div>` : '');
}

module.exports = { renderCarrying };
