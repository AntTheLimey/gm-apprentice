'use strict';
// The to-hit calculator's whole output, pinned: every pure function over a wide grid of states, and
// the drawn page after each of a run of control changes, each as a short hash. The fixture was
// written from the calculator as it stood before its rules numbers moved into the data block (#420),
// so a refactor that changes nothing leaves every hash the same.
//
// After a deliberate change to what the calculator says, rewrite the fixture and read the diff:
//   GOLDEN_WRITE=1 node --test test/gurps-tohit-golden.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { extractSections } = require('../lib/processor');
const { parseGurps } = require('../lib/templates/gurps/parse');
const { buildTohitData } = require('../lib/templates/gurps/tohit-data');
const { TOHIT_RULES } = require('../lib/templates/gurps/blocks/tohit-rules');
const { dataBlock, load, snapshot } = require('./helpers/tohit-dom');

const mod = require('../js/gurps-tohit');
const T = typeof mod.make === 'function' ? mod.make(TOHIT_RULES) : mod;

const FIXTURE = path.join(__dirname, 'fixtures', 'tohit-golden.json');
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v === undefined ? null : v)).digest('hex').slice(0, 16);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- the data blocks ----
function blocks() {
  const base = dataBlock();
  const out = { base };
  const scope = { id: 'row-scope', name: 'Scope', bonus: 3, acc: true, fixed: false, from: 'row', on: true };
  out.kitted = dataBlock({
    weapons: base.weapons.map((w) => (w.type === 'ranged' ? Object.assign({}, w, { rcl: 2, bulk: 4, acc: 4, aids: w.aids.concat([scope]) }) : w))
      .concat([
        { key: 'Rifle', type: 'ranged', name: 'Rifle', skill: 'Guns (Rifle)', level: 15, base: 13, acc: 5, rof: 3, rcl: 2, bulk: 5, range: '700/3000', damage: '7d pi', beam: false,
          aids: [Object.assign({}, scope, { id: 'rifle-scope', fixed: true, bonus: 2 })], bonuses: [{ name: 'Weapon Bond', bonus: 1 }] },
        { key: 'Sword', type: 'melee', name: 'Sword', skill: 'Broadsword', level: 16, base: 15, range: '', damage: 'sw+2 cut', beam: false, aids: [], bonuses: [{ name: 'Fine', bonus: 1 }] },
      ]),
    aids: [
      { id: 'gear-prog', name: 'Targeting program', bonus: 2, acc: false, fixed: false, from: 'gear', on: true },
      { id: 'trait-tv', name: 'HUD link', bonus: 1, acc: true, fixed: false, from: 'trait', on: true },
    ],
    techniques: {
      targeted: [{ skill: 'Broadsword', loc: 'neck', net: -2, name: 'Targeted Attack (Broadsword Swing/Neck)' }],
      dual: { Broadsword: 2 }, offHand: { 'Axe/Mace': 4, Broadsword: 1 },
      other: [{ skill: 'Broadsword', name: 'Feint (Broadsword)', level: 17 }, { skill: 'Axe/Mace', name: 'Hook', level: 15 }],
    },
    traits: { ambidextrous: false, offHand: ['Guns (Rifle)'], halfRapid: true, telescopic: 2, nightVision: 3 },
    freeFall: 10,
  });
  out.ambi = dataBlock({ traits: { ambidextrous: true, offHand: [], halfRapid: false, telescopic: 0, nightVision: 0 }, freeFall: null });
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'gurps', 'gurps-ronnie.md'), 'utf8');
  const { data: fm, content } = matter(raw);
  out.ronnie = buildTohitData(parseGurps(fm, extractSections(content)), { pcSlug: 'ronnie-vint', campaignId: 'golden' });
  out.ronnie.rules = TOHIT_RULES;
  return out;
}

// ---- the states ----
function states(data, w) {
  const id = T.weaponId(w);
  const s = (o) => Object.assign({ weapon: id }, o);
  const list = [['plain', s({})]];
  const add = (k, vals) => vals.forEach((v) => list.push([`${k}=${JSON.stringify(v)}`, s({ [k]: v })]));
  add('aim', [0, 1, 2, 3, 4, 6]);
  add('scope', [1, 3, 6]);
  add('sr', [1, 4, 20]);
  add('man', ['attack', 'aod', 'move', 'popup', 'aodbl', 'aos', 'committed', 'bogus']);
  add('yards', [0, 2, 3, 4, 10, 16, 100, 101, 2000, 20000, '15', -5]);
  add('speed', [5, 60]);
  add('shots', [1, 2, 3, 5, 9, 10, 12, 17, 25, 50, 99, 100, 200, 800, 999, 0, 'x']);
  add('cover', ['partial', 'light', 'nope']);
  add('behind', [1, 3, 25]);
  add('targetLow', [true]);
  add('loc', ['torso', 'vitals', 'arm', 'leg', 'extremity', 'groin', 'face', 'neck', 'skull', 'eye', 'nowhere']);
  add('sm', [-6, -1, 2, 10]);
  add('vis', [-1, -5, -9, -10]);
  add('shock', [-1, -4, 3]);
  add('other', [-5, 7]);
  add('foe', [6, 10, 14, 20]);
  add('evaluate', [1, 3, 5]);
  add('feint', [2, 6]);
  add('deceptive', [-2, -4, -6, -8, -3]);
  add('posture', [-2, -4]);
  add('braced', [true]);
  add('dual', [true]);
  add('offhand', [true]);
  add('footing', [true]);
  add('zerog', [true]);
  add('rapid', [true]);
  add('telegraphic', [true]);
  for (const t of T.techniquesFor(data, w).other) list.push([`technique=${t.name}`, s({ technique: t.name })]);
  const ticks = {};
  for (const a of T.aidsFor(data, w)) ticks[a.tick] = true;
  list.push(['every aid', s({ aids: ticks, aidBonus: { 'row-prog': 2 } })]);
  for (const aim of [1, 2, 3, 5]) list.push([`every aid aim ${aim}`, s({ aids: ticks, aim, aidBonus: { 'row-prog': 3 } })]);
  // Combinations that make the caps and the rules interact.
  list.push(['issue', s({ aim: 3, braced: true, aids: ticks, man: 'aod', yards: 100, shots: 10, sm: 3, vis: -2 })]);
  list.push(['issue sr', s({ aim: 3, braced: true, aids: ticks, man: 'aod', yards: 100, shots: 10, sm: 3, vis: -2, sr: 4 })]);
  list.push(['move aim', s({ man: 'move', aim: 3, rapid: true })]);
  list.push(['popup aim', s({ man: 'popup', aim: 2 })]);
  list.push(['tele deceptive', s({ telegraphic: true, deceptive: -4, evaluate: 2 })]);
  list.push(['tele crit', s({ telegraphic: true, other: 5, foe: 12 })]);
  list.push(['deceptive floor', s({ deceptive: -8, vis: -3, posture: -4 })]);
  list.push(['deceptive move', s({ deceptive: -6, man: 'move' })]);
  list.push(['dark nv', s({ vis: -6, footing: true, shock: -2 })]);
  list.push(['blind move', s({ vis: -10, man: 'move', other: 9 })]);
  list.push(['low skull', s({ targetLow: true, loc: 'skull' })]);
  list.push(['low leg', s({ targetLow: true, loc: 'leg', cover: 'light', behind: 2 })]);
  list.push(['dual aodbl', s({ dual: true, man: 'aodbl', offhand: true })]);
  list.push(['zerog tech', s({ zerog: true, technique: (T.techniquesFor(data, w).other[0] || {}).name })]);
  list.push(['all', s({ aim: 3, braced: true, aids: ticks, man: 'aod', yards: 50, shots: 5, sm: 1, vis: -3, loc: 'skull', cover: 'partial', behind: 1,
    targetLow: true, shock: -2, other: 1, foe: 11, footing: true, zerog: true, dual: true, offhand: true, evaluate: 2, feint: 3, deceptive: -2, posture: -2, rapid: true })]);
  return list;
}

function pureCases(name, data) {
  const out = {};
  out[`${name} defaultState`] = hash(T.defaultState(data));
  for (const w of data.weapons) {
    const id = T.weaponId(w);
    out[`${name} ${id} aidsFor`] = hash(T.aidsFor(data, w));
    out[`${name} ${id} techniquesFor`] = hash(T.techniquesFor(data, w));
    for (const [label, st] of states(data, w)) {
      const r = T.effective(data, st);
      const r2 = T.effective(data, st, { delta: -2 });
      // The to-hit sum and the damage rolls are pinned apart, so a change to one never hides in the other.
      const toHit = (x) => { const c = Object.assign({}, x); delete c.damage; return c; };
      out[`${name} ${id} ${label}`] = hash([toHit(r), toHit(r2), T.odds(r.roll, r.critSkill), T.conflicts(st), T.cleanState(data, st)]);
      out[`${name} ${id} ${label} damage`] = hash([r.damage, r2.damage]);
    }
  }
  return out;
}

function globalCases() {
  const out = {};
  for (let skill = -2; skill <= 30; skill++) {
    const row = [];
    for (let roll = 3; roll <= 18; roll++) row.push(T.outcome(roll, skill), T.outcome(roll, skill, skill - 4));
    out[`outcome skill ${skill}`] = hash(row);
    out[`odds skill ${skill}`] = hash([T.odds(skill), T.odds(skill, skill - 4), T.odds(String(skill))]);
  }
  const yards = [];
  for (let y = 0; y <= 1200; y++) yards.push(T.rangePenalty(y));
  out['rangePenalty 0-1200'] = hash(yards);
  out['rangePenalty far'] = hash([1500, 2000, 7000, 20000, 1e6, 1e9, 2e9, -1, 'x', null, '50'].map((y) => T.rangePenalty(y)));
  out['groups'] = hash(T.GROUPS);
  return out;
}

// ---- the drawn page: a run of control changes, the page after each ----
function pageCases(name, data) {
  const out = {};
  const p = load(clone(data));
  p.flushTimers();
  out[`${name} page start`] = hash(snapshot(p.box));
  const steps = [];
  for (const w of data.weapons) {
    const id = T.weaponId(w);
    steps.push(['#th-weapon', id]);
    if (w.type === 'ranged') {
      steps.push(['#th-aim', 3], ['#th-braced', true], ['#th-scope', 2], ['#th-shots', 10], ['#th-yards', 100], ['#th-band', '50'], ['#th-speed', 5],
        ['#th-man', 'move'], ['#th-man', 'popup'], ['#th-man', 'aod'], ['#th-cover', 'partial'], ['#th-behind', 2], ['#th-targetLow', true],
        ['#th-loc', 'skull'], ['#th-sm', 2], ['#th-vis', -10], ['#th-vis', -4], ['#th-sr', 4], ['#th-dual', true], ['#th-offhand', true],
        ['#th-zerog', true], ['#th-shock', -2], ['#th-other', -3], ['#th-foe', 12], ['#th-aid-0', true], ['#th-aid-1', 2]);
    } else {
      steps.push(['#th-evaluate', 2], ['#th-feint', 3], ['#th-man', 'aod'], ['#th-man', 'committed'], ['#th-man', 'aodbl'], ['#th-man', 'aos'],
        ['#th-man', 'move'], ['#th-rapid', true], ['#th-man', 'attack'], ['#th-deceptive', -4], ['#th-telegraphic', true], ['#th-deceptive', 0],
        ['#th-telegraphic', true], ['#th-posture', -4], ['#th-loc', 'neck'], ['#th-vis', -10], ['#th-footing', true], ['#th-zerog', true],
        ['#th-dual', true], ['#th-offhand', true], ['#th-foe', 10], ['#th-tech', (T.techniquesFor(data, w).other[0] || {}).name || '']);
    }
    steps.push(['#th-reset', 'click']);
  }
  steps.forEach(([sel, v], i) => {
    const el = p.$(sel);
    if (!el) { out[`${name} page ${i} ${sel} absent`] = 'absent'; return; }
    if (v === 'click') p.fire(el, 'click');
    else p.set(sel, v);
    p.flushTimers();
    out[`${name} page ${i} ${sel}=${v}`] = hash(snapshot(p.box));
  });
  out[`${name} page stored`] = hash([...p.store.entries()]);
  // The chips: a targeted attack's button.
  const chip = p.$('.th-chip');
  if (chip) { p.fire(chip, 'click'); p.flushTimers(); out[`${name} page chip`] = hash(snapshot(p.box)); }
  return out;
}

function everything() {
  const all = globalCases();
  for (const [name, data] of Object.entries(blocks())) {
    Object.assign(all, pureCases(name, data));
    Object.assign(all, pageCases(name, data));
  }
  return all;
}

test('the calculator says exactly what the golden fixture says', () => {
  const got = everything();
  if (process.env.GOLDEN_WRITE === '1') {
    fs.writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const changed = Object.keys(want).filter((k) => got[k] !== want[k]);
  const added = Object.keys(got).filter((k) => !(k in want));
  assert.deepStrictEqual({ changed: changed.slice(0, 40), added: added.slice(0, 40) }, { changed: [], added: [] });
  assert.ok(Object.keys(want).length > 1000, `the fixture holds ${Object.keys(want).length} cases`);
});
