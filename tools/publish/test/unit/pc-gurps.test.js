const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderGURPSSheet } = require('../../lib/templates/pc-gurps');

describe('renderGURPSSheet', () => {
  it('renders primary attributes as cards', () => {
    const fm = {
      type: 'pc',
      attributes: { ST: 12, DX: 13, IQ: 11, HT: 10 },
    };
    const html = renderGURPSSheet(fm, []);
    assert.ok(html.includes('gurps-primary-attrs'));
    assert.ok(html.includes('ST'));
    assert.ok(html.includes('12'));
  });

  it('renders secondary characteristics', () => {
    const fm = {
      type: 'pc',
      attributes: { ST: 12, DX: 13, IQ: 11, HT: 10 },
      secondary: { HP: 12, Will: 11, Per: 11, FP: 10, 'Basic Speed': 5.75, 'Basic Move': 5 },
    };
    const html = renderGURPSSheet(fm, []);
    assert.ok(html.includes('HP'));
    assert.ok(html.includes('5.75'));
  });

  it('renders advantages with point costs', () => {
    const fm = {
      type: 'pc',
      advantages: [
        { name: 'Combat Reflexes', cost: 15 },
        { name: 'High Pain Threshold', cost: 10 },
      ],
    };
    const html = renderGURPSSheet(fm, []);
    assert.ok(html.includes('Combat Reflexes'));
    assert.ok(html.includes('[15]'));
    assert.ok(html.includes('gurps-trait-list'));
  });

  it('renders disadvantages with negative costs', () => {
    const fm = {
      type: 'pc',
      disadvantages: [
        { name: 'Bad Temper', cost: -10 },
      ],
    };
    const html = renderGURPSSheet(fm, []);
    assert.ok(html.includes('Bad Temper'));
    assert.ok(html.includes('[-10]'));
  });

  it('renders skills grouped by category', () => {
    const fm = {
      type: 'pc',
      skills: [
        { name: 'Broadsword', level: 14, category: 'Combat', relative: 'DX+1' },
        { name: 'Shield', level: 13, category: 'Combat', relative: 'DX' },
        { name: 'First Aid', level: 12, category: 'Medical', relative: 'IQ+1' },
      ],
    };
    const html = renderGURPSSheet(fm, []);
    assert.ok(html.includes('Combat'));
    assert.ok(html.includes('Medical'));
    assert.ok(html.includes('Broadsword'));
    assert.ok(html.includes('14'));
  });

  it('returns null when no GURPS data present', () => {
    const html = renderGURPSSheet({ type: 'pc' }, []);
    assert.strictEqual(html, null);
  });
});
