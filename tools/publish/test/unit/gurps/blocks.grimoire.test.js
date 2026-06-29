const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderGrimoire } = require('../../../lib/templates/gurps/blocks/grimoire');

describe('renderGrimoire', () => {
  it('renders grimoire table with wide wrapper', () => {
    const model = { grimoire: [
      { name: 'Fireball', skill: '14', class: 'Regular', time: '1 sec', duration: 'Instant', cost: '2', college: 'Fire', page: 'M140' },
    ] };
    const html = renderGrimoire(model);
    assert.ok(html.includes('wide'));
    assert.ok(html.includes('Fireball'));
    assert.ok(html.includes('Fire'));
    assert.ok(html.includes('M140'));
  });
  it('returns null when grimoire is empty', () => {
    assert.strictEqual(renderGrimoire({ grimoire: [] }), null);
  });
});
