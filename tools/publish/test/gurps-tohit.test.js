/**
 * The to-hit calculator's pure half: the sum, its caps, the odds. Data blocks are
 * built by hand in the shape lib/templates/gurps/tohit-data.js produces (melee
 * weapons first, no acc/rof/rcl/bulk on melee rows). Names are invented.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const { extractSections } = require('../lib/processor');
const { parseGurps } = require('../lib/templates/gurps/parse');
const { buildTohitData } = require('../lib/templates/gurps/tohit-data');
const T = require('../js/gurps-tohit');

const LOCATIONS = [
  ['torso', 'Torso', 0], ['vitals', 'Vitals', -3], ['limb', 'Arm or leg', -2], ['extremity', 'Hand or foot', -4],
  ['groin', 'Groin', -3], ['face', 'Face', -5], ['neck', 'Neck', -5], ['skull', 'Skull', -7], ['eye', 'Eye', -9],
];

function mk(over = {}) {
  const data = {
    pc: 'six',
    weapons: [
      { key: 'Knife', type: 'melee', name: 'Knife', skill: 'Knife', level: 14, base: 14, range: '', damage: 'sw cut', beam: false, aids: [], bonuses: [] },
      {
        key: 'Blaster pistol', type: 'ranged', name: 'Blaster pistol', skill: 'Beam Weapons (Pistol)', level: 17, base: 17,
        acc: 6, rof: 10, rcl: 1, bulk: 2, range: '150/450', damage: '3d burn', beam: true, aids: [], bonuses: [],
      },
    ],
    aids: [],
    techniques: { targeted: [], dual: {}, other: [] },
    traits: { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 },
    freeFall: null,
    locations: LOCATIONS,
    bands: [2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700],
  };
  return Object.assign(data, over);
}
const withWeapon = (data, key, patch) => {
  data.weapons = data.weapons.map((w) => (w.key === key ? Object.assign({}, w, patch) : w));
  return data;
};
const SCOPE3 = { id: 'scope', name: 'Scope', bonus: 3, acc: true, fixed: false, from: 'row' };
const RANGED = { weapon: 'Blaster pistol' };
const ISSUE = { weapon: 'Blaster pistol', aim: 3, braced: true, aids: { scope: true }, man: 'aod', yards: 100, shots: 10, sm: 3, vis: -2 };
const line = (r, group) => r.lines.find((l) => l.group === group);
const total = (r, group) => r.lines.filter((l) => l.group === group).reduce((a, l) => a + l.value, 0);
const rolls = (data, state) => T.effective(data, state).roll;

function scoped(aids, extra = {}) {
  return mk({ weapons: mk().weapons.map((w) => (w.type === 'ranged' ? Object.assign({}, w, { aids }, extra) : w)) });
}

describe('the issue\'s case and its two variants', () => {
  const data = scoped([SCOPE3]);
  it('makes 23, the aiming line 12', () => {
    const r = T.effective(data, ISSUE);
    assert.strictEqual(r.roll, 23);
    assert.strictEqual(line(r, 'aiming').value, 12);
  });
  it('makes 15 from a vehicle of SR 4, and says why', () => {
    const r = T.effective(data, Object.assign({}, ISSUE, { sr: 4 }));
    assert.strictEqual(r.roll, 15);
    assert.match(line(r, 'aiming').label, /capped at the vehicle's SR/);
  });
  it('makes 19 with hit location hand or foot', () => {
    assert.strictEqual(rolls(data, Object.assign({}, ISSUE, { loc: 'extremity' })), 19);
  });
});

describe('aiming', () => {
  it('has no aiming line at aim 0', () => {
    assert.strictEqual(line(T.effective(mk(), RANGED), 'aiming'), undefined);
  });
  it('a variable scope adds 1 a turn aimed, with a note', () => {
    const r = T.effective(scoped([SCOPE3]), { weapon: 'Blaster pistol', aim: 1, aids: { scope: true } });
    assert.match(line(r, 'aiming').label, /sighting aids \+1/);
    assert.strictEqual(line(r, 'aiming').value, 7);
    assert.ok(r.notes.some((n) => /needs 3 turns/.test(n)));
  });
  it('a fixed scope gives nothing until aimed long enough, then all of it', () => {
    const fixed = { id: 'fs', name: 'Scope', bonus: 4, acc: true, fixed: true, from: 'row' };
    const data = scoped([fixed]);
    const a = T.effective(data, { weapon: 'Blaster pistol', aim: 3, aids: { fs: true } });
    assert.strictEqual(line(a, 'aiming').value, 8);
    assert.ok(a.notes.some((n) => /only after 4 turns/.test(n)));
    const b = T.effective(data, { weapon: 'Blaster pistol', aim: 4, aids: { fs: true } });
    assert.strictEqual(line(b, 'aiming').value, 12);
    assert.match(line(b, 'aiming').label, /\+2 extra aim/);
  });
  it('two Acc aids together add no more than base Acc, and the whole stays within twice Acc', () => {
    const hud = { id: 'hud', name: 'HUD link', bonus: 1, acc: true, fixed: false, from: 'row' };
    const data = scoped([hud, SCOPE3], { acc: 2 });
    const r = T.effective(data, { weapon: 'Blaster pistol', aim: 3, aids: { hud: true, scope: true } });
    assert.match(line(r, 'aiming').label, /sighting aids \+2/);
    assert.ok(line(r, 'aiming').value <= 4);
  });
  it('only the best scope counts: Telescopic Vision does not stack with a scope', () => {
    const data = scoped([SCOPE3]);
    data.traits.telescopic = 2;
    const r = T.effective(data, { weapon: 'Blaster pistol', aim: 3, aids: { scope: true } });
    assert.strictEqual(line(r, 'aiming').value, 6 + 2 + 3);
  });
  it('Telescopic Vision gives a point a turn up to its level', () => {
    const data = mk();
    data.traits.telescopic = 2;
    assert.strictEqual(line(T.effective(data, { weapon: 'Blaster pistol', aim: 1 }), 'aiming').value, 7);
    assert.strictEqual(line(T.effective(data, { weapon: 'Blaster pistol', aim: 5 }), 'aiming').value, 10);
  });
  it('a flat (non-Acc) aid is a plain line, outside the aim caps', () => {
    const laser = { id: 'laser', name: 'Laser sight', bonus: 1, acc: false, fixed: false, from: 'row' };
    const r = T.effective(scoped([laser]), { weapon: 'Blaster pistol', aids: { laser: true } });
    assert.strictEqual(total(r, 'aiming'), 1);
  });
  it('an aid with no number takes the typed bonus, and none until typed', () => {
    const sg = { id: 'sg', name: 'Smartgun', bonus: null, acc: false, fixed: false, from: 'gear' };
    const data = mk({ aids: [sg] });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aids: { sg: true } }), 17);
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aids: { sg: true }, aidBonus: { sg: 2 } }), 19);
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aidBonus: { sg: 2 } }), 17);
  });
  it('a character-wide aid is offered on a ranged weapon, never a melee one', () => {
    const tp = { id: 'tp', name: 'Targeting program', bonus: 2, acc: false, fixed: false, from: 'gear' };
    const data = mk({ aids: [tp] });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aids: { tp: true } }), 19);
    assert.strictEqual(rolls(data, { weapon: 'Knife', aids: { tp: true } }), 14);
  });
});

describe('ranged attack', () => {
  it('Move and Attack: no aim, a note, the worse of -2 and Bulk', () => {
    const data = mk();
    const r = T.effective(data, { weapon: 'Blaster pistol', aim: 2, man: 'move' });
    assert.strictEqual(line(r, 'aiming'), undefined);
    assert.ok(r.notes.some((n) => /no Aim bonus/.test(n)));
    assert.strictEqual(r.roll, 15);
    withWeapon(data, 'Blaster pistol', { bulk: 5 });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', man: 'move' }), 12);
  });
  it('pop-up attack: -2 and no aim', () => {
    const r = T.effective(mk(), { weapon: 'Blaster pistol', aim: 3, man: 'popup' });
    assert.strictEqual(r.roll, 15);
    assert.strictEqual(line(r, 'aiming'), undefined);
  });
  it('rapid fire by shots', () => {
    const data = withWeapon(mk(), 'Blaster pistol', { rof: 200 });
    const got = [1, 5, 9, 13, 17, 25, 50, 100].map((s) => rolls(data, { weapon: 'Blaster pistol', shots: s }) - 17);
    assert.deepStrictEqual(got, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('shots above RoF give a note', () => {
    const r = T.effective(mk(), { weapon: 'Blaster pistol', shots: 12 });
    assert.ok(r.notes.some((n) => /RoF is 10/.test(n)));
  });
  it('range penalty', () => {
    assert.deepStrictEqual([0, 2, 3, 100, 101].map(T.rangePenalty), [0, 0, -1, -10, -11]);
    assert.strictEqual(T.rangePenalty(2000), -18);
    assert.strictEqual(T.rangePenalty(20000), -24);
    assert.strictEqual(rolls(mk(), { weapon: 'Blaster pistol', yards: 70, speed: 30 }), 7);
  });
});

describe('melee attack', () => {
  it('maneuvers', () => {
    const data = mk();
    assert.strictEqual(rolls(data, { weapon: 'Knife', man: 'aod' }), 18);
    assert.strictEqual(rolls(data, { weapon: 'Knife', man: 'committed' }), 16);
  });
  it('Move and Attack is -4 and capped at 9', () => {
    const data = withWeapon(mk(), 'Knife', { level: 18, base: 18 });
    const r = T.effective(data, { weapon: 'Knife', man: 'move' });
    assert.strictEqual(r.roll, 9);
    assert.strictEqual(r.cap.value, 9);
    assert.strictEqual(rolls(withWeapon(mk(), 'Knife', { level: 12, base: 12 }), { weapon: 'Knife', man: 'move' }), 8);
  });
  it('All-Out (Double) and (Strong) change no number and add a note', () => {
    for (const man of ['aodbl', 'aos']) {
      const r = T.effective(mk(), { weapon: 'Knife', man });
      assert.strictEqual(r.roll, 14);
      assert.strictEqual(r.notes.length, 1);
    }
  });
  it('Rapid Strike, Telegraphic, Deceptive, Evaluate', () => {
    const data = mk();
    assert.strictEqual(rolls(data, { weapon: 'Knife', rapid: true }), 8);
    data.traits.halfRapid = true;
    assert.strictEqual(rolls(data, { weapon: 'Knife', rapid: true }), 11);
    assert.strictEqual(rolls(data, { weapon: 'Knife', telegraphic: true }), 18);
    assert.strictEqual(rolls(data, { weapon: 'Knife', deceptive: -4 }), 10);
    assert.strictEqual(rolls(data, { weapon: 'Knife', evaluate: 2 }), 16);
  });
  it('posture applies to melee only', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', posture: -2 }), 12);
    assert.strictEqual(rolls(mk(), { weapon: 'Blaster pistol', posture: -2 }), 17);
  });
  it('a ranged-only maneuver is the neutral Attack on a melee weapon', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', man: 'popup' }), 14);
    assert.strictEqual(rolls(mk(), { weapon: 'Blaster pistol', man: 'aodbl' }), 17);
  });
  it('the foe\'s defence moves with feint, deceptive, telegraphic and two weapons', () => {
    const r = T.effective(mk(), { weapon: 'Knife', foe: 10, feint: 3, deceptive: -2 });
    assert.strictEqual(r.foe.defence, 6);
    assert.strictEqual(T.effective(mk(), { weapon: 'Knife', foe: 10, feint: 3, telegraphic: true }).foe.defence, 9);
    assert.ok(r.foe.lands > 0 && r.foe.lands < 1);
    const d = T.effective(mk(), { weapon: 'Knife', foe: 10, dual: true });
    assert.strictEqual(d.foe.defence, 9);
    assert.strictEqual(T.effective(mk(), { weapon: 'Knife' }).foe, null);
  });
  it('the foe\'s chance to defend uses the confirmed success table', () => {
    const r = T.effective(mk(), { weapon: 'Knife', foe: 10 });
    assert.ok(Math.abs(r.foe.defends - 0.5) < 1e-9);
  });
});

describe('two weapons and the off hand', () => {
  it('two weapons is -4, less what the technique buys off, and a note', () => {
    const data = mk();
    const plain = T.effective(data, { weapon: 'Blaster pistol', dual: true });
    assert.strictEqual(plain.roll, 13);
    assert.ok(plain.notes.some((n) => /defends at −1/.test(n)));
    data.techniques.dual['Beam Weapons (Pistol)'] = 3;
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', dual: true }), 16);
  });
  it('off hand is -4, nil with Ambidexterity or Off-Hand Weapon Training for the skill', () => {
    const data = mk();
    assert.strictEqual(rolls(data, { weapon: 'Knife', offhand: true }), 10);
    data.traits.offHand = ['Knife'];
    assert.strictEqual(rolls(data, { weapon: 'Knife', offhand: true }), 14);
    data.traits.offHand = [];
    data.traits.ambidextrous = true;
    assert.strictEqual(rolls(data, { weapon: 'Knife', offhand: true }), 14);
  });
});

describe('techniques', () => {
  const targeted = { skill: 'Beam Weapons (Pistol)', loc: 'skull', net: -5, name: 'Targeted Attack (Beam Weapons (Pistol)/Skull)' };
  it('a Targeted Attack replaces the plain location penalty', () => {
    const data = mk();
    data.techniques.targeted = [targeted];
    const r = T.effective(data, { weapon: 'Blaster pistol', loc: 'skull' });
    assert.strictEqual(r.roll, 12);
    assert.match(line(r, 'target').label, /Targeted Attack/);
    assert.strictEqual(rolls(mk(), { weapon: 'Blaster pistol', loc: 'skull' }), 10);
  });
  it('a Targeted Attack for another skill does not apply', () => {
    const data = mk();
    data.techniques.targeted = [Object.assign({}, targeted, { skill: 'Knife' })];
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', loc: 'skull' }), 10);
  });
  it('a picked technique for the weapon\'s skill replaces the level', () => {
    const data = mk();
    data.techniques.other = [{ skill: 'Knife', name: 'Knife throwing', level: 15 }];
    const r = T.effective(data, { weapon: 'Knife', technique: 'Knife throwing' });
    assert.strictEqual(r.lines[0].value, 15);
    assert.strictEqual(r.roll, 15);
  });
  it('a technique for some other skill is ignored', () => {
    const data = mk();
    data.techniques.other = [{ skill: 'Karate', name: 'Kicking', level: 15 }];
    assert.strictEqual(rolls(data, { weapon: 'Knife', technique: 'Kicking' }), 14);
  });
  it('techniquesFor filters both lists by the weapon\'s skill', () => {
    const data = mk();
    data.techniques.targeted = [targeted, Object.assign({}, targeted, { skill: 'Knife', loc: 'neck' })];
    data.techniques.other = [{ skill: 'Knife', name: 'a', level: 1 }, { skill: 'Karate', name: 'b', level: 1 }];
    const mine = T.techniquesFor(data, data.weapons[0]);
    assert.deepStrictEqual(mine.targeted.map((t) => t.loc), ['neck']);
    assert.deepStrictEqual(mine.other.map((t) => t.name), ['a']);
    assert.deepStrictEqual(T.techniquesFor(null, null), { targeted: [], other: [] });
  });
});

describe('caps', () => {
  it('a beam weapon with Rcl under 2 is exempt, with a note', () => {
    const data = mk({ freeFall: 8 });
    const r = T.effective(data, { weapon: 'Blaster pistol', zerog: true });
    assert.strictEqual(r.cap, null);
    assert.strictEqual(r.roll, 17);
    assert.ok(r.notes.length >= 1);
    withWeapon(data, 'Blaster pistol', { rcl: 2 });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', zerog: true }), 8);
  });
  it('no Free Fall on the sheet: no cap, a note', () => {
    const r = T.effective(mk(), { weapon: 'Knife', zerog: true });
    assert.strictEqual(r.cap, null);
    assert.ok(r.notes.some((n) => /no Free Fall/.test(n)));
  });
  it('total darkness is -10 and caps at 9', () => {
    const r = T.effective(withWeapon(mk(), 'Knife', { level: 20, base: 20 }), { weapon: 'Knife', vis: -10 });
    assert.strictEqual(line(r, 'env').value, -10);
    assert.strictEqual(r.roll, 9);
    assert.strictEqual(r.cap.value, 9);
  });
  it('Night Vision offsets partial darkness, never total darkness', () => {
    const data = mk();
    data.traits.nightVision = 5;
    assert.strictEqual(rolls(data, { weapon: 'Knife', vis: -6 }), 13);
    assert.strictEqual(rolls(data, { weapon: 'Knife', vis: -3 }), 14);
    assert.strictEqual(line(T.effective(data, { weapon: 'Knife', vis: -10 }), 'env').value, -10);
  });
  it('the lowest cap below the roll is the one reported', () => {
    const data = mk();
    const r = T.effective(withWeapon(data, 'Knife', { level: 25, base: 25 }), { weapon: 'Knife', vis: -10, man: 'move' });
    assert.strictEqual(r.roll, 9);
    assert.strictEqual(r.cap.why, 'Move and Attack');
  });
});

describe('a row\'s own bonuses are never added: the Skill cell includes them', () => {
  const bond = [{ name: 'Weapon Bond', bonus: 1 }];
  it('a level over the Skills-table level is explained, not added', () => {
    const data = withWeapon(mk(), 'Knife', { level: 15, base: 14, bonuses: bond });
    const r = T.effective(data, { weapon: 'Knife' });
    assert.deepStrictEqual(r.included, { amount: 1, over: 'Knife 14', names: ['Weapon Bond'] });
    assert.strictEqual(r.lines.some((l) => /Weapon Bond/.test(l.label)), false);
    assert.strictEqual(r.roll, 15);
  });
  it('the names may be empty', () => {
    const r = T.effective(withWeapon(mk(), 'Knife', { level: 15, base: 14 }), { weapon: 'Knife' });
    assert.deepStrictEqual(r.included.names, []);
  });
  it('a level equal to the skill with a bonus in the row is still the level', () => {
    const r = T.effective(withWeapon(mk(), 'Knife', { bonuses: bond }), { weapon: 'Knife' });
    assert.strictEqual(r.included, null);
    assert.strictEqual(r.roll, 14);
    assert.strictEqual(r.lines.length, 1);
  });
  it('base null with a bonus in the row: the roll is the level (Rapier 15)', () => {
    const data = withWeapon(mk(), 'Knife', { skill: 'Rapier', level: 15, base: null, bonuses: bond });
    const r = T.effective(data, { weapon: 'Knife' });
    assert.strictEqual(r.roll, 15);
    assert.strictEqual(r.included, null);
  });
  it('a string bonus in the row changes nothing and shows no NaN', () => {
    const data = withWeapon(mk(), 'Knife', { level: 15, base: 14, bonuses: [{ name: 'Balanced', bonus: '\u22123' }] });
    const r = T.effective(data, { weapon: 'Knife' });
    assert.strictEqual(r.roll, 15);
    assert.ok(r.lines.every((l) => !/NaN/.test(l.label)));
  });
});

describe('opts.delta: the live number\'s difference from the one on the sheet', () => {
  const rapier = () => withWeapon(mk(), 'Knife', { skill: 'Rapier', level: 15, base: 14, bonuses: [{ name: 'Weapon Bond', bonus: 1 }] });
  it('a lowered live number is one Encumbrance line; the bonus is not added twice', () => {
    const r = T.effective(rapier(), { weapon: 'Knife' }, { delta: -1 });
    assert.strictEqual(r.roll, 14);
    const you = r.lines.filter((l) => l.group === 'you');
    assert.deepStrictEqual(you.map((l) => [l.label, l.value]), [['Encumbrance', -1]]);
    assert.strictEqual(r.included.amount, 1);
  });
  it('a raised one is the sheet\'s live number', () => {
    const r = T.effective(mk(), { weapon: 'Knife' }, { delta: 2 });
    assert.strictEqual(r.roll, 16);
    assert.strictEqual(line(r, 'you').label, "Sheet's live number");
  });
  it('no delta, zero, or a non-number changes nothing', () => {
    for (const o of [undefined, null, {}, { delta: 0 }, { delta: 'x' }, { delta: NaN }, 5]) {
      assert.strictEqual(T.effective(mk(), { weapon: 'Knife' }, o).roll, 14, String(JSON.stringify(o)));
    }
  });
  it('Free Fall, techniques and included work from the authored level', () => {
    const data = mk({ freeFall: 12 });
    withWeapon(data, 'Knife', { level: 18, base: 17 });
    const r = T.effective(data, { weapon: 'Knife', zerog: true }, { delta: -2 });
    assert.strictEqual(r.roll, 13 - 2);
    assert.strictEqual(r.included.amount, 1);
  });
});

describe('a picked technique carries what the level adds over the skill', () => {
  const axe = (base) => {
    const data = withWeapon(mk(), 'Knife', { skill: 'Axe/Mace', level: 18, base });
    data.techniques.other = [{ skill: 'Axe/Mace', name: 'Feint', level: 19 }];
    return data;
  };
  it('Axe/Mace 17, row 18, technique 19 is 20, and the line says so', () => {
    const r = T.effective(axe(17), { weapon: 'Knife', technique: 'Feint' });
    assert.strictEqual(r.roll, 20);
    assert.match(r.lines[0].label, /Feint.*\+1 included/);
    assert.strictEqual(r.included.amount, 1);
  });
  it('with base unknown nothing is carried', () => {
    const r = T.effective(axe(null), { weapon: 'Knife', technique: 'Feint' });
    assert.strictEqual(r.roll, 19);
    assert.strictEqual(r.included, null);
  });
});

describe('aids on the right weapons', () => {
  const tp = (extra = {}) => Object.assign({ id: 'tp', name: 'Targeting program', bonus: 2, acc: false, fixed: false, from: 'gear', on: true }, extra);
  const twoGuns = (aid) => {
    const data = mk({ aids: [aid] });
    const gun = data.weapons[1];
    data.weapons.push(Object.assign({}, gun, { key: 'Grenade', skill: 'Throwing' }));
    data.weapons.push(Object.assign({}, gun, { key: 'Rifle', skill: 'Guns (Rifle)' }));
    return data;
  };
  it('a character-wide skill-bonus aid starts ticked on Guns, Gunner and Beam Weapons only', () => {
    const data = twoGuns(tp());
    const on = (key) => T.aidsFor(data, data.weapons.find((w) => w.key === key))[0].on;
    assert.strictEqual(on('Blaster pistol'), true);
    assert.strictEqual(on('Rifle'), true);
    assert.strictEqual(on('Grenade'), false);
    data.weapons[3].skill = 'Gunner (Machine Gun)';
    assert.strictEqual(on('Rifle'), true);
  });
  it('the aid\'s own skills list replaces the default prefixes', () => {
    const data = twoGuns(tp({ skills: ['Throwing'] }));
    const on = (key) => T.aidsFor(data, data.weapons.find((w) => w.key === key))[0].on;
    assert.strictEqual(on('Grenade'), true);
    assert.strictEqual(on('Rifle'), false);
  });
  it('another kind of character-wide aid keeps its own start, and a row aid is not changed', () => {
    const data = twoGuns({ id: 'ls', name: 'Laser sight', bonus: 1, acc: false, fixed: false, from: 'gear', on: true });
    assert.strictEqual(T.aidsFor(data, data.weapons[2])[0].on, true);
    withWeapon(data, 'Grenade', { aids: [tp({ id: 'rowtp', from: 'row', on: true })] });
    assert.strictEqual(T.aidsFor(data, data.weapons[2]).find((a) => a.id === 'rowtp').on, true);
  });
  it('a tick is per weapon: a character-wide aid has its own tick key on each weapon', () => {
    const data = twoGuns(tp());
    const keys = data.weapons.slice(1).map((w) => T.aidsFor(data, w)[0].tick);
    assert.strictEqual(new Set(keys).size, 3);
    const w0 = data.weapons[1];
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aids: { [T.aidsFor(data, w0)[0].tick]: true } }), 19);
    assert.strictEqual(rolls(data, { weapon: 'Rifle', aids: { [T.aidsFor(data, w0)[0].tick]: true } }), 17);
  });
  it('defaultState ticks each weapon\'s aids by its own start', () => {
    const data = twoGuns(tp());
    const s = T.defaultState(data);
    const key = (k) => T.aidsFor(data, data.weapons.find((w) => w.key === k))[0].tick;
    assert.strictEqual(s.aids[key('Blaster pistol')], true);
    assert.strictEqual(s.aids[key('Grenade')], false);
  });
});

describe('Rapid Strike with Move and Attack (MA107)', () => {
  it('is ignored with a note, and conflicts says so', () => {
    const r = T.effective(mk(), { weapon: 'Knife', man: 'move', rapid: true });
    assert.strictEqual(r.roll, 10 - 1);
    assert.ok(r.notes.some((n) => /Rapid Strike/.test(n) && /Move and Attack/.test(n)));
    assert.strictEqual(T.conflicts({ man: 'move' }).rapid, true);
    assert.strictEqual(T.conflicts({ man: 'attack' }).rapid, false);
  });
});

describe('numbers out of range or empty (review focus 3)', () => {
  it('blank or odd fields read as the neutral value', () => {
    const data = scoped([SCOPE3]);
    const odd = { yards: '', shots: 0, sr: 0, feint: -2, other: 'x', speed: 'fast', sm: null, cover: '', behind: 'x', targetLow: 'y', shock: NaN, aim: 'many' };
    for (const key of ['Blaster pistol', 'Knife']) {
      const a = T.effective(data, Object.assign({ weapon: key }, odd));
      const b = T.effective(data, { weapon: key });
      assert.ok(Number.isInteger(a.roll));
      assert.strictEqual(a.roll, b.roll);
    }
  });
  it('a missing weapon key means the first weapon, of whatever type', () => {
    const r = T.effective(mk(), {});
    assert.strictEqual(r.type, 'melee');
    assert.strictEqual(T.effective(mk(), { weapon: 'nope' }).roll, 14);
  });
  it('an unknown location or maneuver is neutral', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', loc: 'tail', man: 'cartwheel' }), 14);
  });
  it('a melee row without acc, rof, rcl or bulk is fine', () => {
    const r = T.effective(mk(), { weapon: 'Knife', shots: 20, aim: 3 });
    assert.strictEqual(r.roll, 14);
  });
});

describe('rolls far below 3 or far above 16 (review focus 4)', () => {
  it('below 3 there is no roll', () => {
    const r = T.effective(mk(), { weapon: 'Knife', other: -12 });
    assert.strictEqual(r.roll, 2);
    assert.ok(r.notes.some((n) => /no roll/.test(n)));
    assert.strictEqual(T.odds(r.roll).hit, 0);
    assert.strictEqual(T.odds(2).none, true);
    assert.strictEqual(T.effective(mk(), { weapon: 'Knife', other: -12, foe: 10 }).foe, null);
  });
  it('at 30 only 17 and 18 miss', () => {
    assert.ok(Math.abs(T.odds(30).hit - (1 - 4 / 216)) < 1e-12);
    assert.strictEqual(T.outcome(17, 30), 'F');
    assert.strictEqual(T.outcome(18, 30), 'CF');
    assert.strictEqual(T.outcome(3, 30), 'CS');
    assert.ok(Math.abs(T.odds(30).fumble - 1 / 216) < 1e-12);
  });
  it('odds', () => {
    assert.strictEqual(T.odds(10).hit, 0.5);
    assert.ok(Math.abs(T.odds(16).crit - 20 / 216) < 1e-12);
    assert.strictEqual(T.outcome(5, 14), 'S');
    assert.strictEqual(T.outcome(5, 15), 'CS');
    assert.strictEqual(T.outcome(17, 15), 'CF');
    assert.strictEqual(T.outcome(17, 16), 'F');
    assert.strictEqual(T.outcome(14, 4), 'CF');
  });
});

describe('groups', () => {
  it('every line is in a group of the weapon\'s kind', () => {
    const data = scoped([SCOPE3]);
    const full = { aim: 3, braced: true, aids: { scope: true }, man: 'aod', yards: 50, shots: 5, sm: 1, vis: -3, loc: 'skull', cover: 'partial', behind: 1, targetLow: true,
      footing: true, shock: -1, other: 1, dual: true, offhand: true, evaluate: 2, posture: -2, rapid: true, deceptive: -2, telegraphic: true };
    for (const key of ['Blaster pistol', 'Knife']) {
      const r = T.effective(data, Object.assign({ weapon: key }, full));
      for (const l of r.lines) assert.ok(T.GROUPS[r.type].includes(l.group), `${key}: ${l.group}`);
    }
  });
});

describe('purity', () => {
  it('never mutates data or state', () => {
    const data = scoped([SCOPE3]);
    data.techniques.targeted = [{ skill: 'Beam Weapons (Pistol)', loc: 'skull', net: -5, name: 'x' }];
    const state = Object.assign({}, ISSUE, { loc: 'skull', zerog: true, aids: { scope: true }, aidBonus: { a: 1 } });
    const d0 = JSON.stringify(data);
    const s0 = JSON.stringify(state);
    T.effective(data, state);
    assert.strictEqual(JSON.stringify(data), d0);
    assert.strictEqual(JSON.stringify(state), s0);
  });
  it('an empty or missing data block gives a number, not a throw', () => {
    assert.strictEqual(T.effective(null, {}).roll, 0);
    assert.strictEqual(T.effective({ weapons: [] }, null).roll, 0);
  });
});

describe('fuzz: a few hundred random states', () => {
  let seed = 20261012;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const junk = () => pick([undefined, null, '', 'x', NaN, Infinity, -Infinity, -1, 0, 1, 2, 3, 7, 10, 99, 1e9, -1e9, '5', '-3', true, false, {}, [], 2.5]);
  const MANS = ['attack', 'aod', 'aodbl', 'aos', 'committed', 'move', 'popup', 'zzz', 3, null];
  it('the roll is an integer and every line is finite', () => {
    const data = scoped([SCOPE3, { id: 'hud', name: 'HUD link', bonus: 1, acc: true, fixed: false, from: 'row' },
      { id: 'sg', name: 'Smartgun', bonus: null, acc: false, fixed: false, from: 'gear' }], {});
    data.freeFall = 12;
    data.traits.telescopic = 2;
    data.traits.nightVision = 3;
    data.techniques.targeted = [{ skill: 'Knife', loc: 'neck', net: -2, name: 't' }, { skill: 'Beam Weapons (Pistol)', loc: 'skull', net: -5, name: 'u' }];
    data.techniques.other = [{ skill: 'Knife', name: 'Knife throwing', level: 12 }];
    data.techniques.dual = { Knife: 2 };
    const before = JSON.stringify(data);
    for (let i = 0; i < 400; i++) {
      const st = {};
      for (const k of ['aim', 'sr', 'shots', 'yards', 'speed', 'sm', 'cover', 'behind', 'targetLow', 'vis', 'evaluate', 'feint', 'deceptive', 'posture',
        'shock', 'other', 'foe', 'scope', 'braced', 'dual', 'offhand', 'footing', 'zerog', 'rapid', 'telegraphic']) {
        if (rnd() < 0.6) st[k] = junk();
      }
      st.weapon = pick(['Knife', 'Blaster pistol', 'nope', undefined, 5]);
      st.man = pick(MANS);
      st.loc = pick(['skull', 'neck', 'torso', 'eye', 'tail', 5, undefined]);
      st.technique = pick(['', 'Knife throwing', 'nope', undefined]);
      st.aids = pick([{ scope: true, hud: true, sg: true }, { scope: 'yes' }, null, 4, {}]);
      st.aidBonus = pick([{ sg: junk() }, null, 'x', {}]);
      const r = T.effective(data, st);
      assert.ok(Number.isInteger(r.roll), JSON.stringify(st));
      assert.ok(r.lines.length >= 1);
      for (const l of r.lines) assert.ok(Number.isFinite(l.value), `${JSON.stringify(st)} ${l.label}`);
      assert.ok(T.GROUPS[r.type]);
      if (r.foe) for (const v of Object.values(r.foe)) assert.ok(Number.isFinite(v));
    }
    assert.strictEqual(JSON.stringify(data), before);
  });
});

describe('the Ronnie fixture through effective', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures/gurps/gurps-ronnie.md'), 'utf8');
  const { data: fm, content } = matter(raw);
  const block = buildTohitData(parseGurps(fm, extractSections(content)), { pcSlug: 'ronnie-vint' });
  it('every weapon gives an integer roll in its default state', () => {
    assert.ok(block);
    for (const w of block.weapons) {
      const r = T.effective(block, { weapon: w.key });
      assert.ok(Number.isInteger(r.roll), w.key);
      assert.strictEqual(r.type, w.type);
      for (const l of r.lines) assert.ok(Number.isFinite(l.value), `${w.key}: ${l.label}`);
    }
  });
  it('a full state still gives integers', () => {
    for (const w of block.weapons) {
      const r = T.effective(block, { weapon: w.key, aim: 3, braced: true, man: 'aod', yards: 40, shots: 3, loc: 'limb', zerog: true,
        dual: true, offhand: true, aids: Object.fromEntries(w.aids.concat(block.aids).map((a) => [a.id, true])) });
      assert.ok(Number.isInteger(r.roll), w.key);
    }
  });
});

// ---------- round two ----------
const gunsData = (patch = {}, over = {}) => mk(Object.assign({
  weapons: [
    Object.assign({}, mk().weapons[0]),
    Object.assign({}, mk().weapons[1], { skill: 'Guns (Pistol)', level: 12, base: 12, acc: 3, beam: false, rcl: 2, aids: [] }, patch),
  ],
}, over));
const G = { weapon: 'Blaster pistol' };

describe('Free Fall replaces the base skill (B197, B344)', () => {
  it('ranged: Guns 16, Acc 3, aim 3, Free Fall 12 is 17', () => {
    const data = gunsData({ level: 16, base: 16 }, { freeFall: 12 });
    const r = T.effective(data, { weapon: 'Blaster pistol', aim: 3, zerog: true });
    assert.strictEqual(r.roll, 17);
    assert.strictEqual(r.cap, null);
    assert.strictEqual(r.lines[0].value, 12);
    assert.match(r.lines[0].label, /Free Fall 12 in place of Guns \(Pistol\) 16/);
  });
  it('melee: Knife 16, Free Fall 12, All-Out Determined is 16', () => {
    const data = withWeapon(mk({ freeFall: 12 }), 'Knife', { level: 16, base: 16 });
    assert.strictEqual(rolls(data, { weapon: 'Knife', zerog: true, man: 'aod' }), 16);
  });
  it('a beam weapon at Rcl 2 is capped like any other', () => {
    const data = withWeapon(mk({ freeFall: 12 }), 'Blaster pistol', { level: 16, base: 16, rcl: 2 });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', zerog: true, aim: 3 }), 12 + 6 + 2);
    assert.strictEqual(T.effective(data, { weapon: 'Blaster pistol', zerog: true }).lines[0].value, 12);
  });
  it('Knife 22, Free Fall 12, Move and Attack, total darkness is -2', () => {
    const data = withWeapon(mk({ freeFall: 12 }), 'Knife', { level: 22, base: 22 });
    assert.strictEqual(rolls(data, { weapon: 'Knife', zerog: true, man: 'move', vis: -10 }), -2);
  });
  it('a level that includes a bonus keeps the bonus on the lowered skill', () => {
    const data = withWeapon(mk({ freeFall: 12 }), 'Knife', { level: 18, base: 17 });
    const r = T.effective(data, { weapon: 'Knife', zerog: true });
    assert.strictEqual(r.roll, 13);
    assert.strictEqual(r.included.amount, 1);
  });
  it('a picked technique is limited by Free Fall like the skill', () => {
    const data = mk({ freeFall: 12 });
    data.techniques.other = [{ skill: 'Knife', name: 'Knife throwing', level: 15 }];
    assert.strictEqual(rolls(data, { weapon: 'Knife', technique: 'Knife throwing', zerog: true }), 12);
  });
  it('Free Fall at or above the level changes nothing', () => {
    const r = T.effective(mk({ freeFall: 14 }), { weapon: 'Knife', zerog: true });
    assert.strictEqual(r.roll, 14);
    assert.strictEqual(r.lines[0].label, 'Knife');
  });
  it('the beam exemption and the no-Free-Fall note stay', () => {
    const r = T.effective(mk({ freeFall: 8 }), { weapon: 'Blaster pistol', zerog: true });
    assert.strictEqual(r.roll, 17);
    assert.ok(r.notes.length >= 1);
    assert.ok(T.effective(mk(), { weapon: 'Knife', zerog: true }).notes.some((n) => /no Free Fall/.test(n)));
  });
  it('a fractional Free Fall or level gives an integer roll', () => {
    const data = withWeapon(mk({ freeFall: 12.7 }), 'Knife', { level: 17.6, base: 17.6 });
    assert.strictEqual(rolls(data, { weapon: 'Knife', zerog: true }), 12);
    assert.strictEqual(rolls(data, { weapon: 'Knife' }), 17);
    const odd = withWeapon(mk({ freeFall: -29 }), 'Knife', { level: 22, base: '-2.7' });
    assert.ok(Number.isInteger(rolls(odd, { weapon: 'Knife', zerog: true })));
  });
});

describe('sighting aids and programs (B364, B372, B412, HT156, HT157)', () => {
  const laser = (acc, id = 'laser') => ({ id, name: 'Laser sight', bonus: 1, acc, fixed: false, from: 'row' });
  it('a laser sight gives its bonus without Aim, however the sheet flags it', () => {
    for (const acc of [true, false]) {
      assert.strictEqual(rolls(gunsData({ aids: [laser(acc)] }), { weapon: 'Blaster pistol', aids: { laser: true } }), 13, String(acc));
    }
  });
  it('a laser sight still works when Aim is refused (Move and Attack)', () => {
    assert.strictEqual(rolls(gunsData({ aids: [laser(true)], bulk: 2 }), { weapon: 'Blaster pistol', aids: { laser: true }, aim: 2, man: 'move' }), 11);
  });
  it('when aiming, a laser sits under the twice-Acc cap: Acc 3, aim 3, braced is 18', () => {
    for (const acc of [true, false]) {
      assert.strictEqual(rolls(gunsData({ aids: [laser(acc)] }), { weapon: 'Blaster pistol', aim: 3, braced: true, aids: { laser: true } }), 18, String(acc));
    }
  });
  it('an Acc-flagged HUD link needs Aim; an unflagged targeting system works without it', () => {
    const hud = { id: 'hud', name: 'HUD link', bonus: 1, acc: true, fixed: false, from: 'row' };
    assert.strictEqual(rolls(gunsData({ aids: [hud] }), { weapon: 'Blaster pistol', aids: { hud: true } }), 12);
    const reflex = { id: 'rs', name: 'Reflex sight', bonus: 1, acc: false, fixed: false, from: 'row' };
    assert.strictEqual(rolls(gunsData({ aids: [reflex] }), { weapon: 'Blaster pistol', aids: { rs: true } }), 13);
  });
  it('a targeting program is a skill bonus: outside the aim caps, with or without Aim', () => {
    const tp = { id: 'tp', name: 'Targeting program', bonus: 2, acc: false, fixed: false, from: 'gear' };
    const data = gunsData({}, { aids: [tp] });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aids: { tp: true } }), 14);
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aim: 3, braced: true, aids: { tp: true } }), 12 + 6 + 2);
    const sp = { id: 'sp', name: 'Silhouette program', bonus: 1, acc: true, fixed: false, from: 'gear' };
    assert.strictEqual(rolls(gunsData({}, { aids: [sp] }), { weapon: 'Blaster pistol', aim: 3, aids: { sp: true } }), 12 + 5 + 1);
  });
  it('the same aid in the weapon\'s row and character-wide counts once, the row\'s', () => {
    const data = gunsData({ aids: [laser(false, 'row-laser')] }, { aids: [laser(false, 'gear-laser')] });
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', aids: { 'row-laser': true, 'gear-laser': true } }), 13);
    assert.deepStrictEqual(T.aidsFor(data, data.weapons[1]).map((a) => a.id), ['row-laser']);
    assert.deepStrictEqual(T.aidsFor(data, data.weapons[0]), []);
  });
  it('an aid bonus that is a string reads as its number, and no label says NaN', () => {
    const sg = { id: 'sg', name: 'Smartgun', bonus: '+2', acc: false, fixed: false, from: 'gear' };
    const r = T.effective(mk({ aids: [sg] }), { weapon: 'Blaster pistol', aids: { sg: true } });
    assert.strictEqual(r.roll, 19);
    assert.ok(r.lines.every((l) => !/NaN/.test(l.label)));
  });
});

describe('Telegraphic Attack, Deceptive Attack and Evaluate (MA113, B369)', () => {
  it('Telegraphic does not stack with Evaluate: Knife 14 is 18', () => {
    const r = T.effective(mk(), { weapon: 'Knife', telegraphic: true, evaluate: 3 });
    assert.strictEqual(r.roll, 18);
    assert.ok(r.notes.some((n) => /Evaluate/.test(n)));
  });
  it('Telegraphic and Deceptive cannot be combined: Telegraphic wins, with a note', () => {
    const r = T.effective(mk(), { weapon: 'Knife', telegraphic: true, deceptive: -2, foe: 10 });
    assert.strictEqual(r.roll, 18);
    assert.ok(r.notes.some((n) => /cannot be combined/.test(n)));
    assert.strictEqual(r.foe.defence, 12);
  });
  it('conflicts tells the page which control to disable', () => {
    assert.deepStrictEqual(T.conflicts({}), { telegraphic: false, deceptive: false, rapid: false });
    assert.deepStrictEqual(T.conflicts({ telegraphic: true }), { telegraphic: false, deceptive: true, rapid: false });
    assert.deepStrictEqual(T.conflicts({ deceptive: -2 }), { telegraphic: true, deceptive: false, rapid: false });
    assert.deepStrictEqual(T.conflicts({ telegraphic: true, deceptive: -4 }), { telegraphic: false, deceptive: true, rapid: false });
    assert.deepStrictEqual(T.conflicts(null), { telegraphic: false, deceptive: false, rapid: false });
  });
  it('Deceptive never takes the roll below 10, with a note, and the foe follows the steps used', () => {
    const k = (level) => withWeapon(mk(), 'Knife', { level, base: level });
    let r = T.effective(k(12), { weapon: 'Knife', deceptive: -4, foe: 10 });
    assert.strictEqual(r.roll, 10);
    assert.ok(r.notes.some((n) => /below 10/.test(n)));
    assert.strictEqual(r.foe.defence, 9);
    assert.strictEqual(rolls(k(14), { weapon: 'Knife', deceptive: -8 }), 10);
    assert.strictEqual(rolls(k(13), { weapon: 'Knife', deceptive: -2 }), 11);
    assert.strictEqual(rolls(k(11), { weapon: 'Knife', deceptive: -2 }), 11);
    assert.strictEqual(rolls(k(9), { weapon: 'Knife', deceptive: -2 }), 9);
    r = T.effective(k(20), { weapon: 'Knife', deceptive: -4, man: 'move' });
    assert.strictEqual(r.roll, 9);
  });
});

describe('rapid fire past 100 shots (SS159) and the Rcl note (B373)', () => {
  const data = withWeapon(mk(), 'Blaster pistol', { rof: 2000 });
  it('the table carries on', () => {
    const got = [99, 100, 199, 200, 399, 400, 799, 800, 999].map((s) => rolls(data, { weapon: 'Blaster pistol', shots: s }) - 17);
    assert.deepStrictEqual(got, [6, 7, 7, 8, 8, 9, 9, 10, 10]);
  });
  it('the Rcl note names the step', () => {
    const one = T.effective(mk(), { weapon: 'Blaster pistol', shots: 3 });
    assert.ok(one.notes.some((n) => /^Every point the roll/.test(n)));
    const two = T.effective(withWeapon(mk(), 'Blaster pistol', { rcl: 2 }), { weapon: 'Blaster pistol', shots: 3 });
    assert.ok(two.notes.some((n) => /^Every 2 points the roll/.test(n)));
  });
});

describe('All-Out Attack (Double) with two weapons (MA97, MA126)', () => {
  it('is allowed, the -4 stays, and a note says one attack is traded', () => {
    const r = T.effective(mk(), { weapon: 'Knife', man: 'aodbl', dual: true });
    assert.strictEqual(r.roll, 10);
    assert.ok(r.notes.some((n) => /three attacks/.test(n)));
  });
});

describe('cover and target posture (B407, B548, B551)', () => {
  const P = { weapon: 'Blaster pistol' };
  it('partly exposed and light cover are -2 each; a number is not a cover choice', () => {
    assert.strictEqual(rolls(mk(), Object.assign({ cover: 'partial' }, P)), 15);
    assert.strictEqual(rolls(mk(), Object.assign({ cover: 'light' }, P)), 15);
    assert.strictEqual(rolls(mk(), Object.assign({ cover: -4 }, P)), 17);
    assert.strictEqual(rolls(mk(), Object.assign({ cover: 0 }, P)), 17);
  });
  it('-4 for each figure the shot passes', () => {
    assert.strictEqual(rolls(mk(), Object.assign({ behind: 2 }, P)), 9);
    assert.strictEqual(rolls(mk(), Object.assign({ behind: -3 }, P)), 17);
  });
  it('a low target is -2, but only against torso, groin or a leg', () => {
    assert.strictEqual(rolls(mk(), Object.assign({ targetLow: true }, P)), 15);
    assert.strictEqual(rolls(mk(), Object.assign({ targetLow: true, loc: 'groin' }, P)), 12);
    assert.strictEqual(rolls(mk(), Object.assign({ targetLow: true, loc: 'skull' }, P)), 10);
    assert.strictEqual(rolls(mk(), Object.assign({ targetLow: true, loc: 'extremity' }, P)), 13);
    const limb = T.effective(mk(), Object.assign({ targetLow: true, loc: 'limb' }, P));
    assert.strictEqual(limb.roll, 13);
    assert.ok(limb.notes.some((n) => /legs only/.test(n)));
  });
  it('none of it applies to a melee weapon', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', cover: 'partial', behind: 2, targetLow: true }), 14);
  });
});

describe('constants pinned (the review\'s surviving mutations)', () => {
  it('Evaluate stops at +3', () => assert.strictEqual(rolls(mk(), { weapon: 'Knife', evaluate: 4 }), 17));
  it('bad footing is -2, melee and ranged', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', footing: true }), 12);
    assert.strictEqual(rolls(mk(), { weapon: 'Blaster pistol', footing: true }), 15);
  });
  it('shock is what was lost, at most -4', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', shock: -2 }), 12);
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', shock: -9 }), 10);
  });
  it('posture is -2 or -4 and no worse', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', posture: -4 }), 10);
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', posture: -9 }), 10);
  });
  it('the Speed/Range steps', () => {
    const got = [5, 7, 8, 10, 11, 15, 16, 20, 21, 30, 31, 50, 70, 71].map(T.rangePenalty);
    assert.deepStrictEqual(got, [-2, -3, -4, -4, -5, -5, -6, -6, -7, -7, -8, -8, -9, -10]);
  });
  it('bracing is +1', () => {
    const r = T.effective(mk(), { weapon: 'Blaster pistol', aim: 1, braced: true });
    assert.strictEqual(line(r, 'aiming').value, 7);
  });
  it('a critical success on 6 needs skill 16', () => {
    assert.strictEqual(T.outcome(6, 16), 'CS');
    assert.strictEqual(T.outcome(6, 15), 'S');
    assert.strictEqual(T.outcome(5, 15), 'CS');
  });
  it('the dual technique buys off at most the -4', () => {
    const data = mk();
    data.techniques.dual['Beam Weapons (Pistol)'] = 9;
    assert.strictEqual(rolls(data, { weapon: 'Blaster pistol', dual: true }), 17);
  });
});

describe('the page\'s starting and saved state', () => {
  const AIDS = [
    { id: 'row-laser', name: 'Laser sight', bonus: 1, acc: false, fixed: false, from: 'row', on: true },
    { id: 'row-prog', name: 'Targeting program', bonus: null, acc: false, fixed: false, from: 'row', on: true },
  ];
  const WIDE = [
    { id: 'gear-hud', name: 'HUD link', bonus: 1, acc: true, fixed: false, from: 'gear', on: true },
    { id: 'gear-spare', name: 'Reflex sight', bonus: 2, acc: true, fixed: false, from: 'gear', on: false },
  ];
  const data = () => { const d = scoped(AIDS); d.aids = WIDE; return d; };

  it('starts neutral on the first weapon, every aid ticked as its `on` says', () => {
    const s = T.defaultState(data());
    assert.strictEqual(s.weapon, 'Knife');
    assert.deepStrictEqual(s.aids, { 'row-laser': true, 'row-prog': true, 'gear-hud@Blaster pistol': true, 'gear-spare@Blaster pistol': false });
    assert.strictEqual(rolls(data(), s), 14, 'the knife: the sheet number');
    assert.strictEqual(rolls(data(), Object.assign({}, s, { weapon: 'Blaster pistol' })), 18, 'the sheet number and the ticked laser sight, which needs no Aim');
    const bare = T.defaultState(scoped([]));
    assert.strictEqual(rolls(scoped([]), Object.assign({}, bare, { weapon: 'Blaster pistol' })), 17);
  });
  it('reads anything that is not an object as the defaults, never throwing', () => {
    const want = T.defaultState(data());
    for (const bad of [null, undefined, 'x', 5, [], true, () => 1]) assert.deepStrictEqual(T.cleanState(data(), bad), want);
  });
  it('keeps what is valid', () => {
    const raw = { weapon: 'Blaster pistol', aim: 3, braced: true, aids: { 'row-laser': false }, aidBonus: { 'row-prog': '2' },
      yards: '70', man: 'popup', cover: 'light', behind: 2, loc: 'skull', sm: -2, vis: -4, deceptive: -4, foe: '12' };
    const s = T.cleanState(data(), raw);
    assert.strictEqual(s.weapon, 'Blaster pistol');
    assert.strictEqual(s.aim, 3);
    assert.strictEqual(s.braced, true);
    assert.strictEqual(s.aids['row-laser'], false);
    assert.strictEqual(s.aids['gear-hud@Blaster pistol'], true);
    assert.deepStrictEqual(s.aidBonus, { 'row-prog': 2 });
    assert.strictEqual(s.yards, '70');
    assert.strictEqual(s.man, 'popup');
    assert.strictEqual(s.cover, 'light');
    assert.strictEqual(s.behind, '2');
    assert.strictEqual(s.loc, 'skull');
    assert.strictEqual(s.sm, -2);
    assert.strictEqual(s.vis, -4);
    assert.strictEqual(s.deceptive, -4);
    assert.strictEqual(s.foe, '12');
  });
  it('a weapon key that no longer exists falls back to the first weapon', () => {
    assert.strictEqual(T.cleanState(data(), { weapon: 'Gone gun', aim: 2 }).weapon, 'Knife');
    assert.strictEqual(T.cleanState(data(), { weapon: 'Gone gun', aim: 2 }).aim, 2);
  });
  it('an aid id that is gone is dropped; a bad tick or bonus is the default', () => {
    const s = T.cleanState(data(), { aids: { 'old-scope': true, 'row-laser': 'yes', 'gear-spare@Blaster pistol': true }, aidBonus: { 'old-scope': 3, 'row-prog': 'lots' } });
    assert.ok(!('old-scope' in s.aids));
    assert.strictEqual(s.aids['row-laser'], true, 'default');
    assert.strictEqual(s.aids['gear-spare@Blaster pistol'], true);
    assert.deepStrictEqual(s.aidBonus, {});
  });
  it('a technique must belong to the weapon', () => {
    const d = data();
    d.techniques.other = [{ skill: 'Knife', name: 'Knife trick', level: 16 }];
    assert.strictEqual(T.cleanState(d, { weapon: 'Knife', technique: 'Knife trick' }).technique, 'Knife trick');
    assert.strictEqual(T.cleanState(d, { weapon: 'Blaster pistol', technique: 'Knife trick' }).technique, '');
    assert.strictEqual(T.cleanState(d, { weapon: 'Knife', technique: 'Gone trick' }).technique, '');
  });
  it('values outside what a control offers are the defaults', () => {
    const s = T.cleanState(data(), { aim: 9, man: 'dance', cover: 'moat', loc: 'tail', sm: 99, vis: 4, deceptive: -3, posture: -1, shock: 2, evaluate: 7, braced: 1, yards: {}, foe: [] });
    const d = T.defaultState(data());
    for (const k of ['aim', 'man', 'cover', 'loc', 'sm', 'vis', 'deceptive', 'posture', 'shock', 'evaluate', 'braced', 'yards', 'foe']) assert.deepStrictEqual(s[k], d[k], k);
  });
  it('whatever it is given, the result is a state that sums to an integer', () => {
    const junk = [null, undefined, 'a', -1, 1e9, NaN, {}, [], true, '<b>', { a: 1 }, '12', 0];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const keys = Object.keys(T.defaultState(data())).concat(['zzz']);
    for (let i = 0; i < 300; i++) {
      const raw = {};
      for (const k of keys) if (rnd() < 0.6) raw[k] = junk[Math.floor(rnd() * junk.length)];
      const s = T.cleanState(data(), raw);
      const r = T.effective(data(), s);
      assert.ok(Number.isInteger(r.roll), JSON.stringify(raw));
    }
  });
});

// ---------- round three ----------
describe('skill-bonus aids need no Aim and sit outside the Acc caps (HT156, HT157)', () => {
  const aid = (name, acc, bonus = 2) => ({ id: 'x', name, bonus, acc, fixed: false, from: 'row' });
  it('a targeting or silhouette program applies at aim 0 even when flagged Acc', () => {
    for (const name of ['Targeting program', 'Silhouette program']) {
      for (const acc of [true, false]) {
        assert.strictEqual(rolls(gunsData({ aids: [aid(name, acc)] }), { weapon: 'Blaster pistol', aids: { x: true } }), 14, `${name} ${acc}`);
      }
    }
  });
  it('a reflex sight is a skill bonus: +1 at aim 0 however flagged, outside the caps when aiming', () => {
    for (const acc of [true, false]) {
      assert.strictEqual(rolls(gunsData({ aids: [aid('Reflex sight', acc, 1)] }), { weapon: 'Blaster pistol', aids: { x: true } }), 13);
    }
    const r = T.effective(gunsData({ aids: [aid('Reflex sight', false, 1)] }), { weapon: 'Blaster pistol', aim: 3, braced: true, aids: { x: true } });
    assert.strictEqual(r.roll, 12 + 6 + 1);
  });
  it('an unknown aid flagged Acc still needs Aim', () => {
    assert.strictEqual(rolls(gunsData({ aids: [aid('Gizmo', true)] }), { weapon: 'Blaster pistol', aids: { x: true } }), 12);
  });
});

describe('Telegraphic does not improve the critical chance (MA113)', () => {
  it('critSkill is the roll without the +4, else the roll', () => {
    const t = T.effective(mk(), { weapon: 'Knife', telegraphic: true });
    assert.strictEqual(t.roll, 18);
    assert.strictEqual(t.critSkill, 14);
    const n = T.effective(mk(), { weapon: 'Knife' });
    assert.strictEqual(n.critSkill, n.roll);
    assert.strictEqual(T.effective(null, {}).critSkill, 0);
  });
  it('the +4 is not counted even when Evaluate was set (it is replaced)', () => {
    assert.strictEqual(T.effective(mk(), { weapon: 'Knife', telegraphic: true, evaluate: 3 }).critSkill, 14);
  });
  it('outcome takes the skill that sets the critical-success range; failures use the roll', () => {
    assert.strictEqual(T.outcome(5, 18, 14), 'S');
    assert.strictEqual(T.outcome(5, 18, 15), 'CS');
    assert.strictEqual(T.outcome(6, 18, 15), 'S');
    assert.strictEqual(T.outcome(6, 18, 16), 'CS');
    assert.strictEqual(T.outcome(4, 18, 3), 'CS');
    assert.strictEqual(T.outcome(5, 18), 'CS');
    assert.strictEqual(T.outcome(17, 18, 14), 'F');
    assert.strictEqual(T.outcome(17, 15, 15), 'CF');
  });
  it('odds(roll, critSkill) reports the right critical chance', () => {
    assert.ok(Math.abs(T.odds(18, 14).crit - 4 / 216) < 1e-12);
    assert.ok(Math.abs(T.odds(18).crit - 20 / 216) < 1e-12);
    assert.ok(Math.abs(T.odds(18, 14).hit - T.odds(18).hit) < 1e-12);
    assert.strictEqual(T.odds(2, 14).none, true);
    assert.ok(Math.abs(T.odds(18, 'x').crit - 20 / 216) < 1e-12);
  });
  it('the foe\'s chance to be hit uses it too', () => {
    const t = T.effective(mk(), { weapon: 'Knife', telegraphic: true, foe: 10 });
    const d = T.odds(18, 14);
    assert.ok(Math.abs(t.foe.lands - (d.crit + (d.hit - d.crit) * (1 - t.foe.defends))) < 1e-9);
  });
});

describe('int() rounds toward zero', () => {
  it('a negative fraction loses its fraction', () => {
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', other: -2.7 }), 12);
    assert.strictEqual(rolls(mk(), { weapon: 'Knife', other: 2.7 }), 16);
    const data = withWeapon(mk({ freeFall: 12.7 }), 'Knife', { level: 17.6, base: 17.6 });
    assert.strictEqual(rolls(data, { weapon: 'Knife', zerog: true }), 12);
  });
});


describe('weapons with the same name', () => {
  const twin = () => {
    const d = mk();
    d.weapons = [
      Object.assign({}, d.weapons[0], { id: 'w0', key: 'Twin Blade', name: 'Twin Blade', skill: 'Knife', level: 17, base: 17, nth: 0 }),
      Object.assign({}, d.weapons[0], { id: 'w1', key: 'Twin Blade', name: 'Twin Blade', skill: 'Karate', level: 15, base: 15, nth: 1 }),
      Object.assign({}, d.weapons[1], { id: 'w2', nth: 0 }),
    ];
    return d;
  };
  it('effective finds a weapon by id, so the second twin has its own numbers', () => {
    const a = T.effective(twin(), { weapon: 'w0' });
    const b = T.effective(twin(), { weapon: 'w1' });
    assert.strictEqual(a.roll, 17); assert.match(a.lines[0].label, /Knife/);
    assert.strictEqual(b.roll, 15); assert.match(b.lines[0].label, /Karate/);
  });
  it('a key from a saved state before ids existed finds the first weapon of that name', () => {
    assert.strictEqual(T.effective(twin(), { weapon: 'Twin Blade' }).roll, 17);
    assert.strictEqual(T.cleanState(twin(), { weapon: 'Twin Blade' }).weapon, 'w0');
    assert.strictEqual(T.cleanState(twin(), { weapon: 'w1' }).weapon, 'w1');
    assert.strictEqual(T.cleanState(twin(), { weapon: 'w9' }).weapon, 'w0');
    assert.strictEqual(T.defaultState(twin()).weapon, 'w0');
  });
  it('a block with no ids still works by key', () => {
    assert.strictEqual(T.defaultState(mk()).weapon, 'Knife');
    assert.strictEqual(T.cleanState(mk(), { weapon: 'Blaster pistol' }).weapon, 'Blaster pistol');
  });
});
