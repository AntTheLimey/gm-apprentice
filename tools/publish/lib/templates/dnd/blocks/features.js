const { block, entry, usesHtml, asWritten } = require('../render');
const { liveKey, liveOf, shown } = require('../live-key');

const KIND = { class: 'class', species: 'species', feats: 'feat' };
const HOME = { class: 'classFeatures', species: 'speciesTraits', feats: 'feats' };

function renderFeatures(model, list, title) {
  const entries = (model.features[list] || []).map(f => entry({
    nameHtml: f.nameHtml, tags: [f.action], summaryHtml: f.summaryHtml, usesHtml: usesHtml(f, liveOf(model, liveKey(KIND[list], shown(f.name)))),
  })).join('');
  return block(`features-${list}`, title, entries + asWritten(model.asWritten[HOME[list]]));
}

module.exports = { renderFeatures };
