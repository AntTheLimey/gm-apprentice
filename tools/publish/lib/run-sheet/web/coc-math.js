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

  return {
    topOf, combatOf, TAP_LEVELS, LEVEL_NAMES, RANK, isLevel, levelName, RESPONSES, RESPONSE_WORDS, RESPONSE_NAMES,
    opposedMelee, skillOf, skillName, outnumbered, proneOn, attackDice, defenceAfter, diceOfNet, diceIn, netOf, diceText,
    rowNotes, sideIn, sideText, meleeLine, limitOf,
  };
}));
