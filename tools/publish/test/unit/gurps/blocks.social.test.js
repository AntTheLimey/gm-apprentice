const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderCultural, renderLanguages } = require('../../../lib/templates/gurps/blocks/social');

describe('renderCultural', () => {
  it('renders cultural familiarities with cat-social class', () => {
    const model = { social: { cultural: [{ name: 'Western', cost: '0', markers: [] }], languages: [] } };
    const html = renderCultural(model);
    assert.ok(html.includes('cat-social'));
    assert.ok(html.includes('Western'));
  });
  it('returns null when cultural is empty', () => {
    assert.strictEqual(renderCultural({ social: { cultural: [], languages: [] } }), null);
  });
});

describe('renderLanguages', () => {
  it('renders languages with cat-social class and spoken/written columns', () => {
    const model = { social: { cultural: [], languages: [
      { name: 'English', spoken: 'Native', written: 'Native', points: '0' },
    ] } };
    const html = renderLanguages(model);
    assert.ok(html.includes('cat-social'));
    assert.ok(html.includes('English'));
    assert.ok(html.includes('Native'));
  });
  it('returns null when languages is empty', () => {
    assert.strictEqual(renderLanguages({ social: { cultural: [], languages: [] } }), null);
  });
});
