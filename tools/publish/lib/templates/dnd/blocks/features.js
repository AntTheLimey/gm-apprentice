const { block, entry, usesHtml, asWritten } = require('../render');

const HOME = { class: 'classFeatures', species: 'speciesTraits', feats: 'feats' };

function renderFeatures(model, list, title) {
  const entries = (model.features[list] || []).map(f => entry({
    nameHtml: f.nameHtml, tags: [f.action], summaryHtml: f.summaryHtml, usesHtml: usesHtml(f),
  })).join('');
  return block(`features-${list}`, title, entries + asWritten(model.asWritten[HOME[list]]));
}

module.exports = { renderFeatures };
