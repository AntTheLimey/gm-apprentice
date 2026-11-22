'use strict';
// The GURPS foe reader (step 6b Task 4): HP, FP and Basic Speed, worked out from ST, HT and DX when a block lacks them.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildIndex } = require('../lib/run-sheet/notes');
const { systemFor } = require('../lib/run-sheet/systems');
const { readNumbers, keyOf, lacks } = require('../lib/run-sheet/systems/gurps');
const { foesOf } = require('../lib/run-sheet/foes');
const { copyFixture, removeFixture } = require('./helpers/systems-fixture');

const NPCS = 'Characters/NPCs/';
function read(dir, note) {
  const index = buildIndex(dir);
  return systemFor('gurps-4e').readFoe({ notePath: `${NPCS}${note}.md`, index, text: undefined });
}

for (const crlf of [false, true]) {
  describe(`GURPS foe reader${crlf ? ' (CRLF checkout)' : ''}`, () => {
    const dir = copyFixture('run-sheet-gurps', { crlf });
    it('a block of four attributes gets HP, FP and Basic Speed, each marked', () => {
      const r = read(dir, 'Rafe Kell');
      assert.deepEqual(r.nums, { hp: 10, fp: 11, speed: 5.75, dx: 12, st: 10, ht: 11, dodge: null, dr: null,
        from: { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT' } });
      assert.deepEqual(r.lacks, []);
      assert.equal(r.hpStart, null);
      assert.equal(r.fpStart, null);
    });
    it('full figures win over worked-out ones, DR text kept', () => {
      const r = read(dir, 'Vex Harrow');
      assert.deepEqual(r.nums, { hp: 13, fp: 10, speed: 5.25, dx: 11, st: 13, ht: 10, dodge: 8, dr: '1', from: {} });
      assert.equal(read(dir, 'Mara Quint').nums.dr, '0');
      assert.equal(read(dir, 'Mara Quint').nums.speed, 5.25);
    });
    it('HP 6/9 starts at 6 with 9 as the maximum', () => {
      const r = read(dir, 'Tam Osier');
      assert.equal(r.nums.hp, 9);
      assert.equal(r.hpStart, 6);
      assert.equal(r.nums.speed, 5.5);
      assert.equal('hpStart' in r.nums, false);
    });
    it('FP keeps its figure and leaves the reserve text alone', () => {
      const r = read(dir, 'Bram Holt');
      assert.deepEqual([r.nums.hp, r.nums.fp, r.nums.speed], [12, 11, 5.25]);
      assert.equal('reserve' in r.nums, false);
    });
    it('a magery line adds nothing', () => {
      for (const n of ['Ilse Verrin', 'Dova Lang']) assert.deepEqual(Object.keys(read(dir, n).nums).sort(), ['dodge', 'dr', 'dx', 'fp', 'from', 'hp', 'ht', 'speed', 'st']);
    });
    it('a note with no stat block reads as none', () => {
      assert.deepEqual(read(dir, 'Ned Pike'), { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null, fpStart: null });
    });
    it('the foe row carries Basic Speed as its initiative, and the marks', () => {
      const index = buildIndex(dir);
      const row = foesOf(`${NPCS}Rafe Kell.md`, index, 1, 'k', new Set(), null, null, systemFor('gurps-4e')).foes[0];
      assert.deepEqual([row.hp, row.init, row.speed, row.fp, row.fpMax, row.dx, row.st, row.ht, row.dodge, row.dr], [10, 5.75, 5.75, 11, 11, 12, 10, 11, null, null]);
      assert.deepEqual(row.from, { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT' });
      const tam = foesOf(`${NPCS}Tam Osier.md`, index, 1, 'k', new Set(), null, null, systemFor('gurps-4e')).foes[0];
      assert.deepEqual([tam.hp, tam.hpStart], [9, 6]);
    });
    it('fights stay off, and the description has GURPS\'s known values', () => {
      const d = systemFor('gurps-4e').describe();
      assert.equal(d.fights, false);
      assert.equal(d.family, 'gurps');
      assert.equal(d.label, 'GURPS 4e');
      for (const o of [d, d.fight]) assert.deepEqual([o.initiative, o.initDecimals, o.orderFixed, o.hpFloor, o.autoOut], ['speed', 2, true, null, false]);
      assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
      assert.deepEqual(Object.keys(d).sort(), Object.keys(systemFor('dnd-5e-2024').describe()).sort());
      assert.equal(d.toggles.half, false);
    });
  });
}

describe('GURPS block words', () => {
  it('aliases', () => {
    const n = readNumbers('**Hit Points** 11 · **Fatigue Points** 12 · **Speed** 6.25 · **ST** 11 · **DX** 12 · **HT** 13 · **Dodge** 9');
    assert.deepEqual([n.hp, n.fp, n.speed, n.st, n.dx, n.ht, n.dodge], [11, 12, 6.25, 11, 12, 13, 9]);
    assert.equal(readNumbers('Basic Speed 5.25').speed, 5.25);
  });
  it('attribute names are exact', () => {
    assert.equal(keyOf('st'), null);
    assert.equal(keyOf('ST (Strength)'), 'st');
    assert.equal(keyOf('IQ'), 'iq');
    assert.equal(keyOf('Basic Move'), 'move');
  });
  it('the Special Forces shape, a bold key and a pipe', () => {
    for (const eol of ['\n', '\r\n']) {
      const n = readNumbers(`**ST** 10 | **DX** 10 | **IQ** 10 | **HT** 10${eol}`);
      assert.deepEqual([n.hp, n.fp, n.speed], [10, 10, 5]);
      assert.deepEqual(n.from, { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT' });
    }
  });
  it('a header table and a vertical table read too', () => {
    const a = readNumbers('| ST | DX | IQ | HT |\n|---|---|---|---|\n| 9 | 12 | 10 | 10 |');
    assert.deepEqual([a.st, a.dx, a.ht, a.hp, a.speed], [9, 12, 10, 9, 5.5]);
    const b = readNumbers('| HP | 14 |\n| FP | 9 |\n| DR | 2 (leather) |');
    assert.deepEqual([b.hp, b.fp, b.dr], [14, 9, '2 (leather)']);
  });
  it('a value that is no number is null', () => {
    const n = readNumbers('HP n/a · FP — · Basic Speed not tracked · DR —');
    assert.deepEqual([n.hp, n.fp, n.speed, n.dr, n.from], [null, null, null, null, {}]);
  });
  it('HP written as a current over a maximum, or with a current after it', () => {
    assert.equal(readNumbers('HP 6 / 9').hp, 9);
    assert.equal(readNumbers('HP 10 (currently 4)').hp, 10);
  });
  it('a block with nothing gives nulls and one lack, in GURPS words', () => {
    const n = readNumbers('Just a description, nothing to read.');
    assert.deepEqual([n.hp, n.fp, n.speed, n.dx, n.st, n.ht, n.dodge, n.dr, n.from], [null, null, null, null, null, null, null, null, {}]);
    const l = lacks('Nobody', n);
    assert.deepEqual(l.map((x) => x.kind), ['no-numbers']);
    assert.match(l[0].text, /no numbers in the vault: type ST, HT and DX in the fight, or fill them in prep/);
  });
  it('DX and no HT: no Basic Speed, said in GURPS words', () => {
    const l = lacks('Sam', readNumbers('HP 8 · DX 11'));
    assert.deepEqual(l.map((x) => x.kind), ['no-speed']);
    assert.match(l[0].text, /no Basic Speed: it sorts last until you type it or DX and HT/);
    assert.doesNotMatch(JSON.stringify(l), /\bAC\b|initiative/i);
  });
  it('no HP: said in GURPS words', () => {
    const l = lacks('Sam', readNumbers('Basic Speed 5'));
    assert.deepEqual(l.map((x) => x.kind), ['no-hp']);
  });
});

describe('a bracket before a value', () => {
  it('a bracketed number is the value; a bracketed word is an alias, LF and CRLF', () => {
    for (const eol of ['\n', '\r\n']) {
      const n = readNumbers(`DR (2)${eol}Basic Speed (5.25)${eol}ST 10`);
      assert.deepEqual([n.dr, n.speed], ['(2)', 5.25]);
      assert.equal(readNumbers('DR (2 vs piercing)').dr, '(2 vs piercing)');
      assert.equal(readNumbers(`**ST (Strength)** 12${eol}`).st, 12);
    }
  });
});

describe('the row\'s GURPS fields', () => {
  it('a D&D row gains none', () => {
    assert.deepEqual(systemFor('dnd-5e-2024').foeRow({ hp: 3 }), {});
  });
});

for (const crlf of [false, true]) {
  describe(`GURPS PC numbers from the site's readers${crlf ? ' (CRLF checkout)' : ''}`, () => {
    const dir = copyFixture('run-sheet-gurps', { crlf });
    const readPc = (name) => {
      const index = buildIndex(dir);
      const note = `Characters/PCs/${name}.md`;
      const r = index.read(note);
      return systemFor('gurps-4e').readPc({ notePath: note, index, fm: r.fm, body: r.body });
    };
    it('each fixture PC reads HP, FP, Basic Speed, DX and HT', () => {
      assert.deepEqual(readPc('Corin Ash'), { numbers: { hpNow: 10, hpMax: 10, fpNow: 11, fpMax: 11, speed: 5.25, dx: 10, ht: 11 } });
      assert.deepEqual(readPc('Lysa Venn').numbers, { hpNow: 9, hpMax: 9, fpNow: 10, fpMax: 10, speed: 5, dx: 10, ht: 10 });
      assert.deepEqual(readPc('Orrin Tate').numbers, { hpNow: 12, hpMax: 12, fpNow: 11, fpMax: 11, speed: 5.5, dx: 11, ht: 11 });
      assert.deepEqual(readPc('Sela Drake').numbers, { hpNow: 12, hpMax: 12, fpNow: 10, fpMax: 10, speed: 5.25, dx: 11, ht: 10 });
    });
    it('max from Secondary Characteristics, current from Current Status (the Dead End shape)', () => {
      const body = '## Current Status\n\n**HP:** 9/11\n**FP:** 10/12\n\n## Stat Sheet\n\n### Primary Attributes\n\n| Attribute | Score |\n|---|---|\n| ST | 11 |\n| DX | 12 |\n| IQ | 10 |\n| HT | 12 |\n\n### Secondary Characteristics\n\n| Characteristic | Value |\n|---|---|\n| HP | 11 |\n| FP | 12 |\n| Basic Speed | 6.00 |\n';
      const r = systemFor('gurps-4e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body });
      assert.deepEqual(r.numbers, { hpNow: 9, hpMax: 11, fpNow: 10, fpMax: 12, speed: 6, dx: 12, ht: 12 });
    });
    it('a sheet with no attributes says to type HP and FP in the fight', () => {
      const r = systemFor('gurps-4e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body: 'Nothing here.\n' });
      assert.equal(r.numbers.hpMax, null);
      assert.equal(r.note, 'no HP or FP on the sheet: type them in the fight');
    });
    it('a body that makes the reader throw gives a note, never a throw', () => {
      const r = systemFor('gurps-4e').readPc({ notePath: 'x.md', index: null, fm: null, body: { toString() { throw new Error('boom\nsecond'); } } });
      assert.equal(r.numbers.hpMax, null);
      assert.match(r.note, /could not be read: .*boom$/);
    });
  });
}
