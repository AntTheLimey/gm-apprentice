const { escapeHtml } = require('../../../processor');
const { yesNo } = require('../../sheet-parse');
const { splitReason } = require('../parse');
const { num } = require('../render');

const tile = (label, value) => (value
  ? `<div class="dnd5e-v"><span class="dnd5e-lbl">${label}</span>${num(value)}</div>` : '');

function renderVitals(model) {
  const c = model.combat || {};
  if (!(c.ac || c.hpCur || c.hpMax || c.initiative || c.speed)) return null;

  // Temp HP as written; only a blank or a plain zero is left off.
  const tempText = String(c.tempHp || '').trim();
  const hasTemp = tempText !== '' && !/^0+$/.test(tempText);
  let hp = '';
  if (c.hpCur || c.hpMax || hasTemp) {
    const max = splitReason(c.hpMax);
    const why = max.reason ? `<span class="dnd5e-why">${escapeHtml(max.reason)}</span>` : '';
    const of = c.hpMax ? ` <span class="dnd5e-of"${max.reason ? ` title="${escapeHtml(max.reason)}"` : ''}>/ ${escapeHtml(max.value)}</span>${why}` : '';
    const temp = hasTemp ? ` <span class="dnd5e-temp">+ ${escapeHtml(tempText)} temp</span>` : '';
    hp = `<div class="dnd5e-v dnd5e-hp"><span class="dnd5e-lbl">Hit points</span><span class="dnd5e-hp-line">${num(c.hpCur)}${of}${temp}</span></div>`;
  }

  const chips = [];
  if (yesNo(model.inspiration) === true) chips.push('<span class="dnd5e-chip is-on">Heroic Inspiration</span>');
  chips.push(`<span class="dnd5e-chip">${c.conditions ? escapeHtml(c.conditions) : 'No conditions'}</span>`);
  if (c.exhaustion) chips.push(`<span class="dnd5e-chip">Exhaustion ${escapeHtml(c.exhaustion)}</span>`);

  return '<section class="dnd5e-vitals" aria-label="Vitals">'
    + `<div class="dnd5e-vrow">${hp}${tile('AC', c.ac)}${tile('Init', c.initiative)}${tile('Speed', c.speed)}${tile('Prof', model.pb)}</div>`
    + `<div class="dnd5e-chips">${chips.join('')}</div></section>`;
}

module.exports = { renderVitals };
