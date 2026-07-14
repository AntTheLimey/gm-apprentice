const { test } = require('node:test');
const assert = require('node:assert');
const { renderEquipment } = require('../lib/templates/gurps/blocks/equipment');

test('main items get checked toggles; loadout items get unchecked toggles', () => {
  const model = { equipment: {
    items: [{ qty: '1', name: 'Vibro-axe', cost: '$500', weight: '4 lbs' }],
    loadouts: [{ name: 'Transit', items: [{ qty: '1', name: 'Hand thruster', cost: '$50', weight: '4 lbs' }] }],
  } };
  const html = renderEquipment(model);
  assert.match(html, /class="eq-toggle"[^>]*data-item-key="Vibro-axe"[^>]*data-weight="4"[^>]*checked/);
  assert.match(html, /data-item-key="Hand thruster"[^>]*data-weight="4"/);
  // loadout toggle is NOT checked
  assert.doesNotMatch(html, /data-item-key="Hand thruster"[^>]*checked/);
});
