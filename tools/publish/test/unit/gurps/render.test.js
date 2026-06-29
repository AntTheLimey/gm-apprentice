const { describe, it } = require('node:test');
const assert = require('node:assert');
const { splitMarkers, footnoteRegistry, block, cost } = require('../../../lib/templates/gurps/render');

describe('gurps/render', () => {
  it('splits trailing footnote glyphs from a value', () => {
    assert.deepStrictEqual(splitMarkers('20*'), { value: '20', markers: ['*'] });
    assert.deepStrictEqual(splitMarkers('15†‡'), { value: '15', markers: ['†', '‡'] });
    assert.deepStrictEqual(splitMarkers('10'), { value: '10', markers: [] });
  });
  it('footnote legend lists recorded notes in order', () => {
    const fn = footnoteRegistry();
    const sup = fn.note('includes', '+2 from Healer');
    assert.ok(sup.includes('†') || sup.includes('*'));
    assert.ok(fn.legendHtml().includes('Includes'));
    assert.ok(fn.legendHtml().includes('+2 from Healer'));
  });
  it('block returns null for empty inner', () => {
    assert.strictEqual(block('skill', 'Skills', ''), null);
    assert.ok(block('skill', 'Skills', '<div>x</div>').includes('cat-skill'));
  });
  it('cost wraps a value (brackets added by CSS)', () => {
    assert.ok(cost(-5).includes('class="cost"'));
    assert.ok(cost(-5).includes('-5'));
  });
});
