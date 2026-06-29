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
    assert.ok(html.includes('Skull'), 'should include Skull location');
    assert.ok(html.includes('3–4'), 'Skull roll range should be 3–4 (en dash)');
  });
  it('includes size/speed-range table values', () => {
    const html = renderReference();
    assert.ok(html.includes('Speed/Range'), 'should include Speed/Range column header');
    assert.ok(html.includes('Linear Measure'), 'should include Linear Measure column header');
  });
});
