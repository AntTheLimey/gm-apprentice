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
});
