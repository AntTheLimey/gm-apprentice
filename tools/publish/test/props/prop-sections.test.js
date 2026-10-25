const { describe, it } = require('node:test');
const assert = require('node:assert');
const { filterSections } = require('../../lib/processor');
const { kindOfType } = require('../../lib/kind-label');

describe('prop notes', () => {
  it('a prop note withholds its Context and Delivery sections', () => {
    const md = ['## Context', 'Why it matters.', '## The Text', 'Dear sir.', '## Delivery', 'By hand.'].join('\n');
    const out = filterSections(md, [], { type: 'prop' });
    assert.match(out, /Dear sir\./);
    assert.doesNotMatch(out, /Context|Why it matters|Delivery|By hand/);
  });

  it('kindOfType reads prop as an entity', () => {
    assert.strictEqual(kindOfType('prop'), 'entity');
  });
});
