const { escapeHtml } = require('../../../processor');
const { wide } = require('../render');

function inventoryTable(items) {
  if (!items || items.length === 0) return '';
  const rows = items.map(item => {
    const locCell = item.location != null ? `<td>${escapeHtml(item.location)}</td>` : '';
    const notesCell = item.notes != null ? `<td>${escapeHtml(item.notes)}</td>` : '';
    return `<tr><td class="num">${escapeHtml(String(item.qty))}</td><td>${escapeHtml(item.name)}</td><td class="num">${escapeHtml(item.cost)}</td><td class="num">${escapeHtml(item.weight)}</td>${locCell}${notesCell}</tr>`;
  }).join('\n');
  // Determine whether location/notes columns are needed
  const hasLoc = items.some(i => i.location != null);
  const hasNotes = items.some(i => i.notes != null);
  const locTh = hasLoc ? '<th>Location</th>' : '';
  const notesTh = hasNotes ? '<th>Notes</th>' : '';
  return `<table class="equip-table"><thead><tr><th class="num">Qty</th><th>Item</th><th class="num">Cost</th><th class="num">Weight</th>${locTh}${notesTh}</tr></thead><tbody>${rows}</tbody></table>`;
}

function loadoutTable(loadout) {
  const rows = (loadout.items || []).map(item =>
    `<tr><td class="num">${escapeHtml(String(item.qty))}</td><td>${escapeHtml(item.name)}</td><td class="num">${escapeHtml(item.cost)}</td><td class="num">${escapeHtml(item.weight)}</td></tr>`
  ).join('\n');
  const totals = (loadout.totalCost != null || loadout.totalWeight != null)
    ? `<tr class="totals-row"><td></td><td><strong>Totals</strong></td><td class="num"><strong>${escapeHtml(loadout.totalCost || '')}</strong></td><td class="num"><strong>${escapeHtml(loadout.totalWeight || '')}</strong></td></tr>`
    : '';
  const inner = `<table class="equip-table loadout-table"><thead><tr><th class="num">Qty</th><th>Item</th><th class="num">Cost</th><th class="num">Weight</th></tr></thead><tbody>${rows}${totals}</tbody></table>`;
  return wide('table', `Load-Out: ${loadout.name}`, inner);
}

function renderEquipment(model) {
  const eq = model.equipment || {};
  const items = eq.items || [];
  const loadouts = eq.loadouts || [];
  if (items.length === 0 && loadouts.length === 0) return null;

  const parts = [];
  if (items.length > 0) {
    const table = inventoryTable(items);
    const inv = wide('table', 'Equipment', table);
    if (inv) parts.push(inv);
  }
  for (const lo of loadouts) {
    const lt = loadoutTable(lo);
    if (lt) parts.push(lt);
  }
  if (parts.length === 0) return null;
  return `<div class="gurps-equipment">${parts.join('\n')}</div>`;
}

module.exports = { renderEquipment };
