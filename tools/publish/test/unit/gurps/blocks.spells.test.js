const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderSpells } = require('../../../lib/templates/gurps/blocks/spells');

describe('renderSpells', () => {
  it('renders spells with cat-spell class and representative value', () => {
    const model = { spells: [
      { name: 'Fireball', level: '14', points: '4', markers: [] },
    ] };
    const html = renderSpells(model);
    assert.ok(html.includes('cat-spell'));
    assert.ok(html.includes('Fireball'));
    assert.ok(html.includes('14'));
  });
  it('returns null when spells is empty', () => {
    assert.strictEqual(renderSpells({ spells: [] }), null);
  });
});
