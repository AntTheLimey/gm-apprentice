const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseGurps } = require('../../../lib/templates/gurps/parse');
const { renderGURPSSheet } = require('../../../lib/templates/gurps/index');

const statSheet = {
  title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3><table><tr><th>Attr</th><th>Level</th></tr>' +
        '<tr><td>ST</td><td>10</td></tr><tr><td>DX</td><td>12</td></tr>' +
        '<tr><td>IQ</td><td>18*</td></tr><tr><td>HT</td><td>10</td></tr></table>' +
        '<h3>Secondary Characteristics</h3><table><tr><td>HP</td><td>10</td></tr>' +
        '<tr><td>Will</td><td>18</td></tr></table>',
};

// Vault-style stat sheet: has Characteristic/Value header + Cost column
const vaultStatSheet = {
  title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3>' +
        '<table><tr><th>Attribute</th><th>Score</th><th>Modifier</th><th>Cost</th></tr>' +
        '<tr><td>ST</td><td>12</td><td>—</td><td>[18]</td></tr>' +
        '<tr><td>DX</td><td>15</td><td>—</td><td>[100]</td></tr>' +
        '<tr><td>IQ</td><td>11</td><td>—</td><td>[20]</td></tr>' +
        '<tr><td>HT</td><td>12</td><td>—</td><td>[20]</td></tr></table>' +
        '<h3>Secondary Characteristics</h3>' +
        '<table><tr><th>Characteristic</th><th>Value</th></tr>' +
        '<tr><td>HP</td><td>12</td></tr>' +
        '<tr><td>Will</td><td>11</td></tr>' +
        '<tr><td>Per</td><td>12</td></tr>' +
        '<tr><td>FP</td><td>12</td></tr>' +
        '<tr><td>Basic Speed</td><td>6.75</td></tr>' +
        '<tr><td>Basic Move</td><td>6</td></tr>' +
        '<tr><td>Basic Lift</td><td>29 lbs</td></tr>' +
        '<tr><td>Damage (Thr)</td><td>1d-1</td></tr>' +
        '<tr><td>Damage (Sw)</td><td>1d+2</td></tr>' +
        '<tr><td>Size Modifier</td><td>+1</td></tr></table>',
};

describe('parseGurps', () => {
  it('reads primary attributes from the Stat Sheet, splitting footnote markers', () => {
    const c = parseGurps({}, [statSheet]);
    assert.strictEqual(c.attributes.primary.ST.value, '10');
    assert.strictEqual(c.attributes.primary.IQ.value, '18');
    assert.deepStrictEqual(c.attributes.primary.IQ.markers, ['*']);
  });
  it('reads secondary characteristics', () => {
    const c = parseGurps({}, [statSheet]);
    assert.strictEqual(c.attributes.secondary.HP.value, '10');
  });
  it('frontmatter.attributes overrides parsed primary values', () => {
    const c = parseGurps({ attributes: { ST: 20 } }, [statSheet]);
    assert.strictEqual(c.attributes.primary.ST.value, '20');
  });
  it('returns a model even with no sections', () => {
    const c = parseGurps({}, []);
    assert.ok(c.attributes && c.skills && c.melee);
  });

  // Header-row guard: no "Characteristic" junk key
  it('skips the "Characteristic/Value" header row in secondary table', () => {
    const c = parseGurps({}, [vaultStatSheet]);
    assert.strictEqual(c.attributes.secondary['Characteristic'], undefined,
      '"Characteristic" must not appear as a secondary key');
    assert.strictEqual(c.attributes.secondary.HP.value, '12');
    assert.strictEqual(c.attributes.secondary.Will.value, '11');
  });

  // Cost column parsed from Primary Attributes table
  it('parses Cost column from primary attributes table', () => {
    const c = parseGurps({}, [vaultStatSheet]);
    assert.strictEqual(c.attributes.primary.ST.cost, '18',  'ST cost = 18');
    assert.strictEqual(c.attributes.primary.DX.cost, '100', 'DX cost = 100');
    assert.strictEqual(c.attributes.primary.IQ.cost, '20',  'IQ cost = 20');
    assert.strictEqual(c.attributes.primary.HT.cost, '20',  'HT cost = 20');
  });

  // Derived values routed to model.attributes.derived
  it('routes derived values (Basic Lift, Damage, SM) to attributes.derived', () => {
    const c = parseGurps({}, [vaultStatSheet]);
    assert.strictEqual(c.attributes.derived['Basic Lift'].value, '29 lbs');
    assert.strictEqual(c.attributes.derived['Damage (Thr)'].value, '1d-1');
    assert.strictEqual(c.attributes.derived['Damage (Sw)'].value, '1d+2');
    assert.strictEqual(c.attributes.derived['Size Modifier'].value, '+1');
    // Must NOT appear in secondary
    assert.strictEqual(c.attributes.secondary['Basic Lift'], undefined);
  });

  // True secondary chars go to secondary
  it('routes true secondary chars (HP, Will, FP, etc.) to attributes.secondary', () => {
    const c = parseGurps({}, [vaultStatSheet]);
    assert.strictEqual(c.attributes.secondary.HP.value, '12');
    assert.strictEqual(c.attributes.secondary.FP.value, '12');
    assert.strictEqual(c.attributes.secondary['Basic Move'].value, '6');
  });
});

// Fix 1: Equipment parser must not include subsection rows from ### Encumbrance
describe('parseGurps — Equipment section', () => {
  const equipHtml =
    '<table>' +
    '<tr><th>Item</th><th>Weight</th><th>Cost</th></tr>' +
    '<tr><td>Broadsword</td><td>3 lb</td><td>$600</td></tr>' +
    '<tr><td>Large Shield</td><td>15 lb</td><td>$90</td></tr>' +
    '<tr><td>Mail Hauberk</td><td>25 lb</td><td>$230</td></tr>' +
    '</table>' +
    '<h3>Encumbrance</h3>' +
    '<table>' +
    '<tr><th>Level</th><th>Max Weight</th><th>Move</th><th>Dodge</th></tr>' +
    '<tr><td>None (0)</td><td>22 lb</td><td>6</td><td>9</td></tr>' +
    '<tr><td>Light (1)</td><td>44 lb</td><td>4</td><td>8</td></tr>' +
    '<tr><td>Medium (2)</td><td>66 lb</td><td>3</td><td>7</td></tr>' +
    '</table>';

  const equipSection = { title: 'Equipment', id: 'equipment', html: equipHtml };

  it('parseEquipment yields exactly 3 items (not encumbrance rows)', () => {
    const model = parseGurps({}, [equipSection]);
    assert.strictEqual(model.equipment.items.length, 3,
      `Expected 3 equipment items, got ${model.equipment.items.length}`);
    const names = model.equipment.items.map(i => i.name);
    assert.ok(names.includes('Broadsword'), 'Should contain Broadsword');
    assert.ok(names.includes('Large Shield'), 'Should contain Large Shield');
    assert.ok(names.includes('Mail Hauberk'), 'Should contain Mail Hauberk');
  });

  it('encumbrance subsection still parses separately', () => {
    const model = parseGurps({}, [equipSection]);
    assert.strictEqual(model.encumbrance.length, 3, 'Should parse 3 encumbrance levels');
    assert.strictEqual(model.encumbrance[0].level, 'None (0)');
    assert.strictEqual(model.encumbrance[1].level, 'Light (1)');
  });

  it('encumbrance level labels do not appear as equipment item names', () => {
    const model = parseGurps({}, [equipSection]);
    const names = model.equipment.items.map(i => i.name);
    assert.ok(!names.includes('None (0)'), '"None (0)" must not be an equipment item');
    assert.ok(!names.includes('Light (1)'), '"Light (1)" must not be an equipment item');
  });
});

// Fix 2: Defensive sort — renderGURPSSheet must not throw when skill entries lack name
describe('renderGURPSSheet — defensive sort on missing name', () => {
  it('does not throw when skills lack name', () => {
    assert.doesNotThrow(() => {
      renderGURPSSheet({ skills: [{ level: 10 }, { level: 8 }] }, []);
    });
  });

  it('does not throw when techniques lack name', () => {
    assert.doesNotThrow(() => {
      renderGURPSSheet({ techniques: [{ level: 10 }, { level: 8 }] }, []);
    });
  });

  it('does not throw when spells lack name', () => {
    assert.doesNotThrow(() => {
      renderGURPSSheet({ spells: [{ level: 10 }, { level: 8 }] }, []);
    });
  });
});
