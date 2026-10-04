const { escapeHtml } = require('../../../processor');
const { ABILITIES } = require('../parse');
const { block, num, asWritten, whyOf } = require('../render');

function card(key, a) {
  let save = '';
  if (a.save) save = `<span class="dnd5e-ab-save">Save ${num(a.save)}</span>`;
  else if (a.saveProf) save = '<span class="dnd5e-ab-save">Save proficiency</span>';
  return `<div class="dnd5e-ab${a.saveProf ? ' is-prof' : ''}"><span class="dnd5e-lbl">${key}</span>`
    + `<span class="dnd5e-ab-mod">${num(a.mod)}</span><span class="dnd5e-ab-score">${escapeHtml(a.score)}</span>${save}</div>`;
}

function renderAbilities(model) {
  const cards = ABILITIES.filter(k => model.abilities[k]).map(k => card(k, model.abilities[k])).join('');
  const core = model.core.map(([label, value]) => `<div class="dnd5e-v"><span class="dnd5e-lbl">${escapeHtml(label)}</span>${num(value, '', whyOf(model, value))}</div>`).join('');
  // Loose prose alone is not an abilities block; the layout places it.
  if (!cards && !core) return null;
  const inner = (cards ? `<div class="dnd5e-abilities">${cards}</div>` : '')
    + (core ? `<div class="dnd5e-kv">${core}</div>` : '')
    + asWritten(model.asWritten.statSheet);
  return block('abilities', 'Abilities and saving throws', inner);
}

module.exports = { renderAbilities };
