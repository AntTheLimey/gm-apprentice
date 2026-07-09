const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderPF2eSheet } = require('../../lib/templates/pc-pf2e');

describe('renderPF2eSheet', () => {
  it('renders 6 attribute cards with signed modifiers', () => {
    const fm = {
      type: 'pc',
      attributes: { STR: 4, DEX: 2, CON: 1, INT: 0, WIS: 1, CHA: -1 },
    };
    const html = renderPF2eSheet(fm, []);
    assert.ok(html.includes('pf2e-attributes'));
    assert.ok(html.includes('STR'));
    assert.ok(html.includes('+4'));
    assert.ok(html.includes('+0'));
    assert.ok(html.includes('-1'));
  });

  it('renders skill proficiencies as pills with rank', () => {
    const fm = {
      type: 'pc',
      skill_proficiencies: [
        { name: 'Athletics', rank: 'Expert' },
        { name: 'Stealth', rank: 'Trained' },
      ],
    };
    const html = renderPF2eSheet(fm, []);
    assert.ok(html.includes('pf2e-proficiencies'));
    assert.ok(html.includes('Athletics'));
    assert.ok(html.includes('Expert'));
  });

  it('renders plain-string proficiencies', () => {
    const fm = {
      type: 'pc',
      skill_proficiencies: ['Acrobatics', 'Occultism'],
    };
    const html = renderPF2eSheet(fm, []);
    assert.ok(html.includes('Acrobatics'));
    assert.ok(html.includes('Occultism'));
  });

  it('renders class features sorted by level', () => {
    const fm = {
      type: 'pc',
      class_features: [
        { name: 'Sneak Attack', level: 1, description: 'Extra precision damage vs off-guard' },
        { name: 'Deny Advantage', level: 3, description: 'Not off-guard to hidden attackers' },
      ],
    };
    const html = renderPF2eSheet(fm, []);
    assert.ok(html.includes('Sneak Attack'));
    assert.ok(html.includes('Level 1'));
    assert.ok(html.indexOf('Sneak Attack') < html.indexOf('Deny Advantage'));
  });

  it('renders hero points when present', () => {
    const fm = { type: 'pc', hero_points: 2 };
    const html = renderPF2eSheet(fm, []);
    assert.ok(html.includes('Hero Points'));
    assert.ok(html.includes('2'));
  });

  it('renders spell slots by rank', () => {
    const fm = {
      type: 'pc',
      spell_slots: { 1: 3, 2: 2 },
    };
    const html = renderPF2eSheet(fm, []);
    assert.ok(html.includes('Spell Slots'));
    assert.ok(html.includes('Rank 1'));
  });

  it('returns null when no PF2e data present', () => {
    const html = renderPF2eSheet({ type: 'pc' }, []);
    assert.strictEqual(html, null);
  });
});
