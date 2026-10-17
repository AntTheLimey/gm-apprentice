const { renderCoCSheet } = require('./coc/index');
const { renderGURPSSheet } = require('./gurps/index');
const { renderDnDSheet, isDndConsumedTitle } = require('./dnd/index');
const { renderFitDSheet, isFitDConsumedTitle } = require('./pc-fitd');
const { renderPF2eSheet, isPF2eConsumedTitle } = require('./pc-pf2e');

const { systemId } = require('../shared-lists');

// By canonical system id; the aliases that name each are the shared list (shared-lists.js).
const renderers = {
  'coc-7e': renderCoCSheet,
  'coc-7e-regency': renderCoCSheet,
  'gurps-4e': renderGURPSSheet,
  'dnd-5e-2024': renderDnDSheet,
  'fitd': renderFitDSheet,
  'pf2e': renderPF2eSheet,
};

// For a renderer built on sheet-parse.js: which `## ` section titles its sheet
// renders in full, so the PC page can drop them from its accordion list. Keyed
// by renderer, so the renderer table above stays the only list of systems.
const consumedTitles = new Map([
  [renderDnDSheet, isDndConsumedTitle],
  [renderFitDSheet, isFitDConsumedTitle],
  [renderPF2eSheet, isPF2eConsumedTitle],
]);

// (title) => boolean for the system's sheet, or null when the system has no
// such sheet (CoC and GURPS keep their own lists in pc.js).
function getConsumedTitleMatcher(system) {
  return consumedTitles.get(getRenderer(system)) || null;
}

// Which sheet family a system's renderer belongs to, by renderer so the
// renderer table above stays the only list of systems. CoC has no frontmatter stat read.
const families = new Map([
  [renderGURPSSheet, 'gurps'],
  [renderDnDSheet, 'dnd'],
  [renderPF2eSheet, 'pf2e'],
  [renderFitDSheet, 'fitd'],
]);

function getSheetFamily(system) {
  return families.get(getRenderer(system)) || null;
}

function getRenderer(system) {
  const id = systemId(system);
  return (id && renderers[id]) || null;
}

// The system ids that have a sheet renderer (every game system does; a test holds it).
const RENDERER_IDS = Object.keys(renderers);

module.exports = { RENDERER_IDS, getRenderer, getConsumedTitleMatcher, getSheetFamily };
