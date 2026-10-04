const { block, entry, asWritten } = require('../render');

function renderGear(model) {
  const entries = (model.gear || []).map(g => entry({
    nameHtml: g.nameHtml,
    tags: [g.qty && g.qty !== '1' ? '× ' + g.qty : ''],
    summaryHtml: g.notesHtml,
  })).join('');
  return block('gear', 'Carried', entries + asWritten(model.asWritten.equipment));
}

module.exports = { renderGear };
