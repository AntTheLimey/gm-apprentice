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

// parseChains: list-form parser (rendered markdown strips ** to plain text)
describe('parseGurps — parseChains list form', () => {
  const { extractSections } = require('../../../lib/processor');

  it('parses numbered list with arrow-separated steps per item', () => {
    const md = '## Combat Action Chains\n\n' +
      '1. **Strike Combo:** Feint → Deceptive Attack → All-Out Attack\n' +
      '2. **Defensive Rush:** Move → Block → Riposte\n';
    const sections = extractSections(md);
    const model = parseGurps({}, sections);
    assert.strictEqual(model.chains.melee.length, 2, 'should parse 2 chains');
    assert.strictEqual(model.chains.melee[0].name, 'Strike Combo');
    assert.deepStrictEqual(model.chains.melee[0].steps, ['Feint', 'Deceptive Attack', 'All-Out Attack']);
    assert.strictEqual(model.chains.melee[1].name, 'Defensive Rush');
    assert.deepStrictEqual(model.chains.melee[1].steps, ['Move', 'Block', 'Riposte']);
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

// Current-encumbrance-row detection: explicit marker in the Level cell, or
// fallback match against the Current Status Enc: value.
describe('parseGurps — current encumbrance row', () => {
  function encSection(levels) {
    const rows = levels.map(l =>
      `<tr><td>${l[0]}</td><td>${l[1]}</td><td>${l[2]}</td><td>${l[3]}</td></tr>`).join('');
    return { title: 'Encumbrance', id: 'encumbrance',
      html: '<table><tr><th>Level</th><th>Max Weight</th><th>Move</th><th>Dodge</th></tr>' + rows + '</table>' };
  }
  const statusSection = { title: 'Current Status', id: 'current-status',
    html: '<p><strong>Enc:</strong> Light (1)</p>' };

  it('trailing * marker flags that row and is stripped from the level', () => {
    const model = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1) *', '44 lb', '4', '8'],
      ['Medium (2)', '66 lb', '3', '7'],
    ])]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [false, true, false]);
    assert.strictEqual(model.encumbrance[1].level, 'Light (1)');
  });

  it('(current) and ← markers also flag the row', () => {
    const m1 = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1) (current)', '44 lb', '4', '8'],
    ])]);
    assert.strictEqual(m1.encumbrance[1].current, true);
    assert.strictEqual(m1.encumbrance[1].level, 'Light (1)');
    const m2 = parseGurps({}, [encSection([
      ['None (0) ←', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
    ])]);
    assert.strictEqual(m2.encumbrance[0].current, true);
    assert.strictEqual(m2.encumbrance[0].level, 'None (0)');
  });

  it('marker works in the Equipment ### Encumbrance subsection path', () => {
    const equip = { title: 'Equipment', id: 'equipment',
      html: '<h3>Encumbrance</h3><table>' +
        '<tr><th>Level</th><th>Max Weight</th><th>Move</th><th>Dodge</th></tr>' +
        '<tr><td>None (0)</td><td>22 lb</td><td>6</td><td>9</td></tr>' +
        '<tr><td>Light (1) *</td><td>44 lb</td><td>4</td><td>8</td></tr></table>' };
    const model = parseGurps({}, [equip]);
    assert.strictEqual(model.encumbrance[1].current, true);
    assert.strictEqual(model.encumbrance[1].level, 'Light (1)');
  });

  it('only the first marked row is flagged when several carry markers', () => {
    const model = parseGurps({}, [encSection([
      ['None (0) *', '22 lb', '6', '9'],
      ['Light (1) *', '44 lb', '4', '8'],
    ])]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [true, false]);
  });

  it('with no marker, Current Status Enc: flags the matching row', () => {
    const model = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
      ['Medium (2)', '66 lb', '3', '7'],
    ]), statusSection]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [false, true, false]);
  });

  it('status fallback matches level names case-insensitively, ignoring parentheticals', () => {
    const status = { title: 'Current Status', id: 'current-status',
      html: '<p><strong>Enc:</strong> LIGHT</p>' };
    const model = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
    ]), status]);
    assert.strictEqual(model.encumbrance[1].current, true);
  });

  it('no marker and no matching status leaves every row unflagged', () => {
    const model = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
    ])]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [false, false]);
  });

  it('an explicit marker wins over a conflicting status value', () => {
    const model = parseGurps({}, [encSection([
      ['None (0) *', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
    ]), statusSection]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [true, false]);
  });

  it('frontmatter encumbrance with current: true is untouched by the fallback', () => {
    const fm = { encumbrance: [
      { level: 'None (0)', weight: '22 lb', move: '6', dodge: '9', current: true },
      { level: 'Light (1)', weight: '44 lb', move: '4', dodge: '8' },
    ] };
    const model = parseGurps(fm, [statusSection]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [true, false]);
  });

  it('a lone * level cell is not treated as a marker', () => {
    const model = parseGurps({}, [encSection([
      ['*', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
    ])]);
    assert.strictEqual(model.encumbrance[0].level, '*');
    assert.strictEqual(model.encumbrance[0].current, false);
  });
});

// Review fixes: single-current invariant on every source, stacked markers,
// numeric status fallback, fm-array fallback opt-in.
describe('parseGurps — current encumbrance row (review hardening)', () => {
  function encSection(levels) {
    const rows = levels.map(l =>
      `<tr><td>${l[0]}</td><td>${l[1]}</td><td>${l[2]}</td><td>${l[3]}</td></tr>`).join('');
    return { title: 'Encumbrance', id: 'encumbrance',
      html: '<table><tr><th>Level</th><th>Max Weight</th><th>Move</th><th>Dodge</th></tr>' + rows + '</table>' };
  }

  it('stacked markers are stripped completely', () => {
    const model = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1) ← *', '44 lb', '4', '8'],
    ])]);
    assert.strictEqual(model.encumbrance[1].current, true);
    assert.strictEqual(model.encumbrance[1].level, 'Light (1)');
  });

  it('frontmatter array with two current entries keeps only the first', () => {
    const fm = { encumbrance: [
      { level: 'None (0)', current: true },
      { level: 'Light (1)', current: true },
    ] };
    const model = parseGurps(fm, []);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [true, false]);
  });

  it('frontmatter array without current is flagged by a matching status Enc', () => {
    const fm = { encumbrance: [
      { level: 'None (0)' },
      { level: 'Light (1)' },
    ] };
    const status = { title: 'Current Status', id: 'current-status',
      html: '<p><strong>Enc:</strong> Light (1)</p>' };
    const model = parseGurps(fm, [status]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [false, true]);
  });

  it('a bare numeric status Enc matches the row parenthetical', () => {
    const status = { title: 'Current Status', id: 'current-status',
      html: '<p><strong>Enc:</strong> 2</p>' };
    const model = parseGurps({}, [encSection([
      ['None (0)', '22 lb', '6', '9'],
      ['Light (1)', '44 lb', '4', '8'],
      ['Medium (2)', '66 lb', '3', '7'],
    ]), status]);
    assert.deepStrictEqual(model.encumbrance.map(e => e.current), [false, false, true]);
  });
});
