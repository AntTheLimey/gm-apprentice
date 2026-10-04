const { escapeHtml } = require('../../../processor');
const { block, num, entry } = require('../render');

// The Bonuses table as written: where it comes from, what it applies to, the
// bonus. The site adds nothing in; dnd_sheet.py does, into the note's cells.
function renderBonuses(model) {
  const entries = (model.bonuses || []).map((b) => {
    const applies = String(b.applies || '').split(',').map(t => t.trim()).filter(Boolean);
    return entry(b.source
      ? { nameHtml: b.sourceHtml || escapeHtml(b.source), tags: applies, bigHtml: b.bonus ? num(b.bonus) : '' }
      : { nameHtml: escapeHtml(b.applies), bigHtml: b.bonus ? num(b.bonus) : '' });
  }).join('');
  return block('bonuses', 'Bonuses', entries);
}

module.exports = { renderBonuses };
