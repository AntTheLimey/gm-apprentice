const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderMelee } = require('../../../lib/templates/gurps/blocks/melee');

describe('renderMelee', () => {
  it('renders melee table with wide wrapper and dmg class', () => {
    const model = { melee: [
      { weapon: 'Broadsword', skill: '14', parry: '10', damage: '2d+1 cut', reach: '1', st: '10', notes: '' },
    ] };
    const html = renderMelee(model);
    assert.ok(html.includes('wide'));
    assert.ok(html.includes('Broadsword'));
    assert.ok(html.includes('dmg'));
    assert.ok(html.includes('2d+1 cut'));
  });
  it('returns null when melee is empty', () => {
    assert.strictEqual(renderMelee({ melee: [] }), null);
  });
});
