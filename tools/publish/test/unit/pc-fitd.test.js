const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderFitDSheet } = require('../../lib/templates/pc-fitd');

describe('renderFitDSheet', () => {
  it('renders action ratings as dots', () => {
    const fm = {
      type: 'pc',
      action_ratings: {
        Insight: { Hunt: 2, Study: 1, Survey: 0, Tinker: 1 },
        Prowess: { Finesse: 0, Prowl: 2, Skirmish: 1, Wreck: 0 },
        Resolve: { Attune: 0, Command: 1, Consort: 2, Sway: 0 },
      },
    };
    const html = renderFitDSheet(fm, []);
    assert.ok(html.includes('fitd-action-ratings'));
    assert.ok(html.includes('Hunt'));
    assert.ok(html.includes('fitd-dot filled'));
    assert.ok(html.includes('fitd-dot"'));
  });

  it('renders stress tracker', () => {
    const fm = {
      type: 'pc',
      stress: { current: 4, max: 9 },
    };
    const html = renderFitDSheet(fm, []);
    assert.ok(html.includes('Stress'));
    assert.ok(html.includes('4'));
  });

  it('renders trauma tracker', () => {
    const fm = {
      type: 'pc',
      trauma: ['Cold', 'Haunted'],
    };
    const html = renderFitDSheet(fm, []);
    assert.ok(html.includes('Trauma'));
    assert.ok(html.includes('Cold'));
    assert.ok(html.includes('Haunted'));
  });

  it('renders special abilities as cards', () => {
    const fm = {
      type: 'pc',
      special_abilities: [
        { name: 'Ghost Mind', description: 'You can push yourself to attune to the ghost field.' },
      ],
    };
    const html = renderFitDSheet(fm, []);
    assert.ok(html.includes('fitd-special-ability'));
    assert.ok(html.includes('Ghost Mind'));
  });

  it('returns null when no FitD data present', () => {
    const html = renderFitDSheet({ type: 'pc' }, []);
    assert.strictEqual(html, null);
  });
});
