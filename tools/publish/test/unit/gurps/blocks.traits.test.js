const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderTraitList } = require('../../../lib/templates/gurps/blocks/traits');

describe('renderTraitList', () => {
  it('renders advantages with [cost] brackets', () => {
    const model = { traits: { advantages: [{ name: 'Combat Reflexes', cost: '15', markers: [] }] } };
    const html = renderTraitList(model, 'advantages', 'trait', 'Advantages');
    assert.ok(html.includes('Combat Reflexes'));
    assert.ok(html.includes('class="cost"'));
    assert.ok(html.includes('15'));
  });
  it('returns null when the list is empty', () => {
    assert.strictEqual(renderTraitList({ traits: { perks: [] } }, 'perks', 'trait', 'Perks'), null);
  });
});
