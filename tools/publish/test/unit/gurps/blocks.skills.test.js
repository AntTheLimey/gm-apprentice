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
  });
  it('returns null when no skills', () => {
    assert.strictEqual(renderSkills({ skills: [] }), null);
  });
});
