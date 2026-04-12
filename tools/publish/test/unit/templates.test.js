const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stubBadge, metadataBadgesFor, cssPath, rootPath } = require('../../lib/templates/base');

describe('stubBadge', () => {
  it('returns badge for STUB status', () => {
    const result = stubBadge({ canon_status: 'STUB' });
    assert.ok(result.includes('stub-badge'));
    assert.ok(result.includes('Stub'));
  });

  it('returns empty string for non-stub', () => {
    assert.strictEqual(stubBadge({ canon_status: 'ACTIVE' }), '');
    assert.strictEqual(stubBadge({}), '');
  });
});

describe('metadataBadgesFor', () => {
  it('renders event badges', () => {
    const fm = { type: 'event', event_type: 'Combat', date: '1943-05-01' };
    const result = metadataBadgesFor(fm);
    assert.ok(result.includes('Combat'));
    assert.ok(result.includes('1943-05-01'));
  });

  it('strips wiki-link brackets', () => {
    const fm = { type: 'event', location: '[[Berlin]]' };
    const result = metadataBadgesFor(fm);
    assert.ok(result.includes('Berlin'));
    assert.ok(!result.includes('[['));
  });

  it('returns empty for unknown type', () => {
    const fm = { type: 'unknown' };
    assert.strictEqual(metadataBadgesFor(fm), '');
  });
});

describe('cssPath', () => {
  it('handles root level', () => {
    assert.strictEqual(cssPath('index.html'), 'css/style.css');
  });

  it('handles one level deep', () => {
    assert.strictEqual(cssPath('factions/index.html'), '../css/style.css');
  });

  it('handles two levels deep', () => {
    assert.strictEqual(cssPath('characters/pcs/john.html'), '../../css/style.css');
  });
});

describe('rootPath', () => {
  it('handles root level', () => {
    assert.strictEqual(rootPath('index.html'), './');
  });

  it('handles nested paths', () => {
    assert.strictEqual(rootPath('characters/pcs/john.html'), '../../');
  });
});
