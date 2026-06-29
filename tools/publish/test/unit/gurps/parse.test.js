const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseGurps } = require('../../../lib/templates/gurps/parse');

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
