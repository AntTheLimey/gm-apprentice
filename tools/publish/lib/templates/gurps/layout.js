const { escapeHtml } = require('../../processor');
const { renderAttributes } = require('./blocks/attributes');
const { renderIdentity } = require('./blocks/identity');
const { renderLiftingFeats, renderSlamTable } = require('./blocks/lifting');
const { renderSenses } = require('./blocks/senses');
const { renderDefenses } = require('./blocks/defenses');
const { renderEncumbrance } = require('./blocks/encumbrance');
const { renderReactions } = require('./blocks/reactions');
const { renderCultural, renderLanguages } = require('./blocks/social');
const { renderTraitList } = require('./blocks/traits');
const { renderSkills } = require('./blocks/skills');
const { renderTechniques } = require('./blocks/techniques');
const { renderSpells } = require('./blocks/spells');
const { renderPoints } = require('./blocks/points');
const { renderMelee } = require('./blocks/melee');
const { renderRanged } = require('./blocks/ranged');
const { renderGrimoire } = require('./blocks/grimoire');
const { renderChains } = require('./blocks/chains');
const { renderReference } = require('./blocks/reference');
const { renderEquipment } = require('./blocks/equipment');
const { findSectionByTitle } = require('./tables');

const RICH_COMBAT_TITLES = ['multi-action combat skill chains', 'combat summary'];

// Cells a row holds past the columns the sheet reads, listed so nothing written is dropped.
function renderRowNotes(notes) {
  if (!notes || notes.length === 0) return null;
  const lines = notes.map(n => `<div class="subline">${escapeHtml(n.section)}${n.row ? `: ${escapeHtml(n.row)}` : ''} — ${escapeHtml(n.text)}</div>`);
  return `<section class="blk cat-skill"><h2>Notes on rows</h2>${lines.join('')}</section>`;
}

function buildSheet(model, rowNotes) {
  const flow = [
    renderAttributes(model), renderLiftingFeats(model), renderSlamTable(model),
    renderSenses(model), renderDefenses(model), renderEncumbrance(model),
    renderReactions(model), renderCultural(model), renderLanguages(model),
    renderTraitList(model, 'templates', 'trait', 'Templates & Meta-Traits', 'template'),
    renderTraitList(model, 'advantages', 'trait', 'Advantages', 'adv'),
    renderTraitList(model, 'perks', 'trait', 'Perks', 'perk'),
    renderTraitList(model, 'disadvantages', 'trait', 'Disadvantages', 'disadv'),
    renderTraitList(model, 'quirks', 'trait', 'Quirks', 'quirk'),
    renderSkills(model), renderTechniques(model), renderSpells(model), renderPoints(model),
  ].filter(Boolean);
  const wideBlocks = [renderMelee(model), renderRanged(model), renderGrimoire(model)].filter(Boolean);
  // Full-width and above the flow: the physical description leads the sheet rather
  // than getting buried mid-column.
  const identity = renderIdentity(model) || '';
  // Notes alone are not a sheet: with nothing else to show the page keeps its sections as they are.
  if (flow.length === 0 && wideBlocks.length === 0 && !identity) return null;
  const notes = renderRowNotes(rowNotes);
  if (notes) flow.push(notes);
  return `<div class="gurps-sheet">${identity}<div class="flow">${flow.join('\n')}</div>${wideBlocks.join('\n')}</div>`;
}

// `tohitHtml` (the to-hit calculator's container and data block, or '') goes after the last weapon,
// chain and combat section and before the rules reference, which `reference: false` leaves out
// (player_site.sheets.gurps_reference_tables).
function buildCombat(model, sections, tohitHtml, { reference = true } = {}) {
  const parts = [
    renderDefenses(model),
    renderMelee(model),
    renderRanged(model),
    renderChains(model),
  ].filter(Boolean);

  // Append rich combat sections (multi-action chains, combat summary) from raw sections
  for (const titleKey of RICH_COMBAT_TITLES) {
    const sec = findSectionByTitle(sections || [], titleKey);
    if (sec && sec.html && sec.html.trim()) {
      parts.push(`<section class="blk cat-skill"><h2>${escapeHtml(sec.title)}</h2>${sec.html}</section>`);
    }
  }

  if (parts.length === 0) return null;
  return `<div class="gurps-combat">${parts.join('\n')}${tohitHtml ? '\n' + tohitHtml : ''}${reference ? renderReference() : ''}</div>`;
}

function buildEquipment(model) {
  return renderEquipment(model);
}

module.exports = { RICH_COMBAT_TITLES, renderRowNotes, buildSheet, buildCombat, buildEquipment };
