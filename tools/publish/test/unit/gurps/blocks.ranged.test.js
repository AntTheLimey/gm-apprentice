const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderRanged } = require('../../../lib/templates/gurps/blocks/ranged');

describe('renderRanged', () => {
  it('renders ranged table with wide wrapper', () => {
    const model = { ranged: [
      { weapon: 'Bow', skill: '14', damage: '1d+1 imp', acc: '2', range: '140/210', rof: '1', shots: 'T(2)', st: '10', bulk: '-6', rcl: '1', notes: '' },
    ] };
    const html = renderRanged(model);
    assert.ok(html.includes('wide'));
    assert.ok(html.includes('Bow'));
    assert.ok(html.includes('1d+1 imp'));
    assert.ok(html.includes('140/210'));
  });
  it('shows the to-hit level and a live weapon-key hook, like melee', () => {
    const model = { ranged: [
      { weapon: 'Blaster pistol', skill: 'Beam Weapons (Pistol)-15', damage: '3d (5) burn', acc: '6', range: '300/900', rof: '3', shots: '200(3)', st: '', bulk: '-2', rcl: '', notes: '' },
    ] };
    const html = renderRanged(model);
    // Trailing number wrapped as the current skill level (default surfaces the same way).
    assert.ok(html.includes('Beam Weapons (Pistol)-<span class="wp-tohit">15</span>'));
    // Row carries the key the live script updates.
    assert.ok(html.includes('data-weapon-key="Blaster pistol"'));
  });
  it('returns null when ranged is empty', () => {
    assert.strictEqual(renderRanged({ ranged: [] }), null);
  });
});
