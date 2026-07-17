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

const { buildVitals } = require('../lib/templates/gurps/live-data');

test('buildVitals reads max from Attributes, cur from Current Status', () => {
  const model = {
    attributes: { primary: { ST: { value: '13' }, HT: { value: '11' } },
                  secondary: { HP: { value: '13' }, FP: { value: '12' } } },
    status: { hp: '4/13', fp: '3' },
  };
  assert.deepEqual(buildVitals(model), {
    hp: { cur: 4, max: 13 }, fp: { cur: 3, max: 12 }, st: 13, basicSpeed: null, dx: null,
  });
});

test('buildVitals defaults cur to max when no Current Status', () => {
  const model = {
    attributes: { primary: { ST: { value: '10' }, HT: { value: '10' } },
                  secondary: { HP: { value: '10' }, FP: { value: '10' } } },
    status: {},
  };
  assert.deepEqual(buildVitals(model), {
    hp: { cur: 10, max: 10 }, fp: { cur: 10, max: 10 }, st: 10, basicSpeed: null, dx: null,
  });
});

test('buildVitals falls back HP->ST and FP->HT when secondary absent', () => {
  const model = {
    attributes: { primary: { ST: { value: '12' }, HT: { value: '11' } }, secondary: {} },
    status: {},
  };
  assert.deepEqual(buildVitals(model), {
    hp: { cur: 12, max: 12 }, fp: { cur: 11, max: 11 }, st: 12, basicSpeed: null, dx: null,
  });
});

test('buildVitals returns null when max HP/FP unresolvable', () => {
  assert.equal(buildVitals({ attributes: { primary: {}, secondary: {} }, status: {} }), null);
});

test('buildLiveData attaches a vitals block', () => {
  const model = {
    encumbrance: [
      { level: 'None (0)', weight: '≤34', move: '6', dodge: '10', current: false },
      { level: 'Light (1)', weight: '≤68', move: '4', dodge: '9', current: true },
      { level: 'Medium (2)', weight: '≤102', move: '3', dodge: '8', current: false },
      { level: 'Heavy (3)', weight: '≤204', move: '2', dodge: '7', current: false },
      { level: 'X-Heavy (4)', weight: '≤340', move: '1', dodge: '6', current: false },
    ],
    equipment: { items: [{ name: 'Armor', weight: '56' }], loadouts: [] },
    attributes: { primary: { ST: { value: '13' }, HT: { value: '11' } },
                  secondary: { HP: { value: '13' }, FP: { value: '12' } } },
    status: { hp: '13/13', fp: '12' },
    skills: [], melee: [],
  };
  const data = buildLiveData(model, { buildVersion: 'v1', campaignId: 'c', pcSlug: 'p' });
  assert.deepEqual(data.vitals, { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, st: 13, basicSpeed: null, dx: null });
});

function modelWith(primary, secondary) {
  return {
    attributes: { primary, secondary },
    encumbrance: [
      { level: 'None (0)', weight: '26', move: '6', dodge: '10', current: true },
      { level: 'Light (1)', weight: '52', move: '4', dodge: '9' },
      { level: 'Medium (2)', weight: '78', move: '3', dodge: '8' },
      { level: 'Heavy (3)', weight: '156', move: '2', dodge: '7' },
      { level: 'X-Heavy (4)', weight: '260', move: '1', dodge: '6' },
    ],
    skills: [], melee: [],
    equipment: { items: [{ name: 'Pack', weight: '10 lb' }], loadouts: [] },
    status: {},
  };
}

test('buildLiveData surfaces basicSpeed and dx from attributes', () => {
  const model = modelWith(
    { ST: { value: 13 }, DX: { value: 14 }, HT: { value: 12 } },
    { HP: { value: 13 }, FP: { value: 12 }, 'Basic Speed': { value: '6.50' } }
  );
  const data = buildLiveData(model, { buildVersion: 'v1', campaignId: 'c', pcSlug: 's' });
  assert.equal(data.basicSpeed, 6.5);
  assert.equal(data.dx, 14);
});

test('buildLiveData tolerates missing Basic Speed / DX (null, PC still built)', () => {
  const model = modelWith(
    { ST: { value: 13 }, HT: { value: 12 } },
    { HP: { value: 13 }, FP: { value: 12 } }
  );
  const data = buildLiveData(model, { buildVersion: 'v1', campaignId: 'c', pcSlug: 's' });
  assert.equal(data.basicSpeed, null);
  assert.equal(data.dx, null);
  assert.ok(Array.isArray(data.levels));   // still a valid build
});
