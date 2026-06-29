const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderEquipment } = require('../../../lib/templates/gurps/blocks/equipment');

describe('renderEquipment', () => {
  it('renders an inventory table with items', () => {
    const model = {
      equipment: {
        items: [
          { qty: '1', name: 'Broadsword', cost: '$500', weight: '3 lb', location: null, notes: null },
          { qty: '2', name: 'Arrow (30)', cost: '$15', weight: '1 lb', location: null, notes: null },
        ],
        loadouts: [],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html, 'should render non-null html');
    assert.ok(html.includes('Broadsword'), 'should include item name');
    assert.ok(html.includes('$500'), 'should include item cost');
    assert.ok(html.includes('3 lb'), 'should include item weight');
    assert.ok(html.includes('Arrow (30)'), 'should include second item');
    assert.ok(html.includes('cat-table'), 'should have cat-table class');
  });
  it('renders load-outs with a Totals footer row', () => {
    const model = {
      equipment: {
        items: [],
        loadouts: [
          {
            name: 'Light Travel',
            items: [
              { qty: '1', name: 'Dagger', cost: '$20', weight: '0.25 lb', location: null, notes: null },
            ],
            totalCost: '$20',
            totalWeight: '0.25 lb',
          },
        ],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html, 'should render non-null html');
    assert.ok(html.includes('Light Travel'), 'should include load-out name');
    assert.ok(html.includes('Dagger'), 'should include load-out item');
    assert.ok(html.includes('Totals'), 'should include Totals footer');
    assert.ok(html.includes('$20'), 'should include total cost');
  });
  it('returns null when no equipment', () => {
    assert.strictEqual(renderEquipment({ equipment: { items: [], loadouts: [] } }), null);
    assert.strictEqual(renderEquipment({}), null);
  });
  it('renders both inventory table and load-out when both present', () => {
    const model = {
      equipment: {
        items: [{ qty: '1', name: 'Crossbow', cost: '$150', weight: '6 lb', location: null, notes: null }],
        loadouts: [
          {
            name: 'Adventuring',
            items: [{ qty: '1', name: 'Rope', cost: '$5', weight: '4 lb', location: null, notes: null }],
            totalCost: '$5',
            totalWeight: '4 lb',
          },
        ],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html.includes('Crossbow'), 'should include inventory item');
    assert.ok(html.includes('Adventuring'), 'should include load-out name');
    assert.ok(html.includes('Totals'), 'should include totals row');
  });

  it('mixed location/notes: all rows have same <td> count (column alignment)', () => {
    // Only item 0 has a location, only item 1 has notes.
    // After fix, both rows must emit a <td> for each column that exists in ANY row.
    const model = {
      equipment: {
        items: [
          { qty: '1', name: 'Sword',   cost: '$600', weight: '3 lb', location: 'Belt',  notes: null   },
          { qty: '2', name: 'Rations', cost: '$5',   weight: '1 lb', location: null,    notes: 'Iron' },
        ],
        loadouts: [],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html, 'should render html');
    // Count <td> elements in each <tr> — they must be equal.
    const rowMatches = html.match(/<tr>([\s\S]*?)<\/tr>/g) || [];
    // Skip the header row (uses <th>)
    const dataRows = rowMatches.filter(r => r.includes('<td'));
    assert.ok(dataRows.length >= 2, 'should have at least 2 data rows');
    const tdCounts = dataRows.map(r => (r.match(/<td/g) || []).length);
    const allSame = tdCounts.every(c => c === tdCounts[0]);
    assert.ok(allSame, `td counts must be equal across rows; got ${tdCounts.join(', ')}`);
    // Both column headers present
    assert.ok(html.includes('<th>Location</th>'), 'Location header present');
    assert.ok(html.includes('<th>Notes</th>'), 'Notes header present');
    // The row without location shows an empty td (not missing td)
    assert.ok(html.includes('<td>Belt</td>'), 'location cell for Sword');
    assert.ok(html.includes('<td>Iron</td>'), 'notes cell for Rations');
  });
});
