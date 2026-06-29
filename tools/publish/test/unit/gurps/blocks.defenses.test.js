const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderDefenses } = require('../../../lib/templates/gurps/blocks/defenses');

describe('renderDefenses', () => {
  it('renders defenses with cat-def class and a representative value', () => {
    const model = { defenses: {
      parry: [{ label: 'Broadsword', value: '10' }],
      block: [],
      dodge: '8',
      hitLocations: [{ location: 'Skull', dr: '2' }],
    } };
    const html = renderDefenses(model);
    assert.ok(html.includes('cat-def'));
    assert.ok(html.includes('Broadsword'));
    assert.ok(html.includes('Dodge'));
    assert.ok(html.includes('Skull'));
  });
  it('returns null when defenses is empty', () => {
    assert.strictEqual(renderDefenses({ defenses: { parry: [], block: [], dodge: null, hitLocations: [] } }), null);
  });
});
