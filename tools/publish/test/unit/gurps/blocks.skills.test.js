const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderSkills } = require('../../../lib/templates/gurps/blocks/skills');

describe('renderSkills', () => {
  it('renders skills with level, relative, points, parry sub-line, citation', () => {
    const model = { skills: [
      { name: 'Brawling', level: '12', relative: 'DX+0', points: '1', parry: '8', markers: [], source: 'B182' },
      { name: 'Diplomacy', level: '19', relative: 'IQ+1', points: '2', markers: ['†'] },
    ] };
    const html = renderSkills(model);
    assert.ok(html.includes('cat-skill'));
    assert.ok(html.includes('Brawling'));
    assert.ok(html.includes('Parry: 8'));
    assert.ok(html.includes('B182'));
    assert.ok(html.includes('fn-legend') || html.includes('class="fn"'));
    // Relative level column
    assert.ok(html.includes('<td class="num rel">DX+0</td>'), 'relative column shows DX+0');
    assert.ok(html.includes('<td class="num rel">IQ+1</td>'), 'relative column shows IQ+1');
    // Point cost column
    assert.ok(html.includes('<span class="cost">1</span>'), 'points column shows 1');
    assert.ok(html.includes('<span class="cost">2</span>'), 'points column shows 2');
  });
  it('returns null when no skills', () => {
    assert.strictEqual(renderSkills({ skills: [] }), null);
  });
  it('shows a base sub-line only when Current differs from Base', () => {
    const model = { skills: [
      { name: 'Climbing', level: '10', base: '12', relative: 'DX-1', points: '1', markers: [] },
      { name: 'Broadsword', level: '15', base: '15', relative: 'DX+2', points: '8', markers: [] },
    ] };
    const html = renderSkills(model);
    assert.ok(html.includes('base 12'), 'differing base is shown');
    assert.strictEqual(html.includes('base 15'), false, 'equal base is not repeated');
  });
});
