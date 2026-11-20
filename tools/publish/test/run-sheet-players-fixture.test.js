'use strict';
// The players' fixture (5b): run-sheet-app plus a fight session whose every number is a sentinel, so the leak
// test can search for it. This test pins where each sentinel is; the leak test (Task 8) depends on it.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const { buildIndex, stemOf } = require('../lib/run-sheet/notes');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const read = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function model() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-players-'));
  made.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return readRunSheet(dir, PLAN, { party: [ADA, BEN] });
}
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('run-sheet-players fixture', () => {
  it('reads with no unexpected warnings', () => {
    const m = model();
    assert.deepStrictEqual(m.warnings.map((w) => w.kind).sort(), ['ambiguous-name', 'dead-in-scene']);
  });

  it('every number is a sentinel, and none is near an ordinary figure', () => {
    const m = model();
    const fight = m.beats.find((b) => b.title === 'Ashfall Reckoning');
    const got = Object.fromEntries(fight.foes.map((f) => [f.name, [f.ac, f.hp, f.init]]));
    assert.deepStrictEqual(got, {
      'Glacier Wyrm': [6174, 7342, 92],
      'Rime Imp': [6175, 21, 93],
      'Ice Mephit 1': [6173, 7341, 97],
      'Ice Mephit 2': [6173, 7341, 97],
      'Brother Venn': [6179, 7343, 91],
      'Masked Gilt': [6176, 7345, 90],
      'Hidden Abbot': [6178, 7344, 94],
      'Frost Wolf': [6177, 7346, 95],
    });
    // +97 is inside /api/roll's -99..99 and is not +1; every modifier is two digits
    assert.ok(fight.foes.every((f) => Math.abs(f.init) >= 90 && Math.abs(f.init) <= 99));
    const wyrm = fight.foes.find((f) => f.name === 'Glacier Wyrm');
    assert.deepStrictEqual(wyrm.rechargeAt, { 'Cold Breath': 5 });
    assert.ok(wyrm.lairActions.includes('The ice shifts.') && wyrm.lairActions.includes('Fog rises.'));
    const mephit = fight.foes.find((f) => f.name === 'Ice Mephit 1');
    assert.deepStrictEqual([mephit.recharge, mephit.rechargeAt], [['Frost Breath'], { 'Frost Breath': 6 }]);
    assert.strictEqual(m.notes['Creatures/Ice Mephit.md'].unseenAs, 'a mephit');
  });

  it('the fight beat holds the cast the leak test expects', () => {
    const m = model();
    const fight = m.beats.find((b) => b.title === 'Ashfall Reckoning');
    assert.strictEqual(fight.place, 'Locations/The Gate.md');
    assert.deepStrictEqual(fight.who.map((w) => w.name), ['Glacier Wyrm', 'Rime Imp', 'Ice Mephit', 'Brother Venn', 'Masked Gilt', 'Hidden Abbot', 'Quiet Dead', 'Frost Wolf']);
    assert.strictEqual(fight.who.find((w) => w.name === 'Quiet Dead').dead, true);
    assert.ok(fight.points.some((p) => /Bloodied \(3671 HP or less\): it bargains/.test(p.text)));
    assert.ok(fight.ifs.some((x) => /\bBloodied\b/.test(x.do)));
    const ally = fight.foes.find((f) => f.name === 'Brother Venn');
    assert.strictEqual(ally.ally, true);
    assert.ok(!fight.foes.some((f) => f.name === 'Quiet Dead'), 'a note with no Stats is no foe');
    const hub = m.beats.find((b) => /hub/.test(b.title));
    assert.deepStrictEqual(hub.spots.map((s) => s.note || s.name), ['Locations/The Gate House.md', 'The orchard']);
    assert.strictEqual(m.beats.filter((b) => b.contingency).length, 1);
  });

  it('a masked NPC, a withheld one, and a dead one are in the cast', () => {
    const { cast } = model();
    const gilt = cast.find((c) => c.name === 'Masked Gilt');
    assert.deepStrictEqual(gilt.gmAliases, ['The Pale Courier Two']);
    assert.strictEqual(gilt.portrait, '_attachments/gilt-face.png');
    assert.strictEqual(cast.find((c) => c.name === 'Hidden Abbot').withheld, true);
    const dead = cast.find((c) => c.name === 'Quiet Dead');
    assert.deepStrictEqual([dead.dead, dead.status], [true, 'alive']);
  });

  it('maps: a GM map is never showable, its player twin is, and a withheld place has a picture', () => {
    const m = model();
    assert.deepStrictEqual(m.showableMaps, ['Documents/Map of the Gate.md']);
    assert.ok(read('Documents/Map of the Gate (GM).md').includes('gate-gm-secret.png'));
    const ix = buildIndex(FIXTURE);
    assert.strictEqual(ix.portrait('Locations/The Gate House.md'), '_attachments/gatehouse-room.png');
    assert.match(read('Locations/The Gate House.md'), /withheld: true/);
    assert.strictEqual(ix.portrait('Documents/Map of the Gate.md'), '_attachments/gate-map.png');
  });

  it('every picture differs in its bytes', () => {
    const pics = walk(path.join(FIXTURE, '_attachments')).filter((f) => f.endsWith('.png'));
    assert.ok(pics.length >= 9);
    const hashes = pics.map((f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
    assert.strictEqual(new Set(hashes).size, pics.length);
  });

  it('every GM Notes section and Plan section holds its own GMNOTE line', () => {
    const notes = walk(FIXTURE).filter((f) => f.endsWith('.md'));
    let n = 0;
    for (const f of notes) {
      const text = fs.readFileSync(f, 'utf8');
      const stem = path.basename(f, '.md');
      const isPlan = / - Plan$/.test(stem);
      if (!isPlan && !/^## GM Notes\s*$/m.test(text)) continue;
      n += 1;
      assert.ok(text.includes(`GMNOTE-${stem}`), stem);
      if (isPlan) assert.strictEqual(text.split('\n').filter((l) => /^## /.test(l)).length, text.split(`GMNOTE-${stem}`).length - 1, `${stem}: one per section`);
    }
    assert.ok(n >= 15, `${n} notes carry the sentinel`);
  });

  it('no title shares a word with a place, a person or a creature (Review M5)', () => {
    const ix = buildIndex(FIXTURE);
    const STOP = new Set(['the', 'of', 'a', 'an', 'scene', 'hub', 'routing', 'and', 'on']);
    const words = (s) => String(s).toLowerCase().match(/[a-z]+/g) || [];
    const forbidden = new Set();
    for (const p of ix.notes()) {
      const fm = ix.read(p).fm || {};
      if (['npc', 'creature', 'pc', 'location'].includes(String(fm.type).toLowerCase())) {
        for (const w of words(`${fm.name || stemOf(p)} ${[fm.unmasked_name, fm.gm_aliases].flat().filter(Boolean).join(' ')}`)) forbidden.add(w);
      }
    }
    for (const w of ['wolf', 'wolves', 'gate']) forbidden.add(w);
    const bad = [];
    for (const rel of ['Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md', PLAN]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-players-'));
      made.push(dir);
      fs.cpSync(FIXTURE, dir, { recursive: true });
      const m = readRunSheet(dir, rel, { party: [ADA, BEN] });
      for (const b of m.beats) for (const w of words(b.title)) if (!STOP.has(w) && forbidden.has(w)) bad.push(`${b.title}: ${w}`);
    }
    assert.deepStrictEqual(bad, []);
  });
});
