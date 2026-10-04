const { block, entry, asWritten } = require('../render');

const many = g => Boolean(g.qty) && g.qty !== '1';

// The weight of one, as written. A bare number is given its unit; with a quantity above one it says "each".
function weightTag(g) {
  if (!g.weight) return '';
  const text = /^(\d+(\.\d+)?|(\d+\s+)?\d+\s*\/\s*\d+)$/.test(g.weight) ? g.weight + ' lb' : g.weight;
  return many(g) ? text + ' each' : text;
}

function renderGear(model) {
  const entries = (model.gear || []).map(g => entry({
    nameHtml: g.nameHtml,
    tags: [many(g) ? '× ' + g.qty : '', weightTag(g)],
    summaryHtml: g.notesHtml,
  })).join('');
  return block('gear', 'Carried', entries + asWritten(model.asWritten.equipment));
}

module.exports = { renderGear };
