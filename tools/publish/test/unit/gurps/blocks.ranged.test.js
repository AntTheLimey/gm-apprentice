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
  it('returns null when ranged is empty', () => {
    assert.strictEqual(renderRanged({ ranged: [] }), null);
  });
});
