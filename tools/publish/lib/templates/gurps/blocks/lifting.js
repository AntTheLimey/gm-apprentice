'use strict';

const { escapeHtml } = require('../../../processor');
const { block } = require('../render');
const { parseBasicLift, computeLiftingFeats, computeSlamTable } = require('../derived');

/**
 * Parse HP from the secondary attributes map.
 * Accepts numeric string like "12" or "12/12".
 */
function parseHP(secondary) {
  if (!secondary || !secondary.HP) return null;
  const s = String(secondary.HP.value || '').split('/')[0].trim();
  const n = parseInt(s, 10);
  return isFinite(n) ? n : null;
}

/**
 * Parse Basic Move from the secondary attributes map.
 * Accepts "6" etc.
 */
function parseMove(secondary) {
  if (!secondary || !secondary['Basic Move']) return null;
  const s = String(secondary['Basic Move'].value || '').trim();
  const n = parseInt(s, 10);
  return isFinite(n) ? n : null;
}

/**
 * Parse Basic Lift from the derived attributes map (preferred)
 * or fall back to the legacy model.attributes.bl field.
 */
function getBL(model) {
  const der = (model.attributes || {}).derived || {};
  if (der['Basic Lift']) return parseBasicLift(der['Basic Lift'].value);
  const a = model.attributes || {};
  if (a.bl) return parseBasicLift(String(a.bl));
  return null;
}

function renderLiftingFeats(model) {
  const blLb = getBL(model);
  if (blLb == null) return null;
  const feats = computeLiftingFeats(blLb);
  if (feats.length === 0) return null;

  const rows = feats.map(f =>
    `<tr><td>${escapeHtml(f.label)}</td><td class="num">${escapeHtml(f.value)}</td></tr>`
  ).join('\n');
  const inner = `<table class="lift-feats"><thead><tr><th>Feat</th><th class="num">Weight</th></tr></thead><tbody>${rows}</tbody></table>`;
  return block('attr', 'Lifting Feats', inner);
}

function renderSlamTable(model) {
  const sec = (model.attributes || {}).secondary || {};
  const hp = parseHP(sec);
  const move = parseMove(sec);
  if (hp == null || move == null) return null;

  const rows = computeSlamTable(hp, move);
  if (rows.length === 0) return null;

  const cells = rows.map(r =>
    `<div class="slam-cell"><div class="slam-v">${escapeHtml(r.damage)}</div><div class="slam-l">v=${r.velocity}</div></div>`
  ).join('');
  const inner = `<div class="slam-row">${cells}</div><div class="slam-note">Crushing damage at Basic Move up to ${move}</div>`;
  return block('attr', 'Slam', inner);
}

module.exports = { renderLiftingFeats, renderSlamTable };
