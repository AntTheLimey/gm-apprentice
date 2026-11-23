'use strict';
// The CoC foe reader (step 6b Task 3): HP, MP, SAN and DEX from the five block shapes real vaults use.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
      // Task 16 added the combat figures (fighting to attacks) on purpose; Task 18 INT, for its INT roll's card; Task 19
      // the guns (none here)
      assert.deepEqual(r.nums, { hp: 13, mp: 12, san: 55, dex: 50, luck: 45, armour: 'none', str: 60, con: 65, siz: 70, pow: 60, int: 55,
        fighting: 55, firearms: null, dodge: 35, db: '+1D4', build: 1, attacks: null, guns: null, from: {} });
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
    it('readFoe gives Fighting 40, Dodge 20, DB +1D4, Build 1, armour 1 and attacks 2 from a fixture block', () => {
      const n = read(dir, 'Dock Cultist').nums;
      // Task 19 gave the fixture a flintlock pistol at 30 on purpose (its Firearms; Brawl 40 stays the tie figure)
      assert.deepEqual([n.fighting, n.firearms, n.dodge, n.db, n.build, n.attacks], [40, 30, 20, '+1D4', 1, 2]);
      const index = buildIndex(dir);
      const foe = foesOf(`${NPCS}Dock Cultist.md`, index, 1, 'k', new Set(), null, null, systemFor('coc-7e')).foes[0];
      assert.deepEqual([foe.fighting, foe.dodge, foe.db, foe.build, foe.armour, foe.attacks], [40, 20, '+1D4', 1, '1 (oilskin coat)', 2]);
      // the fight's rows: armour a number, attacks carried (Fight on the Net Loft, as the page builds it)
      const M = require('../lib/run-sheet/web/fight-math');
      const RS = require('../lib/run-sheet/web/state');
      const { readRunSheet } = require('../lib/run-sheet/read');
      const m = readRunSheet(dir, 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Fog Bound - Plan.md');
      const b = m.beats.find((x) => /Net Loft/.test(x.title));
      const s = RS.emptyState({ stateId: 's', session: 'x', plan: 'p' });
      const row = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: b.key, idBase: 'f' }).rows.find((r) => r.name === 'Dock Cultist');
      assert.deepEqual([row.fighting, row.dodge, row.db, row.build, row.armour, row.attacks, row.meleeDefences], [40, 20, '+1D4', 1, 1, 2, 0]);
    });
    it('attack lines: a firearm\'s name is Firearms, any other is Fighting; the highest of each', () => {
      const n = readNumbers('**HP** 10\n- Pocket pistol 40% (20/8), damage 1D8\n- Cleaver 30% (15/6), damage 1D6\n- Fighting (Brawl) 45%\n- Dodge 22% (11/4)\n**Skills:** Swim 60%');
      assert.deepEqual([n.fighting, n.firearms, n.dodge, n.attacks], [45, 40, 22, null]);
      assert.deepEqual([read(dir, 'Marcus Lowe').nums.firearms, read(dir, 'Marcus Lowe').nums.fighting], [40, null]);
      assert.deepEqual([read(dir, 'Tobias Reed').nums.fighting, read(dir, 'Creatures/Brine Walker.md').nums.attacks], [45, 1]);
    });
    it('attack names with digits, and a gun: .38 Revolver, 12-gauge shotgun, Tommy gun, elephant gun are Firearms', () => {
      for (const [line, want] of [
        ['- .38 Revolver 45% (22/9), damage 1D10', 45], ['- 12-gauge shotgun 50% (25/10), damage 4D6/2D6/1D6', 50],
        ['- Tommy gun 35% (17/7), damage 1D10+2', 35], ['- **Elephant gun** 60% (30/12), damage 3D6+4', 60],
      ]) {
        const n = readNumbers(`**HP** 10\n${line}`);
        assert.deepEqual([n.firearms, n.fighting], [want, null], line);
      }
      // a fighting weapon with a digit stays Fighting
      assert.deepEqual([readNumbers('- 2-handed axe 40% (20/8), damage 1D8+DB').fighting, readNumbers('- 2-handed axe 40% (20/8), damage 1D8+DB').firearms], [40, null]);
    });
    it('a firearm line\'s damage, malfunction, slow reload and impaling (Task 19): a Regency flintlock and blunderbuss', () => {
      const n = readNumbers('**HP** 10\n- Flintlock pistol 45% (22/9), damage 1D6+1, 1 per 4 rounds, malfunction 95\n- Blunderbuss 40% (20/8), damage 2D6/1D6, 1/4 rnds, malf. 95\n- .38 Revolver 50% (25/10), damage 1D10, impales\n- Tommy gun 35%, damage 1D10+2\n- Brawl 40% (20/8), damage 1D3+DB');
      assert.deepEqual(n.guns, [
        { name: 'Flintlock pistol', skill: 45, damage: '1D6+1', malfunction: 95, reload: 4, impales: false },
        { name: 'Blunderbuss', skill: 40, damage: '2D6/1D6', malfunction: 95, reload: 4, impales: false },
        { name: '.38 Revolver', skill: 50, damage: '1D10', malfunction: null, reload: null, impales: true },
        { name: 'Tommy gun', skill: 35, damage: '1D10+2', malfunction: null, reload: null, impales: null },
      ]);
      assert.equal(readNumbers('**HP** 10\r\n- Brawl 40% (20/8), damage 1D3+DB').guns, null);
      assert.deepEqual(read(dir, 'Dock Cultist').nums.guns.map((g) => [g.name, g.malfunction, g.reload, g.impales]), [['Flintlock pistol', 95, 4, false]]);
    });
    it('a PC sheet\'s Combat table gives its guns (Task 19)', () => {
      const { coc } = require('../lib/run-sheet/systems/coc');
      // Iris's fixture sheet with a Combat table added
      const sheet = fs.readFileSync(path.join(dir, 'Characters/PCs/Iris Calder.md'), 'utf8').replace(/\r\n/g, '\n');
      const fm = { name: 'Iris Calder' };
      const body = `${sheet.replace(/^---[\s\S]*?\n---\n/, '')}\n## Combat\n\n${['| Weapon | Skill % | Damage | Attacks | Range | Ammo | Malf |', '|---|---|---|---|---|---|---|',
        '| Unarmed | 25 | 1D3+DB | 1 | — | — | — |', '| Pistol (Double-Barreled), Flintlock | Firearms (Pistol) 45 | 1D6+1 | 1/4 | 10 yds | 2 | 90 |'].join('\n')}\n`.replace(/\n/g, '\r\n');
      const out = coc.readPc({ body, fm });
      assert.equal(out.note, undefined, 'read by the sheet reader');
      assert.deepEqual(out.numbers.guns, [{ name: 'Pistol (Double-Barreled), Flintlock', skill: 45, damage: '1D6+1', malfunction: 90, reload: 4, impales: false }]);
    });
    it('CoC and Regency are CoC, and fight (Task 7)', () => {
      for (const [id, label] of [['coc-7e', 'Call of Cthulhu 7e'], ['coc-7e-regency', null]]) {
        const d = systemFor(id).describe();
        assert.equal(d.family, 'coc');
        assert.equal(d.fights, true);
        assert.equal(d.toggles.gun, true);
        assert.deepEqual(d.panelBoxes.map((b) => b.label), ['DEX', 'MP', 'SAN', 'Fighting', 'Firearms', 'Dodge', 'DB', 'Armour', 'Build', 'Attacks']);
        assert.equal(d.words.entryPlaceholder, '-7 / +3 / m-2 / s-5');
        assert.equal(d.initiative, 'dex');
        assert.equal(d.initDecimals, 0);
        assert.equal(d.hpFloor, 0);
        assert.equal(d.autoOut, false);
        assert.equal(d.fight.initiative, 'dex');
        // Task 16: CoC's melee numbers as data, on the model's rules and the fight's
        // Task 18 added the cards' table on purpose (its own tests are in run-sheet-coc-math.test.js)
        // Task 19 added the firearm table on purpose (its own tests are in run-sheet-coc-math.test.js)
        const { cards, firearm, ...melee } = d.coc;
        assert.equal(typeof cards, 'object');
        assert.equal(typeof firearm, 'object');
        assert.deepEqual(melee, { tie: { dodge: 'defender', fightBack: 'attacker' }, outnumbered: { bonus: 1 }, prone: { status: 'Prone', meleeBonus: 1 }, maxDice: 2, defaultResponse: 'fightBack' });
        assert.deepEqual(d.fight.coc, d.coc);
        assert.equal(d.words.buildHint, 'Manoeuvre: compare Builds');
        assert.ok(d.statuses.includes('Prone'));
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

for (const crlf of [false, true]) {
  describe(`CoC PC numbers from the site's readers${crlf ? ' (CRLF checkout)' : ''}`, () => {
    const dir = copyFixture('run-sheet-coc', { crlf });
    const readPc = (name, system = 'coc-7e') => {
      const index = buildIndex(dir);
      const note = `Characters/PCs/${name}.md`;
      const r = index.read(note);
      return systemFor(system).readPc({ notePath: note, index, fm: r.fm, body: r.body });
    };
    it('a Derived table gives current and maximum, Luck and DEX', () => {
      // Task 16: the sheet's Combat table adds Dodge, Build and the damage bonus (no Fighting or Firearms written); Task 18
      // CON and INT from its characteristics, for the cards
      assert.deepEqual(readPc('Iris Calder'), { numbers: { hpNow: 9, hpMax: 11, mpNow: 13, mpMax: 13, sanNow: 62, sanMax: 99, luck: 55, dex: 55, dodge: 27, build: 0, db: '0', con: 60, int: 75 } });
      assert.deepEqual(readPc('Iris Calder', 'coc-7e-regency').numbers.hpMax, 11);
    });
    it('a one-line sheet falls back to its line, current = max, with a quiet note', () => {
      const r = readPc('Jonas Finch');
      assert.deepEqual(r.numbers, { hpNow: 13, hpMax: 13, mpNow: 12, mpMax: 12, sanNow: 60, sanMax: 60, luck: null, dex: null });
      assert.equal(r.note, 'numbers from a one-line sheet (current = max)');
    });
    it('a sheet with no numbers says to type HP in the fight', () => {
      const r = readPc('Mabel Quill');
      assert.equal(r.numbers.hpMax, null);
      assert.equal(r.note, 'no HP on the sheet: type it in the fight');
    });
    it('an empty Current column reads as the maximum', () => {
      const body = '## Stat Sheet\n\n### Derived\n\n| Attribute | Max | Current |\n|---|---|---|\n| HP | 12 | |\n| MP | 8 | |\n| Sanity | 70 | |\n';
      const r = systemFor('coc-7e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body });
      assert.deepEqual([r.numbers.hpNow, r.numbers.hpMax, r.numbers.mpNow, r.numbers.sanNow, r.numbers.sanMax], [12, 12, 8, 70, 70]);
    });
    it('combatOf takes the highest PC specialisation and counts a typed figure', () => {
      const body = '## Stat Sheet\n\n### Derived\n\n| Attribute | Max | Current |\n|---|---|---|\n| HP | 12 | |\n\n'
        + '## Skills\n\n| Skill | Base | Regular | Half | Fifth |\n|---|---|---|---|---|\n| Fighting (Brawl) | 25 | 40 | 20 | 8 |\n'
        + '| Fighting (Sword) | 20 | 65 | 32 | 13 |\n| Firearms (Handgun) | 20 | 30 | 15 | 6 |\n| Dodge | 25 | 35 | 17 | 7 |\n';
      const n = systemFor('coc-7e').readPc({ notePath: 'x.md', index: null, fm: { type: 'pc' }, body }).numbers;
      assert.deepEqual([n.fighting, n.firearms, n.dodge], [65, 30, 35]);
      const CM = require('../lib/run-sheet/web/coc-math');
      assert.equal(CM.combatOf(n), 65);
      assert.equal(CM.combatOf({ ...n, fighting: 70 }), 70);
    });
    it('a body that makes the reader throw gives a note, never a throw', () => {
      const r = systemFor('coc-7e').readPc({ notePath: 'x.md', index: null, fm: null, body: { toString() { throw new Error('boom\nsecond'); } } });
      assert.equal(r.numbers.hpMax, null);
      assert.match(r.note, /could not be read: .*boom$/);
    });
  });
}
