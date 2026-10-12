/**
 * The to-hit data block: the parsed GURPS model turned into the one JSON block
 * the page script reads. Models are built by hand; one case parses the Ronnie
 * fixture. Names in these tests are invented.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const { extractSections } = require('../../../lib/processor');
const { parseGurps, emptyModel } = require('../../../lib/templates/gurps/parse');
const { buildTohitData, tohitDataScript } = require('../../../lib/templates/gurps/tohit-data');

const META = { pcSlug: 'six' };

const rangedRow = (o = {}) => ({
  weapon: 'Blaster pistol', skill: 'Beam Weapons (Pistol)-17', damage: '3d burn',
  acc: '6', range: '150/450', rof: '10', shots: '20', st: '', bulk: '-2', rcl: '1', notes: '', ...o,
});
const meleeRow = (o = {}) => ({
  weapon: 'Hatchet', skill: 'Axe/Mace-17', damage: 'sw+1 cut', reach: '1', parry: '11', st: '', notes: '', ...o,
});
function model(parts = {}) {
  const m = emptyModel();
  m.skills = (parts.skills || [
    ['Beam Weapons (Pistol)', '17'], ['Guns (Rifle)', '17'], ['Axe/Mace', '17'], ['Knife', '14'],
  ]).map(([name, level]) => ({ name, level }));
  m.ranged = parts.ranged || [];
  m.melee = parts.melee || [];
  m.techniques = parts.techniques || [];
  m.traits.advantages = (parts.advantages || []).map(name => ({ name }));
  m.equipment.items = parts.items || [];
  return m;
}
const one = (o) => buildTohitData(model({ ranged: [rangedRow(o)] }), META).weapons[0];

function walk(v, fn, where = '$') {
  fn(v, where);
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, fn, `${where}.${k}`);
}

describe('buildTohitData: the Skill cell', () => {
  const cases = [
    ['Beam Weapons (Pistol)-17', 'Beam Weapons (Pistol)', 17],
    ['Guns (Rifle) 17', 'Guns (Rifle)', 17],
    ['Wrestling-15 +4 = 19', 'Wrestling', 19],
    ['DX-12 (default)', 'DX', 12],
    ['10', '', 10],
    ['Knife (12)', 'Knife', 12],
    ['Brawling (11)', 'Brawling', 11],
    ['Guns (Rifle) (15)', 'Guns (Rifle)', 15],
    ['Beam Weapons (Rifle)-14 (default, Pistol-4)', 'Beam Weapons (Rifle)', 14],
    ['Guns (Rifle) 17 (DX+2)', 'Guns (Rifle)', 17],
    ['Judo 16 (Karate 18)', 'Judo', 16],
    ['Guns (Rifle) 17/15', 'Guns (Rifle)', 17],
    ['Guns/TL8 (Pistol)-12', 'Guns (Pistol)', 12],
  ];
  for (const [cell, skill, level] of cases) {
    it(`reads "${cell}" as ${JSON.stringify(skill)} at ${level}`, () => {
      const w = one({ skill: cell });
      assert.strictEqual(w.skill, skill);
      assert.strictEqual(w.level, level);
    });
  }
  it('leaves out a weapon whose Skill cell has no level ("Brawling")', () => {
    const d = buildTohitData(model({ ranged: [rangedRow({ skill: 'Brawling' }), rangedRow({ weapon: 'Other gun' })] }), META);
    assert.deepStrictEqual(d.weapons.map(w => w.name), ['Other gun']);
  });
  it('reads a weapon written with a trailing "(+1)" or a diamond after its name', () => {
    const w = one({ weapon: 'Colt M4A1 \u25c7', skill: 'Guns (Rifle) 17 (+1)' });
    assert.strictEqual(w.level, 17);
    assert.strictEqual(w.name, 'Colt M4A1');
    assert.strictEqual(w.key, 'Colt M4A1 \u25c7');
  });
  it('keeps key as the raw Weapon cell, equal to the row\'s data-weapon-key', () => {
    assert.strictEqual(one({ weapon: 'Blaster pistol (stun)' }).key, 'Blaster pistol (stun)');
  });
  it('flags beam weapons and sets type', () => {
    const d = buildTohitData(model({ ranged: [rangedRow()], melee: [meleeRow()] }), META);
    const r = d.weapons.find(w => w.type === 'ranged');
    const m = d.weapons.find(w => w.type === 'melee');
    assert.strictEqual(r.type, 'ranged'); assert.strictEqual(r.beam, true);
    assert.strictEqual(m.type, 'melee'); assert.strictEqual(m.beam, false);
  });
});

describe('buildTohitData: the Acc cell', () => {
  it('"6" is acc 6 with no aid', () => {
    const w = one({ acc: '6' });
    assert.strictEqual(w.acc, 6); assert.deepStrictEqual(w.aids, []);
  });
  it('"6+3" is acc 6 and a scope aid', () => {
    const w = one({ acc: '6+3' });
    assert.strictEqual(w.acc, 6);
    assert.strictEqual(w.aids.length, 1);
    assert.deepStrictEqual({ ...w.aids[0], id: undefined },
      { id: undefined, name: 'Scope', bonus: 3, acc: true, fixed: false, from: 'row', on: true });
  });
  it('"4 (+1 HUD)" is acc 4 and a HUD link aid', () => {
    const w = one({ acc: '4 (+1 HUD)' });
    assert.strictEqual(w.acc, 4);
    assert.strictEqual(w.aids[0].name, 'HUD link');
    assert.strictEqual(w.aids[0].bonus, 1);
    assert.strictEqual(w.aids[0].acc, true);
  });
  it('"10*" is 10; an empty or dash cell is 0', () => {
    assert.strictEqual(one({ acc: '10*' }).acc, 10);
    assert.strictEqual(one({ acc: '' }).acc, 0);
    assert.strictEqual(one({ acc: '\u2014' }).acc, 0);
  });
  it('rcl defaults to 1, bulk is positive, rof is a number', () => {
    const w = one({ rcl: '', bulk: '-4', rof: '3\u00d72' });
    assert.strictEqual(w.rcl, 1); assert.strictEqual(w.bulk, 4); assert.strictEqual(w.rof, 3);
    const z = one({ rcl: '0', bulk: '', rof: '' });
    assert.strictEqual(z.rcl, 1); assert.strictEqual(z.bulk, 0); assert.strictEqual(z.rof, 1);
  });
});

describe('buildTohitData: a weapon row\'s Notes', () => {
  it('standard form: three aids, the third not an Acc aid', () => {
    const w = one({ notes: 'Scope +2 Acc; HUD link +1 Acc; Laser sight +1' });
    assert.deepStrictEqual(w.aids.map(a => [a.name, a.bonus, a.acc, a.from]),
      [['Scope', 2, true, 'row'], ['HUD link', 1, true, 'row'], ['Laser sight', 1, false, 'row']]);
  });
  it('a fixed scope is fixed', () => {
    const a = one({ notes: 'Fixed scope +4 Acc' }).aids[0];
    assert.strictEqual(a.name, 'Scope'); assert.strictEqual(a.fixed, true); assert.strictEqual(a.bonus, 4);
  });
  it('non-aid bonuses are bonuses, not aids', () => {
    const w = one({ notes: 'Weapon Bond +1; Balanced +1' });
    assert.deepStrictEqual(w.aids, []);
    assert.deepStrictEqual(w.bonuses, [{ name: 'Weapon Bond', bonus: 1 }, { name: 'Balanced', bonus: 1 }]);
  });
  it('words with no number are left alone', () => {
    const w = one({ notes: 'vacuum-safe' });
    assert.deepStrictEqual(w.aids, []); assert.deepStrictEqual(w.bonuses, []);
  });
  it('a melee weapon gets bonuses but no aids and no ranged numbers', () => {
    const d = buildTohitData(model({ melee: [meleeRow({ notes: 'Balanced +1; scope +2' })] }), META);
    const w = d.weapons[0];
    assert.strictEqual(w.type, 'melee');
    assert.deepStrictEqual(w.aids, []);
    assert.deepStrictEqual(w.bonuses, [{ name: 'Balanced', bonus: 1 }]);
    assert.strictEqual(w.acc, undefined);
  });
});

describe('buildTohitData: loose prose on real sheets', () => {
  const build = (items) => buildTohitData(model({ ranged: [rangedRow()], items }), META).aids;
  it('a targeting program in gear with "+2 Guns skill" is a flat character-wide aid', () => {
    const [a] = build([{ name: 'Targeting Program (Complexity 4)', notes: '+2 Guns skill (all shots, in suit)' }]);
    assert.strictEqual(a.name, 'Targeting program');
    assert.strictEqual(a.bonus, 2); assert.strictEqual(a.acc, false); assert.strictEqual(a.from, 'gear');
  });
  it('a gear row named for a weapon feeds THAT weapon: "smartgun + HUD link" is two row aids with no bonus', () => {
    const d = buildTohitData(model({ ranged: [rangedRow({ weapon: 'Blaster pistol (Fine) \u2014 stowed, toggle on' })],
      items: [{ name: 'Blaster pistol (Fine)', notes: 'smartgun + HUD link, vacuum-safe' }] }), META);
    assert.deepStrictEqual(d.aids, []);
    assert.deepStrictEqual(d.weapons[0].aids.map(a => [a.name, a.bonus, a.from]), [['Smartgun', null, 'row'], ['HUD link', null, 'row']]);
  });
  it('"scope (+1 Acc)" is bonus 1 and an Acc aid', () => {
    const [a] = build([{ name: 'Rifle', notes: 'scope (+1 Acc)' }]);
    assert.strictEqual(a.name, 'Scope'); assert.strictEqual(a.bonus, 1); assert.strictEqual(a.acc, true);
  });
  it('items with null notes and no aid names give nothing', () => {
    assert.deepStrictEqual(build([{ name: 'Rope', notes: null }, { name: 'Boots' }]), []);
  });
  it('an aid written as an advantage is a trait aid', () => {
    const d = buildTohitData(model({ ranged: [rangedRow()], advantages: ['Smartgun link'] }), META);
    assert.deepStrictEqual(d.aids.map(a => [a.name, a.from]), [['Smartgun', 'trait']]);
  });
});

describe('buildTohitData: aid ids', () => {
  it('are unique within a character and identical across builds', () => {
    const m = () => model({
      ranged: [rangedRow({ notes: 'Scope +2 Acc', acc: '6+3' }), rangedRow({ weapon: 'Blaster pistol', notes: 'Scope +1 Acc' })],
      items: [{ name: 'Scope', notes: '+1' }, { name: 'Scope', notes: '+2' }],
      advantages: ['Smartgun'],
    });
    const ids = (d) => [...d.aids, ...d.weapons.flatMap(w => w.aids)].map(a => a.id);
    const a = ids(buildTohitData(m(), META));
    const b = ids(buildTohitData(m(), META));
    assert.deepStrictEqual(a, b);
    assert.ok(a.length >= 5);
    assert.strictEqual(new Set(a).size, a.length);
    for (const id of a) assert.match(id, /^[a-z0-9-]+$/);
  });
  it('do not change when an unrelated weapon is added after', () => {
    const base = model({ ranged: [rangedRow({ acc: '6+3' })] });
    const more = model({ ranged: [rangedRow({ acc: '6+3' }), rangedRow({ weapon: 'Second gun', acc: '4+1' })] });
    assert.strictEqual(buildTohitData(base, META).weapons[0].aids[0].id, buildTohitData(more, META).weapons[0].aids[0].id);
  });
});

describe('buildTohitData: advantages', () => {
  const traits = (...adv) => buildTohitData(model({ ranged: [rangedRow()], advantages: adv }), META).traits;
  it('reads a level written as a trailing number, in brackets, or beside Night Vision', () => {
    assert.strictEqual(traits('Telescopic Vision 2').telescopic, 2);
    assert.strictEqual(traits('Telescopic Vision (2)').telescopic, 2);
    assert.strictEqual(traits('Night Vision 5').nightVision, 5);
  });
  it('a character with none of them gets neutral values', () => {
    assert.deepStrictEqual(traits('Luck'), { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 });
  });
  it('Ambidexterity, Off-Hand Weapon Training, Weapon Master, Trained by a Master', () => {
    assert.strictEqual(traits('Ambidexterity').ambidextrous, true);
    assert.deepStrictEqual(traits('Off-Hand Weapon Training (Knife)').offHand, ['Knife']);
    assert.strictEqual(traits('Weapon Master (Knife)').halfRapid, true);
    assert.strictEqual(traits('Trained by a Master').halfRapid, true);
  });
});

describe('buildTohitData: techniques', () => {
  const t = (techniques, skills, ranged = [rangedRow()]) => buildTohitData(model({ ranged, techniques, skills }), META).techniques;
  it('Targeted Attack on a ranged skill', () => {
    const r = t([{ name: 'Targeted Attack (Beam Weapons (Pistol)/Skull)', def: '', level: '12' }]);
    assert.deepStrictEqual(r.targeted, [{ skill: 'Beam Weapons (Pistol)', loc: 'skull', net: -5, name: 'Targeted Attack (Beam Weapons (Pistol)/Skull)' }]);
  });
  it('Targeted Attack takes the skill from the Default cell', () => {
    const r = t([{ name: 'Targeted Attack (Axe Swing/Neck)', def: 'Axe/Mace-5', level: '17' }]);
    assert.strictEqual(r.targeted[0].skill, 'Axe/Mace');
    assert.strictEqual(r.targeted[0].loc, 'neck');
    assert.strictEqual(r.targeted[0].net, 0);
  });
  it('arm and leg map to limb; hand and foot to extremity', () => {
    const r = t([
      { name: 'Targeted Attack (Knife Thrust/Arm)', def: 'Knife-4', level: '12' },
      { name: 'Targeted Attack (Knife Thrust/Leg)', def: 'Knife-4', level: '12' },
      { name: 'Targeted Attack (Knife Thrust/Hand)', def: 'Knife-4', level: '12' },
      { name: 'Targeted Attack (Knife Thrust/Foot)', def: 'Knife-4', level: '12' },
    ]);
    assert.deepStrictEqual(r.targeted.map(x => x.loc), ['limb', 'limb', 'extremity', 'extremity']);
  });
  it('leaves out a Targeted Attack with an unknown location, no slash, or a skill not on the sheet', () => {
    const r = t([
      { name: 'Targeted Attack (Knife Thrust/Tail)', def: 'Knife-4', level: '12' },
      { name: 'Targeted Attack (Knife Thrust)', def: 'Knife-4', level: '12' },
      { name: 'Targeted Attack (Whip/Neck)', def: 'Whip-4', level: '12' },
    ]);
    assert.deepStrictEqual(r.targeted, []);
  });
  it('Dual-Weapon Attack records the points of the -4 bought off', () => {
    const r = t([{ name: 'Dual-Weapon Attack (Guns (Pistol))', def: 'Guns (Pistol)-4', level: '15' }], [['Guns (Pistol)', '16']]);
    assert.deepStrictEqual(r.dual, { 'Guns (Pistol)': 3 });
  });
  it('Dual-Weapon Attack stays within 0 to 4', () => {
    const r = t([
      { name: 'Dual-Weapon Attack (Knife)', def: '', level: '5' },
      { name: 'Dual-Weapon Attack (Axe/Mace)', def: '', level: '30' },
    ]);
    assert.deepStrictEqual(r.dual, { Knife: 0, 'Axe/Mace': 4 });
  });
  it('another technique with a Default on a skill goes to other', () => {
    const r = t([{ name: 'Kicking', def: 'Karate-2', level: '15' }], [['Karate', '17']]);
    assert.deepStrictEqual(r.other, [{ skill: 'Karate', name: 'Kicking', level: 15 }]);
  });
  it('a technique with an unreadable level or Default is left out', () => {
    const r = t([{ name: 'Mystery', def: '', level: '15' }, { name: 'Kicking', def: 'Karate-2', level: '' }]);
    assert.deepStrictEqual(r.other, []);
  });
});

describe('buildTohitData: base, free fall, locations, bands', () => {
  it('base is the Skills-table level; a weapon written higher keeps its own level', () => {
    const w = one({ skill: 'Beam Weapons (Pistol)-18' });
    assert.strictEqual(w.level, 18); assert.strictEqual(w.base, 17);
  });
  it('base is null when the skill is not on the Skills table or the cell has no skill', () => {
    assert.strictEqual(one({ skill: 'Blowpipe-12' }).base, null);
    assert.strictEqual(one({ skill: '10' }).base, null);
  });
  it('freeFall comes from the Skills table; null when absent', () => {
    const withFF = buildTohitData(model({ ranged: [rangedRow()], skills: [['Free Fall', '12'], ['Beam Weapons (Pistol)', '17']] }), META);
    assert.strictEqual(withFF.freeFall, 12);
    assert.strictEqual(buildTohitData(model({ ranged: [rangedRow()] }), META).freeFall, null);
  });
  it('locations carry stable keys with numeric penalties, from the shipped reference rows', () => {
    const d = buildTohitData(model({ ranged: [rangedRow()] }), META);
    assert.deepStrictEqual(d.locations.map(l => l[0]),
      ['torso', 'vitals', 'limb', 'extremity', 'groin', 'face', 'neck', 'skull', 'eye']);
    const pen = Object.fromEntries(d.locations.map(([k, , p]) => [k, p]));
    assert.deepStrictEqual(pen, { torso: 0, vitals: -3, limb: -2, extremity: -4, groin: -3, face: -5, neck: -5, skull: -7, eye: -9 });
  });
  it('bands are the yard values of the Speed/Range rows, ascending', () => {
    const { bands } = buildTohitData(model({ ranged: [rangedRow()] }), META);
    assert.strictEqual(bands[0], 2);
    assert.strictEqual(bands[bands.length - 1], 700);
    assert.ok(bands.every((b, i) => Number.isFinite(b) && (i === 0 || b > bands[i - 1])));
  });
  it('pc is the slug from meta', () => {
    assert.strictEqual(buildTohitData(model({ ranged: [rangedRow()] }), { pcSlug: 'six' }).pc, 'six');
  });
});

describe('buildTohitData: nothing to calculate', () => {
  it('returns null with no weapons at all', () => {
    assert.strictEqual(buildTohitData(model(), META), null);
  });
  it('returns null when no weapon has a readable level', () => {
    assert.strictEqual(buildTohitData(model({ ranged: [rangedRow({ skill: 'Brawling' })], melee: [meleeRow({ skill: '' })] }), META), null);
  });
  it('a model with only melee weapons has no ranged weapons', () => {
    const d = buildTohitData(model({ melee: [meleeRow()] }), META);
    assert.strictEqual(d.weapons.length, 1);
    assert.ok(d.weapons.every(w => w.type === 'melee'));
  });
  it('copes with a bare model and missing fields', () => {
    assert.strictEqual(buildTohitData({}, META), null);
    assert.strictEqual(buildTohitData(null, META), null);
    const d = buildTohitData({ ranged: [{ weapon: 'Gun', skill: 'Guns 12' }] }, META);
    assert.strictEqual(d.weapons[0].level, 12);
  });
});

describe('tohitDataScript', () => {
  it('writes "</script>" in a weapon name as an escaped "<"', () => {
    const d = buildTohitData(model({ ranged: [rangedRow({ weapon: 'Bad</script><b>gun' })] }), META);
    const html = tohitDataScript(d);
    assert.ok(html.startsWith('<script type="application/json" id="gurps-tohit-data">'));
    assert.ok(html.endsWith('</script>'));
    assert.strictEqual(html.slice(0, -'</script>'.length).includes('</script>'), false);
    assert.ok(!html.slice(60, -9).includes('<'));
    assert.ok(html.includes('\\u003c/script>'));
  });
  it('round-trips: the JSON inside reads back to the same data', () => {
    const d = buildTohitData(model({ ranged: [rangedRow({ weapon: 'A </script> B', notes: 'Scope +2 Acc <img src=x>' })] }), META);
    const inner = tohitDataScript(d).replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    assert.deepStrictEqual(JSON.parse(inner), JSON.parse(JSON.stringify(d)));
  });
  it('hostile text in gear notes and technique names stays inside the block', () => {
    const d = buildTohitData(model({
      ranged: [rangedRow()],
      items: [{ name: 'Scope <script>alert(1)</script>', notes: '+1 <b>x</b>' }],
      techniques: [{ name: 'Kicking </script>', def: 'Knife-2', level: '10' }],
    }), META);
    const html = tohitDataScript(d);
    assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
    assert.strictEqual((html.match(/<script/g) || []).length, 1);
  });
});

describe('buildTohitData: the Ronnie fixture', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../../fixtures/gurps/gurps-ronnie.md'), 'utf8');
  const { data: fm, content } = matter(raw);
  const m = parseGurps(fm, extractSections(content));
  const d = buildTohitData(m, { pcSlug: 'ronnie-vint' });
  it('returns a block with a finite level on every weapon', () => {
    assert.ok(d);
    assert.strictEqual(d.weapons.length, 7);
    for (const w of d.weapons) assert.ok(Number.isFinite(w.level), w.key);
  });
  it('reads the rifle row: diamond dropped, HUD aid found, base from Skills', () => {
    const rifle = d.weapons.find(w => w.key.startsWith('Colt M4A1'));
    assert.strictEqual(rifle.name, 'Colt M4A1 SOPMOD (5.56mm)');
    assert.strictEqual(rifle.skill, 'Guns (Rifle)');
    assert.strictEqual(rifle.acc, 4);
    assert.strictEqual(rifle.base, 17);
    assert.deepStrictEqual(rifle.aids.map(a => [a.name, a.bonus]), [['HUD link', 1]]);
  });
  it('keeps the chaingun at 19 over a skill of 17: "Guns (LMG)" is the Skills table\'s "Guns (Light Machine Gun)"', () => {
    const gun = d.weapons.find(w => w.key.startsWith('Linked Storm'));
    assert.strictEqual(gun.level, 19);
    assert.strictEqual(gun.base, 17);
    assert.strictEqual(gun.skill, 'Guns (Light Machine Gun)');
    assert.strictEqual(gun.skillAs, 'Guns (LMG)');
  });
  it('holds no NaN, undefined or non-finite number anywhere', () => {
    walk(d, (v, where) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${where} is ${v}`);
      assert.notStrictEqual(v, undefined, where);
    });
    assert.ok(!/NaN|undefined/.test(JSON.stringify(d)));
  });
});

// ---- Round two: false aids, skill forms, name matching, ticks ----

describe('round two: aids found by where the text is', () => {
  const chars = (items, advantages = []) =>
    buildTohitData(model({ ranged: [rangedRow()], items, advantages }), META).aids;
  it('prose that merely mentions a HUD makes no aid (and +3 Navigation is no to-hit bonus)', () => {
    assert.deepStrictEqual(chars([{ name: 'Inertial compass (integral to suit)',
      notes: 'Never lost. +3 Navigation (Air, Land, Sea). Feeds his helmet HUD and overlays his position on digital maps.' }]), []);
  });
  for (const name of ['Field scope', 'Scope of Work', 'Reflex sight cleaning kit', 'Helmet HUD', 'Mini HUD + earpiece comm',
    'Rifle scope cap', 'Smartgun-compatible gloves', 'Targeting software update']) {
    it(`item name "${name}" is not a sighting aid`, () => {
      assert.deepStrictEqual(chars([{ name, notes: '+1 hit' }]), []);
    });
  }
  it('a name that starts with an aid name is an aid: "Laser sight", "Scope, 4x", "Targeting Program (Complexity 4)"', () => {
    assert.deepStrictEqual(chars([{ name: 'Laser sight', notes: null }, { name: 'Scope, 4x', notes: '' }]).map(a => [a.name, a.bonus]),
      [['Laser sight', null], ['Scope', null]]);
  });
  it('the bonus must belong to the aid: +2 Guns skill counts, +3 Navigation does not', () => {
    const [a] = chars([{ name: 'Targeting Program (Complexity 4)', notes: '+3 Navigation; +2 Guns skill (all shots)' }]);
    assert.strictEqual(a.bonus, 2); assert.strictEqual(a.acc, false);
    const [b] = chars([{ name: 'Targeting Program', notes: '+3 Navigation' }]);
    assert.strictEqual(b.bonus, null);
  });
  it('a standard-form piece in any gear notes is an aid; the same words in prose are not', () => {
    const aids = chars([{ name: 'Combat suit', notes: 'sealed; Targeting program +2; HUD link +1 Acc; has a HUD link +9' }]);
    assert.deepStrictEqual(aids.map(a => [a.name, a.bonus, a.acc]), [['Targeting program', 2, false], ['HUD link', 1, true]]);
  });
  it('a HUD link in the standard form is an aiming bonus without the word Acc', () => {
    const [a] = chars([{ name: 'Suit', notes: 'HUD link +1' }]);
    assert.strictEqual(a.acc, true);
    const w = one({ notes: 'HUD link +1' }).aids[0];
    assert.strictEqual(w.acc, true);
    assert.strictEqual(one({ notes: 'Laser sight +1' }).aids[0].acc, false);
  });
  it('a gear row named like a weapon (ignoring case, bracket, marker) feeds that weapon with from "row"', () => {
    const d = buildTohitData(model({
      ranged: [rangedRow({ weapon: 'Blaster Pistol \u25c7' }), rangedRow({ weapon: 'Other gun' })],
      items: [{ name: 'blaster pistol (Fine)', notes: 'Scope +2 Acc' }],
    }), META);
    assert.deepStrictEqual(d.aids, []);
    assert.deepStrictEqual(d.weapons[0].aids.map(a => [a.name, a.bonus, a.from, a.on]), [['Scope', 2, 'row', true]]);
    assert.deepStrictEqual(d.weapons[1].aids, []);
  });
  it('the number nearest after the aid name wins: "Bulk -4 (laser sight +1 at 2 yd)" is laser sight +1', () => {
    const [a] = one({ notes: 'Bulk -4 (laser sight +1 at 2 yd)' }).aids;
    assert.strictEqual(a.name, 'Laser sight'); assert.strictEqual(a.bonus, 1);
  });
  it('a prose "scope" in an advantage name makes no aid, but the level is read', () => {
    const d = buildTohitData(model({ ranged: [rangedRow()], advantages: ['Telescopic Vision 2 (Accessibility, only with a scope)'] }), META);
    assert.deepStrictEqual(d.aids, []);
    assert.strictEqual(d.traits.telescopic, 2);
  });
});

describe('round two: which character-wide aids start ticked', () => {
  const on = (items) => buildTohitData(model({ ranged: [rangedRow()], items }), META).aids.map(a => [a.name, a.on]);
  it('of several flat aids only the best starts on', () => {
    assert.deepStrictEqual(on([
      { name: 'Silhouette program', notes: '+1 Guns skill' },
      { name: 'Targeting Program', notes: '+2 Guns skill' },
    ]), [['Silhouette program', false], ['Targeting program', true]]);
  });
  it('ties keep the first on', () => {
    assert.deepStrictEqual(on([
      { name: 'Targeting Program', notes: '+2 Guns skill' }, { name: 'Silhouette program', notes: '+2 Guns skill' },
    ]), [['Targeting program', true], ['Silhouette program', false]]);
  });
  it('backup, superseded and spare start off, and do not compete', () => {
    assert.deepStrictEqual(on([
      { name: 'Targeting Program', notes: '+2 Guns skill' },
      { name: 'Silhouette program', notes: 'Backup targeting (+3 Guns if Targeting offline)' },
    ]), [['Targeting program', true], ['Silhouette program', false]]);
    assert.strictEqual(on([{ name: 'Targeting Program', notes: '+2 Guns skill, superseded' }])[0][1], false);
    assert.strictEqual(on([{ name: 'Targeting Program', notes: '+2 Guns skill, spare unit' }])[0][1], false);
  });
  it('Acc aids and aids with no bonus start on', () => {
    assert.deepStrictEqual(on([{ name: 'Suit', notes: 'HUD link +1 Acc; Laser sight' }, { name: 'Targeting Program', notes: '+2 Guns skill' }]),
      [['HUD link', true], ['Targeting program', true]]);
    assert.strictEqual(on([{ name: 'Laser sight' }])[0][1], true);
  });
  it('everything in a weapon\'s own row starts on', () => {
    assert.ok(one({ acc: '6+3', notes: 'Scope +2 Acc; Laser sight +1' }).aids.every(a => a.on === true));
  });
});

describe('round two: skill names are matched to the Skills table', () => {
  const sk = [['Beam Weapons/TL11 (Pistol)', '16'], ['Guns (Light Machine Gun)', '17'], ['Guns (Grenade Launcher)', '12'],
    ['Guns (Submachine Gun)', '13'], ['Guns (Rifle)', '15'], ['Knife', '12'], ['Axe/Mace', '18'], ['Karate', '17']];
  const w1 = (skill) => buildTohitData(model({ ranged: [rangedRow({ skill })], skills: sk }), META).weapons[0];
  it('ignores /TL in either name and uses the table\'s name', () => {
    const w = w1('Beam Weapons (Pistol)-18');
    assert.strictEqual(w.skill, 'Beam Weapons/TL11 (Pistol)'); assert.strictEqual(w.base, 16);
    assert.strictEqual(w.skillAs, 'Beam Weapons (Pistol)'); assert.strictEqual(w.beam, true);
  });
  it('reads initials in the bracket: LMG, GL, SMG', () => {
    assert.deepStrictEqual(['Guns (LMG) 19', 'Guns (GL) 12', 'Guns (SMG) 13'].map(c => w1(c).skill),
      ['Guns (Light Machine Gun)', 'Guns (Grenade Launcher)', 'Guns (Submachine Gun)']);
    assert.strictEqual(w1('Guns (LMG) 19').base, 17);
    assert.strictEqual(w1('Guns (LMG) 19').skillAs, 'Guns (LMG)');
  });
  it('does not match a different bracket', () => {
    const w = w1('Guns (Pistol) 12');
    assert.strictEqual(w.skill, 'Guns (Pistol)'); assert.strictEqual(w.base, null);
  });
  it('the same matcher serves Targeted Attack, Dual-Weapon Attack, other techniques and Off-Hand Training', () => {
    const d = buildTohitData(model({
      ranged: [rangedRow()], skills: sk,
      techniques: [
        { name: 'Targeted Attack (Guns (LMG)/Skull)', def: '', level: '12' },
        { name: 'Dual-Weapon Attack (Guns (SMG))', def: '', level: '13' },
        { name: 'Burst', def: 'Guns (GL)-2', level: '10' },
      ],
      advantages: ['Off-Hand Weapon Training (Guns (SMG))'],
    }), META);
    assert.strictEqual(d.techniques.targeted[0].skill, 'Guns (Light Machine Gun)');
    assert.strictEqual(d.techniques.targeted[0].net, -5);
    assert.deepStrictEqual(d.techniques.dual, { 'Guns (Submachine Gun)': 4 });
    assert.strictEqual(d.techniques.other[0].skill, 'Guns (Grenade Launcher)');
    assert.deepStrictEqual(d.traits.offHand, ['Guns (Submachine Gun)']);
  });
  it('Targeted Attack takes the last WORD after the last slash: Right Arm, Left Leg, Right Hand', () => {
    const t = (l) => buildTohitData(model({ ranged: [rangedRow()], skills: sk,
      techniques: [{ name: `Targeted Attack (Guns (Rifle)/${l})`, def: '', level: '12' }] }), META).techniques.targeted;
    assert.strictEqual(t('Right Arm')[0].loc, 'limb');
    assert.strictEqual(t('Left Leg')[0].loc, 'limb');
    assert.strictEqual(t('Right Hand')[0].loc, 'extremity');
    assert.strictEqual(t('Right Arm')[0].skill, 'Guns (Rifle)');
  });
  it('a Default with a plus ("Judo+0 (16)") names its skill', () => {
    const d = buildTohitData(model({ ranged: [rangedRow()], skills: [['Judo', '16']],
      techniques: [{ name: 'Arm Lock (Judo)', def: 'Judo+0 (16)', level: '18' }] }), META);
    assert.deepStrictEqual(d.techniques.other, [{ skill: 'Judo', name: 'Arm Lock (Judo)', level: 18 }]);
  });
});

describe('round two: trait levels and the script', () => {
  const tr = (n) => buildTohitData(model({ ranged: [rangedRow()], advantages: [n] }), META).traits;
  it('Telescopic Vision with no number is level 1; "(Level 2)" and "2 [10]" are 2; same for Night Vision', () => {
    assert.strictEqual(tr('Telescopic Vision').telescopic, 1);
    assert.strictEqual(tr('Telescopic Vision (Level 2)').telescopic, 2);
    assert.strictEqual(tr('Telescopic Vision 2 [10]').telescopic, 2);
    assert.strictEqual(tr('Telescopic Vision [10]').telescopic, 1);
    assert.strictEqual(tr('Night Vision').nightVision, 1);
    assert.strictEqual(tr('Night Vision (Level 5)').nightVision, 5);
  });
  it('U+2028 and U+2029 are written escaped', () => {
    const d = buildTohitData(model({ ranged: [rangedRow({ weapon: 'A\u2028B\u2029C' })] }), META);
    const html = tohitDataScript(d);
    assert.ok(!html.includes('\u2028') && !html.includes('\u2029'));
    assert.ok(html.includes('\\u2028') && html.includes('\\u2029'));
    assert.strictEqual(JSON.parse(html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).weapons[0].key, 'A\u2028B\u2029C');
  });
});
