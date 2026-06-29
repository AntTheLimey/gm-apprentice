const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderPoints } = require('../../../lib/templates/gurps/blocks/points');

describe('renderPoints', () => {
  it('renders points summary with cat-points class', () => {
    const model = { points: [
      { label: 'Attributes', value: '100' },
      { label: 'Total', value: '150', total: true },
      { label: 'Unspent', value: '5', unspent: true },
    ] };
    const html = renderPoints(model);
    assert.ok(html.includes('cat-points'));
    assert.ok(html.includes('Attributes'));
    assert.ok(html.includes('150'));
    assert.ok(html.includes('total'));
  });
  it('returns null when points is empty', () => {
    assert.strictEqual(renderPoints({ points: [] }), null);
  });
});
