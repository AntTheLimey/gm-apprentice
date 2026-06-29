const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderReference } = require('../../../lib/templates/gurps/blocks/reference');

describe('renderReference', () => {
  it('renders a collapsed details block with both tables and citations', () => {
    const html = renderReference();
    assert.ok(html.includes('<details'), 'should have <details element');
    assert.ok(!html.includes(' open'), 'should be default collapsed (no open attribute)');
    assert.ok(html.includes('Hit Location'), 'should include Hit Location table');
    assert.ok(html.includes('B552'), 'should cite B552');
    assert.ok(html.includes('B550'), 'should cite B550');
  });
  it('includes the summary element with Rules Reference text', () => {
    const html = renderReference();
    assert.ok(html.includes('<summary>'), 'should have summary element');
    assert.ok(html.includes('Rules Reference'), 'summary should say Rules Reference');
  });
  it('includes humanoid hit location roll values', () => {
    const html = renderReference();
    // Skull is 3-4
    assert.ok(html.includes('Skull') || html.includes('skull'), 'should include Skull location');
  });
  it('includes size/speed-range table values', () => {
    const html = renderReference();
    assert.ok(html.includes('Size') || html.includes('Speed'), 'should include size/speed table');
    // New 3-column layout: Speed/Range, Size Modifier, Linear Measure columns
    assert.ok(html.includes('Speed/Range') || html.includes('speed-range') || html.includes('Speed'),
      'should include Speed/Range column header');
    assert.ok(html.includes('Linear Measure') || html.includes('Yards') || html.includes('yd'),
      'should include linear measure column');
  });
});
