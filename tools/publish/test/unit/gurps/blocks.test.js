'use strict';
// The GURPS sheet blocks, one block per renderer.
// Each block below was a test file of its own; the blocks keep their own imports and helpers.

// ---- blocks.attributes.test.js ---------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderAttributes } = require('../../../lib/templates/gurps/blocks/attributes');

describe('renderAttributes', () => {
  it('renders primary attribute cards with values', () => {
    const model = { attributes: {
      primary: {
        ST: { value: '10', markers: [], cost: '90' },
        DX: { value: '12', markers: [], cost: '40' },
        IQ: { value: '18', markers: ['*'], cost: '160' },
        HT: { value: '10', markers: [] },
      },
      secondary: { HP: { value: '10', markers: [] } },
      derived: {},
    } };
    const html = renderAttributes(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('18'));
    assert.ok(html.includes('attrgrid'));
  });

  it('shows point cost in primary cards when present', () => {
    const model = { attributes: {
      primary: { ST: { value: '12', markers: [], cost: '18' } },
      secondary: {},
      derived: {},
    } };
    const html = renderAttributes(model);
    assert.ok(html.includes('[18]'), 'cost should render as [18]');
  });

  it('renders secondary sub-group and derived strip', () => {
    const model = { attributes: {
      primary: { ST: { value: '12', markers: [] } },
      secondary: { HP: { value: '12', markers: [] }, Will: { value: '11', markers: [] } },
      derived: { 'Basic Lift': { value: '29 lbs', markers: [] }, 'Damage (Thr)': { value: '1d-1', markers: [] } },
    } };
    const html = renderAttributes(model);
    assert.ok(html.includes('subgrid'), 'secondary subgrid present');
    assert.ok(html.includes('derived'), 'derived strip present');
    assert.ok(html.includes('attr-sublabel'), 'sub-group labels present');
    assert.ok(html.includes('BL'), 'derived BL label present');
    assert.ok(html.includes('Thr'), 'derived Thr label present');
  });

  it('does not render a "Characteristic" junk cell', () => {
    const model = { attributes: {
      primary: { ST: { value: '10', markers: [] } },
      secondary: { HP: { value: '10', markers: [] } },
      derived: {},
    } };
    const html = renderAttributes(model);
    assert.ok(!html.includes('>Characteristic<'), 'no Characteristic junk cell');
    assert.ok(!html.includes('>Value<'), 'no Value junk cell from header row');
  });

  it('returns null when no attributes', () => {
    assert.strictEqual(renderAttributes({ attributes: { primary: {}, secondary: {}, derived: {} } }), null);
  });
});
}

// ---- blocks.chains.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderChains } = require('../../../lib/templates/gurps/blocks/chains');

describe('renderChains', () => {
  it('renders melee chains as step arrows', () => {
    const model = {
      chains: {
        melee: [{ name: 'Sword Combo', steps: ['Feint', 'Deceptive Attack', 'All-Out Attack'] }],
        ranged: [],
      },
    };
    const html = renderChains(model);
    assert.ok(html.includes('cat-chain'));
    assert.ok(html.includes('Sword Combo'));
    assert.ok(html.includes('Feint'));
    assert.ok(html.includes('→'));
    assert.ok(html.includes('Deceptive Attack'));
    assert.ok(html.includes('All-Out Attack'));
  });
  it('renders ranged chains', () => {
    const model = {
      chains: {
        melee: [],
        ranged: [{ name: 'Aimed Shot', steps: ['Aim', 'Attack'] }],
      },
    };
    const html = renderChains(model);
    assert.ok(html.includes('Aimed Shot'));
    assert.ok(html.includes('Aim'));
    assert.ok(html.includes('→'));
    assert.ok(html.includes('Attack'));
  });
  it('returns null when no chains', () => {
    assert.strictEqual(renderChains({ chains: { melee: [], ranged: [] } }), null);
    assert.strictEqual(renderChains({ chains: null }), null);
  });
});
}

// ---- blocks.defenses.test.js -----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderDefenses } = require('../../../lib/templates/gurps/blocks/defenses');

describe('renderDefenses', () => {
  it('renders defenses with cat-def class and a representative value', () => {
    const model = { defenses: {
      parry: [{ label: 'Broadsword', value: '10' }],
      block: [],
      dodge: '8',
      hitLocations: [{ location: 'Skull', dr: '2' }],
    } };
    const html = renderDefenses(model);
    assert.ok(html.includes('cat-def'));
    assert.ok(html.includes('Broadsword'));
    assert.ok(html.includes('Dodge'));
    assert.ok(html.includes('Skull'));
  });
  it('returns null when defenses is empty', () => {
    assert.strictEqual(renderDefenses({ defenses: { parry: [], block: [], dodge: null, hitLocations: [] } }), null);
  });
});
}

// ---- blocks.encumbrance.test.js --------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderEncumbrance } = require('../../../lib/templates/gurps/blocks/encumbrance');

describe('renderEncumbrance', () => {
  it('renders encumbrance table with cat-attr class', () => {
    const model = { encumbrance: [
      { level: 'None (0)', weight: '20 lb', move: '5', dodge: '8', current: true },
      { level: 'Light (1)', weight: '40 lb', move: '4', dodge: '7', current: false },
    ] };
    const html = renderEncumbrance(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('None (0)'));
    assert.ok(html.includes('cur'));
  });
  it('returns null when encumbrance is empty', () => {
    assert.strictEqual(renderEncumbrance({ encumbrance: [] }), null);
  });
});
}

// ---- blocks.equipment.test.js ----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderEquipment } = require('../../../lib/templates/gurps/blocks/equipment');

describe('renderEquipment', () => {
  it('renders an inventory table with items', () => {
    const model = {
      equipment: {
        items: [
          { qty: '1', name: 'Broadsword', cost: '$500', weight: '3 lb', location: null, notes: null },
          { qty: '2', name: 'Arrow (30)', cost: '$15', weight: '1 lb', location: null, notes: null },
        ],
        loadouts: [],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html, 'should render non-null html');
    assert.ok(html.includes('Broadsword'), 'should include item name');
    assert.ok(html.includes('$500'), 'should include item cost');
    assert.ok(html.includes('3 lb'), 'should include item weight');
    assert.ok(html.includes('Arrow (30)'), 'should include second item');
    assert.ok(html.includes('cat-table'), 'should have cat-table class');
  });
  it('renders load-outs with a Totals footer row', () => {
    const model = {
      equipment: {
        items: [],
        loadouts: [
          {
            name: 'Light Travel',
            items: [
              { qty: '1', name: 'Dagger', cost: '$20', weight: '0.25 lb', location: null, notes: null },
            ],
            totalCost: '$20',
            totalWeight: '0.25 lb',
          },
        ],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html, 'should render non-null html');
    assert.ok(html.includes('Light Travel'), 'should include load-out name');
    assert.ok(html.includes('Dagger'), 'should include load-out item');
    assert.ok(html.includes('Totals'), 'should include Totals footer');
    assert.ok(html.includes('$20'), 'should include total cost');
  });
  it('returns null when no equipment', () => {
    assert.strictEqual(renderEquipment({ equipment: { items: [], loadouts: [] } }), null);
    assert.strictEqual(renderEquipment({}), null);
  });
  it('renders missing numeric fields as blank, not "undefined", and keeps a literal 0', () => {
    const html = renderEquipment({
      equipment: {
        // qty omitted entirely; a free item priced at 0
        items: [{ name: 'Field notes', cost: 0, weight: '0.1 lb' }],
        loadouts: [],
      },
    });
    assert.doesNotMatch(html, /undefined/);
    assert.match(html, />0</); // cost 0 survives instead of being swallowed to ''
  });
  it('renders both inventory table and load-out when both present', () => {
    const model = {
      equipment: {
        items: [{ qty: '1', name: 'Crossbow', cost: '$150', weight: '6 lb', location: null, notes: null }],
        loadouts: [
          {
            name: 'Adventuring',
            items: [{ qty: '1', name: 'Rope', cost: '$5', weight: '4 lb', location: null, notes: null }],
            totalCost: '$5',
            totalWeight: '4 lb',
          },
        ],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html.includes('Crossbow'), 'should include inventory item');
    assert.ok(html.includes('Adventuring'), 'should include load-out name');
    assert.ok(html.includes('Totals'), 'should include totals row');
  });

  it('mixed location/notes: all rows have same <td> count (column alignment)', () => {
    // Only item 0 has a location, only item 1 has notes.
    // After fix, both rows must emit a <td> for each column that exists in ANY row.
    const model = {
      equipment: {
        items: [
          { qty: '1', name: 'Sword',   cost: '$600', weight: '3 lb', location: 'Belt',  notes: null   },
          { qty: '2', name: 'Rations', cost: '$5',   weight: '1 lb', location: null,    notes: 'Iron' },
        ],
        loadouts: [],
      },
    };
    const html = renderEquipment(model);
    assert.ok(html, 'should render html');
    // Count <td> elements in each <tr> — they must be equal.
    const rowMatches = html.match(/<tr>([\s\S]*?)<\/tr>/g) || [];
    // Skip the header row (uses <th>)
    const dataRows = rowMatches.filter(r => r.includes('<td'));
    assert.ok(dataRows.length >= 2, 'should have at least 2 data rows');
    const tdCounts = dataRows.map(r => (r.match(/<td/g) || []).length);
    const allSame = tdCounts.every(c => c === tdCounts[0]);
    assert.ok(allSame, `td counts must be equal across rows; got ${tdCounts.join(', ')}`);
    // Both column headers present
    assert.ok(html.includes('<th>Location</th>'), 'Location header present');
    assert.ok(html.includes('<th>Notes</th>'), 'Notes header present');
    // The row without location shows an empty td (not missing td)
    assert.ok(html.includes('<td>Belt</td>'), 'location cell for Sword');
    assert.ok(html.includes('<td>Iron</td>'), 'notes cell for Rations');
  });
});

describe('renderEquipment escaping', () => {
  it('escapes the load-out name exactly once', () => {
    const html = renderEquipment({
      equipment: {
        items: [],
        loadouts: [{
          name: 'Fitz & Co "Heavy"',
          items: [{ qty: '1', name: 'Rope', cost: '$5', weight: '1 lb', location: null, notes: null }],
          totalCost: '$5', totalWeight: '1 lb',
        }],
      },
    });
    assert.ok(html.includes('Load-Out: Fitz &amp; Co &quot;Heavy&quot;'),
      'name should be escaped once');
    assert.ok(!html.includes('&amp;amp;'), 'name must not be double-escaped');
  });
});
}

// ---- blocks.grimoire.test.js -----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderGrimoire } = require('../../../lib/templates/gurps/blocks/grimoire');

describe('renderGrimoire', () => {
  it('renders grimoire table with wide wrapper', () => {
    const model = { grimoire: [
      { name: 'Fireball', skill: '14', class: 'Regular', time: '1 sec', duration: 'Instant', cost: '2', college: 'Fire', page: 'M140' },
    ] };
    const html = renderGrimoire(model);
    assert.ok(html.includes('wide'));
    assert.ok(html.includes('Fireball'));
    assert.ok(html.includes('Fire'));
    assert.ok(html.includes('M140'));
  });
  it('returns null when grimoire is empty', () => {
    assert.strictEqual(renderGrimoire({ grimoire: [] }), null);
  });
});
}

// ---- blocks.identity.test.js -----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderIdentity } = require('../../../lib/templates/gurps/blocks/identity');
const { parseGurps } = require('../../../lib/templates/gurps/parse');
const { buildSheet } = require('../../../lib/templates/gurps/layout');
const { sectionsFromMarkdown } = require('../../helpers/sections');

const appearanceSheet = {
  title: 'Stat Sheet', id: 'stat-sheet',
  html: '<h3>Primary Attributes</h3><table><tr><th>Attribute</th><th>Score</th></tr>' +
        '<tr><td>ST</td><td>13</td></tr></table>' +
        '<h3>Appearance &amp; Social</h3>' +
        '<table><tr><th>Trait</th><th>Value</th></tr>' +
        '<tr><td>Religion</td><td>None</td></tr>' +
        '<tr><td>Height</td><td>6&#39;2&quot;</td></tr>' +
        '<tr><td>Weight</td><td>215 lb</td></tr>' +
        '<tr><td>Eyes</td><td>Pale grey</td></tr>' +
        '<tr><td>Batch</td><td>MACE-06</td></tr></table>',
};

describe('renderIdentity', () => {
  it('returns null when there is no identity data', () => {
    assert.strictEqual(renderIdentity({ identity: {} }), null);
    assert.strictEqual(renderIdentity({}), null);
  });

  it('drops keys whose value is blank', () => {
    const html = renderIdentity({ identity: { Height: '6\'2"', Weight: '   ' } });
    assert.ok(html.includes('Height'));
    assert.ok(!html.includes('Weight'));
  });

  it('orders physical description ahead of the rest, extras last', () => {
    const html = renderIdentity({
      identity: { Religion: 'None', Batch: 'MACE-06', Height: '6\'2"', Eyes: 'Pale grey' },
    });
    const order = ['Height', 'Eyes', 'Religion', 'Batch'].map(k => html.indexOf(`>${k}<`));
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(order.every(i => i > -1));
  });

  it('escapes values exactly once', () => {
    const html = renderIdentity({ identity: { Height: '6\'2"' } });
    assert.ok(html.includes('6\'2&quot;'));
    assert.ok(!html.includes('&amp;quot;'));
  });
});

describe('parseIdentity', () => {
  it('reads the Appearance & Social sub-table into model.identity', () => {
    const model = parseGurps({}, [appearanceSheet]);
    assert.strictEqual(model.identity.Height, '6\'2"');
    assert.strictEqual(model.identity.Weight, '215 lb');
    assert.strictEqual(model.identity.Eyes, 'Pale grey');
  });

  it('drops the header row rather than the first real row', () => {
    const model = parseGurps({}, [appearanceSheet]);
    assert.strictEqual(model.identity.Religion, 'None');
    assert.ok(!('Trait' in model.identity));
  });

  it('leaves senses empty when the sheet has no Senses sub-table', () => {
    const model = parseGurps({}, [appearanceSheet]);
    assert.deepStrictEqual(model.senses, {});
  });

  it('still reads a real Senses sub-table', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Senses</h3><table><tr><th>Sense</th><th>Value</th></tr>' +
            '<tr><td>Vision</td><td>13</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.strictEqual(model.senses.Vision, '13');
    assert.deepStrictEqual(model.identity, {});
  });

  it('reads an appearance table from the Stat Sheet body', () => {
    const model = parseGurps({}, sectionsFromMarkdown([
      '## Stat Sheet', '', '### Appearance & Social', '',
      '| Trait | Value |', '|---|---|', '| Height | 168 cm |', '| Eyes | Brown |',
    ].join('\n')));
    assert.strictEqual(model.identity.Height, '168 cm');
  });

  it('ignores frontmatter appearance and identity', () => {
    const model = parseGurps({ appearance: { Height: 'sentinel' }, identity: 'sentinel' }, []);
    assert.deepStrictEqual(model.identity, {});
  });
});

describe('identity band placement', () => {
  it('renders full width above the two-column flow', () => {
    const html = buildSheet(parseGurps({}, [appearanceSheet]));
    const band = html.indexOf('identity-band');
    const flow = html.indexOf('<div class="flow">');
    assert.ok(band > -1, 'band renders');
    assert.ok(flow > -1, 'flow renders');
    assert.ok(band < flow, 'band precedes the flow');
  });
});

describe('parseIdentity completeness', () => {
  it('merges every recognised identity sub-table, not just the first', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Appearance &amp; Social</h3><table><tr><th>Trait</th><th>Value</th></tr>' +
            '<tr><td>Height</td><td>6ft</td></tr></table>' +
            '<h3>Physical Description</h3><table><tr><th>Trait</th><th>Value</th></tr>' +
            '<tr><td>Hair</td><td>Black</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.strictEqual(model.identity.Height, '6ft');
    assert.strictEqual(model.identity.Hair, 'Black');
  });

  it('a Physical Description table still merges beside Appearance & Social', () => {
    const model = parseGurps({}, sectionsFromMarkdown([
      '## Stat Sheet', '', '### Appearance & Social', '', '| Trait | Value |', '|---|---|', '| Height | 6ft |', '',
      '### Physical Description', '', '| Trait | Value |', '|---|---|', '| Build | Lean |',
    ].join('\n')));
    assert.strictEqual(model.identity.Height, '6ft');
    assert.strictEqual(model.identity.Build, 'Lean');
  });

  it('keeps columns beyond the second', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Appearance &amp; Social</h3><table><tr><th>Trait</th><th>Value</th><th>Notes</th></tr>' +
            '<tr><td>Hair</td><td>Black</td><td>greying</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.ok(model.identity.Hair.includes('Black'));
    assert.ok(model.identity.Hair.includes('greying'));
  });
});

describe('parseSenses aliases', () => {
  it('reads a "Senses and Checks" heading', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Senses and Checks</h3><table><tr><th>Sense</th><th>Value</th></tr>' +
            '<tr><td>Vision</td><td>13</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.strictEqual(model.senses.Vision, '13');
  });

  it('does not drop the first senses row when there is no header row', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Senses</h3><table><tr><td>Vision</td><td>13</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.strictEqual(model.senses.Vision, '13');
  });
});

describe('renderIdentity falsey values', () => {
  it('keeps numeric 0 and boolean false', () => {
    const html = renderIdentity({ identity: { Dependents: 0, Literate: false } });
    assert.ok(html.includes('Dependents'));
    assert.ok(html.includes('>0<'));
    assert.ok(html.includes('Literate'));
  });
});

describe('parseSenses header detection', () => {
  it('does not store a "Sense | Check" header as a sense', () => {
    const sheet = {
      title: 'Stat Sheet', id: 'stat-sheet',
      html: '<h3>Senses</h3><table><tr><td>Sense</td><td>Check</td></tr>' +
            '<tr><td>Vision</td><td>13</td></tr></table>',
    };
    const model = parseGurps({}, [sheet]);
    assert.strictEqual(model.senses.Vision, '13');
    assert.ok(!('Sense' in model.senses));
  });
});
}

// ---- blocks.melee.test.js --------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderMelee } = require('../../../lib/templates/gurps/blocks/melee');

describe('renderMelee', () => {
  it('renders melee table with wide wrapper and dmg class', () => {
    const model = { melee: [
      { weapon: 'Broadsword', skill: '14', parry: '10', damage: '2d+1 cut', reach: '1', st: '10', notes: '' },
    ] };
    const html = renderMelee(model);
    assert.ok(html.includes('wide'));
    assert.ok(html.includes('Broadsword'));
    assert.ok(html.includes('dmg'));
    assert.ok(html.includes('2d+1 cut'));
  });
  it('returns null when melee is empty', () => {
    assert.strictEqual(renderMelee({ melee: [] }), null);
  });
});
}

// ---- blocks.points.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderPoints } = require('../../../lib/templates/gurps/blocks/points');

describe('renderPoints', () => {
  it('renders points summary with cat-points class', () => {
    const model = { points: [
      { label: 'Attributes', value: '100' },
      { label: 'Total', value: '150', total: true },
      { label: 'Unspent', value: '5', unspent: true },
    ] };
    const html = renderPoints(model);
    assert.ok(html.includes('cat-points'));
    assert.ok(html.includes('Attributes'));
    assert.ok(html.includes('150'));
    assert.ok(html.includes('total'));
  });
  it('returns null when points is empty', () => {
    assert.strictEqual(renderPoints({ points: [] }), null);
  });
});
}

// ---- blocks.ranged.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderRanged } = require('../../../lib/templates/gurps/blocks/ranged');

describe('renderRanged', () => {
  it('renders ranged table with wide wrapper', () => {
    const model = { ranged: [
      { weapon: 'Bow', skill: '14', damage: '1d+1 imp', acc: '2', range: '140/210', rof: '1', shots: 'T(2)', st: '10', bulk: '-6', rcl: '1', notes: '' },
    ] };
    const html = renderRanged(model);
    assert.ok(html.includes('wide'));
    assert.ok(html.includes('Bow'));
    assert.ok(html.includes('1d+1 imp'));
    assert.ok(html.includes('140/210'));
  });
  it('shows the to-hit level and a live weapon-key hook, like melee', () => {
    const model = { ranged: [
      { weapon: 'Blaster pistol', skill: 'Beam Weapons (Pistol)-15', damage: '3d (5) burn', acc: '6', range: '300/900', rof: '3', shots: '200(3)', st: '', bulk: '-2', rcl: '', notes: '' },
    ] };
    const html = renderRanged(model);
    // Trailing number wrapped as the current skill level (default surfaces the same way).
    assert.ok(html.includes('Beam Weapons (Pistol)-<span class="wp-tohit">15</span>'));
    // Row carries the key the live script updates.
    assert.ok(html.includes('data-weapon-key="Blaster pistol"'));
  });
  it('returns null when ranged is empty', () => {
    assert.strictEqual(renderRanged({ ranged: [] }), null);
  });
});
}

// ---- blocks.reactions.test.js ----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderReactions } = require('../../../lib/templates/gurps/blocks/reactions');

describe('renderReactions', () => {
  it('renders reactions with cat-social class and representative value', () => {
    const model = { reactions: { 'Appearance': '+2', 'Status': '+1' } };
    const html = renderReactions(model);
    assert.ok(html.includes('cat-social'));
    assert.ok(html.includes('Appearance'));
    assert.ok(html.includes('+2'));
  });
  it('returns null when reactions is empty', () => {
    assert.strictEqual(renderReactions({ reactions: {} }), null);
  });
});
}

// ---- blocks.reference.test.js ----------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderReference } = require('../../../lib/templates/gurps/blocks/reference');

describe('renderReference', () => {
  it('renders a collapsed details block with both tables and citations', () => {
    const html = renderReference();
    assert.ok(html.includes('<details'), 'should have <details element');
    assert.ok(!html.includes(' open'), 'should be default collapsed (no open attribute)');
    assert.ok(html.includes('Hit Location'), 'should include Hit Location table');
    assert.ok(html.includes('B552'), 'should cite B552');
    assert.ok(html.includes('B550'), 'should cite B550');
  });
  it('includes the summary element with Rules Reference text', () => {
    const html = renderReference();
    assert.ok(html.includes('<summary>'), 'should have summary element');
    assert.ok(html.includes('Rules Reference'), 'summary should say Rules Reference');
  });
  it('includes humanoid hit location roll values', () => {
    const html = renderReference();
    assert.ok(html.includes('Skull'), 'should include Skull location');
    assert.ok(html.includes('3–4'), 'Skull roll range should be 3–4 (en dash)');
  });
  it('includes size/speed-range table values', () => {
    const html = renderReference();
    assert.ok(html.includes('Speed/Range'), 'should include Speed/Range column header');
    assert.ok(html.includes('Linear Measure'), 'should include Linear Measure column header');
  });
});
}

// ---- blocks.senses.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderSenses } = require('../../../lib/templates/gurps/blocks/senses');

describe('renderSenses', () => {
  it('renders senses with cat-attr class and a representative value', () => {
    const model = { senses: { Vision: '13', Hearing: '13', 'Fright Check': '11' } };
    const html = renderSenses(model);
    assert.ok(html.includes('cat-attr'));
    assert.ok(html.includes('Vision'));
    assert.ok(html.includes('13'));
  });
  it('returns null when senses is empty', () => {
    assert.strictEqual(renderSenses({ senses: {} }), null);
  });
});
}

// ---- blocks.skills.test.js -------------------------------------------------------------------------------
{
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
}

// ---- blocks.social.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderCultural, renderLanguages } = require('../../../lib/templates/gurps/blocks/social');

describe('renderCultural', () => {
  it('renders cultural familiarities with cat-social class', () => {
    const model = { social: { cultural: [{ name: 'Western', cost: '0', markers: [] }], languages: [] } };
    const html = renderCultural(model);
    assert.ok(html.includes('cat-social'));
    assert.ok(html.includes('Western'));
  });
  it('returns null when cultural is empty', () => {
    assert.strictEqual(renderCultural({ social: { cultural: [], languages: [] } }), null);
  });
});

describe('renderLanguages', () => {
  it('renders languages with cat-social class and spoken/written columns', () => {
    const model = { social: { cultural: [], languages: [
      { name: 'English', spoken: 'Native', written: 'Native', points: '0' },
    ] } };
    const html = renderLanguages(model);
    assert.ok(html.includes('cat-social'));
    assert.ok(html.includes('English'));
    assert.ok(html.includes('Native'));
  });
  it('returns null when languages is empty', () => {
    assert.strictEqual(renderLanguages({ social: { cultural: [], languages: [] } }), null);
  });
});
}

// ---- blocks.spells.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderSpells } = require('../../../lib/templates/gurps/blocks/spells');

describe('renderSpells', () => {
  it('renders spells with cat-spell class and representative value', () => {
    const model = { spells: [
      { name: 'Fireball', level: '14', points: '4', markers: [] },
    ] };
    const html = renderSpells(model);
    assert.ok(html.includes('cat-spell'));
    assert.ok(html.includes('Fireball'));
    assert.ok(html.includes('14'));
  });
  it('returns null when spells is empty', () => {
    assert.strictEqual(renderSpells({ spells: [] }), null);
  });
});
}

// ---- blocks.status.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderStatus } = require('../../../lib/templates/gurps/blocks/status');

describe('renderStatus', () => {
  it('renders status banner with hp, fp, condition', () => {
    const model = { status: { hp: '10', fp: '10', condition: 'Healthy', move: '5', enc: '0' } };
    const html = renderStatus(model);
    assert.ok(html.includes('status'));
    assert.ok(html.includes('HP'));
    assert.ok(html.includes('Healthy'));
  });
  it('returns null when status is empty', () => {
    assert.strictEqual(renderStatus({ status: {} }), null);
  });
  // Fix 3: carrying field must render
  it('renders carrying text when present', () => {
    const model = { status: { hp: '10', carrying: 'Light Load (18 lb)' } };
    const html = renderStatus(model);
    assert.ok(html != null, 'should render non-null html');
    assert.ok(html.includes('Light Load (18 lb)'), 'should include carrying text');
    assert.ok(html.includes('carrying'), 'should include carrying class or label');
  });
  it('omits carrying element when not present', () => {
    const model = { status: { hp: '10' } };
    const html = renderStatus(model);
    assert.ok(!html.includes('Carrying:'), 'should not include Carrying: label when absent');
  });
});
}

// ---- blocks.traits.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderTraitList } = require('../../../lib/templates/gurps/blocks/traits');

describe('renderTraitList', () => {
  it('renders advantages with [cost] brackets', () => {
    const model = { traits: { advantages: [{ name: 'Combat Reflexes', cost: '15', markers: [] }] } };
    const html = renderTraitList(model, 'advantages', 'trait', 'Advantages');
    assert.ok(html.includes('Combat Reflexes'));
    assert.ok(html.includes('class="cost"'));
    assert.ok(html.includes('15'));
  });
  it('returns null when the list is empty', () => {
    assert.strictEqual(renderTraitList({ traits: { perks: [] } }, 'perks', 'trait', 'Perks'), null);
  });
  // #531: one class for the category, one for the list, so a theme can colour disadvantages apart from advantages.
  it('names each trait list on the sheet beside the category it shares', () => {
    const { buildSheet } = require('../../../lib/templates/gurps/layout');
    const t = (n) => [{ name: n, cost: '1', markers: [] }];
    const html = [].concat(buildSheet({ traits: { templates: t('A'), advantages: t('B'), perks: t('C'), disadvantages: t('D'), quirks: t('E') } }, [])).join('');
    assert.deepStrictEqual(html.match(/<section class="blk cat-trait[^"]*"/g), [
      '<section class="blk cat-trait cat-template"', '<section class="blk cat-trait cat-adv"', '<section class="blk cat-trait cat-perk"',
      '<section class="blk cat-trait cat-disadv"', '<section class="blk cat-trait cat-quirk"',
    ]);
  });
});
}
