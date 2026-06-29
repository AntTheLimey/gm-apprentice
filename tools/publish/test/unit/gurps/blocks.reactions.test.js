const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderReactions } = require('../../../lib/templates/gurps/blocks/reactions');

describe('renderReactions', () => {
  it('renders reactions with cat-social class and representative value', () => {
    const model = { reactions: { 'Appearance': '+2', 'Status': '+1' } };
    const html = renderReactions(model);
    assert.ok(html.includes('cat-social'));
    assert.ok(html.includes('Appearance'));
    assert.ok(html.includes('+2'));
  });
  it('returns null when reactions is empty', () => {
    assert.strictEqual(renderReactions({ reactions: {} }), null);
  });
});
