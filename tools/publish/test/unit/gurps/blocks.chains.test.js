const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderChains } = require('../../../lib/templates/gurps/blocks/chains');

describe('renderChains', () => {
  it('renders melee chains as step arrows', () => {
    const model = {
      chains: {
        melee: [{ name: 'Sword Combo', steps: ['Feint', 'Deceptive Attack', 'All-Out Attack'] }],
        ranged: [],
      },
    };
    const html = renderChains(model);
    assert.ok(html.includes('cat-chain'));
    assert.ok(html.includes('Sword Combo'));
    assert.ok(html.includes('Feint'));
    assert.ok(html.includes('→'));
    assert.ok(html.includes('Deceptive Attack'));
    assert.ok(html.includes('All-Out Attack'));
  });
  it('renders ranged chains', () => {
    const model = {
      chains: {
        melee: [],
        ranged: [{ name: 'Aimed Shot', steps: ['Aim', 'Attack'] }],
      },
    };
    const html = renderChains(model);
    assert.ok(html.includes('Aimed Shot'));
    assert.ok(html.includes('Aim'));
    assert.ok(html.includes('→'));
    assert.ok(html.includes('Attack'));
  });
  it('returns null when no chains', () => {
    assert.strictEqual(renderChains({ chains: { melee: [], ranged: [] } }), null);
    assert.strictEqual(renderChains({ chains: null }), null);
  });
});
