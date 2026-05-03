const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderCoCSheet } = require('../../lib/templates/pc-coc');

describe('renderCoCSheet', () => {
  it('renders characteristics grid', () => {
    const fm = {
      type: 'pc',
      characteristics: { STR: 60, CON: 50, SIZ: 65, DEX: 55, APP: 70, INT: 80, POW: 60, EDU: 75 },
    };
    const html = renderCoCSheet(fm, []);
    assert.ok(html.includes('coc-characteristics'));
    assert.ok(html.includes('STR'));
    assert.ok(html.includes('60'));
  });

  it('renders sanity tracker', () => {
    const fm = {
      type: 'pc',
      sanity: { current: 45, max: 60, onset: 'Phobias' },
    };
    const html = renderCoCSheet(fm, []);
    assert.ok(html.includes('coc-sanity-tracker'));
    assert.ok(html.includes('45'));
  });

  it('renders skills by category', () => {
    const fm = {
      type: 'pc',
      skills: [
        { name: 'Library Use', value: 65, category: 'Investigation' },
        { name: 'Spot Hidden', value: 55, category: 'Investigation' },
        { name: 'Fighting (Brawl)', value: 40, category: 'Combat' },
      ],
    };
    const html = renderCoCSheet(fm, []);
    assert.ok(html.includes('Investigation'));
    assert.ok(html.includes('Library Use'));
    assert.ok(html.includes('65'));
  });
});
