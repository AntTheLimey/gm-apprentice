const { renderCoCSheet } = require('./pc-coc');
const { renderGURPSSheet } = require('./pc-gurps');
const { renderDnDSheet } = require('./pc-dnd');
const { renderFitDSheet } = require('./pc-fitd');

const renderers = {
  'coc-7e': renderCoCSheet,
  'coc': renderCoCSheet,
  'regency-cthulhu': renderCoCSheet,
  'gurps-4e': renderGURPSSheet,
  'gurps': renderGURPSSheet,
  'dnd-5e': renderDnDSheet,
  'dnd-5e-2024': renderDnDSheet,
  'dnd': renderDnDSheet,
  'fitd': renderFitDSheet,
  'blades': renderFitDSheet,
};

function getRenderer(system) {
  if (!system) return null;
  return renderers[String(system).toLowerCase()] || null;
}

module.exports = { getRenderer };
