const { escapeHtml } = require('../../../processor');

// Physical description reads best in a fixed order regardless of how the sheet's
// own table happens to be sorted; anything unrecognised follows in source order.
const PREFERRED_ORDER = [
  'Age', 'Gender', 'Height', 'Weight', 'Build', 'Hair', 'Eyes', 'Skin',
  'Handedness', 'Appearance', 'Birthday', 'Religion', 'Status', 'Reputation', 'TL',
];

function orderedEntries(identity) {
  const keys = Object.keys(identity);
  const known = PREFERRED_ORDER.filter(k => keys.includes(k));
  const rest = keys.filter(k => !PREFERRED_ORDER.includes(k));
  return [...known, ...rest].map(k => [k, identity[k]]);
}

// A full-width band that sits above the two-column flow, so the sheet opens on
// who the character physically is before any of the numbers.
function renderIdentity(model) {
  const identity = model.identity || {};
  const entries = orderedEntries(identity).filter(([, v]) => String(v || '').trim());
  if (entries.length === 0) return null;
  const cells = entries.map(([k, v]) =>
    `<div class="id-cell"><div class="id-l">${escapeHtml(k)}</div><div class="id-v">${escapeHtml(String(v))}</div></div>`
  ).join('');
  return `<section class="blk cat-attr identity-band"><h2>Appearance</h2><div class="id-grid">${cells}</div></section>`;
}

module.exports = { renderIdentity };
