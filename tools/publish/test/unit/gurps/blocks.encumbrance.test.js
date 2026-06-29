const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderEncumbrance } = require('../../../lib/templates/gurps/blocks/encumbrance');

describe('renderEncumbrance', () => {
  it('renders encumbrance table with cat-attr class', () => {
    const model = { encumbrance: [
      { level: 'None (0)', weight: '20 lb', move: '5', dodge: '8', current: true },
      { level: 'Light (1)', weight: '40 lb', move: '4', dodge: '7', current: false },
    ] };
    const html = renderEncumbrance(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('None (0)'));
    assert.ok(html.includes('cur'));
  });
  it('returns null when encumbrance is empty', () => {
    assert.strictEqual(renderEncumbrance({ encumbrance: [] }), null);
  });
});
