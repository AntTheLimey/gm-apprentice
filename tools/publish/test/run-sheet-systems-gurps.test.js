'use strict';
// The GURPS foe reader (step 6b Task 4): HP, FP and Basic Speed, worked out from ST, HT and DX when a block lacks them.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildIndex } = require('../lib/run-sheet/notes');
const { systemFor } = require('../lib/run-sheet/systems');
const { readNumbers, keyOf, lacks, energyReserve, isCaster } = require('../lib/run-sheet/systems/gurps');
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
      // step 6b Task 14 changed this on purpose: Dodge is worked out from Basic Speed, marked; Parry and Block are read
      assert.deepEqual(r.nums, { hp: 10, fp: 11, speed: 5.75, dx: 12, st: 10, ht: 11, dodge: 8, parry: null, block: null, dr: null,
        from: { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT', dodge: 'from Speed' } });
      assert.deepEqual(r.lacks, []);
      assert.equal(r.hpStart, null);
      assert.equal(r.fpStart, null);
    });
    // Task 12 changed DR on purpose: the brief makes it the DR text's figure, a number the hit's sum takes off
    it('full figures win over worked-out ones, DR read as its figure', () => {
      const r = read(dir, 'Vex Harrow');
      // step 6b Task 14 (on purpose): Parry and Block are read
      assert.deepEqual(r.nums, { hp: 13, fp: 10, speed: 5.25, dx: 11, st: 13, ht: 10, dodge: 8, parry: 10, block: 9, dr: 1, from: {} });
      assert.equal(read(dir, 'Mara Quint').nums.dr, 0);
      assert.equal(read(dir, 'Mara Quint').nums.speed, 5.25);
    });
    it('HP 6/9 starts at 6 with 9 as the maximum', () => {
      const r = read(dir, 'Tam Osier');
      assert.equal(r.nums.hp, 9);
      assert.equal(r.hpStart, 6);
      assert.equal(r.nums.speed, 5.5);
      assert.equal('hpStart' in r.nums, false);
    });
    it('FP keeps its figure; the reserve after it is the Energy Reserve', () => {
      const r = read(dir, 'Bram Holt');
      assert.deepEqual([r.nums.hp, r.nums.fp, r.nums.speed, r.nums.er], [12, 11, 5.25, 4]);
      assert.equal('reserve' in r.nums, false);
      assert.equal(r.nums.caster, undefined, 'a reserve alone is no caster');
    });
    // Task 4 read Magery as nothing; Task 10 reads who casts (changed on purpose)
    it('Magery 2 is a caster, Magery 0 is not', () => {
      assert.equal(read(dir, 'Ilse Verrin').nums.caster, true);
      assert.equal(read(dir, 'Ilse Verrin').nums.er, 4, 'a trait Energy Reserve 4 beside Magery');
      // step 6b Task 14 (on purpose): Parry and Block are read
      assert.deepEqual(Object.keys(read(dir, 'Dova Lang').nums).sort(), ['block', 'dodge', 'dr', 'dx', 'fp', 'from', 'hp', 'ht', 'parry', 'speed', 'st']);
      const index = buildIndex(dir);
      const row = (n) => foesOf(`${NPCS}${n}.md`, index, 1, 'k', new Set(), null, null, systemFor('gurps-4e')).foes[0];
      assert.equal(row('Ilse Verrin').caster, true);
      assert.equal('caster' in row('Dova Lang'), false);
      assert.equal('er' in row('Rafe Kell'), false, 'no reserve, no key');
    });
    it('a note with no stat block reads as none', () => {
      assert.deepEqual(read(dir, 'Ned Pike'), { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null, fpStart: null });
    });
    it('the foe row carries Basic Speed as its initiative, and the marks', () => {
      const index = buildIndex(dir);
      const row = foesOf(`${NPCS}Rafe Kell.md`, index, 1, 'k', new Set(), null, null, systemFor('gurps-4e')).foes[0];
      // step 6b Task 14 changed this on purpose: Dodge is worked out from Basic Speed, marked
      assert.deepEqual([row.hp, row.init, row.speed, row.fp, row.fpMax, row.dx, row.st, row.ht, row.dodge, row.dr], [10, 5.75, 5.75, 11, 11, 12, 10, 11, 8, null]);
      assert.deepEqual(row.from, { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT', dodge: 'from Speed' });
      const tam = foesOf(`${NPCS}Tam Osier.md`, index, 1, 'k', new Set(), null, null, systemFor('gurps-4e')).foes[0];
      assert.deepEqual([tam.hp, tam.hpStart], [9, 6]);
    });
    it('it fights (Task 7), and the description has GURPS\'s known values', () => {
      const d = systemFor('gurps-4e').describe();
      assert.equal(d.fights, true);
      assert.deepEqual(d.panelBoxes.map((b) => b.label), ['ST', 'HT', 'DX', 'Speed', 'Dodge', 'Parry', 'Block', 'DR']);
      assert.equal(d.words.entryPlaceholder, '-7 / +3 / f-2');
      assert.equal(d.toggles.gun, false);
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
      // step 6b Task 14 changed this on purpose: Dodge is worked out from Basic Speed, marked
      assert.deepEqual(n.from, { hp: 'from ST', fp: 'from HT', speed: 'from DX and HT', dodge: 'from Speed' });
    }
  });
  it('a header table and a vertical table read too', () => {
    const a = readNumbers('| ST | DX | IQ | HT |\n|---|---|---|---|\n| 9 | 12 | 10 | 10 |');
    assert.deepEqual([a.st, a.dx, a.ht, a.hp, a.speed], [9, 12, 10, 9, 5.5]);
    const b = readNumbers('| HP | 14 |\n| FP | 9 |\n| DR | 2 (leather) |');
    // Task 12 (on purpose): DR is its figure
    assert.deepEqual([b.hp, b.fp, b.dr], [14, 9, 2]);
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
      // Task 12 (on purpose): DR is its figure
      assert.deepEqual([n.dr, n.speed], [2, 5.25]);
      assert.equal(readNumbers('DR (2 vs piercing)').dr, 2);
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
      // Task 10: Lysa's Energy Reserve and her spells (changed on purpose)
      assert.deepEqual(readPc('Lysa Venn').numbers, { hpNow: 9, hpMax: 9, fpNow: 10, fpMax: 10, speed: 5, dx: 10, ht: 10, erNow: 6, erMax: 6, caster: true });
      assert.deepEqual(readPc('Orrin Tate').numbers, { hpNow: 12, hpMax: 12, fpNow: 11, fpMax: 11, speed: 5.5, dx: 11, ht: 11 });
      // Task 12 (on purpose): Sela's sheet has a DR by Hit Location table; Task 14 (on purpose): its Active Defenses
      assert.deepEqual(readPc('Sela Drake').numbers, { hpNow: 12, hpMax: 12, fpNow: 10, fpMax: 10, speed: 5.25, dx: 11, ht: 10, dodge: 8, parry: 10, block: 9,
        drByLocation: { skull: 4, face: 0, neck: 2, torso: 3, arm: 2, hand: 1, leg: 2, foot: 1 } });
    });
    it('max from Secondary Characteristics, current from Current Status (the Dead End shape)', () => {
      const body = '## Current Status\n\n**HP:** 9/11\n**FP:** 10/12\n\n## Stat Sheet\n\n### Primary Attributes\n\n| Attribute | Score |\n|---|---|\n| ST | 11 |\n| DX | 12 |\n| IQ | 10 |\n| HT | 12 |\n\n### Secondary Characteristics\n\n| Characteristic | Value |\n|---|---|\n| HP | 11 |\n| FP | 12 |\n| Basic Speed | 6.00 |\n';
      const r = systemFor('gurps-4e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body });
      assert.deepEqual(r.numbers, { hpNow: 9, hpMax: 11, fpNow: 10, fpMax: 12, speed: 6, dx: 12, ht: 12 });
    });
    // Task 23b B8: the PC's defences come from the note's Active Defenses; several Parry lines leave the first (Task 28's
    // real-vault proof checks how the Dead Air PCs write theirs)
    it('a PC with several Parry lines reads the first; one with no Active Defenses reads none', () => {
      const base = '## Current Status\n\n**HP:** 10/10\n**FP:** 10/10\n\n## Stat Sheet\n\n### Primary Attributes\n\n| Attribute | Score |\n|---|---|\n| ST | 10 |\n| DX | 10 |\n| IQ | 10 |\n| HT | 10 |\n\n### Secondary Characteristics\n\n| Characteristic | Value |\n|---|---|\n| HP | 10 |\n| FP | 10 |\n| Basic Speed | 5.00 |\n';
      const read = (extra) => systemFor('gurps-4e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body: base + extra }).numbers;
      const n = read('\n## Active Defenses\n\n| Defense | Value | Source |\n|---|---|---|\n| Dodge | 8 | Basic Speed |\n| Parry | 10 | Broadsword |\n| Parry | 9 | Main-Gauche |\n| Block | 9 | Shield |\n');
      assert.deepEqual([n.dodge, n.parry, n.block], [8, 10, 9]);
      const none = read('');
      assert.deepEqual([none.dodge, none.parry, none.block], [undefined, undefined, undefined]);
    });
    it('an empty Spells table is no caster', () => {
      const orrin = readPc('Orrin Tate');
      assert.equal(orrin.numbers.caster, undefined);
      assert.equal(orrin.spells, undefined);
      const lysa = readPc('Lysa Venn');
      assert.match(lysa.spells, /^\| Name \| College \| Skill Level/);
      assert.match(lysa.spells, /\| Create Fire \| Fire \| 13 \|/);
      assert.doesNotMatch(lysa.spells, /\r/);
      for (const p of ['Corin Ash', 'Sela Drake']) assert.equal(readPc(p).numbers.caster, undefined, p);
    });
    it('Magery 0 with no spells on a sheet is no caster; a dash row beside a real one still casts', () => {
      const sheet = (rows) => `## Current Status\n\n**HP:** 10/10\n**FP:** 10/10\n\n## Advantages\n\n| Name | Points |\n|---|---|\n| Magery 0 | 5 |\n\n## Stat Sheet\n\n### Primary Attributes\n\n| Attribute | Score |\n|---|---|\n| ST | 10 |\n| DX | 10 |\n| IQ | 10 |\n| HT | 10 |\n\n### Secondary Characteristics\n\n| Characteristic | Value |\n|---|---|\n| HP | 10 |\n| FP | 10 |\n| Basic Speed | 5.00 |\n\n## Spells\n\n| Name | Skill Level |\n|---|---|\n${rows}\n`;
      const pc = (rows) => systemFor('gurps-4e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body: sheet(rows) });
      assert.equal(pc('| — | — |').numbers.caster, undefined);
      assert.equal(pc('| - | - |').numbers.caster, undefined);
      assert.equal(pc('| — | — |\n| Light | 12 |').numbers.caster, true);
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

describe('GURPS magic in a block (Task 10)', () => {
  it('Energy Reserve read three ways', () => {
    for (const eol of ['\n', '\r\n']) {
      assert.deepEqual(energyReserve(`HP 12 · FP 11 (+4 Energy Reserve) · Basic Speed 5.25${eol}`), { now: 4, max: 4 });
      assert.deepEqual(energyReserve(`**Advantages:** Magery 1, Energy Reserve 3 (Magical) [9]${eol}`), { now: 3, max: 3 });
      assert.deepEqual(energyReserve(`| Track | Value |${eol}|---|---|${eol}| Energy Reserve | 4/6 |${eol}`), { now: 4, max: 6 });
    }
    assert.deepEqual(energyReserve('**Energy Reserve:** 5/5'), { now: 5, max: 5 });
    assert.equal(energyReserve('| Energy Reserve (Magical) | 18 |'), null, 'a table row\'s cost is never the reserve');
    assert.deepEqual(energyReserve('| Energy Reserve 6 (Magic only) | 18 |'), { now: 6, max: 6 });
    assert.equal(energyReserve('FP 10 · no reserve'), null);
    // a figure after a parenthesis (review); a cost cell after one is still never the reserve
    assert.deepEqual(energyReserve('Advantages: Energy Reserve (Magical) 6 [18]'), { now: 6, max: 6 });
    assert.deepEqual(energyReserve('**Energy Reserve (Magical):** 3/6'), { now: 3, max: 6 });
    assert.equal(energyReserve('| Energy Reserve (Magical) | 18 |'), null);
    assert.equal(energyReserve('| Energy Reserve (Magical) 6 | 18 |').max, 6);
    const n = readNumbers('HP 9 · FP 10 · Energy Reserve 2/5');
    assert.deepEqual([n.fp, n.er, n.erStart], [10, 5, 2]);
    const row = systemFor('gurps-4e').foeRow(n);
    assert.deepEqual([row.er, row.erMax, row.erStart], [5, 5, 2]);
  });
  it('who casts: Magery 1 or more, or a spell list with levels', () => {
    assert.equal(isCaster('Magery 1'), true);
    assert.equal(isCaster('**Magery** 3'), true);
    assert.equal(isCaster('Magery 0'), false);
    assert.equal(isCaster('Magery (One College) 2'), true);
    assert.equal(isCaster('Magery (One College) 0'), false);
    assert.equal(isCaster('| Magery (One College) | 25 |'), false, 'a cost cell is no level');
    assert.equal(isCaster('Advantages: Magery 0 (sense only)'), false);
    assert.equal(isCaster('**Spells (IQ+Magery = 12):** Light-12; Seek Earth-12'), true);
    assert.equal(isCaster('Spells: none'), false);
    assert.equal(isCaster('#### Spells\n\n- Light-13\n- Shape Water-13'), true);
    assert.equal(isCaster('#### Spells\n\n| Name | Level |\n|---|---|\n| — | — |'), false);
    assert.equal(isCaster('#### Spells\n\n| Name | Level |\n|---|---|\n| Haste | 14 |'), true);
    assert.equal(isCaster('| Spell | Level |\n|---|---|\n| Haste | 14 |'), true);
    // a stat table is no spell list
    assert.equal(isCaster('| HP | 14 |\n| FP | 9 |\n| DR | 2 |'), false);
    assert.equal(isCaster('ST 10 | DX 12 | IQ 10 | HT 11'), false);
  });
  it('the description has the reserve\'s pool and the caster\'s box words', () => {
    const d = systemFor('gurps-4e').describe();
    assert.deepEqual(d.fight.pools.map((p) => [p.key, p.prefix, p.max]), [['fp', 'f', 'fpMax'], ['er', 'e', 'erMax']]);
    assert.equal(d.words.casterPlaceholder, '\u2726 f-3');
    assert.match(d.words.entryInvalid, /e-2 \(Energy Reserve\)/);
  });
});

// ---- the damage helper (step 6b Task 12) ----
describe('GURPS hits: the readers', () => {
  const { WOUNDING, drByLocationOf } = require('../lib/run-sheet/systems/gurps');
  it('a block that says the face is bare opens it; a plain DR does not', () => {
    assert.equal(readNumbers('DR 2 (face 0)').faceOpen, true);
    assert.equal(readNumbers('ST 10 · DR 3 (open face)').faceOpen, true);
    assert.equal(readNumbers('DR 2 (face 0)').dr, 2);
    assert.equal(readNumbers('DR 2').faceOpen, undefined);
    assert.equal(readNumbers('A bare face and a scowl.\nDR 2').faceOpen, undefined, 'only the DR line speaks for the face');
    const index = buildIndex(copyFixture('run-sheet-gurps'));
    const row = foesOf(`${NPCS}Vex Harrow.md`, index, 1, 'k', new Set(), null, null, systemFor('gurps-4e')).foes[0];
    assert.deepEqual([row.dr, 'faceOpen' in row], [1, false]);
  });
  it('a sheet\'s DR rows: plural, sided, shared and starred places', () => {
    const model = { defenses: { hitLocations: [
      { location: 'Left Arm', dr: '3' }, { location: 'Arms/Legs', dr: '2*' }, { location: 'Head', dr: '4' },
      { location: 'Torso', dr: '—' }, { location: 'Vitals', dr: '5' }, { location: 'Tail', dr: '9' },
    ] } };
    // the plain arm is the Arms/Legs row's, whatever the order: a right-arm or unsided hit is never the left's DR 3
    assert.deepEqual(drByLocationOf(model), { 'left arm': 3, arm: 2, leg: 2, skull: 4, face: 4, vitals: 5 });
    const sided = { defenses: { hitLocations: [{ location: 'Right Arm', dr: '1' }, { location: 'Left Arm', dr: '3' }, { location: 'Torso', dr: '2' }] } };
    assert.deepEqual(drByLocationOf(sided), { 'right arm': 1, 'left arm': 3, torso: 2, arm: 1 }, 'no plain row: the first sided one');
    const { gurpsInjury } = require('../lib/run-sheet/web/gurps-math');
    const row = { max: 20, drByLocation: drByLocationOf(model) };
    assert.equal(gurpsInjury({ n: 9, type: 'cr', location: 'arm', side: 'right' }, row, WOUNDING).line, '9 cr − DR 2 = 7');
    assert.equal(gurpsInjury({ n: 9, type: 'cr', location: 'arm', side: 'left' }, row, WOUNDING).line, '9 cr − DR 3 = 6');
    assert.equal(drByLocationOf({ defenses: { hitLocations: [] } }), null);
    assert.equal(drByLocationOf({}), null);
  });
  it('the description carries the wounding table, the type chips and the location list', () => {
    const d = systemFor('gurps-4e').describe();
    assert.equal(d.toggles.hitChips, true);
    assert.deepEqual(d.fight.wounding, WOUNDING);
    assert.equal(systemFor('dnd-5e-2024').describe().fight.wounding, null);
    assert.equal(systemFor('coc-7e').describe().fight.wounding, null);
    assert.deepEqual(d.fight.wounding.typeChips.slice().sort(), Object.keys(WOUNDING.types).sort());
    // step 6b Task 25 changed this on purpose: the location chips became one list, every place in it
    assert.deepEqual(d.fight.wounding.locationOrder.slice().sort(), Object.keys(WOUNDING.locations).sort());
    assert.equal(d.fight.wounding.locationChips, undefined);
  });
});
