const { block, entry, usesHtml } = require('../render');

const ATTUNEMENT_SLOTS = 3;

// Each item with its charges drawn as feature uses are; the caption counts the attuned rows.
function renderMagicItems(model) {
  const items = model.magicItems || [];
  if (!items.length) return null;
  const entries = items.map(i => entry({
    nameHtml: i.nameHtml,
    tags: [i.attuned ? 'Attuned' : ''],
    summaryHtml: i.notesHtml,
    usesHtml: usesHtml({ name: i.name, uses: i.charges, used: i.used, recovers: i.recovers, recoversHtml: i.recoversHtml }),
  })).join('');
  return block('magic-items', 'Magic items', entries, `${items.filter(i => i.attuned).length} of ${ATTUNEMENT_SLOTS} attuned`);
}

module.exports = { renderMagicItems };
