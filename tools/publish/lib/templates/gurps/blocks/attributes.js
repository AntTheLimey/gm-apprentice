const { escapeHtml } = require('../../../processor');
const { block, footnoteRegistry } = require('../render');

const PRIMARY = ['ST', 'DX', 'IQ', 'HT'];

function renderAttributes(model) {
  const a = model.attributes || {};
  const prim = a.primary || {};
  if (Object.keys(prim).length === 0 && Object.keys(a.secondary || {}).length === 0) return null;
  const fn = footnoteRegistry();
  const cards = PRIMARY.filter(k => prim[k]).map(k =>
    `<div class="a"><div class="v">${escapeHtml(prim[k].value)}${prim[k].markers.length ? '<sup class="fn">*</sup>' : ''}</div><div class="l">${k}</div></div>`).join('');
  const sec = Object.entries(a.secondary || {}).map(([k, c]) =>
    `<div class="a"><div class="v">${escapeHtml(c.value)}</div><div class="l">${escapeHtml(k)}</div></div>`).join('');
  const derived = [a.bl && `BL ${escapeHtml(a.bl)}`, a.thrust && `Thr ${escapeHtml(a.thrust)}`, a.swing && `Sw ${escapeHtml(a.swing)}`, a.dodge && `Dodge ${escapeHtml(a.dodge)}`]
    .filter(Boolean).map(t => `<span>${t}</span>`).join('');
  const inner = `<div class="attrgrid">${cards}</div>` +
    (sec ? `<div class="subgrid">${sec}</div>` : '') +
    (derived ? `<div class="derived">${derived}</div>` : '');
  return block('attr', 'Attributes', inner);
}

module.exports = { renderAttributes };
