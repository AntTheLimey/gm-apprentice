const { escapeHtml } = require('../../../processor');
const { yesNo } = require('../../sheet-parse');
const { splitReason } = require('../parse');
const { num } = require('../render');

const tile = (label, value) => (value
  ? `<div class="dnd5e-v"><span class="dnd5e-lbl">${label}</span>${num(value)}</div>` : '');

function renderVitals(model) {
  const c = model.combat || {};
  // Temp HP as written; only a blank or a plain zero is left off.
  const tempText = String(c.tempHp || '').trim();
  const hasTemp = tempText !== '' && !/^0+$/.test(tempText);
  // Inspiration as written: Yes is a lit chip, No or blank nothing, anything else is shown as typed.
  const inspiration = String(model.inspiration || '').trim();
  const inspired = yesNo(inspiration);
  const speeds = c.speeds || [];
  if (!(c.ac || c.hpCur || c.hpMax || c.initiative || c.speed || speeds.length || model.pb || hasTemp
    || c.conditions || c.exhaustion || inspired !== false)) return null;
  let hp = '';
  if (c.hpCur || c.hpMax || hasTemp) {
    const max = splitReason(c.hpMax);
    const why = max.reason ? `<span class="dnd5e-why">${escapeHtml(max.reason)}</span>` : '';
    const of = c.hpMax ? ` <span class="dnd5e-of"${max.reason ? ` title="${escapeHtml(max.reason)}"` : ''}>/ ${escapeHtml(max.value)}</span>${why}` : '';
    const temp = hasTemp ? ` <span class="dnd5e-temp">+ ${escapeHtml(tempText)} temp</span>` : '';
    hp = `<div class="dnd5e-v dnd5e-hp"><span class="dnd5e-lbl">Hit points</span><span class="dnd5e-hp-line">${num(c.hpCur)}${of}${temp}</span></div>`;
  }

  const chips = [];
  if (inspired === true) chips.push('<span class="dnd5e-chip is-on">Heroic Inspiration</span>');
  else if (inspired === null) chips.push(`<span class="dnd5e-chip is-on">Heroic Inspiration: ${escapeHtml(inspiration)}</span>`);
  // A chip with nothing to say (no conditions, exhaustion 0) is marked quiet; a phone leaves it out.
  const quiet = on => (on ? '' : ' is-quiet');
  chips.push(`<span class="dnd5e-chip${quiet(c.conditions)}">${c.conditions ? escapeHtml(c.conditions) : 'No conditions'}</span>`);
  if (c.exhaustion) chips.push(`<span class="dnd5e-chip${quiet(!/^0+$/.test(String(c.exhaustion).trim()))}">Exhaustion ${escapeHtml(c.exhaustion)}</span>`);
  const allQuiet = chips.every(chip => chip.includes(' is-quiet"'));
  // Speed, with any fly, swim, climb or burrow speed small beneath it.
  const extra = speeds.map(([kind, value]) => `<span class="dnd5e-sub">${escapeHtml(kind)} ${escapeHtml(value)}</span>`).join('');
  const speed = c.speed || extra
    ? `<div class="dnd5e-v"><span class="dnd5e-lbl">Speed</span>${c.speed ? num(c.speed) : ''}${extra}</div>` : '';

  return '<section class="dnd5e-vitals" aria-label="Vitals">'
    + `<div class="dnd5e-vrow">${hp}${tile('AC', c.ac)}${tile('Init', c.initiative)}${speed}${tile('Prof', model.pb)}</div>`
    + `<div class="dnd5e-chips${allQuiet ? ' is-quiet' : ''}">${chips.join('')}</div></section>`;
}

module.exports = { renderVitals };
