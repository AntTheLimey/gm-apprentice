const { renderCoCSheet } = require('./coc/index');
const { renderGURPSSheet } = require('./gurps/index');
const { renderDnDSheet } = require('./pc-dnd');
const { renderFitDSheet } = require('./pc-fitd');
const { renderPF2eSheet } = require('./pc-pf2e');

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
  'pf2e': renderPF2eSheet,
  'pathfinder-2e': renderPF2eSheet,
  'pathfinder': renderPF2eSheet,
};

function getRenderer(system) {
  if (!system) return null;
  return renderers[String(system).toLowerCase()] || null;
}

module.exports = { getRenderer };
