const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderSenses } = require('../../../lib/templates/gurps/blocks/senses');

describe('renderSenses', () => {
  it('renders senses with cat-attr class and a representative value', () => {
    const model = { senses: { Vision: '13', Hearing: '13', 'Fright Check': '11' } };
    const html = renderSenses(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('Vision'));
    assert.ok(html.includes('13'));
  });
  it('returns null when senses is empty', () => {
    assert.strictEqual(renderSenses({ senses: {} }), null);
  });
});
