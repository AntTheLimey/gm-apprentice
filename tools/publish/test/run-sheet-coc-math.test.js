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
    assert.deepEqual(systemFor('coc-7e-regency').describe().fight.coc, COC);
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
