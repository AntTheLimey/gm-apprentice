const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderStatus } = require('../../../lib/templates/gurps/blocks/status');

describe('renderStatus', () => {
  it('renders status banner with hp, fp, condition', () => {
    const model = { status: { hp: '10', fp: '10', condition: 'Healthy', move: '5', enc: '0' } };
    const html = renderStatus(model);
    assert.ok(html.includes('status'));
    assert.ok(html.includes('HP'));
    assert.ok(html.includes('Healthy'));
  });
  it('returns null when status is empty', () => {
    assert.strictEqual(renderStatus({ status: {} }), null);
  });
  // Fix 3: carrying field must render
  it('renders carrying text when present', () => {
    const model = { status: { hp: '10', carrying: 'Light Load (18 lb)' } };
    const html = renderStatus(model);
    assert.ok(html != null, 'should render non-null html');
    assert.ok(html.includes('Light Load (18 lb)'), 'should include carrying text');
    assert.ok(html.includes('carrying'), 'should include carrying class or label');
  });
  it('omits carrying element when not present', () => {
    const model = { status: { hp: '10' } };
    const html = renderStatus(model);
    assert.ok(!html.includes('Carrying:'), 'should not include Carrying: label when absent');
  });
});
