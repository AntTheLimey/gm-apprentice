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
    it('gun names: a calibre, a kind of gun, a make are Firearms; an axe and a Gunsmith are not (Task 19)', () => {
      for (const name of ['.45 Automatic', 'Colt .45', 'Thompson', '.30-06 Bolt-action', 'Lee-Enfield', 'Webley', 'Luger', 'Brown Bess',
        '9mm pistol', 'Semi-automatic pistol', 'Lever-action rifle', 'Matchlock', 'Mauser', 'Winchester', 'Remington', 'Springfield', 'Baker rifle', 'SMG', 'Machine gun']) {
        const n = readNumbers(`**HP** 10\n- ${name} 40% (20/8), damage 1D10`);
        assert.deepEqual([n.firearms, n.fighting], [40, null], name);
      }
      for (const name of ['2-handed axe', 'Gunsmith', 'Cleaver']) {
        const n = readNumbers(`**HP** 10\n- ${name} 40% (20/8), damage 1D6`);
        assert.deepEqual([n.firearms, n.fighting], [null, 40], name);
      }
      // a skill line stays a skill
      assert.deepEqual([readNumbers('- Firearms (Handgun) 45%').firearms, readNumbers('- Fighting (Brawl) 45%').fighting], [45, 45]);
    });
    it('Regency block shapes (Task 19 fix round 2): a Firearms skill line with damage, a skill-only gun, damage with no word', () => {
      const g = (t) => readNumbers(`**HP** 10\n${t}`).guns;
      assert.deepEqual(g('- Firearms (Rifle/Musket) 60% (30/12), damage 1D10+4, 1 shot per 4 rounds (Brown Bess)'),
        [{ name: 'Brown Bess', skill: 60, damage: '1D10+4', malfunction: null, reload: 4, impales: false }]);
      assert.deepEqual(g('- Firearms (Musket) 50% (25/10), damage 1D10+4, one shot per 4 rounds'),
        [{ name: 'Firearms (Musket)', skill: 50, damage: '1D10+4', malfunction: null, reload: 4, impales: false }]);
      assert.deepEqual(g('- Firearms (Pistol) 45% (22/9), damage 1D6+1'), [{ name: 'Firearms (Pistol)', skill: 45, damage: '1D6+1', malfunction: null, reload: null, impales: null }]);
      // a skill only: a gun of unknown damage, its kind from the specialisation and the Equipment line
      const only = readNumbers('**HP** 10\n- **Firearms (Pistol)** 55%\n**Equipment:** a flintlock pistol and a short sabre');
      assert.deepEqual([only.firearms, only.guns], [55, [{ name: 'Firearms (Pistol)', skill: 55, damage: null, malfunction: null, reload: null, impales: false }]]);
      // a Firearms figure inside a run of skills
      const run = readNumbers('**Skills:** Persuade 75%, Firearms (Handgun) 40%, Dodge 30%');
      assert.deepEqual([run.firearms, run.guns[0].name, run.guns[0].skill], [40, 'Firearms (Handgun)', 40]);
      // damage written without the word
      const nw = readNumbers('* **Pistol (flintlock)** 45% — 1D10+2, 1/3 rounds\n- Knife: 35%, 1D4+2\n* **Dodge** 50%');
      assert.deepEqual([nw.firearms, nw.fighting, nw.dodge], [45, 35, 50]);
      assert.deepEqual(nw.guns, [{ name: 'Pistol (flintlock)', skill: 45, damage: '1D10+2', malfunction: null, reload: 3, impales: false }]);
    });
    // Task 23b B12: dice with no `damage` word count only right after the percentage
    it('a skill line with dice further along is no attack; dice right after the percentage still are', () => {
      const n = (t) => readNumbers(`**HP** 10\n${t}`);
      assert.deepEqual([n('- First Aid 60%: restores 1D3').fighting, n('- First Aid 60%: restores 1D3').firearms], [null, null]);
      assert.equal(n('- Medicine 55%, heals 1D4 HP').fighting, null);
      assert.equal(n('- Knife 35% 1D4+2').fighting, 35);
      assert.equal(n('- Knife: 35%, 1D4+2').fighting, 35);
      assert.equal(n('- Knife 35% (17/7), 1D4+2').fighting, 35);
      assert.equal(n('- First Aid 60% (30/12): restores 1D3').fighting, null);
      assert.equal(n('* **Sabre** 45% \u2014 1D6+2').fighting, 45);
      assert.equal(n('* **Sabre** 45% \u2013 1D6+2').fighting, 45);
      assert.equal(n('- Boat hook 45% (22/9), damage 1D6+DB').fighting, 45);
    });
    it('reload and malfunction phrasings the vaults use (Task 19 fix round 2)', () => {
      const r = (t) => readNumbers(`- Flintlock pistol 40%, damage 1D6, ${t}`).guns[0];
      for (const [t, n] of [['1 per 4 rounds', 4], ['1 shot per 4 rounds', 4], ['one shot per 4 rounds', 4], ['1 shot/4 rounds', 4], ['one per four rounds', 4],
        ['reload 4 rounds', 4], ['1/3 rounds', 3], ['1/4 rounds to reload', 4], ['3 rounds to reload', 3], ['reload their flintlocks in **2 rounds**', 2],
        ['(1/3, slow reload)', 3], ['1/4 rnds', 4], ['1 round to reload', null], ['slow reload', null]]) assert.equal(r(t).reload, n, t);
      assert.deepEqual([r('misfire 5%').malfunction, r('malf 95').malfunction, r('95 malf').malfunction], [96, 95, 95]);
    });
    it('a make that is also a name: a possessive is a melee weapon; Baker is no make (Task 19 fix round 2)', () => {
      for (const name of ['Baker\'s knife', 'Thompson\'s cleaver', 'Colt\'s cane', 'Remington\'s poker', 'Winchester\'s club', 'Springfield\'s axe']) {
        const n = readNumbers(`- ${name} 40% (20/8), damage 1D6`);
        assert.deepEqual([n.firearms, n.fighting], [null, 40], name);
      }
      assert.equal(readNumbers('- Thompson 40% (20/8), damage 1D10+2').firearms, 40);
    });
    it('Regency guns that do not say read impales false; the same blocks in plain CoC read null; a line that says impales wins (fix round 3)', () => {
      const { buildIndex } = require('../lib/run-sheet/notes');
      const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'coc-guns-'));
      try {
        fs.mkdirSync(path.join(tmp, 'Characters', 'NPCs'), { recursive: true });
        // made-up officers, written as Ord's and Dunmore's blocks are
        const block = (gun) => `---\nname: Officer\ntype: npc\n---\n\n## GM Notes\n\n### Stats\n\n**HP** 12 · **DEX** 60\n\n**Combat**\n- Brawl 50% (25/10), damage 1D3+1D4\n- ${gun}\n- Dodge 25% (12/5)\n`;
        fs.writeFileSync(path.join(tmp, 'Characters/NPCs/Officer A.md'), block('Firearms (Pistol) 45% (22/9), damage 1D6+1'));
        fs.writeFileSync(path.join(tmp, 'Characters/NPCs/Officer B.md'), block('Firearms (Handgun) 40% (20/8), damage 1D10'));
        fs.writeFileSync(path.join(tmp, 'Characters/NPCs/Officer C.md'), block('Firearms (Pistol) 45% (22/9), damage 1D6+1, impales'));
        const index = buildIndex(tmp);
        const imp = (id, who) => systemFor(id).readFoe({ notePath: `Characters/NPCs/${who}.md`, index, text: undefined }).nums.guns.map((g) => g.impales);
        assert.deepEqual(['Officer A', 'Officer B', 'Officer C'].map((w) => imp('coc-7e-regency', w)), [[false], [false], [true]]);
        assert.deepEqual(['Officer A', 'Officer B', 'Officer C'].map((w) => imp('coc-7e', w)), [[null], [null], [true]]);
        // a PC's sheet the same way
        const sheet = fs.readFileSync(path.join(dir, 'Characters/PCs/Iris Calder.md'), 'utf8').replace(/\r\n/g, '\n').replace(/^---[\s\S]*?\n---\n/, '');
        const body = `${sheet}\n## Combat\n\n| Weapon | Skill % | Damage | Attacks | Range | Ammo | Malf |\n|---|---|---|---|---|---|---|\n| Pistol | 50 | 1D6+1 | 1 | 10 yds | 1 | 95 |\n`;
        assert.deepEqual([systemFor('coc-7e-regency').readPc({ body, fm: { name: 'Iris Calder' } }).numbers.guns[0].impales,
          systemFor('coc-7e').readPc({ body, fm: { name: 'Iris Calder' } }).numbers.guns[0].impales], [false, null]);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
    it('malfunction 00 is 100; a number outside 1-100 is none (Task 19)', () => {
      const g = (t) => readNumbers(`- Flintlock pistol 30%, damage 1D6, ${t}`).guns[0].malfunction;
      assert.deepEqual([g('malf 00'), g('malfunction 100'), g('malfunction 150'), g('malf. 95')], [100, 100, null, 95]);
    });
    it('a PC sheet\'s Combat table gives its guns (Task 19)', () => {
      const { coc } = require('../lib/run-sheet/systems/coc');
      // Iris's fixture sheet with a Combat table added
      const sheet = fs.readFileSync(path.join(dir, 'Characters/PCs/Iris Calder.md'), 'utf8').replace(/\r\n/g, '\n');
      const fm = { name: 'Iris Calder' };
      const body = `${sheet.replace(/^---[\s\S]*?\n---\n/, '')}\n## Combat\n\n${['| Weapon | Skill % | Damage | Attacks | Range | Ammo | Malf |', '|---|---|---|---|---|---|---|',
        '| Unarmed | 25 | 1D3+DB | 1 | — | — | — |', '| Pistol (Double-Barreled), Flintlock | Firearms (Pistol) 45 | 1D6+1 | 1/4 | 10 yds | 2 | 90 |',
        '| Old revolver | Firearms (Handgun) 40 | 1D8 | 1 | 15 yds | 6 | 00 |', '| Rusty rifle | Firearms (Rifle) 35 | 2D6 | 1 | 90 yds | 5 | 120 |',
        '| Long musket | 55/27/11 | 1d10+4 | 3 rounds to reload | 100 yds | 1 | 95+ |'].join('\n')}\n`.replace(/\n/g, '\r\n');
      const out = coc.readPc({ body, fm });
      assert.equal(out.note, undefined, 'read by the sheet reader');
      assert.deepEqual(out.numbers.guns, [{ name: 'Pistol (Double-Barreled), Flintlock', skill: 45, damage: '1D6+1', malfunction: 90, reload: 4, impales: false },
        { name: 'Old revolver', skill: 40, damage: '1D8', malfunction: 100, reload: null, impales: null },
        { name: 'Rusty rifle', skill: 35, damage: '2D6', malfunction: null, reload: null, impales: null },
        { name: 'Long musket', skill: 55, damage: '1D10+4', malfunction: 95, reload: 3, impales: false }]);
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

// Task 32: Canticle-shaped NPC notes give their combat figures. Each fixture copies a real note's shape in made-up words.
for (const crlf of [false, true]) {
  describe(`CoC foe reader: Canticle shapes (Task 32)${crlf ? ' (CRLF checkout)' : ''}`, () => {
    const dir = copyFixture('run-sheet-coc-shapes', { crlf });
    const foe = (note) => read(dir, note, 'coc-7e-regency');
    it('a sibling ## Skills list gives Fighting, Firearms and Dodge; a prose section and an "Attack" story heading do not', () => {
      const r = foe('Sergeant Brask');
      assert.equal(r.statsHeading, 'Statistics');
      assert.deepEqual([r.nums.hp, r.nums.dex, r.nums.db], [12, 55, '+1D4']);
      assert.deepEqual([r.nums.fighting, r.nums.firearms, r.nums.dodge], [50, 70, 30]);
      assert.deepEqual(r.nums.guns, [{ name: 'Firearms (Rifle/Musket)', skill: 70, damage: null, malfunction: null, reload: null, impales: false }]);
    });
    it('a Combat Skills table takes its Skill column, not Base; a Weapons table gives the attacks and the gun, malfunction last', () => {
      const r = foe('Lieutenant Corve');
      assert.equal(r.statsHeading, 'Attributes');
      assert.deepEqual([r.nums.hp, r.nums.mp, r.nums.dex], [12, 10, 65]);
      // Brawl 55 (not its base 25), the Cutlass 60 the highest; a dash in the Skill column reads as nothing
      assert.deepEqual([r.nums.fighting, r.nums.firearms, r.nums.dodge, r.nums.db], [60, 45, 35, '+1D4']);
      assert.deepEqual(r.nums.guns, [{ name: 'Flintlock Pistol', skill: 45, damage: '1D6+1', malfunction: 95, reload: 4, impales: false }]);
      assert.deepEqual(r.lacks, []);
    });
    it('### Attacks per Round: 3 gives Attacks 3, and its attack table gives Fighting', () => {
      const r = foe('Creatures/Fen Stalker.md');
      assert.deepEqual([r.nums.attacks, r.nums.fighting, r.nums.firearms, r.nums.guns], [3, 45, null, null]);
      assert.deepEqual([r.nums.hp, r.nums.mp, r.nums.dex, r.nums.db, r.nums.build], [13, 7, 75, '+1D6', 2]);
    });
    it('bold pairs with only spaces between give every characteristic, and a sibling Combat Skills list its figures', () => {
      const r = foe('Madame Ostrel');
      const n = r.nums;
      assert.deepEqual([n.str, n.con, n.siz, n.dex, n.int, n.pow, n.hp, n.mp, n.san, n.luck, n.build],
        [50, 55, 50, 70, 65, 60, 10, 12, 60, 55, 0]);
      assert.deepEqual([n.fighting, n.firearms, n.dodge], [70, 40, 45]);
      assert.deepEqual(n.guns, [{ name: 'Pistol (flintlock)', skill: 40, damage: '1D10', malfunction: null, reload: 4, impales: false }]);
      assert.deepEqual(r.lacks, []);
    });
    it('the stat block\'s own figures win over a sibling section\'s', () => {
      const tmp = path.join(path.dirname(dir), 'own-first');
      fs.mkdirSync(path.join(tmp, 'Characters', 'NPCs'), { recursive: true });
      try {
        fs.writeFileSync(path.join(tmp, 'Characters/NPCs/Ferry Clerk.md'),
          '---\nname: Ferry Clerk\ntype: npc\n---\n\n## Stats\n\n**HP** 9 · **DEX** 40\n- Fighting (Brawl) 30%\n- Dodge 20%\n\n## Skills\n\n- Fighting (Brawl) 60%\n- Dodge 50%\n- Firearms (Handgun) 35%\n'.replace(/\n/g, crlf ? '\r\n' : '\n'));
        const n = systemFor('coc-7e').readFoe({ notePath: 'Characters/NPCs/Ferry Clerk.md', index: buildIndex(tmp), text: undefined }).nums;
        assert.deepEqual([n.fighting, n.dodge, n.firearms], [30, 20, 35]);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
  });
}

describe('CoC block shapes one line at a time (Task 32)', () => {
  it('bold pairs: a key inside or outside the bold, a dash, words after a figure', () => {
    const n = readNumbers('**STR** 45 **DEX** 60\n**HP:** 11 **SAN:** 0 (barely holding on) **Luck:** —');
    assert.deepEqual([n.str, n.dex, n.hp, n.san, n.luck], [45, 60, 11, 0, null]);
  });
  it('a line of bold words that are not all CoC keys is left as it was', () => {
    const n = readNumbers('**HP** 10\n**Note** 3 **DEX** 50');
    assert.equal(n.dex, null);
  });
  it('a heading that is a key and a number is read; a story heading is not', () => {
    assert.equal(readNumbers('#### Attacks per round: 2\n| Bite | 40% | 1D4 |').attacks, 2);
    assert.equal(readNumbers('### The Attack: 3 Nights Later').attacks, null);
  });
  it('a table with no Skill column is read as before; a skill cell that is no number is nothing, never a throw', () => {
    assert.deepEqual([readNumbers('| Stat | Value |\n|---|---|\n| Dodge | 25 |').dodge, readNumbers('| Skill | % |\n|---|---|\n| Dodge | 25% |').dodge], [25, 25]);
    const n = readNumbers('| Weapon | Skill | Damage | Malf |\n|---|---|---|---|\n| Club | n/a | 1D6 | — |\n| Musket | 50% | 1D10+4 | 9x |');
    assert.deepEqual([n.fighting, n.firearms, n.guns], [null, 50, [{ name: 'Musket', skill: 50, damage: '1D10+4', malfunction: null, reload: null, impales: false }]]);
  });
  it('a weapon table whose Skill cell names the skill, and a reload in its Notes', () => {
    const n = readNumbers('| Weapon | Skill | Damage | Range | Notes |\n|---|---|---|---|---|\n| Sabre | Fighting (Sword) 65% | 1d8+DB | Touch | Impales on Extreme |\n| Flintlock Pistol | Firearms (Pistol) 50% | 1d6+1 | 10 yds | 1/4 rounds to reload |\n| Hatchet | DEX ÷ 2 | 1d6 | Touch | — |');
    assert.deepEqual([n.fighting, n.firearms], [65, 50]);
    assert.deepEqual(n.guns, [{ name: 'Flintlock Pistol', skill: 50, damage: '1D6+1', malfunction: null, reload: 4, impales: false }]);
  });
});
