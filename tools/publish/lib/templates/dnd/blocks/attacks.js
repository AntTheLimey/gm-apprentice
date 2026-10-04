const { escapeHtml } = require('../../../processor');
const { filled } = require('../../sheet-parse');
const { block, entry, hitHtml, tile } = require('../render');

function renderAttacks(model) {
  const entries = (model.attacks || []).map(a => entry({
    nameHtml: a.nameHtml,
    bigHtml: (filled(a.hit) ? `${hitHtml(a.hit)} ` : '')
      + `<span class="dnd5e-dmg">${escapeHtml(a.damage)}</span>`,
    summaryHtml: a.notesHtml,
  })).join('');
  // Attacks per Action and any Save DC row from Combat, as written.
  const tiles = ((model.combat || {}).attackTiles || []).map(([l, v]) => tile(l, v, model)).join('');
  return block('attacks', 'Attacks', (tiles ? `<div class="dnd5e-kv">${tiles}</div>` : '') + entries);
}

module.exports = { renderAttacks };
