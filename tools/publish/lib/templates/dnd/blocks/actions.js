const { escapeHtml } = require('../../../processor');
const { block, entry, usesHtml } = require('../render');
const { liveKey, liveOf, shown } = require('../live-key');

const GROUPS = [
  ['action', 'actions-action', 'Action'],
  ['bonus action', 'actions-bonus', 'Bonus action'],
  ['reaction', 'actions-reaction', 'Reaction'],
];

function renderActions(model) {
  const features = [
    ...model.features.class.map(f => [f, 'class']),
    ...model.features.species.map(f => [f, 'species']),
    ...model.features.feats.map(f => [f, 'feat']),
  ];
  return GROUPS.map(([kind, key, title]) => {
    const parts = features
      .filter(([f]) => String(f.action || '').trim().toLowerCase() === kind)
      .map(([f, from]) => entry({ nameHtml: f.nameHtml, summaryHtml: f.summaryHtml, usesHtml: usesHtml(f, liveOf(model, liveKey(from, shown(f.name)))) }));
    // Spells cast as a plain action are not listed here; they live on the Spells tab.
    const names = kind === 'action' ? [] : (model.spells || [])
      .filter(s => new RegExp(`^(?:1\\s+)?${kind}\\b`).test(String(s.time || '').trim().toLowerCase()))
      .map(s => escapeHtml(s.name));
    if (names.length) parts.push(entry({ nameHtml: 'Spells', summaryHtml: names.join(', ') }));
    return block(key, title, parts.join(''));
  }).filter(Boolean);
}

module.exports = { renderActions };
