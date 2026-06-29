const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderGURPSSheet } = require('../../../lib/templates/gurps/index');

const statSheet = { title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3><table><tr><th>Attr</th><th>Level</th></tr><tr><td>ST</td><td>10</td></tr></table>' };

const meleeSection = {
  title: 'Melee Weapons', id: 'melee-weapons',
  html: '<table><tr><th>Weapon</th><th>Skill</th><th>Parry</th><th>Damage</th><th>Reach</th><th>ST</th><th>Notes</th></tr>' +
        '<tr><td>Broadsword</td><td>14</td><td>10</td><td>2d-1 cut</td><td>1</td><td>10</td><td></td></tr></table>',
};

const equipSection = {
  title: 'Equipment', id: 'equipment',
  html: '<table><tr><th>Qty</th><th>Name</th><th>Cost</th><th>Weight</th></tr>' +
        '<tr><td>1</td><td>Broadsword</td><td>$500</td><td>3 lb</td></tr></table>',
};

describe('renderGURPSSheet (index)', () => {
  it('returns an object with sheetHtml containing the attributes block', () => {
    const out = renderGURPSSheet({}, [statSheet]);
    assert.strictEqual(typeof out, 'object');
    assert.ok(out.sheetHtml.includes('cat-attr'));
  });
  it('returns { sheetHtml: null } when there is no GURPS data', () => {
    const out = renderGURPSSheet({ type: 'pc' }, []);
    assert.strictEqual(out.sheetHtml, null);
  });
  it('combatHtml includes melee table and rules-ref when melee data present', () => {
    const out = renderGURPSSheet({}, [meleeSection]);
    assert.ok(out.combatHtml, 'combatHtml should be non-null when melee present');
    assert.ok(out.combatHtml.includes('Broadsword'), 'combatHtml should contain melee weapon');
    assert.ok(out.combatHtml.includes('rules-ref'), 'combatHtml should contain rules-ref details');
  });
  it('combatHtml is null when no combat data', () => {
    const out = renderGURPSSheet({ type: 'pc' }, []);
    assert.strictEqual(out.combatHtml, null);
  });
  it('equipmentHtml includes items and is non-null when equipment present', () => {
    const out = renderGURPSSheet({}, [equipSection]);
    assert.ok(out.equipmentHtml, 'equipmentHtml should be non-null when equipment present');
    assert.ok(out.equipmentHtml.includes('Broadsword'), 'equipmentHtml should include item name');
  });
  it('equipmentHtml is null when no equipment', () => {
    const out = renderGURPSSheet({ type: 'pc' }, []);
    assert.strictEqual(out.equipmentHtml, null);
  });
});
