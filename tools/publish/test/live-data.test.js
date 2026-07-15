const { test } = require('node:test');
const assert = require('node:assert');
const { buildLiveData, liveDataScript } = require('../lib/templates/gurps/live-data');

// Minimal synthetic model (parse.js emptyModel shape, only fields buildLiveData reads).
function sixModel() {
  return {
    attributes: { primary: { ST: { value: '13' } },
      secondary: { 'Basic Move': { value: '6' }, 'Basic Speed': { value: '6.50' } } },
    traits: { advantages: [{ name: 'Combat Reflexes' }], perks: [], disadvantages: [], quirks: [] },
    encumbrance: [
      { level: 'None (0)', weight: '≤34 lbs', move: '6', dodge: '10', current: false },
      { level: 'Light (1)', weight: '≤68 lbs', move: '4', dodge: '9', current: true },
      { level: 'Medium (2)', weight: '≤102 lbs', move: '3', dodge: '8', current: false },
      { level: 'Heavy (3)', weight: '≤204 lbs', move: '2', dodge: '7', current: false },
      { level: 'X-Heavy (4)', weight: '≤340 lbs', move: '1', dodge: '6', current: false },
    ],
    skills: [
      { name: 'Climbing', level: '12', base: '13' },   // affected: -1 at Light
      { name: 'Judo', level: '14', base: '14' },        // Armor Familiarity: flat
    ],
    melee: [
      { weapon: 'Vibro-axe', skill: 'Axe/Mace-17', parry: '12 (0U)' }, // Axe/Mace not affected
      { weapon: 'Judo throw', skill: 'Judo-14', parry: '11' },         // linked to flat Judo
    ],
    ranged: [],
    equipment: {
      items: [{ name: 'Vibro-axe', weight: '4 lbs' }, { name: 'Space Armor', weight: '56 lbs' }],
      loadouts: [{ name: 'Transit', items: [{ name: 'Hand thruster', weight: '4 lbs' }] }],
    },
    status: {},
  };
}

test('buildLiveData produces 5 levels with sheet Move/Dodge/thresholds', () => {
  const d = buildLiveData(sixModel(), { campaignId: 'dead-end', pcSlug: 'six', buildVersion: 'v1' });
  assert.equal(d.levels.length, 5);
  assert.deepEqual(d.levels.map(l => l.move), [6, 4, 3, 2, 1]);
  assert.deepEqual(d.levels.map(l => l.dodge), [10, 9, 8, 7, 6]);
  assert.deepEqual(d.levels.map(l => l.maxWeight), [34, 68, 102, 204, 340]);
  assert.equal(d.authoredLevel, 1);
});

test('affected skill ramps by level, flat skill stays flat', () => {
  const d = buildLiveData(sixModel(), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  assert.deepEqual(d.skills['Climbing'], [13, 12, 11, 10, 9]);
  assert.deepEqual(d.skills['Judo'], [14, 14, 14, 14, 14]);
});

test('weapon parry/to-hit follow their linked skill', () => {
  const d = buildLiveData(sixModel(), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  // Axe/Mace unaffected (not in Skills table, not enc-penalized) -> flat
  assert.deepEqual(d.weapons['Vibro-axe'].parry, [12, 12, 12, 12, 12]);
  // Judo throw linked to flat Judo -> flat
  assert.deepEqual(d.weapons['Judo throw'].parry, [11, 11, 11, 11, 11]);
  assert.deepEqual(d.weapons['Judo throw'].toHit, [14, 14, 14, 14, 14]);
});

test('items carry weight + default carried (main on, loadout off)', () => {
  const d = buildLiveData(sixModel(), { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  const byKey = Object.fromEntries(d.items.map(i => [i.key, i]));
  assert.equal(byKey['Vibro-axe'].defaultCarried, true);
  assert.equal(byKey['Vibro-axe'].weight, 4);
  assert.equal(byKey['Hand thruster'].defaultCarried, false);
  assert.equal(byKey['Hand thruster'].table, 'loadout:Transit');
});

test('defaulted enc-penalized weapon gets a computed series (case 2)', () => {
  const m = sixModel();
  m.skills = [];  // no skills table entries at all
  m.melee = [{ weapon: 'Rapier', skill: 'Rapier-11', parry: '10' }]; // fencing, defaulted
  const d = buildLiveData(m, { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  // base = authoredToHit(11) + authoredLevel(1) = 12; series[L] = 12 - L
  assert.deepEqual(d.weapons['Rapier'].toHit, [12, 11, 10, 9, 8]);
  // parry[L] = 10 + floor(series[L]/2) - floor(series[1]/2); series[1]=11 -> floor 5
  assert.deepEqual(d.weapons['Rapier'].parry, [11, 10, 10, 9, 9]);
});

test('parenthetical (specialized) skill cell yields positive flat to-hit (case 3)', () => {
  const m = sixModel();
  // Weapon whose skill is specialized and NOT in the Skills table -> flat default.
  // The `-` follows `)`, which a signed scan would misread as a negative sign.
  // Kept on the melee (now weapons-only) path so the parenthetical-parse regression stays covered.
  m.melee = [{ weapon: 'Blaster', skill: 'Beam Weapons (Pistol)-15', damage: '3d', acc: '6' }];
  const d = buildLiveData(m, { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' });
  assert.deepEqual(d.weapons['Blaster'].toHit, [15, 15, 15, 15, 15]);
});

test('returns null when no encumbrance table or no weighted items', () => {
  const m = sixModel(); m.encumbrance = [];
  assert.equal(buildLiveData(m, { campaignId: 'c', pcSlug: 'p', buildVersion: 'v' }), null);
});

test('liveDataScript embeds JSON under the expected id', () => {
  const html = liveDataScript({ buildVersion: 'v', items: [] });
  assert.match(html, /<script type="application\/json" id="gurps-live-data">/);
  assert.match(html, /"buildVersion":"v"/);
});
