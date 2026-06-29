const { escapeHtml } = require('../../../processor');
const { block } = require('../render');

function renderChainList(chains, heading) {
  if (!chains || chains.length === 0) return '';
  const items = chains.map(c => {
    const steps = (c.steps || []).map(s => `<span class="chain-step">${escapeHtml(s)}</span>`).join(' <span class="chain-arrow">→</span> ');
    return `<div class="chain-entry"><div class="chain-name">${escapeHtml(c.name)}</div><div class="chain-steps">${steps}</div></div>`;
  }).join('\n');
  return `<div class="chain-group"><h3>${escapeHtml(heading)}</h3>${items}</div>`;
}

function renderChains(model) {
  const chains = model.chains || {};
  const melee = chains.melee || [];
  const ranged = chains.ranged || [];
  if (melee.length === 0 && ranged.length === 0) return null;
  const inner = [
    melee.length > 0 ? renderChainList(melee, 'Melee') : '',
    ranged.length > 0 ? renderChainList(ranged, 'Ranged') : '',
  ].filter(Boolean).join('\n');
  return block('chain', 'Combat Action Chains', inner);
}

module.exports = { renderChains };
