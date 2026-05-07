const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderDnDSheet } = require('../../lib/templates/pc-dnd');

describe('renderDnDSheet', () => {
  it('renders 6 ability score cards', () => {
    const fm = {
      type: 'pc',
      ability_scores: { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 13, CHA: 8 },
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('dnd-ability-scores'));
    assert.ok(html.includes('STR'));
    assert.ok(html.includes('16'));
    assert.ok(html.includes('+3'));
  });

  it('calculates modifiers correctly', () => {
    const fm = {
      type: 'pc',
      ability_scores: { STR: 10, DEX: 8, CON: 15, INT: 1, WIS: 20, CHA: 18 },
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('+0'));
    assert.ok(html.includes('-1'));
    assert.ok(html.includes('+2'));
    assert.ok(html.includes('+5'));
    assert.ok(html.includes('+4'));
  });

  it('renders proficiencies as pills', () => {
    const fm = {
      type: 'pc',
      proficiencies: ['Athletics', 'Perception', 'Stealth'],
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('dnd-proficiencies'));
    assert.ok(html.includes('Athletics'));
    assert.ok(html.includes('Perception'));
  });

  it('renders class features', () => {
    const fm = {
      type: 'pc',
      class_features: [
        { name: 'Sneak Attack', level: 1, description: 'Extra damage on finesse attacks' },
        { name: 'Cunning Action', level: 2, description: 'Bonus action to Dash, Disengage, or Hide' },
      ],
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('Sneak Attack'));
    assert.ok(html.includes('Level 1'));
  });

  it('renders spell slots when present', () => {
    const fm = {
      type: 'pc',
      spell_slots: { 1: 4, 2: 3, 3: 2 },
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('Spell Slots'));
  });

  it('returns null when no D&D data present', () => {
    const html = renderDnDSheet({ type: 'pc' }, []);
    assert.strictEqual(html, null);
  });
});
