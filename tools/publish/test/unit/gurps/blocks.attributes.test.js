const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderAttributes } = require('../../../lib/templates/gurps/blocks/attributes');

describe('renderAttributes', () => {
  it('renders primary attribute cards with values', () => {
    const model = { attributes: {
      primary: {
        ST: { value: '10', markers: [], cost: '90' },
        DX: { value: '12', markers: [], cost: '40' },
        IQ: { value: '18', markers: ['*'], cost: '160' },
        HT: { value: '10', markers: [] },
      },
      secondary: { HP: { value: '10', markers: [] } },
      derived: {},
    } };
    const html = renderAttributes(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('18'));
    assert.ok(html.includes('attrgrid'));
  });

  it('shows point cost in primary cards when present', () => {
    const model = { attributes: {
      primary: { ST: { value: '12', markers: [], cost: '18' } },
      secondary: {},
      derived: {},
    } };
    const html = renderAttributes(model);
    assert.ok(html.includes('[18]'), 'cost should render as [18]');
  });

  it('renders secondary sub-group and derived strip', () => {
    const model = { attributes: {
      primary: { ST: { value: '12', markers: [] } },
      secondary: { HP: { value: '12', markers: [] }, Will: { value: '11', markers: [] } },
      derived: { 'Basic Lift': { value: '29 lbs', markers: [] }, 'Damage (Thr)': { value: '1d-1', markers: [] } },
    } };
    const html = renderAttributes(model);
    assert.ok(html.includes('subgrid'), 'secondary subgrid present');
    assert.ok(html.includes('derived'), 'derived strip present');
    assert.ok(html.includes('attr-sublabel'), 'sub-group labels present');
    assert.ok(html.includes('BL'), 'derived BL label present');
    assert.ok(html.includes('Thr'), 'derived Thr label present');
  });

  it('does not render a "Characteristic" junk cell', () => {
    const model = { attributes: {
      primary: { ST: { value: '10', markers: [] } },
      secondary: { HP: { value: '10', markers: [] } },
      derived: {},
    } };
    const html = renderAttributes(model);
    assert.ok(!html.includes('>Characteristic<'), 'no Characteristic junk cell');
    assert.ok(!html.includes('>Value<'), 'no Value junk cell from header row');
  });

  it('returns null when no attributes', () => {
    assert.strictEqual(renderAttributes({ attributes: { primary: {}, secondary: {}, derived: {} } }), null);
  });
});
