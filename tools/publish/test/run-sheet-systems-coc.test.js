'use strict';
// The CoC foe reader (step 6b Task 3): HP, MP, SAN and DEX from the five block shapes real vaults use.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildIndex } = require('../lib/run-sheet/notes');
const { systemFor } = require('../lib/run-sheet/systems');
const { pairs } = require('../lib/run-sheet/systems/pairs');
const { readNumbers, keyOf } = require('../lib/run-sheet/systems/coc');
const { foesOf } = require('../lib/run-sheet/foes');
const { copyFixture, withSystem, removeFixture } = require('./helpers/systems-fixture');

const NPCS = 'Characters/NPCs/';
function read(dir, note, id = 'coc-7e') {
  const index = buildIndex(dir);
  return systemFor(id).readFoe({ notePath: note.includes('/') ? note : `${NPCS}${note}.md`, index, text: undefined });
}

for (const crlf of [false, true]) {
  describe(`CoC foe reader${crlf ? ' (CRLF checkout)' : ''}`, () => {
    const dir = copyFixture('run-sheet-coc', { crlf });
    it('reads a template line plus a characteristics table', () => {
      const r = read(dir, 'Warden Hale');
      assert.deepEqual(r.nums, { hp: 13, mp: 12, san: 55, dex: 50, luck: 45, armour: 'none', str: 60, con: 65, siz: 70, pow: 60, from: {} });
      assert.deepEqual(r.lacks, []);
      assert.equal(r.hpStart, null);
    });
    it('reads a pipe line', () => {
      const n = read(dir, 'Nurse Orla Penn').nums;
      assert.deepEqual([n.hp, n.mp, n.san, n.dex, n.luck, n.armour], [10, 11, 55, 60, 60, null]);
    });
    it('reads a vertical table', () => {
      const n = read(dir, 'Tobias Reed').nums;
      assert.deepEqual([n.hp, n.mp, n.san, n.dex, n.luck, n.str, n.siz], [13, 9, 45, 45, 40, 70, 75]);
    });
    it('reads paired cells', () => {
      const r = read(dir, 'Edda Voss');
      assert.deepEqual([r.nums.hp, r.nums.mp, r.nums.san, r.nums.dex, r.nums.luck], [10, 10, 50, 35, 55]);
      assert.equal(r.statsHeading, 'Attributes');
    });
    it('reads a characteristics header table', () => {
      const n = read(dir, 'Marcus Lowe').nums;
      assert.deepEqual([n.hp, n.mp, n.san, n.dex, n.luck, n.pow, n.edu], [12, 13, 65, 70, 50, 65, undefined]);
    });
    it('a current HP after the figure is the start, the max stays', () => {
      const r = read(dir, 'Wick Tamsin');
      assert.equal(r.nums.hp, 10);
      assert.equal(r.hpStart, 4);
      assert.equal('hpStart' in r.nums, false);
    });
    it('HP comes from CON and SIZ when the block has none, and says so', () => {
      const r = read(dir, 'Gull Sexton');
      assert.equal(r.nums.hp, 12);
      assert.equal(r.nums.mp, 9);
      assert.deepEqual(r.nums.from, { hp: 'from CON+SIZ' });
      assert.equal(r.nums.dex, null);
      assert.deepEqual(r.lacks.map((l) => l.kind), ['no-dex']);
      assert.match(r.lacks[0].text, /no DEX: it sorts last until you type it/);
    });
    it('MP comes from POW when the block has none, and says so', () => {
      const r = read(dir, 'Rook Dunmore');
      assert.equal(r.nums.hp, 11);
      assert.equal(r.nums.mp, 10);
      assert.deepEqual(r.nums.from, { mp: 'from POW' });
    });
    it('a creature: SAN not tracked is null, 7 / 13 flying is not read as the move', () => {
      const r = read(dir, 'Creatures/Tide Wraith.md');
      assert.equal(r.nums.san, null);
      assert.equal(r.nums.str, null);
      assert.deepEqual([r.nums.hp, r.nums.mp, r.nums.dex, r.nums.armour], [9, 14, 80, 'none']);
    });
    it('a note with no stat block reads as none, the regency id reads the same', () => {
      const r = read(dir, 'Pell Ashby');
      assert.deepEqual(r, { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null });
      for (const note of ['Warden Hale', 'Gull Sexton', 'Edda Voss']) assert.deepEqual(read(dir, note, 'coc-7e-regency'), read(dir, note), note);
    });
    it('the foe row carries MP, SAN, DEX, armour and the derivations, and sorts on DEX', () => {
      const index = buildIndex(dir);
      const { foes: rows } = foesOf(`${NPCS}Gull Sexton.md`, index, 1, 'k', new Set(), null, null, systemFor('coc-7e'));
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].hp, rows[0].mp, rows[0].mpMax, rows[0].san, rows[0].sanMax, rows[0].dex, rows[0].init], [12, 9, 9, 50, 50, null, null]);
      assert.deepEqual(rows[0].from, { hp: 'from CON+SIZ' });
      const w = foesOf(`${NPCS}Warden Hale.md`, index, 1, 'k', new Set(), null, null, systemFor('coc-7e')).foes[0];
      assert.deepEqual([w.init, w.dex, w.armour], [50, 50, 'none']);
    });
    it('CoC and Regency are CoC; fights stay off', () => {
      for (const [id, label] of [['coc-7e', 'Call of Cthulhu 7e'], ['coc-7e-regency', null]]) {
        const d = systemFor(id).describe();
        assert.equal(d.family, 'coc');
        assert.equal(d.fights, false);
        assert.equal(d.initiative, 'dex');
        assert.equal(d.initDecimals, 0);
        assert.equal(d.hpFloor, 0);
        assert.equal(d.autoOut, false);
        assert.equal(d.fight.initiative, 'dex');
        if (label) assert.equal(d.label, label); else assert.match(d.label, /Regency/);
      }
      assert.equal(systemFor('coc').id, 'coc-7e');
    });
  });
}

describe('CoC block words', () => {
  const nums = (md) => readNumbers(md);
  it('aliases', () => {
    const n = nums('**Hit Points** 8 · **Magic Points** 7 · **Sanity** 40 · **Dexterity** 55 · **Armor** 1 point of hide');
    assert.deepEqual([n.hp, n.mp, n.san, n.dex, n.armour], [8, 7, 40, 55, '1 point of hide']);
    const t = nums('| STR (Strength) | 70 |\n| Constitution | 60 |\n| Size | 50 |\n| Power | 45 |');
    assert.deepEqual([t.str, t.con, t.siz, t.pow, t.hp, t.mp], [70, 60, 50, 45, 11, 9]);
  });
  it('a bold line with a parenthesised alias reads its value, LF and CRLF', () => {
    for (const eol of ['\n', '\r\n']) {
      const n = nums(`**STR (Strength)** 70 · **CON** 60${eol}**SIZ (Size):** 50 · **POW** 45`);
      assert.deepEqual([n.str, n.con, n.siz, n.pow], [70, 60, 50, 45]);
    }
  });
  it('a value that is no number is null', () => {
    const n = nums('**HP** n/a · **MP** — · **SAN** not tracked · **DEX** 7 / 13 flying');
    assert.deepEqual([n.hp, n.mp, n.san, n.dex], [null, null, null, 7]);
  });
  it('a block with no numbers gives nulls and one lack', () => {
    const n = nums('Just a description, nothing to read.');
    assert.deepEqual([n.hp, n.mp, n.san, n.dex, n.luck, n.armour, n.from], [null, null, null, null, null, null, {}]);
    const { lacks } = require('../lib/run-sheet/systems/coc');
    const l = lacks('Nobody', n);
    assert.equal(l.length, 1);
    assert.equal(l[0].kind, 'no-numbers');
  });
  it('a block with DEX and no HP lacks HP only, in CoC words', () => {
    const { lacks } = require('../lib/run-sheet/systems/coc');
    const l = lacks('Sam', nums('**DEX** 40 · **SAN** 50'));
    assert.deepEqual(l.map((x) => x.kind), ['no-hp']);
    assert.match(l[0].text, /no HP in its stats: type it in the fight, or fill it in prep/);
    assert.doesNotMatch(JSON.stringify(l), /\bAC\b|initiative|stat-fill/i);
  });
});

describe('the row\'s system fields', () => {
  it('a D&D row gains no CoC keys, and a CoC row does', () => {
    const dir = copyFixture('run-sheet-coc');
    try {
      const index = buildIndex(dir);
      const d = foesOf(`${NPCS}Warden Hale.md`, index, 1, 'k', new Set(), null, null, systemFor('dnd-5e-2024')).foes[0];
      for (const k of ['mp', 'mpMax', 'san', 'sanMax', 'dex', 'armour', 'from']) assert.equal(k in d, false, k);
      assert.deepEqual(systemFor('dnd-5e-2024').foeRow({ hp: 3 }), {});
      assert.equal('mp' in foesOf(`${NPCS}Warden Hale.md`, index, 1, 'k', new Set(), null, null, systemFor('coc-7e')).foes[0], true);
    } finally { removeFixture(dir); }
  });
});

describe('pairs is system-neutral', () => {
  it('takes the caller\'s keys', () => {
    const keyOfX = (s) => (/^(?:ST|DX|HT)$/.test(s) ? s.toLowerCase() : null);
    assert.deepEqual(pairs('ST 11 · DX 12\r\n| ST | DX | HT |\r\n|---|---|---|\r\n| 9 | 8 | 7 |', keyOfX), [['st', '11'], ['dx', '12'], ['st', '9'], ['dx', '8'], ['ht', '7']]);
    assert.equal(keyOf('ST'), null);
  });
});
