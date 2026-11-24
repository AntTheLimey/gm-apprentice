'use strict';
// The combat references and the code that uses the same figures, held together (step 6b Task 25): the generated tables
// are what the generator writes today (a code change without a regenerate fails here, and so does a hand edit inside
// the markers), every copy of the hit locations in code agrees with the one table, and the CoC sentences that state a
// figure the run sheet's code holds say what the code does.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { render, FILES } = require('../scripts/gen-combat-reference');
const { LOCATIONS, LOCATION_ORDER, LOCATION_WORDS } = require('../lib/templates/gurps/hit-locations');
const { WOUNDING, CONSEQUENCES } = require('../lib/run-sheet/systems/gurps');
const { HIT_LOCATION_ROWS } = require('../lib/templates/gurps/blocks/reference');
const { LOCATION_KEYS, buildTohitData } = require('../lib/templates/gurps/tohit-data');
const { TOHIT_RULES } = require('../lib/templates/gurps/blocks/tohit-rules');
const { woundingAt } = require('../lib/run-sheet/web/gurps-math');
const CM = require('../lib/run-sheet/web/coc-math');
const { systemFor } = require('../lib/run-sheet/systems');

const lf = (s) => String(s).replace(/\r\n?/g, '\n');
const penaltyOf = (key) => LOCATIONS.find((l) => l.key === key).penalty;

describe('the generated tables', () => {
  for (const { file, blocks } of FILES) {
    it(`${file.split('/systems/')[1]} is what the generator writes`, () => {
      const text = lf(fs.readFileSync(file, 'utf8'));
      assert.equal(render(text, blocks), text, 'out of date: run `node tools/publish/scripts/gen-combat-reference.js --write`');
    });
  }
  it('a hand edit inside the markers is put back', () => {
    const { file, blocks } = FILES[0];
    const text = lf(fs.readFileSync(file, 'utf8'));
    const edited = text.replace('| Face | -5 |', '| Face | -4 |');
    assert.notEqual(edited, text);
    assert.equal(render(edited, blocks), text);
  });
  it('a missing marker is an error, never a quiet skip', () => {
    assert.throws(() => render('# no markers\n', FILES[0].blocks), /no <!-- generated: hit-locations -->/);
  });
});

describe('the hit locations in code: one table', () => {
  it('the run sheet\'s WOUNDING is the table, in its order', () => {
    assert.deepEqual(Object.keys(WOUNDING.locations).sort(), LOCATIONS.map((l) => l.key).sort());
    assert.deepEqual(WOUNDING.locationOrder, LOCATION_ORDER);
    for (const l of LOCATIONS) assert.equal(WOUNDING.locations[l.key].penalty, l.penalty, l.key);
    // every word a GM types names a place in the table
    for (const [w, k] of Object.entries(LOCATION_WORDS)) assert.ok(WOUNDING.locations[k], `${w} -> ${k}`);
    // `as` and `drAs` name places in the table
    for (const l of LOCATIONS) for (const k of [l.as, l.drAs].filter(Boolean)) assert.ok(WOUNDING.locations[k], `${l.key}: ${k}`);
    // every type a place lists can be typed
    for (const l of LOCATIONS) for (const t of l.targets || []) assert.ok(t in WOUNDING.types, `${l.key}: ${t}`);
  });
  it('the knockdown places and modifiers are the table\'s', () => {
    const k = CONSEQUENCES.knockdown;
    assert.deepEqual(k.places.slice().sort(), LOCATIONS.filter((l) => l.knockdown && l.knockdown.shock).map((l) => l.key).sort());
    for (const l of LOCATIONS) assert.equal(k.major[l.key], l.knockdown && l.knockdown.major, l.key);
    assert.deepEqual(k.extra, { jaw: { cr: -1 } });
    // fix round 1: the skull's toxic keeps no -10; a crippled spine knocks down outright; the groin's male figures
    assert.deepEqual(k.except, { skull: ['tox'] });
    assert.deepEqual(k.auto, ['spine']);
    assert.deepEqual(Object.keys(k.male), ['groin']);
    assert.equal(k.major.groin, undefined, 'the groin\'s -5 is for a male target only: said, never applied');
  });
  it('the player site\'s reference block lists every place, row for row, with the table\'s penalty', () => {
    const named = new Map();
    for (const [roll, name, mod] of HIT_LOCATION_ROWS) {
      const base = name.replace(/^(?:Right|Left) /, '');
      const loc = LOCATIONS.find((l) => l.name === base);
      assert.ok(loc, `${name}: no place`);
      const n = mod === '—' ? 0 : -Number(mod.replace('–', ''));
      assert.equal(n, loc.penalty, name);
      // a roll the table gives, the side's for a limb
      const want = typeof loc.roll === 'string' ? loc.roll : loc.roll ? loc.roll[/^Left /.test(name) ? 'left' : 'right'] : '—';
      assert.equal(roll, want, name);
      named.set(loc.key, (named.get(loc.key) || 0) + 1);
    }
    for (const l of LOCATIONS) assert.equal(named.get(l.key), l.roll && typeof l.roll === 'object' ? 2 : 1, l.key);
  });
  it('the to-hit calculator stands for every place once, each key\'s places at one penalty', () => {
    const seen = LOCATION_KEYS.flatMap(([, , places]) => places);
    assert.deepEqual(seen.slice().sort(), LOCATIONS.map((l) => l.key).sort());
    assert.equal(new Set(seen).size, seen.length);
    for (const [key, , places] of LOCATION_KEYS) assert.equal(new Set(places.map(penaltyOf)).size, 1, key);
    // what the calculator is given carries the table's penalty
    const model = { attributes: {}, skills: [], techniques: [], traits: [], ranged: [{ weapon: 'Pistol', skill: 'Guns (Pistol)-12', acc: '2', range: '100', rof: '1', shots: '6', bulk: '-2', rcl: '2' }] };
    const d = buildTohitData(model, { pcSlug: 'x', campaignId: 'x' });
    for (const [key, , p] of d.locations) assert.equal(p, penaltyOf(LOCATION_KEYS.find(([k]) => k === key)[2][0]), key);
    // a low target's places are the calculator's
    for (const k of TOHIT_RULES.targetLowLocs) assert.ok(LOCATION_KEYS.some(([key]) => key === k), k);
  });
  it('the to-hit calculator lists its places in the run sheet\'s order (Task 34)', () => {
    const model = { attributes: {}, skills: [], techniques: [], traits: [], ranged: [{ weapon: 'Pistol', skill: 'Guns (Pistol)-12', acc: '2', range: '100', rof: '1', shots: '6', bulk: '-2', rcl: '2' }] };
    const d = buildTohitData(model, { pcSlug: 'x', campaignId: 'x' });
    const first = (key) => LOCATION_KEYS.find(([k]) => k === key)[2][0];
    assert.deepEqual(d.locations.map(([k]) => first(k)), LOCATION_ORDER.filter((k) => d.locations.some(([key]) => first(key) === k)));
  });
  it('a place\'s multiplier for each type is one figure, from one function', () => {
    // the generated table, the run sheet's labels and its working all ask woundingAt; spot-check the book's figures
    const m = (k, t) => woundingAt(WOUNDING, k, t);
    assert.equal(m('face', 'cr').mult, 1);
    assert.equal(m('face', 'cor').mult, 1.5);
    assert.equal(m('skull', 'cr').mult, 4);
    assert.equal(m('neck', 'cut').mult, 2);
    assert.equal(m('neck', 'cr').mult, 1.5);
    assert.equal(m('neck vein', 'cut').mult, 2.5);
    assert.equal(m('arm vein', 'cut').mult, 2);
    assert.equal(m('eye', 'cr').can, false);
    assert.equal(m('hand joint', 'imp').can, false);
    assert.equal(m('vitals', 'cr').mult, 1);
  });
});

describe('the CoC references say what the code does', () => {
  const rules = systemFor('coc-7e').describe().fight;
  const read = (name) => lf(fs.readFileSync(require.resolve(`../../../skills/ttrpg-expert/systems/coc-7e/${name}`), 'utf8')).replace(/\*\*/g, '').replace(/\s+/g, ' ');
  const files = ['combat-reference.md', 'mechanics.md', 'rules-reference.md'];
  it('a Major Wound is one hit of at least half max HP', () => {
    assert.equal(rules.prompts.majorWoundAt, 2);
    assert.equal(CM.cocCardForHit({ hp: 5, max: 10 }, { damage: 5, before: 10 }, rules).major, true);
    assert.equal(CM.cocCardForHit({ hp: 6, max: 10 }, { damage: 4, before: 10 }, rules).major, false);
    for (const f of files) assert.match(read(f), /Major Wound: (?:Damage in a single hit of |If damage taken in a single hit is |one hit of )at least half (?:the character's )?max HP/, f);
  });
  it('0 HP alone is Unconscious; Dying needs a Major Wound', () => {
    const kind = (row, hit) => CM.cocCardForHit(row, hit, rules).lines.map((l) => l.offers || l.kind);
    assert.deepEqual(kind({ hp: 0, max: 10 }, { damage: 3, before: 3 }), [['unconscious']]);
    assert.deepEqual(kind({ hp: 0, max: 10, majorWound: true }, { damage: 3, before: 3 }), [['dying']]);
    for (const f of files) assert.match(read(f), /0 HP alone (?:is|the \w+ is) Unconscious; Dying needs a Major Wound/, f);
  });
  it('a SAN loss of 5 or more from one roll calls for the INT roll', () => {
    assert.equal(rules.prompts.insanityAt, 5);
    assert.ok(CM.sanCard({}, 5, rules));
    assert.equal(CM.sanCard({}, 4, rules), null);
    for (const f of ['mechanics.md', 'rules-reference.md']) assert.match(read(f), /Losing 5 or more SAN from one roll calls for an INT roll/, f);
  });
  it('the damage bonus by attack is the code\'s', () => {
    assert.deepEqual(['melee', 'thrown', 'shot'].map(CM.dbModeOf), ['full', 'half', 'none']);
    assert.match(read('mechanics.md'), /\| Melee \| full DB \| \| Thrown weapon, or a bow drawn by the wielder \| half DB \| \| Firearm \| no DB \|/);
  });
});
