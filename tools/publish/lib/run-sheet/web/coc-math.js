'use strict';
// The run sheet's CoC arithmetic, as pure helpers (step 6b Tasks 16-19). UMD like gurps-math.js: `module.exports`
// under node, `window.RunSheetCocMath` in a page, so the reader (systems/coc.js), fight-math.js, the reducer
// (fight.js) and the page share one copy. No DOM, no fetch, no dice: the d100 is the server's (lib/dice). Its numbers
// come from `rules.coc` (systems/coc.js), each cited there; nothing here prints a rule.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetCocMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // ---- the combat skill (Task 6's tie figure, moved here: the one copy) ----
  // The higher of a figure that may be one number or a PC's specialisations ({ Brawl: 40, Sword: 65 } or a list).
  const topOf = (v) => {
    const all = isNum(v) ? [v] : (v && typeof v === 'object' ? Object.values(v).filter(isNum) : []);
    return all.length ? Math.max(...all) : null;
  };
  // A row's combat skill for a DEX tie (KR p102): the higher of its Fighting and Firearms, worked out each time it is
  // read, so a figure typed in the panel counts; a row with neither may carry `combat` itself; else null.
  function combatOf(r) {
    const best = [topOf(r && r.fighting), topOf(r && r.firearms)].filter(isNum);
    if (best.length) return Math.max(...best);
    return r && isNum(r.combat) ? r.combat : null;
  }

  // ---- levels ----
  // The levels a d100 gives (lib/dice rollPercent's words), and the order the GM taps a player's from.
  const TAP_LEVELS = ['critical', 'extreme', 'hard', 'regular', 'fail', 'fumble'];
  const LEVEL_NAMES = { critical: 'Critical', extreme: 'Extreme', hard: 'Hard', regular: 'Regular', fail: 'Fail', fumble: 'Fumble' };
  // The levels' order (KR p90, p103).
  const RANK = { fumble: 0, fail: 0, regular: 1, hard: 2, extreme: 3, critical: 4 };
  const isLevel = (l) => typeof l === 'string' && Object.prototype.hasOwnProperty.call(RANK, l);
  const levelName = (l) => LEVEL_NAMES[l] || '';

  // ---- opposed melee (Task 16) ----
  const RESPONSES = ['dodge', 'fightBack'];
  const RESPONSE_WORDS = { dodge: 'Dodges', fightBack: 'Fights Back' };
  const RESPONSE_NAMES = { dodge: 'Dodge', fightBack: 'Fight Back' };
  // the tie winners when a system gives none (KR p103)
  const TIE = { dodge: 'defender', fightBack: 'attacker' };

  // An attack's level against the defence's (KR p103): { winner: 'attacker' | 'defender' | null, tie, hits: the side
  // whose damage is owed, or null }. `coc` is rules.coc (its `tie`); null for a level or a response that is not one.
  function opposedMelee(attack, defence, response, coc) {
    if (!isLevel(attack) || !isLevel(defence) || !RESPONSES.includes(response)) return null;
    const tie = (coc && coc.tie) || TIE;
    const a = RANK[attack];
    const d = RANK[defence];
    if (a === 0 && d === 0) return { winner: null, tie: false, hits: null };
    const winner = a > d ? 'attacker' : d > a ? 'defender' : (tie[response] === 'defender' ? 'defender' : 'attacker');
    const hits = winner === 'attacker' ? 'attacker' : response === 'fightBack' ? 'defender' : null;
    return { winner, tie: a === d, hits };
  }

  // The figure a side rolls against: `dodge` the row's Dodge, else its Fighting (the highest). Null when it has none.
  function skillOf(row, part) {
    if (!row) return null;
    if (part === 'dodge') return isNum(row.dodge) ? row.dodge : null;
    return topOf(row.fighting);
  }
  const skillName = (part) => (part === 'dodge' ? 'Dodge' : 'Fighting');

  // ---- the dice on an attack: outnumbered and Prone (Task 16), the stepper's net ----
  const maxDiceOf = (coc) => (coc && isNum(coc.maxDice) ? coc.maxDice : 2);
  // A row's attacks figure, at least 1 (KR p108).
  const limitOf = (row) => (row && isNum(row.attacks) && row.attacks >= 1 ? Math.floor(row.attacks) : 1);
  const countOf = (row) => (row && isNum(row.meleeDefences) && row.meleeDefences > 0 ? Math.floor(row.meleeDefences) : 0);

  // A row's outnumbered state: its melee defences this round, its limit, whether the next melee attack on it gets
  // the bonus die (`bonus`), and the row's off switch.
  function outnumbered(row, coc) {
    const count = countOf(row);
    const limit = limitOf(row);
    const off = Boolean(row && row.outnumberedOff);
    const per = coc && coc.outnumbered && isNum(coc.outnumbered.bonus) ? coc.outnumbered.bonus : 0;
    const due = count >= limit;
    return { count, limit, due, off, bonus: due && !off ? per : 0 };
  }
  const proneOn = (row, coc) => {
    const p = coc && coc.prone;
    return Boolean(p && row && Array.isArray(row.conds) && row.conds.includes(p.status || 'Prone'));
  };

  // The dice an attack on `row` starts with, before the GM's taps: { net, why } (bonus dice above 0). A melee attack
  // takes the outnumbered die and the Prone die; a shot (`kind` 'firearm') takes neither here (Task 19 reads Prone).
  function attackDice(row, coc, kind = 'melee') {
    if (kind !== 'melee' || !coc) return { net: 0, why: [] };
    const why = [];
    let net = 0;
    const o = outnumbered(row, coc);
    if (o.bonus) { net += o.bonus; why.push('outnumbered'); }
    if (proneOn(row, coc) && isNum(coc.prone.meleeBonus) && coc.prone.meleeBonus) { net += coc.prone.meleeBonus; why.push('prone'); }
    const cap = maxDiceOf(coc);
    return { net: Math.max(-cap, Math.min(cap, net)), why };
  }
  // A row's melee-defence count after an attack of `kind`: only 'melee' adds (KR p108).
  const defenceAfter = (row, kind) => countOf(row) + (kind === 'melee' ? 1 : 0);

  // The stepper's net as dice ({ bonus, penalty }, one of them 0), within the cap; and back.
  function diceOfNet(net, coc) {
    const cap = maxDiceOf(coc);
    const n = isNum(net) ? Math.max(-cap, Math.min(cap, Math.trunc(net))) : 0;
    return { bonus: n > 0 ? n : 0, penalty: n < 0 ? -n : 0 };
  }
  // Dice an action carries, checked: whole numbers, one side 0, within the cap; null when not.
  function diceIn(d, coc) {
    if (!d || typeof d !== 'object') return null;
    const { bonus, penalty } = d;
    const cap = maxDiceOf(coc);
    const ok = (n) => Number.isInteger(n) && n >= 0 && n <= cap;
    if (!ok(bonus) || !ok(penalty) || (bonus && penalty)) return null;
    return { bonus, penalty };
  }
  const netOf = (d) => (d ? d.bonus - d.penalty : 0);
  const REASONS = ['outnumbered', 'prone'];
  // The row's own dice as the page saw them when the exchange opened ({ net, why }), checked; null when not.
  function autoIn(x, coc) {
    if (!x || typeof x !== 'object') return null;
    const cap = maxDiceOf(coc);
    if (!Number.isInteger(x.net) || Math.abs(x.net) > cap || !Array.isArray(x.why)) return null;
    if (x.why.some((w) => !REASONS.includes(w))) return null;
    return { net: x.net, why: x.why.slice() };
  }
  // "+1 bonus die (outnumbered)", "+2 bonus dice (outnumbered, prone)", "−1 penalty die (set by hand)"; '' for none,
  // unless the GM took the row's dice off ("no dice (set by hand)").
  function diceText(net, why, byHand) {
    if (!net) return byHand ? 'no dice (set by hand)' : '';
    const n = Math.abs(net);
    const kind = net > 0 ? 'bonus' : 'penalty';
    const reasons = (why || []).concat(byHand ? ['set by hand'] : []);
    return `${net > 0 ? '+' : '−'}${n} ${kind} ${n === 1 ? 'die' : 'dice'}${reasons.length ? ` (${reasons.join(', ')})` : ''}`;
  }
  // The row's outnumbered and Prone notes: "defended 1× → next attack +1 bonus die", "prone → melee +1 bonus die".
  function rowNotes(row, coc) {
    if (!coc) return { outnumbered: '', prone: '' };
    const o = outnumbered(row, coc);
    let on = '';
    if (o.count) {
      if (o.off) on = `defended ${o.count}× · outnumbered off`;
      else if (o.due) on = `defended ${o.count}× → next attack +${o.bonus} bonus die`;
      else on = `defended ${o.count}× of ${o.limit}`;
    }
    const pb = coc.prone && coc.prone.meleeBonus;
    return { outnumbered: on, prone: proneOn(row, coc) && pb ? `prone → melee +${pb} bonus die` : '' };
  }

  // A side of the exchange as the action carries it: a PC's level tapped ({ level }), or an NPC's d100 from the server
  // (rollPercent's result, against `skill` with `dice`). { level, kept } when it holds, else null.
  function sideIn(row, x, skill, dice) {
    if (!row || !x || typeof x !== 'object') return null;
    if (row.kind === 'pc') return isLevel(x.level) && x.kept === undefined ? { level: x.level, kept: null } : null;
    if (!isNum(skill) || !isLevel(x.level) || !isNum(x.kept) || x.target !== skill) return null;
    if ((x.difficulty || 'regular') !== 'regular') return null;
    const asked = x.asked && typeof x.asked === 'object' ? x.asked : { bonus: x.bonus || 0, penalty: x.penalty || 0 };
    if ((asked.bonus || 0) !== dice.bonus || (asked.penalty || 0) !== dice.penalty) return null;
    return { level: x.level, kept: x.kept };
  }
  // "Regular" for a tap, "Hard (18)" for a roll.
  const sideText = (s) => `${levelName(s.level)}${isNum(s.kept) ? ` (${s.kept})` : ''}`;

  // The exchange's log line: "Gus, +1 bonus die (outnumbered): Regular; Cultist 2 Fights Back: Regular (31): a tie:
  // Gus hits Cultist 2." `names` { attacker, defender }; `out` opposedMelee's answer.
  function meleeLine(names, response, dice, attack, defence, out) {
    const dt = diceText(dice.net, dice.why, dice.byHand);
    const head = `${names.attacker}${dt ? `, ${dt}` : ''}: ${sideText(attack)}; ${names.defender} ${RESPONSE_WORDS[response]}: ${sideText(defence)}`;
    let tail;
    if (!out.winner) tail = 'both fail: nothing happens';
    else {
      const what = out.hits === 'attacker' ? `${names.attacker} hits ${names.defender}`
        : out.hits === 'defender' ? `${names.defender} hits ${names.attacker}` : `${names.defender} dodges`;
      tail = out.tie ? `a tie: ${what}` : what;
    }
    return `${head}: ${tail}.`;
  }

  // ---- damage (Task 17): the dice and the damage bonus, armour, the Extreme hit's maximum ----
  // The damage bonus's settings (KR p108, p408): full for melee, half for thrown weapons and bows, none for firearms
  // and crossbows. What an exchange's kind starts the box at: Task 19's shot is 'shot'.
  const DB_MODES = ['full', 'half', 'none'];
  const DB_WORDS = { full: 'full DB', half: 'half DB', none: 'no DB' };
  const DB_OF_KIND = { melee: 'full', thrown: 'half', shot: 'none' };
  const dbModeOf = (kind) => DB_OF_KIND[kind] || 'full';

  // A row's DB as a term to add: '+1D4', '-1', '' for none (0, `none`, a dash, or no figure); null when it is
  // neither one die group nor a whole number (the GM types it in the panel).
  function dbTerm(v) {
    if (v === null || v === undefined) return '';
    if (isNum(v)) { const n = Math.trunc(v); return n > 0 ? `+${n}` : n < 0 ? `-${-n}` : ''; }
    const t = String(v).replace(/\s+/g, '').replace(/\u2212/g, '-');
    if (t === '' || /^(?:none|n\/a|[-\u2013\u2014])$/i.test(t)) return '';
    let m = /^([+-]?)(\d+)$/.exec(t);
    if (m) { const n = Number(m[2]); return n ? `${m[1] === '-' ? '-' : '+'}${n}` : ''; }
    m = /^([+-]?)(\d*)d(\d+)$/i.exec(t);
    if (!m) return null;
    const count = m[2] === '' ? 1 : Number(m[2]);
    const sides = Number(m[3]);
    if (count < 1 || sides < 2) return null;
    return `${m[1] === '-' ? '-' : '+'}${count}D${sides}`;
  }
  // Half a DB term: a number halved toward 0; dice by half the count when it is even (+2D6 is +1D6), else half the
  // sides (+1D4 is +1D2, +1D6 is +1D3).
  function halfTerm(term) {
    if (!term) return '';
    let m = /^([+-])(\d+)$/.exec(term);
    if (m) { const n = Math.floor(Number(m[2]) / 2); return n ? `${m[1]}${n}` : ''; }
    m = /^([+-])(\d+)D(\d+)$/.exec(term);
    if (!m) return term;
    const count = Number(m[2]);
    const sides = Number(m[3]);
    if (count % 2 === 0) return `${m[1]}${count / 2}D${sides}`;
    return `${m[1]}${count}D${Math.max(2, Math.floor(sides / 2))}`;
  }

  // What the server rolls for an entry (fight-math parseEntry's CoC dice: { dice, db }): the weapon's dice, and the
  // attacker's DB put in where the entry says DB, by the setting, so the server only ever sees dice notation.
  // { notation, weapon, db }, or { error: 'attacker' } (DB with no attacker) or { error: 'db', db } (a DB that is
  // not dice or a number); null for an entry that is not dice.
  function damageRoll(e, attacker, mode = 'full') {
    if (!e || typeof e.dice !== 'string' || !e.dice) return null;
    const weapon = e.dice.toUpperCase();
    if (!e.db) return { notation: weapon, weapon, db: '' };
    if (!attacker) return { error: 'attacker' };
    const term = dbTerm(attacker.db);
    if (term === null) return { error: 'db', db: attacker.db };
    const db = mode === 'none' ? '' : mode === 'half' ? halfTerm(term) : term;
    return { notation: `${weapon}${db}`, weapon, db };
  }

  // A damage roll as the server answers it (lib/dice rollDamage, or maxRoll's), for this notation, its sum holding.
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const rollOk = (x, notation) => Boolean(x) && typeof x === 'object' && x.notation === notation && Array.isArray(x.dice)
    && x.dice.length > 0 && x.dice.every(Number.isInteger) && Number.isInteger(x.mod) && Number.isInteger(x.total)
    && x.total >= 0 && x.total <= 9999 && x.total === Math.max(0, sum(x.dice) + x.mod);
  const minus = (n) => (n < 0 ? `\u2212${-n}` : String(n));
  // "4+2 = 6", "1\u22122 = 0", "3" (one face, no number: nothing to add)
  function sumText(x) {
    const faces = x.dice.map((d, i) => (i && d >= 0 ? `+${d}` : minus(d))).join('') + (x.mod > 0 ? `+${x.mod}` : x.mod < 0 ? minus(x.mod) : '');
    return faces === String(x.total) ? faces : `${faces} = ${x.total}`;
  }

  // A hit (Task 17): its total, the target's armour off (KR p108), never below 0 (HP's floor is the reducer's, KR
  // p120), with the working line: "1D6+1D4 = 4+2 = 6 \u2212 armour 1 = 5". `e` is parseEntry's. `opts`:
  // - `roll`: the server's roll of damageRoll's notation (with `mode`, the DB setting); for `extreme`, maxRoll's,
  //   and `extra` the weapon's own roll when it impales;
  // - `asRolled`: a bare number is the total as rolled (a box an exchange opened), so armour comes off it.
  // { total, armour, damage, line, notation }, or null when the roll is not this entry's or a bare number is raw.
  function cocDamage(e, attacker, target, opts = {}) {
    if (!e || e.pool !== 'hp' || e.kind !== 'damage') return null;
    const armour = target && isNum(target.armour) && target.armour > 0 ? Math.floor(target.armour) : 0;
    let total;
    let line;
    let notation = null;
    if (!e.dice) {
      if (!opts.asRolled || !isNum(e.n)) return null;
      total = e.n;
      line = String(e.n);
    } else {
      const spec = damageRoll(e, attacker, DB_MODES.includes(opts.mode) ? opts.mode : 'full');
      if (!spec || spec.error) return null;
      notation = spec.notation;
      const x = opts.roll;
      if (!rollOk(x, spec.notation) || Boolean(opts.extreme) !== (x.max === true)) return null;
      if (opts.extreme && opts.extra) {
        const y = opts.extra;
        if (!rollOk(y, spec.weapon) || y.max) return null;
        total = x.total + y.total;
        line = `Extreme, impaling: ${spec.notation} at max = ${sumText(x)}, +${spec.weapon} = ${sumText(y)}: ${total}`;
      } else if (opts.extreme) {
        total = x.total;
        line = `Extreme: ${spec.notation} at max = ${sumText(x)}`;
      } else {
        total = x.total;
        line = `${spec.notation} = ${sumText(x)}`;
      }
    }
    const damage = Math.max(0, total - armour);
    if (armour) line += ` \u2212 armour ${armour} = ${damage}`;
    return { total, armour, damage, line, notation };
  }

  // Whether a hit offers the Extreme maximum (KR p103, p405, p408): the attacking side's own hit, on its own turn, at
  // Extreme or better; never the defender's (fighting back). A very long shot only on a critical, the 01 (KR p112).
  // `x`: { side: 'attacker' | 'defender', onTurn, level, veryLong }.
  function extremeOffer(x) {
    if (!x || x.side !== 'attacker' || !x.onTurn || !isLevel(x.level)) return false;
    if (x.veryLong) return x.level === 'critical';
    return RANK[x.level] >= RANK.extreme;
  }

  return {
    DB_MODES, DB_WORDS, dbModeOf, dbTerm, halfTerm, damageRoll, cocDamage, extremeOffer,
    topOf, combatOf, TAP_LEVELS, LEVEL_NAMES, RANK, isLevel, levelName, RESPONSES, RESPONSE_WORDS, RESPONSE_NAMES,
    opposedMelee, skillOf, skillName, outnumbered, proneOn, attackDice, defenceAfter, diceOfNet, diceIn, netOf, autoIn, diceText,
    rowNotes, sideIn, sideText, meleeLine, limitOf,
  };
}));
