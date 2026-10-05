const { escapeHtml } = require('../../../processor');
const { yesNo } = require('../../sheet-parse');
const { splitReason } = require('../parse');
const { num, whyOf } = require('../render');

const tile = (model, label, value, whyClass) => (value
  ? `<div class="dnd5e-v"><span class="dnd5e-lbl">${label}</span>${num(value, whyClass, whyOf(model, value))}</div>` : '');

function renderVitals(model) {
  const c = model.combat || {};
  const live = !!model.liveKeys;
  const hook = name => (live ? ` data-live="${name}"` : '');
  // Temp HP as written; only a blank or a plain zero is left off.
  const tempText = String(c.tempHp || '').trim();
  const hasTemp = tempText !== '' && !/^0+$/.test(tempText);
  // Inspiration as written: Yes is a lit chip, No or blank nothing, anything else is shown as typed.
  const inspiration = String(model.inspiration || '').trim();
  const inspired = yesNo(inspiration);
  const speeds = c.speeds || [];
  // The reason in the AC cell is a duplicate when a Defences line says what the armour class is made of.
  const acReasonShownBelow = (model.defences || []).some(([label]) => /^armou?r class$/i.test(label));
  if (!live && !(c.ac || c.hpCur || c.hpMax || c.initiative || c.speed || speeds.length || model.pb || hasTemp
    || c.conditions || c.exhaustion || inspired !== false)) return null;
  let hp = '';
  if (c.hpCur || c.hpMax || hasTemp) {
    const max = splitReason(c.hpMax);
    const why = max.reason ? `<span class="dnd5e-why">${whyOf(model, c.hpMax) || escapeHtml(max.reason)}</span>` : '';
    const of = c.hpMax ? ` <span class="dnd5e-of"${max.reason ? ` title="${escapeHtml(max.reason)}"` : ''}>/ ${escapeHtml(max.value)}</span>${why}` : '';
    const temp = hasTemp ? ` <span class="dnd5e-temp">+ ${escapeHtml(tempText)} temp</span>` : '';
    hp = `<div class="dnd5e-v dnd5e-hp"${model.liveHp ? hook('hp') : ''}><span class="dnd5e-lbl">Hit points</span><span class="dnd5e-hp-line">${num(c.hpCur, '', whyOf(model, c.hpCur))}${of}${temp}</span></div>`;
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
    ? `<div class="dnd5e-v"><span class="dnd5e-lbl">Speed</span>${c.speed ? num(c.speed, '', whyOf(model, c.speed)) : ''}${extra}</div>` : '';

  return `<section class="dnd5e-vitals" aria-label="Vitals"${hook('vitals')}>`
    + `<div class="dnd5e-vrow">${hp}${tile(model, 'AC', c.ac, acReasonShownBelow ? 'is-dup' : '')}${tile(model, 'Init', c.initiative)}${speed}${tile(model, 'Prof', model.pb)}</div>`
    + `<div class="dnd5e-chips${allQuiet ? ' is-quiet' : ''}"${hook('chips')}>${chips.join('')}</div></section>`;
}

module.exports = { renderVitals };
