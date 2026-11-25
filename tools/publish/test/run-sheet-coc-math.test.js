'use strict';
// CoC's run-sheet arithmetic (step 6b Task 16): web/coc-math.js, the one copy the reader, fight-math, the reducer
// and the page share. Made-up rows only.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../lib/run-sheet/web/coc-math');
const FM = require('../lib/run-sheet/web/fight-math');
const { systemFor } = require('../lib/run-sheet/systems');

const COC = systemFor('coc-7e').describe().fight.coc;
const LEVELS = ['critical', 'extreme', 'hard', 'regular', 'fail', 'fumble'];
const RANK = { critical: 4, extreme: 3, hard: 2, regular: 1, fail: 0, fumble: 0 };

describe('coc-math: opposed melee', () => {
  for (const response of ['dodge', 'fightBack']) {
    for (const a of LEVELS) {
      for (const d of LEVELS) {
        const ra = RANK[a];
        const rd = RANK[d];
        const want = !ra && !rd ? null : ra > rd ? 'attacker' : rd > ra ? 'defender' : response === 'dodge' ? 'defender' : 'attacker';
        it(`${response}: attack ${a}, defence ${d} -> ${want || 'nobody'}`, () => {
          const out = C.opposedMelee(a, d, response, COC);
          assert.equal(out.winner, want);
          assert.equal(out.tie, Boolean(ra && ra === rd));
        });
      }
    }
  }
  it('dodge, regular against regular -> the defender, a tie, nobody hits', () => {
    assert.deepEqual(C.opposedMelee('regular', 'regular', 'dodge', COC), { winner: 'defender', tie: true, hits: null });
  });
  it('fightBack, regular against regular -> the attacker, a tie, the attacker hits', () => {
    assert.deepEqual(C.opposedMelee('regular', 'regular', 'fightBack', COC), { winner: 'attacker', tie: true, hits: 'attacker' });
  });
  it('Fight Back won by the defender opens its damage', () => {
    assert.deepEqual(C.opposedMelee('regular', 'hard', 'fightBack', COC), { winner: 'defender', tie: false, hits: 'defender' });
    assert.deepEqual(C.opposedMelee('regular', 'hard', 'dodge', COC), { winner: 'defender', tie: false, hits: null });
  });
  it('both fail: nothing', () => {
    for (const [a, d] of [['fail', 'fail'], ['fumble', 'fail'], ['fail', 'fumble'], ['fumble', 'fumble']]) {
      assert.deepEqual(C.opposedMelee(a, d, 'fightBack', COC), { winner: null, tie: false, hits: null });
      assert.deepEqual(C.opposedMelee(a, d, 'dodge', COC), { winner: null, tie: false, hits: null });
    }
  });
  it('a level or response that is not one -> null', () => {
    assert.equal(C.opposedMelee('great', 'hard', 'dodge', COC), null);
    assert.equal(C.opposedMelee('hard', 'hard', 'parry', COC), null);
  });
});

describe('coc-math: outnumbered and Prone dice', () => {
  const row = (o) => FM.blankRow({ id: 'r1', name: 'Dock Cultist', ...o });
  it('outnumbered: the second defence in a round puts +1 bonus die on, by default', () => {
    assert.deepEqual(C.attackDice(row({ meleeDefences: 0 }), COC), { net: 0, why: [] });
    assert.deepEqual(C.attackDice(row({ meleeDefences: 1 }), COC), { net: 1, why: ['outnumbered'] });
    assert.equal(C.rowNotes(row({ meleeDefences: 1 }), COC).outnumbered, 'defended 1× → next attack +1 bonus die');
  });
  it('outnumbered off for the row -> no die, and its note says off', () => {
    assert.deepEqual(C.attackDice(row({ meleeDefences: 2, outnumberedOff: true }), COC), { net: 0, why: [] });
    assert.equal(C.rowNotes(row({ meleeDefences: 2, outnumberedOff: true }), COC).outnumbered, 'defended 2× · outnumbered off');
  });
  it('a two-attack creature defends twice first', () => {
    assert.deepEqual(C.attackDice(row({ attacks: 2, meleeDefences: 1 }), COC).net, 0);
    assert.equal(C.rowNotes(row({ attacks: 2, meleeDefences: 1 }), COC).outnumbered, 'defended 1× of 2');
    assert.deepEqual(C.attackDice(row({ attacks: 2, meleeDefences: 2 }), COC), { net: 1, why: ['outnumbered'] });
  });
  it('attacks blank, 0 or not a number -> 1', () => {
    for (const attacks of [null, 0, 'two', undefined]) assert.equal(C.limitOf(row({ attacks })), 1);
  });
  it('a Prone row\'s next melee attacker gets +1 bonus die', () => {
    assert.deepEqual(C.attackDice(row({ conds: ['Prone'] }), COC), { net: 1, why: ['prone'] });
    assert.equal(C.rowNotes(row({ conds: ['Prone'] }), COC).prone, 'prone → melee +1 bonus die');
    assert.deepEqual(C.attackDice(row({ conds: ['Prone'], meleeDefences: 1 }), COC), { net: 2, why: ['outnumbered', 'prone'] });
  });
  it('a shot does not add to defended', () => {
    assert.equal(C.defenceAfter(row({ meleeDefences: 0 }), 'firearm'), 0);
    assert.equal(C.defenceAfter(row({ meleeDefences: 0 }), 'dive'), 0);
    assert.equal(C.defenceAfter(row({ meleeDefences: 1 }), 'melee'), 2);
  });
  it('a shot at a row that has defended gets no outnumbered die', () => {
    assert.deepEqual(C.attackDice(row({ meleeDefences: 3 }), COC, 'firearm'), { net: 0, why: [] });
  });
  it('the dice cap at 2 each way, and cancel', () => {
    assert.deepEqual(C.diceOfNet(3, COC), { bonus: 2, penalty: 0 });
    assert.deepEqual(C.diceOfNet(-5, COC), { bonus: 0, penalty: 2 });
    assert.deepEqual(C.diceOfNet(0, COC), { bonus: 0, penalty: 0 });
    assert.equal(C.diceIn({ bonus: 1, penalty: 1 }, COC), null);
    assert.equal(C.diceIn({ bonus: 3, penalty: 0 }, COC), null);
    assert.deepEqual(C.diceIn({ bonus: 0, penalty: 2 }, COC), { bonus: 0, penalty: 2 });
  });
});

describe('coc-math: the result line and the sides', () => {
  it('the result line names the dice given', () => {
    const out = C.opposedMelee('regular', 'regular', 'fightBack', COC);
    const line = C.meleeLine({ attacker: 'Iris Calder', defender: 'Dock Cultist 2' }, 'fightBack', { net: 1, why: ['outnumbered'] },
      { level: 'regular', kept: null }, { level: 'regular', kept: 31 }, out);
    assert.equal(line, 'Iris Calder, +1 bonus die (outnumbered): Regular; Dock Cultist 2 Fights Back: Regular (31): a tie: Iris Calder hits Dock Cultist 2.');
  });
  it('dice set by hand, a penalty die, a dodge and both failing', () => {
    const n = { attacker: 'Dock Cultist 1', defender: 'Iris Calder' };
    assert.equal(C.meleeLine(n, 'dodge', { net: -1, why: [], byHand: true }, { level: 'hard', kept: 12 }, { level: 'extreme', kept: null }, C.opposedMelee('hard', 'extreme', 'dodge', COC)),
      'Dock Cultist 1, −1 penalty die (set by hand): Hard (12); Iris Calder Dodges: Extreme: Iris Calder dodges.');
    assert.equal(C.meleeLine(n, 'fightBack', { net: 0, why: [] }, { level: 'fail', kept: 77 }, { level: 'fumble', kept: null }, C.opposedMelee('fail', 'fumble', 'fightBack', COC)),
      'Dock Cultist 1: Fail (77); Iris Calder Fights Back: Fumble: both fail: nothing happens.');
    assert.equal(C.meleeLine(n, 'fightBack', { net: 2, why: ['outnumbered', 'prone'] }, { level: 'regular', kept: 40 }, { level: 'hard', kept: null }, C.opposedMelee('regular', 'hard', 'fightBack', COC)),
      'Dock Cultist 1, +2 bonus dice (outnumbered, prone): Regular (40); Iris Calder Fights Back: Hard: Iris Calder hits Dock Cultist 1.');
  });
  it('a PC side is never rolled: its level is a tap', () => {
    const pc = { kind: 'pc' };
    const none = { bonus: 0, penalty: 0 };
    assert.deepEqual(C.sideIn(pc, { level: 'hard' }, null, none), { level: 'hard', kept: null });
    assert.equal(C.sideIn(pc, { level: 'hard', kept: 20, target: 50 }, 50, none), null);
    assert.equal(C.sideIn(pc, { level: 'great' }, null, none), null);
  });
  it('an NPC side is the server\'s roll against its skill with the dice asked, never a tap', () => {
    const npc = { kind: 'foe' };
    const roll = { tens: [10, 30], units: 8, kept: 18, target: 40, difficulty: 'regular', level: 'hard', asked: { bonus: 1, penalty: 0 }, bonus: 1, penalty: 0 };
    assert.deepEqual(C.sideIn(npc, roll, 40, { bonus: 1, penalty: 0 }), { level: 'hard', kept: 18 });
    assert.equal(C.sideIn(npc, { level: 'hard' }, 40, { bonus: 0, penalty: 0 }), null, 'a tap');
    assert.equal(C.sideIn(npc, roll, 45, { bonus: 1, penalty: 0 }), null, 'the skill moved');
    assert.equal(C.sideIn(npc, roll, 40, { bonus: 0, penalty: 0 }), null, 'other dice');
  });
  it('the figure a side rolls: Fighting to attack or fight back, Dodge to dodge', () => {
    const r = { fighting: { Brawl: 40, Knife: 55 }, dodge: 20 };
    assert.equal(C.skillOf(r, 'attack'), 55);
    assert.equal(C.skillOf(r, 'fightBack'), 55);
    assert.equal(C.skillOf(r, 'dodge'), 20);
    assert.equal(C.skillOf({}, 'dodge'), null);
  });
});

describe('coc-math: the combat skill (Task 6 tie figure)', () => {
  it('combatOf takes the highest PC specialisation and counts a typed figure', () => {
    assert.equal(C.combatOf({ fighting: { Brawl: 40, Sword: 65 }, firearms: [30, 50] }), 65);
    assert.equal(C.combatOf({ fighting: 40, firearms: null }), 40);
    // a figure typed in the panel replaces the sheet's on the row; read again, it counts
    assert.equal(C.combatOf({ fighting: 70, firearms: [30, 50] }), 70);
    assert.equal(C.combatOf({ combat: 33 }), 33);
    assert.equal(C.combatOf({}), null);
  });
  it('fight-math uses the one copy', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'fight-math.js'), 'utf8');
    assert.doesNotMatch(src, /function combatOf/);
    assert.doesNotMatch(src, /const topOf/);
  });
});

describe('coc-math: the file', () => {
  const FILE = path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'coc-math.js');
  const src = fs.readFileSync(FILE, 'utf8');
  it('no DOM, no fetch, no require', () => {
    assert.doesNotMatch(src, /\bdocument\b|\bfetch\(|\brequire\(/);
  });
  it('the page loads it before fight-math.js', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'gm.html'), 'utf8');
    const a = html.indexOf('/web/coc-math.js');
    assert.ok(a > 0 && a < html.indexOf('/web/fight-math.js'));
  });
  it('the Regency id carries the same coc rules', () => {
    // but for Regency's guns that do not say, which never impale (Task 19 fix round 3, on purpose)
    const reg = systemFor('coc-7e-regency').describe().fight.coc;
    // and Task 34: Regency's guns with no malfunction figure take the book's (RC p187)
    assert.deepEqual({ ...reg, firearm: { ...reg.firearm, unknownImpales: undefined, unknownMalfunction: undefined } }, { ...COC, firearm: { ...COC.firearm, unknownImpales: undefined, unknownMalfunction: undefined } });
    assert.deepEqual(systemFor('coc-7e').describe().coc, COC);
  });
});

describe('coc-math: damage (Task 17)', () => {
  const { rollDamage, maxRoll, parseDamage } = require('../lib/dice');
  const RULES = systemFor('coc-7e').describe().fight;
  const entry = (t) => FM.parseEntry(t, RULES);
  // the server's roll of the notation, its dice injected in order
  const rolled = (notation, ...faces) => { let i = 0; return rollDamage(notation, { floor: 0, randomInt: () => faces[i++] }); };
  const cultist = { db: '+1D4', armour: 1 };
  const iris = { db: 0, armour: null };

  it('1D6+DB with DB +1D4 and armour 1, injected dice 4 and 2 -> 5, "1D6+1D4 = 4+2 = 6 − armour 1 = 5"', () => {
    const e = entry('1D6+DB');
    const spec = C.damageRoll(e, cultist, 'full');
    assert.deepEqual(spec, { notation: '1D6+1D4', weapon: '1D6', db: '+1D4' });
    const out = C.cocDamage(e, cultist, cultist, { mode: 'full', roll: rolled(spec.notation, 4, 2) });
    assert.deepEqual(out, { total: 6, armour: 1, damage: 5, line: '1D6+1D4 = 4+2 = 6 − armour 1 = 5', notation: '1D6+1D4' });
  });
  it('DB -2 with 1D3, a 1 rolled -> 0, "1D3-2 = 1−2 = 0"', () => {
    const e = entry('1D3+DB');
    const A = { db: -2 };
    const spec = C.damageRoll(e, A, 'full');
    assert.equal(spec.notation, '1D3-2');
    const out = C.cocDamage(e, A, iris, { roll: rolled(spec.notation, 1) });
    assert.deepEqual([out.damage, out.line], [0, '1D3-2 = 1−2 = 0']);
  });
  it('half DB: +1D4 -> +1D2, +2D6 -> +1D6, +1D6 -> +1D3, -2 -> -1, -1 -> none; none adds none', () => {
    const e = entry('1D6+DB');
    assert.equal(C.damageRoll(e, { db: '+1D4' }, 'half').notation, '1D6+1D2');
    assert.equal(C.damageRoll(e, { db: '+2D6' }, 'half').notation, '1D6+1D6');
    assert.equal(C.damageRoll(e, { db: '+1D6' }, 'half').notation, '1D6+1D3');
    assert.equal(C.damageRoll(e, { db: -2 }, 'half').notation, '1D6-1');
    assert.equal(C.damageRoll(e, { db: '-1' }, 'half').notation, '1D6');
    assert.equal(C.damageRoll(e, { db: '+2D6' }, 'none').notation, '1D6');
  });
  it('an exchange\'s kind sets the DB: melee full, thrown half, shot none', () => {
    assert.deepEqual(['melee', 'thrown', 'shot', undefined].map(C.dbModeOf), ['full', 'half', 'none', 'full']);
  });
  it('a DB read as a term: +1D4, 1D4, -1, 0, none, a dash, no figure; words -> null', () => {
    assert.deepEqual(['+1D4', '1d4', ' +2D6 ', -1, '-1', '−1', 2, 0, '0', 'none', '—', null, undefined].map(C.dbTerm),
      ['+1D4', '+1D4', '+2D6', '-1', '-1', '-1', '+2', '', '', '', '', '', '']);
    assert.equal(C.dbTerm('big'), null);
    assert.equal(C.dbTerm('1D4+1'), null);
  });
  it('DB with no attacker, or a DB in words -> an error the page says; dice with no DB need no attacker', () => {
    assert.deepEqual(C.damageRoll(entry('1D6+DB'), null), { error: 'attacker' });
    assert.deepEqual(C.damageRoll(entry('1D6+DB'), { db: 'big' }), { error: 'db', db: 'big' });
    assert.deepEqual(C.damageRoll(entry('1D8+1'), null), { notation: '1D8+1', weapon: '1D8+1', db: '' });
  });
  it('armour 3 against a 2 rolled -> 0', () => {
    const e = entry('1D3');
    const out = C.cocDamage(e, null, { armour: 3 }, { roll: rolled('1D3', 2) });
    assert.deepEqual([out.total, out.damage, out.line], [2, 0, '1D3 = 2 − armour 3 = 0']);
  });
  it('a bare 7 in a box an exchange opened, against armour 1 -> 6, "7 − armour 1 = 6"', () => {
    const out = C.cocDamage(entry('7'), cultist, cultist, { asRolled: true });
    assert.deepEqual([out.damage, out.line], [6, '7 − armour 1 = 6']);
  });
  it('a bare 6 typed cold -> null (the reducer takes it raw)', () => {
    assert.equal(C.cocDamage(entry('6'), null, cultist, {}), null);
  });
  it('a roll of other dice (the DB changed while they were out), a sum that does not hold, or a max roll for a plain hit -> null', () => {
    const e = entry('1D6+DB');
    assert.equal(C.cocDamage(e, { db: '+1D6', armour: 0 }, iris, { roll: rolled('1D6+1D4', 4, 2) }), null);
    assert.equal(C.cocDamage(e, cultist, iris, { roll: { ...rolled('1D6+1D4', 4, 2), total: 9 } }), null);
    assert.equal(C.cocDamage(e, cultist, iris, { roll: maxRoll('1D6+1D4', { floor: 0 }) }), null);
  });
  it('Extreme on the attacker\'s turn offers; max damage and max DB; with impaling on, one more weapon roll', () => {
    assert.equal(C.extremeOffer({ side: 'attacker', onTurn: true, level: 'extreme' }), true);
    assert.equal(C.extremeOffer({ side: 'attacker', onTurn: true, level: 'critical' }), true);
    assert.equal(C.extremeOffer({ side: 'attacker', onTurn: true, level: 'hard' }), false);
    assert.equal(C.extremeOffer({ side: 'attacker', onTurn: false, level: 'extreme' }), false, 'not its turn');
    const e = entry('1D6+DB');
    const max = maxRoll('1D6+1D4', { floor: 0 });
    let out = C.cocDamage(e, cultist, cultist, { roll: max, extreme: true });
    assert.deepEqual([out.damage, out.line], [9, 'Extreme: 1D6+1D4 at max = 6+4 = 10 − armour 1 = 9']);
    out = C.cocDamage(e, cultist, cultist, { roll: max, extreme: true, extra: rolled('1D6', 3) });
    assert.deepEqual([out.damage, out.line], [12, 'Extreme, impaling: 1D6+1D4 at max = 6+4 = 10, +1D6 = 3: 13 − armour 1 = 12']);
    // a plain roll sent as the maximum is not one
    assert.equal(C.cocDamage(e, cultist, cultist, { roll: rolled('1D6+1D4', 6, 4), extreme: true }), null);
  });
  it('Extreme on a Fight Back offers nothing', () => {
    assert.equal(C.extremeOffer({ side: 'defender', onTurn: false, level: 'extreme' }), false);
    assert.equal(C.extremeOffer({ side: 'defender', onTurn: true, level: 'critical' }), false);
  });
  it('a very long shot\'s Extreme that is not 01 offers nothing; an 01 does', () => {
    assert.equal(C.extremeOffer({ side: 'attacker', onTurn: true, level: 'extreme', veryLong: true }), false);
    assert.equal(C.extremeOffer({ side: 'attacker', onTurn: true, level: 'critical', veryLong: true }), true);
  });
  it('every DB-substituted form is notation the server reads', () => {
    for (const t of ['1D8+DB', '1D6+DB+1', 'd6+DB', '1D3-1+DB', '2D6+DB', '1D4+DB-1', '1D10+DB']) {
      for (const db of ['+1D4', '1D6', '+2D6', '-1', -2, 0, 3, '+1D3', null, 'none']) {
        for (const mode of C.DB_MODES) {
          const spec = C.damageRoll(entry(t), { db }, mode);
          assert.doesNotThrow(() => parseDamage(spec.notation), `${t} with DB ${db}, ${mode}: ${spec.notation}`);
          assert.doesNotThrow(() => parseDamage(spec.weapon), `${t}: ${spec.weapon}`);
        }
      }
    }
  });
});

describe('coc-math: a hit\'s card and the SAN bout (Task 18)', () => {
  const RULES = systemFor('coc-7e').describe().fight;
  const GMath = require('../lib/run-sheet/web/gurps-math');
  const K = RULES.coc.cards;
  // a made-up row as a hit left it
  const after = (hp, max, more) => ({ id: 'r1', name: 'Vera Holm', kind: 'npc', in: true, out: false, conds: [], hp, max, ...more });
  const kinds = (out) => out.lines.map((l) => l.kind);
  const d100 = (kept, target, level) => ({ kept, target, level, difficulty: 'regular', asked: { bonus: 0, penalty: 0 } });

  it('the numbers are data with the system: 2 for the Major Wound, 5 for the INT roll, a 10-sided bout', () => {
    assert.deepEqual(RULES.prompts, { majorWoundAt: 2, insanityAt: 5 });
    assert.equal(K.bout.sides, 10);
    assert.deepEqual(systemFor('coc-7e-regency').describe().fight.prompts, RULES.prompts);
  });
  it('15 HP: a 7 brings no card, an 8 does', () => {
    assert.deepEqual(C.cocCardForHit(after(8, 15), { damage: 7, before: 15 }, RULES), { major: false, lines: [] });
    const out = C.cocCardForHit(after(7, 15), { damage: 8, before: 15 }, RULES);
    assert.equal(out.major, true);
    assert.deepEqual(kinds(out), ['major']);
    assert.equal(out.lines[0].stat, 'con');
  });
  it('17 on 16 -> dead; 16 on 16 -> dying; 2 to 0 with the box -> dying; 2 to 0 without -> unconscious; 8 on 16 -> major', () => {
    assert.deepEqual(kinds(C.cocCardForHit(after(0, 16), { damage: 17, before: 16 }, RULES)), ['dead']);
    // exactly max HP is no death: a Major Wound, and Dying at 0
    let out = C.cocCardForHit(after(0, 16), { damage: 16, before: 16 }, RULES);
    assert.deepEqual([out.major, kinds(out)], [true, ['dying']]);
    out = C.cocCardForHit(after(0, 16, { majorWound: true }), { damage: 2, before: 2 }, RULES);
    assert.deepEqual([out.major, kinds(out)], [false, ['dying']]);
    assert.deepEqual(kinds(C.cocCardForHit(after(0, 16), { damage: 2, before: 2 }, RULES)), ['unconscious']);
    assert.deepEqual(kinds(C.cocCardForHit(after(8, 16), { damage: 8, before: 16 }, RULES)), ['major']);
  });
  it('9 on a row at 0 -> nothing; 20 on a row at 0 -> dead', () => {
    assert.deepEqual(C.cocCardForHit(after(0, 16, { majorWound: true }), { damage: 9, before: 0 }, RULES), { major: false, lines: [] });
    assert.deepEqual(kinds(C.cocCardForHit(after(0, 16), { damage: 20, before: 0 }, RULES)), ['dead']);
  });
  it('no max HP, no damage, or D&D\'s rules -> nothing', () => {
    assert.deepEqual(kinds(C.cocCardForHit(after(3, null), { damage: 9, before: 12 }, RULES)), []);
    assert.deepEqual(kinds(C.cocCardForHit(after(3, 16), { damage: 0, before: 3 }, RULES)), []);
    assert.deepEqual(kinds(C.cocCardForHit(after(3, 16), { damage: 9, before: 12 }, FM.rulesOf(null))), []);
  });
  it('offers set at once on the lines with no roll, and gurps-math\'s nextLine passes them', () => {
    for (const [dmg, hp, offer] of [[17, 0, 'dead'], [16, 0, 'dying'], [2, 0, 'unconscious']]) {
      const out = C.cocCardForHit(after(hp, 16), { damage: dmg, before: dmg === 2 ? 2 : 16 }, RULES);
      assert.deepEqual(out.lines[0].offers, [offer]);
      assert.equal(GMath.nextLine({ lines: out.lines }, K), -1);
    }
    const major = C.cocCardForHit(after(8, 16), { damage: 8, before: 16 }, RULES);
    assert.equal(GMath.nextLine({ lines: major.lines }, K), 0);
  });
  it('Dying set in round 3: no reminder at the end of round 3; reminders at the ends of rounds 4 and 5', () => {
    const rows = [after(0, 16, { conds: ['Dying', 'Unconscious'], dyingRound: 3 }), after(5, 16, { id: 'r2' })];
    assert.deepEqual(C.cocCardsAtRoundEnd(rows, 3, RULES), []);
    for (const round of [4, 5]) {
      const got = C.cocCardsAtRoundEnd(rows, round, RULES);
      assert.equal(got.length, 1);
      assert.equal(got[0].row, 'r1');
      assert.deepEqual([got[0].card.kind, got[0].card.lines.map((l) => [l.kind, l.stat]), got[0].card.standing], ['dying', [['dyingCon', 'con']], ['stabilised']]);
    }
    assert.deepEqual(C.cocCardsAtRoundEnd([{ ...rows[0], out: true }], 5, RULES), [], 'an Out row owes nothing');
  });
  it('s-6: the INT card; s-4: nothing', () => {
    const c = C.sanCard(after(5, 16), 6, RULES);
    assert.deepEqual([c.kind, c.lines.map((l) => [l.kind, l.stat]), c.what], ['int', [['int', 'int']], 'SAN −6']);
    assert.equal(C.sanCard(after(5, 16), 4, RULES), null);
    assert.ok(C.sanCard(after(5, 16), 5, RULES));
  });
  it('a roll: an NPC\'s is the server\'s d100 at Regular with no dice; a PC\'s is a tap, never a roll', () => {
    const npc = after(8, 16);
    const pc = after(8, 16, { kind: 'pc' });
    assert.deepEqual(C.rollResult(d100(34, 55, 'regular'), npc), { kept: 34, target: 55, level: 'regular', passed: true });
    assert.equal(C.rollResult(d100(78, 55, 'fail'), npc).passed, false);
    assert.equal(C.rollResult(d100(99, 55, 'fumble'), npc).passed, false);
    assert.equal(C.rollResult({ ...d100(34, 55, 'regular'), difficulty: 'hard' }, npc), null);
    assert.equal(C.rollResult({ ...d100(34, 55, 'regular'), asked: { bonus: 1, penalty: 0 } }, npc), null);
    assert.equal(C.rollResult({ tap: 'passed' }, npc), null);
    // PRENTICE review M2: a card's line takes an NPC's tap (a foe made up at the table has no CON to roll against)
    assert.deepEqual(C.rollResult({ tap: 'passed' }, npc, true), { tapped: true, passed: true });
    assert.deepEqual(C.rollResult({ tap: 'failed' }, pc), { tapped: true, passed: false });
    assert.equal(C.rollResult(d100(34, 55, 'regular'), pc), null);
  });
  it('major: pass -> prone, fail -> proneOut; dyingCon: pass -> none, fail -> dead; int: pass -> insane, fail -> none', () => {
    const ok = { passed: true };
    const no = { passed: false };
    assert.deepEqual([C.offersFor({ kind: 'major' }, ok), C.offersFor({ kind: 'major' }, no)], [['prone'], ['proneOut']]);
    assert.deepEqual([C.offersFor({ kind: 'dyingCon' }, ok), C.offersFor({ kind: 'dyingCon' }, no)], [[], ['dead']]);
    assert.deepEqual([C.offersFor({ kind: 'int' }, ok), C.offersFor({ kind: 'int' }, no)], [['insane'], []]);
    assert.deepEqual(K.offers.proneOut.add, ['Prone', 'Unconscious']);
    assert.deepEqual(K.offers.dying.add, ['Dying', 'Unconscious', 'Prone']);
    assert.equal(K.offers.prone.tap, true);
  });
  it('the line\'s words are names and figures: "Major wound: CON 55", "SAN loss: INT ?", "Over max HP"', () => {
    const major = C.cocCardForHit(after(8, 16), { damage: 8, before: 16 }, RULES).lines[0];
    assert.equal(C.lineText(major, after(8, 16, { con: 55 }), K), 'Major wound: CON 55');
    assert.equal(C.lineText(major, after(8, 16, { con: 55 }), K, true), 'Major wound, CON 55');
    assert.equal(C.lineText(major, after(8, 16), K, true), 'Major wound', 'the log names no figure it lacks');
    assert.equal(C.lineText(C.sanCard(after(5, 16), 6, RULES).lines[0], after(5, 16), K), 'SAN loss: INT ?');
    assert.equal(C.lineText(C.cocCardForHit(after(0, 16), { damage: 17, before: 16 }, RULES).lines[0], after(0, 16), K), 'Over max HP');
    assert.equal(C.lineTarget(major, after(8, 16, { con: 55 })), 55);
    assert.equal(C.lineTarget(major, after(8, 16)), null);
    assert.deepEqual([C.resultText({ tapped: true, passed: true }), C.resultText({ kept: 34, level: 'hard' })], ['passed', 'rolled 34, Hard']);
  });
  it('the bout\'s rounds come from the server\'s d10; "bout: 7 rounds", "bout: 1 round"', () => {
    assert.equal(C.boutRoll({ sides: 10, mod: 0, die: 7, total: 7 }, RULES), 7);
    assert.equal(C.boutRoll({ sides: 6, mod: 0, die: 4, total: 4 }, RULES), null);
    assert.equal(C.boutRoll({ sides: 10, mod: 0, die: 11, total: 11 }, RULES), null);
    assert.equal(C.boutRoll(null, RULES), null);
    assert.deepEqual([C.boutText({ left: 7, of: 7 }), C.boutText({ left: 1, of: 7 }), C.boutText(null)], ['bout: 7 rounds', 'bout: 1 round', '']);
    assert.deepEqual([C.roundsText(1), C.roundsText(3)], ['1 round', '3 rounds']);
  });
  it('no card text quotes the book: names, figures and a page', () => {
    for (const v of Object.values(K.lines).concat(Object.values(K.offers).map((o) => o.label), Object.values(K.notes))) {
      assert.ok(v.length <= 30, `short: ${v}`);
    }
    assert.match(K.notes.int, /KR p\d+/);
  });
});

describe('coc-math: a shot\'s dice (Task 19)', () => {
  const { rollPercent } = require('../lib/dice');
  const shooter = { kind: 'npc', firearms: 55, conds: [] };
  const target = { kind: 'pc', conds: [] };
  const dice = (chips, a = shooter, d = target) => C.shotDice(chips, a, d, COC);
  const net = (chips, a, d) => dice(chips, a, d).net;
  // the server's d100 with its dice faces given: tens faces then the units face, as lib/dice draws them
  const faces = (...f) => { let i = 0; return () => f[i++]; };

  it('the chip numbers are data with the system, the same for Regency', () => {
    // fix round 3 on purpose: Regency's guns that do not say read as never impaling (RC p187); the rest is the same
    // Task 34 on purpose: and those with no malfunction figure take the book's, 95, a double-barrelled one 90 (RC p187)
    const { unknownImpales, unknownMalfunction, ...regency } = systemFor('coc-7e-regency').describe().fight.coc.firearm;
    assert.deepEqual([regency, unknownImpales, COC.firearm.unknownImpales], [COC.firearm, false, undefined]);
    assert.deepEqual([unknownMalfunction, COC.firearm.unknownMalfunction], [{ any: 95, doubleBarrel: 90 }, undefined]);
    assert.deepEqual(COC.firearm.ranges.map((r) => r.difficulty), ['regular', 'hard', 'extreme']);
    for (const c of COC.firearm.chips) assert.ok(c.label.length <= 22 && c.short.length <= 12, `a chip names a condition: ${c.label}, ${c.short}`);
  });
  it('each chip\'s die', () => {
    const want = { aim: 1, pointBlank: 1, large: 1, small: -1, cover: -1, fast: -1, intoMelee: -1, loading: -1, shots: -1, proneTarget: -1, proneShooter: 1, dive: -1 };
    for (const [k, n] of Object.entries(want)) assert.equal(net([k]), n, k);
    assert.equal(net([]), 0);
  });
  it('the range chips: regular, long, very long', () => {
    assert.deepEqual([dice([]).difficulty, dice(['long']).difficulty, dice(['veryLong']).difficulty], ['regular', 'hard', 'extreme']);
    assert.deepEqual(dice(['long', 'pointBlank']).why, ['long range', 'point blank']);
  });
  it('point blank and a small target cancel', () => {
    const d = dice(['pointBlank', 'small']);
    assert.deepEqual([d.net, d.asked, d.rolled], [0, { bonus: 0, penalty: 0 }, { bonus: 0, penalty: 0 }]);
  });
  it('several shots: shot 1 to 3', () => {
    for (let shot = 1; shot <= 3; shot++) assert.equal(net(['shots']), -1, `shot ${shot}`);
  });
  it('Prone: a target, a target at point blank, a shooter', () => {
    assert.equal(net(['proneTarget']), -1);
    assert.equal(net(['proneTarget', 'pointBlank']), 1, 'only the point blank die');
    assert.equal(net(['proneShooter']), 1);
    // the strip turns them on from the statuses
    assert.deepEqual(C.shotChipsFrom({ conds: ['Prone'] }, { conds: ['Prone'] }, 2, COC), ['proneTarget', 'proneShooter']);
  });
  it('the aimed chip: the round after the aim, the round of it, two rounds on', () => {
    assert.deepEqual(C.shotChipsFrom({ conds: [], aiming: { round: 1 } }, target, 2, COC), ['aim']);
    assert.deepEqual(C.shotChipsFrom({ conds: [], aiming: { round: 2 } }, target, 2, COC), []);
    assert.deepEqual(C.shotChipsFrom({ conds: [], aiming: { round: 1 } }, target, 3, COC), []);
  });
  it('size: Build 4, Build -2, a known Build and a size chip, no Build', () => {
    assert.equal(net([], shooter, { build: 4 }), 1);
    assert.equal(net([], shooter, { build: -2 }), -1);
    assert.equal(net(['large'], shooter, { build: 1 }), 0);
    assert.equal(net(['small'], shooter, {}), -1, 'no Build: the chip');
  });
  it('six penalty chips: two rolled, and the roll line says six were asked', () => {
    const d = dice(['small', 'cover', 'fast', 'intoMelee', 'loading', 'shots']);
    assert.deepEqual([d.net, d.asked, d.rolled, d.over], [-6, { bonus: 0, penalty: 6 }, { bonus: 0, penalty: 2 }, true]);
    assert.equal(C.shotDiceText(d), '−2 penalty dice (6 penalty dice asked: 2 rolled (KR p91))');
    // the server takes the six and rolls two, keeping what was asked
    const x = rollPercent({ target: 55, ...d.asked }, { randomInt: faces(1, 4, 7, 3) });
    assert.deepEqual([x.tens.length, x.asked, C.shotRoll(x, 55, d).kept], [3, { bonus: 0, penalty: 6 }, 73]);
  });
  it('a long shot at skill 55: Hard, and a 96 is a fumble', () => {
    const d = dice(['long']);
    const x = rollPercent({ target: 55, difficulty: d.difficulty, ...d.asked }, { randomInt: faces(9, 6) });
    const r = C.shotRoll(x, 55, d);
    assert.deepEqual([r.kept, r.level, r.needed], [96, 'fumble', 27]);
    assert.equal(C.shotHits(r.level, d.difficulty), false);
    // a Regular 40 misses at Hard; a Hard 20 hits
    assert.deepEqual([C.shotHits('regular', 'hard'), C.shotHits('hard', 'hard'), C.shotHits('regular', 'regular'), C.shotHits('fail', 'regular')], [false, true, true, false]);
  });
  it('a roll against another figure, difficulty or dice than the shot holds is not taken', () => {
    const d = dice(['long', 'pointBlank']);
    const x = rollPercent({ target: 55, difficulty: 'hard', bonus: 1 }, { randomInt: faces(3, 4, 3) });
    assert.ok(C.shotRoll(x, 55, d));
    assert.equal(C.shotRoll(x, 50, d), null);
    assert.equal(C.shotRoll({ ...x, difficulty: 'regular' }, 55, d), null);
    assert.equal(C.shotRoll(x, 55, dice(['long'])), null);
  });
  it('a kept 96 with malfunction 95 is flagged; 94 is not; with no number, 95 shows the hint', () => {
    // the one parser of a malfunction number: typed, else the gun's; 00 is 100; words are none
    const gun = { malfunction: 95 };
    assert.deepEqual([C.malfunctionOf('90', gun), C.malfunctionOf('', gun), C.malfunctionOf(null, null), C.malfunctionOf('00', gun), C.malfunctionOf('lots', gun), C.malfunctionOf('0', gun), C.malfunctionOf('101', gun), C.malfunctionOf(88, gun)],
      [90, 95, null, 100, undefined, undefined, undefined, 88]);
    assert.deepEqual([C.malNumber('00'), C.malNumber('100'), C.malNumber('150'), C.malNumber('0'), C.malNumber('x')], [100, 100, null, null, null]);
    assert.deepEqual([C.malfunctionFlag(96, 95, COC), C.malfunctionFlag(95, 95, COC), C.malfunctionFlag(94, 95, COC)], ['malfunction', 'malfunction', '']);
    assert.deepEqual([C.malfunctionFlag(95, null, COC), C.malfunctionFlag(94, null, COC)], ['check', '']);
    assert.equal(C.malfunctionFlag(90, 90, COC), 'malfunction', 'the double-barreled pistol');
  });
  it('the blunderbuss\'s damage box offers 2D6 and 1D6 as typed choices', () => {
    assert.deepEqual(C.damageChoices('2D6/1D6'), ['2D6', '1D6']);
    assert.deepEqual([C.damageChoices('1D6+1'), C.damageChoices(null)], [['1D6+1'], []]);
  });
  it('the shot\'s figure: the gun\'s own skill, else Firearms; who may shoot', () => {
    assert.equal(C.shotSkill({ firearms: 40 }, { skill: 30 }), 30);
    assert.equal(C.shotSkill({ firearms: { Handgun: 45, Rifle: 50 } }, null), 50);
    assert.deepEqual([C.canShoot({ kind: 'pc' }), C.canShoot({ kind: 'foe', firearms: 30 }), C.canShoot({ kind: 'foe', guns: [{ name: 'x' }] }), C.canShoot({ kind: 'foe' })], [true, true, true, false]);
  });
  it('the lines: a shot rolled, a PC\'s tapped, a malfunction; the dive; the marks', () => {
    const d = dice(['long', 'pointBlank']);
    const roll = { level: 'fail', kept: 33, tens: [30, 40], needed: 27 };
    assert.equal(C.shotLine({ shooter: 'Cultist 1', target: 'Cultist 2' }, { dice: d, skill: 55, roll, hit: false, flag: '' }),
      'Cultist 1 shoots Cultist 2 (long range, point blank), +1 bonus die: Firearms 55 at Hard (27): rolled 33 (tens 30, 40): Fail: a miss.');
    assert.equal(C.shotLine({ shooter: 'Iris', target: 'Cultist 2' }, { dice: dice([]), level: 'regular', hit: true, flag: '' }), 'Iris shoots Cultist 2: Regular needed: Regular: a hit.');
    assert.match(C.shotLine({ shooter: 'A', target: 'B' }, { dice: dice([]), skill: 30, roll: { level: 'fumble', kept: 97, tens: [90], needed: 30 }, hit: false, flag: 'malfunction', malfunction: 95 }), /: Fumble: malfunction \(95\)\.$/);
    assert.match(C.shotLine({ shooter: 'A', target: 'B' }, { dice: dice([]), skill: 30, roll: { level: 'fumble', kept: 97, tens: [90], needed: 30 }, hit: false, flag: 'check' }), /a miss; check malfunction \(KR p118\)\.$/);
    assert.equal(C.diveLine('Cultist 2', { kept: 15, level: 'hard', passed: true }, 1), 'Cultist 2 dives for cover: Dodge rolled 15, Hard: a penalty die on the shot; loses its next attack.');
    assert.equal(C.diveLine('Iris', { tapped: true, passed: false }, 1), 'Iris dives for cover: failed; loses its next attack.');
    assert.deepEqual([C.lostText({ attacks: 1, on: true }), C.lostText({ attacks: 2, on: true }), C.lostText({ attacks: 1, on: false })],
      ['loses this attack: dived for cover', 'loses all 2 attacks: dived for cover', 'dived for cover: loses its next attack']);
    const one = { guns: [{ name: 'Flintlock pistol' }] };
    assert.equal(C.reloadText({ gun: 0, left: 4, weapon: 'Flintlock pistol' }, one), 'Flintlock pistol: ready again in 4 rounds');
    // a brace of pistols: each its own counter, numbered
    const brace = { guns: [{ name: 'Flintlock pistol' }, { name: 'Flintlock pistol' }] };
    assert.deepEqual([C.reloadText({ gun: 0, left: 1, weapon: 'Flintlock pistol' }, brace), C.reloadText({ gun: 1, left: 3, weapon: 'Flintlock pistol' }, brace)],
      ['Flintlock pistol 1: ready again in 1 round', 'Flintlock pistol 2: ready again in 3 rounds']);
  });
});
