const { escapeHtml } = require('../../../processor');
const { block, num, marks } = require('../render');

const track = (name, inner) => `<div class="dnd5e-track"><span class="dnd5e-track-name">${escapeHtml(name)}</span>${inner}</div>`;
const tile = (label, value) => `<div class="dnd5e-v"><span class="dnd5e-lbl">${escapeHtml(label)}</span>${num(value)}</div>`;

// Saves made are the filled marks, so a mark is spent once it is not yet made.
function saves(name, count, label) {
  return track(name, Number.isInteger(count) && count <= 3
    ? marks(3, 3 - count, label)
    : `<span class="dnd5e-num">${escapeHtml(String(count))}</span>`);
}

function renderTracks(model) {
  const c = model.combat || {};
  const rows = (c.hitDice || []).map(h => track(h.label, h.raw !== undefined
    ? escapeHtml(h.raw) : marks(h.max, h.spent, h.label)));
  const d = c.deathSaves;
  if (d) {
    if (d.raw !== undefined) rows.push(track('Death saves', escapeHtml(d.raw)));
    else rows.push(saves('Saved', d.s, 'Death saves made'), saves('Failed', d.f, 'Death saves failed'));
  }
  const tiles = [...(c.other || []), ...(c.size ? [['Size', c.size]] : [])].map(([l, v]) => tile(l, v)).join('');
  return block('tracks', 'Hit dice and death saves', rows.join('') + (tiles ? `<div class="dnd5e-kv">${tiles}</div>` : ''));
}

module.exports = { renderTracks };
