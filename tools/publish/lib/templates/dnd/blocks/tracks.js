const { escapeHtml } = require('../../../processor');
const { block, marks, tile } = require('../render');
const { liveKey, liveOf, shown } = require('../live-key');

const track = (name, inner) => `<div class="dnd5e-track"><span class="dnd5e-track-name">${escapeHtml(name)}</span>${inner}</div>`;

// Saves made are the filled marks, so a mark is spent once it is not yet made.
function saves(name, count, label, live) {
  return track(name, Number.isInteger(count) && count <= 3
    ? marks(3, 3 - count, label, live)
    : `<span class="dnd5e-num">${escapeHtml(String(count))}</span>`);
}

function renderTracks(model) {
  const c = model.combat || {};
  const rows = (c.hitDice || []).map(h => track(h.label, h.raw !== undefined
    ? escapeHtml(h.raw) : marks(h.max, h.spent, h.label, liveOf(model, liveKey('hd', shown(h.label))))));
  const d = c.deathSaves;
  if (d) {
    if (d.raw !== undefined) rows.push(track('Death saves', escapeHtml(d.raw)));
    else rows.push(saves('Saved', d.s, 'Death saves made', liveOf(model, 'ds:s', 'made')), saves('Failed', d.f, 'Death saves failed', liveOf(model, 'ds:f', 'made')));
  }
  const tiles = [...(c.other || []), ...(c.size ? [['Size', c.size]] : [])].map(([l, v]) => tile(l, v, model)).join('');
  return block('tracks', 'Hit dice and death saves', rows.join('') + (tiles ? `<div class="dnd5e-kv">${tiles}</div>` : ''));
}

module.exports = { renderTracks };
