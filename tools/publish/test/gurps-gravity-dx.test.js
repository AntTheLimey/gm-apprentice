// #629: the DX penalty for gravity (B350, B57, B60), its to-hit modifier, the sheet notice and the board chip.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const { extractSections } = require('../lib/processor');
const { renderGURPSSheet } = require('../lib/templates/gurps/index');
const { buildPartyManifest } = require('../lib/party-manifest');
const { rowCells } = require('../js/gurps-party');
const { TOHIT_RULES } = require('../lib/templates/gurps/blocks/tohit-rules');
const gl = require('../js/gurps-live');
const T = require('../js/gurps-tohit').make(TOHIT_RULES);

const dx = (local, home, traits) => gl.gravityDx(local, home, traits).dx;

test('gravityDx: whole 0.2G increments from 1G, 0.81-1.19G is none', () => {
  assert.equal(dx(1.2, 1), 1);
  assert.equal(dx(0.8, 1), 1);
  assert.equal(dx(1.19, 1), 0);
  assert.equal(dx(0.81, 1), 0);
  assert.equal(dx(1.6, 1), 3);
  assert.equal(dx(1, 1), 0);
});

test('gravityDx: G-Experience halves it when All, naming the gravity, or unqualified (assumed)', () => {
  assert.equal(dx(1.6, 1, [{ name: 'G-Experience (All)', cost: '10' }]), 1);
  assert.equal(dx(1.6, 1, [{ name: 'g-experience (1.6G)', cost: '5' }]), 1);
  assert.equal(dx(1.2, 1, [{ name: 'G-Experience (1.6G)', cost: '5' }]), 1);   // names another gravity: no effect
  assert.equal(dx(1.6, 1, [{ name: 'G-Experience (1.2G)', cost: '5' }]), 3);
  const plain = gl.gravityDx(1.6, 1, [{ name: 'G-Experience', cost: '5' }]);
  assert.equal(plain.dx, 1);
  assert.equal(plain.assumed, true);
  assert.equal(dx(1.4, 1, [{ name: 'G-Experience (All)', cost: '10' }]), 1);   // 2 increments, halved
  assert.equal(dx(1.2, 1, [{ name: 'G-Experience (All)', cost: '10' }]), 0);   // 1 increment, halved, rounds down
  assert.equal(dx(0.5, 1, [{ name: 'G-Experience (.5G)', cost: '1' }]), 1);    // a leading-dot gravity is 0.5G
  assert.equal(dx(5, 1, [{ name: 'G-Experience (.5G)', cost: '1' }]), 20);     // and not 5G
});

test('gravityDx: Improved G-Tolerance widens the increment, any case', () => {
  assert.equal(dx(1.5, 1, [{ name: 'Improved G-tolerance', cost: '10' }]), 1);
  assert.equal(dx(1.4, 1, [{ name: 'Improved G-tolerance', cost: '10' }]), 0);
  assert.equal(dx(1.3, 1, [{ name: 'Improved G-Tolerance', cost: '5' }]), 1);
  assert.equal(dx(2, 1, [{ name: 'Improved G-Tolerance', cost: '15' }]), 1);
  assert.equal(gl.gravityDx(1.5, 1, [{ name: 'Improved G-Tolerance', cost: '10 pts' }]).incrementG, 0.5);
});

test('gravityDx: home_gravity, and zero gravity is the Free Fall rule\'s', () => {
  assert.equal(dx(1, 0.5), 2);
  assert.equal(dx(1.2, 1.2), 0);
  assert.equal(dx(0, 1), 0);
  assert.equal(dx(null, 1), 0);
});

const META = { campaignId: 'c', pcSlug: 'gravity-test', buildVersion: 'v1', tohit: true };
function sheet(edit) {
  const file = fs.readFileSync(path.join(__dirname, 'fixtures/gurps/gurps-gravity.md'), 'utf8').replace(/\r\n/g, '\n');
  const { data, content } = matter(edit ? edit(file) : file);
  return renderGURPSSheet(data, extractSections(content), META);
}

test('the sheet opens with a gravity warning: DX, Beam Weapons, jump and throw multiplier', () => {
  const out = sheet();
  assert.match(out.sheetHtml, /<div class="gurps-sheet"><div class="gl-grav-alert"/);
  assert.match(out.sheetHtml, /1\.2G: DX \u22121 to agility and ballistic tasks, Beam Weapons exempt; jumps and throws \u00d70\.83 \(B350\)/);
});

test('G-Experience and a within-step gravity change the notice; no gravity has none', () => {
  const exp = sheet(raw => raw.replace('gravity: 1.2', 'gravity: 1.6').replace('| Combat Reflexes | 15 | +1 all defenses |', '| Combat Reflexes | 15 | +1 all defenses |\n| G-Experience | 5 | |'));
  assert.match(exp.sheetHtml, /1\.6G: DX \u22121 .*G-Experience halves it, taken to cover 1\.6G/);
  assert.match(sheet(raw => raw.replace('gravity: 1.2', 'gravity: 1.1')).sheetHtml, /1\.1G: no DX penalty/);
  const none = sheet(raw => raw.replace('gravity: 1.2\n', ''));
  assert.doesNotMatch(none.sheetHtml, /gl-grav-alert/);
  assert.equal(none.liveData.gravityFx, undefined);
  assert.equal(none.tohitData === null || none.tohitData.gravity === undefined, true);
});

test('home_gravity: set alone it still counts, a bad value is a warning', () => {
  const out = sheet(raw => raw.replace('gravity: 1.2', 'home_gravity: 0.5'));
  assert.match(out.sheetHtml, /1G \(raised at 0\.5G\): DX \u22122/);
  const bad = sheet(raw => raw.replace('gravity: 1.2', 'gravity: 1.2\nhome_gravity: far'));
  assert.ok(bad.warnings.some(w => /home_gravity/.test(w)));
  assert.match(sheet(raw => raw.replace('gravity: 1.2', 'gravity: 1.0\nhome_gravity: 0.5')).sheetHtml, /DX \u22122/);
});

test('zero gravity: no DX penalty, the Free Fall rule is named', () => {
  const out = sheet(raw => raw.replace('gravity: 1.2', 'gravity: 0'));
  assert.match(out.sheetHtml, /0G: no DX penalty from this rule/);
  assert.equal(out.tohitData, null);
});

test('the party board chip names the DX penalty', () => {
  const out = sheet();
  const m = buildPartyManifest('c', [{ name: 'G', outputPath: 'pcs/g.html', data: out.liveData }]);
  const v = gl.deriveLive(m.pcs[0], null);
  assert.equal(v.gravityDx, 1);
  assert.match(rowCells(v).enc, /1\.2G DX \u22121/);
  const home = sheet(raw => raw.replace('gravity: 1.2', 'home_gravity: 0.5'));
  const v2 = gl.deriveLive(buildPartyManifest('c', [{ name: 'G', outputPath: 'p.html', data: home.liveData }]).pcs[0], null);
  assert.match(rowCells(v2).enc, /1G DX \u22122/);
});

test('to-hit: the Gravity modifier is on by default, applies to all but Beam Weapons, and can be unticked', () => {
  const out = sheet(raw => raw.replace('| Combat Reflexes', '| Combat Reflexes'));
  const data = {
    weapons: [
      { key: 'Knife', type: 'melee', name: 'Knife', skill: 'Knife', level: 14, base: 14, range: '', damage: 'sw cut', beam: false, aids: [], bonuses: [] },
      { key: 'Blaster', type: 'ranged', name: 'Blaster', skill: 'Beam Weapons (Pistol)', level: 17, base: 17, acc: 6, rof: 1, rcl: 1, bulk: 2, range: '150/450', damage: '3d burn', beam: true, aids: [], bonuses: [] },
      { key: 'Pistol', type: 'ranged', name: 'Pistol', skill: 'Guns (Pistol)', level: 15, base: 15, acc: 2, rof: 3, rcl: 2, bulk: 2, range: '150/450', damage: '2d pi', beam: false, aids: [], bonuses: [] },
    ],
    aids: [], techniques: { targeted: [], dual: {}, other: [] },
    traits: { ambidextrous: false, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 },
    freeFall: null, locations: [['torso', 'Torso', 0]], bands: [2, 3, 5, 7, 10], rules: TOHIT_RULES,
  };
  const withG = Object.assign({}, data, { gravity: { dx: 1, label: 'Gravity 1.2G (DX \u22121)' } });
  const s = T.defaultState(withG);
  assert.equal(s.gravity, true);
  assert.equal(T.effective(withG, Object.assign({}, s, { weapon: 'Knife' })).roll, 13);
  assert.equal(T.effective(withG, Object.assign({}, s, { weapon: 'Pistol' })).roll, 14 + 0);
  const beam = T.effective(withG, Object.assign({}, s, { weapon: 'Blaster' }));
  assert.equal(beam.roll, T.effective(data, Object.assign({}, T.defaultState(data), { weapon: 'Blaster' })).roll);
  assert.ok(beam.notes.some(n => /Beam Weapons/.test(n)));
  assert.equal(T.effective(withG, Object.assign({}, s, { weapon: 'Knife', gravity: false })).roll, 14);
  // A PC with no penalty keeps the state it always had.
  assert.equal('gravity' in T.defaultState(data), false);
});

test('buildTohitData carries the modifier only when the penalty is not 0', () => {
  const { parseGurps } = require('../lib/templates/gurps/parse');
  const { buildTohitData } = require('../lib/templates/gurps/tohit-data');
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures/gurps/gurps-ronnie.md'), 'utf8');
  const build = (extra) => {
    const { data, content } = matter(raw);
    return buildTohitData(parseGurps(Object.assign({}, data, extra), extractSections(content)), { pcSlug: 'r' });
  };
  assert.equal(build({}).gravity, undefined);
  assert.equal(build({ gravity: 1.1 }).gravity, undefined);
  assert.deepEqual(build({ gravity: 1.2 }).gravity, { dx: 1, label: 'Gravity 1.2G (DX \u22121)' });
  assert.equal(build({ gravity: 1, home_gravity: 0.5 }).gravity.label, 'Gravity 1G, home 0.5G (DX \u22122)');
});

test('G-Experience naming several gravities applies if any is the local one', () => {
  assert.equal(dx(1.6, 1, [{ name: 'G-Experience (0.5G, 1.6G)', cost: '5' }]), 1);
  assert.equal(dx(1.6, 1, [{ name: 'G-Experience (0.5G, 1.2G)', cost: '5' }]), 3);
});

test('Improved G-Tolerance reads the first number of the cost cell', () => {
  assert.equal(gl.gravityDx(1.5, 1, [{ name: 'Improved G-Tolerance', cost: '5 pts, 1 lvl' }]).incrementG, 0.3);
});

test('G-Intolerance (B137): 0.1G or 0.05G increments, named or from the points', () => {
  assert.equal(dx(1.2, 1, [{ name: 'G-Intolerance (0.1 G increment)', cost: '-10' }]), 2);
  assert.equal(dx(1.2, 1, [{ name: 'G-Intolerance', cost: '-20' }]), 4);
  assert.equal(dx(1.2, 1, [{ name: 'G-Intolerance', cost: '-10' }]), 2);
  assert.equal(dx(1.2, 1, [{ name: 'Total G-Intolerance', cost: '-25' }]), 1);   // another book (S222): not read
  const dis = '## Disadvantages\n\n| Trait | Cost | Notes |\n|-------|------|-------|\n| G-Intolerance (0.1 G increment) | -10 | |\n\n## Equipment';
  assert.match(sheet(raw => raw.replace('## Equipment', dis)).sheetHtml, /DX \u22122 .*G-Intolerance \(B137\) makes the step 0\.1G/);
});

test('the notice does not say "within steps" when G-Experience halved a real increment away', () => {
  const out = sheet(raw => raw.replace('| Combat Reflexes | 15 | +1 all defenses |', '| Combat Reflexes | 15 | +1 all defenses |\n| G-Experience (All) | 10 | |'));
  assert.match(out.sheetHtml, /1\.2G: no DX penalty \(1 G-Increment, halved by G-Experience\)/);
  assert.doesNotMatch(out.sheetHtml, /within/);
});
