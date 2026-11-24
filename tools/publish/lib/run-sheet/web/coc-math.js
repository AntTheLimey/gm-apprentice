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
    return { level: x.level, kept: x.kept, ...(x.typed === true ? { typed: true } : {}) };
  }
  // "Regular" for a tap, "Hard (18)" for a roll, "Hard (typed 18)" for one rolled at the table.
  const sideText = (s) => `${levelName(s.level)}${isNum(s.kept) ? ` (${s.typed ? 'typed ' : ''}${s.kept})` : ''}`;

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

  // ---- what a hit and a SAN loss owe (Task 18): one card of prompts, never an outcome ----
  // `rules` is the fight's: `prompts` (majorWoundAt, insanityAt) and `coc.cards`, the names and offers
  // (systems/coc.js, each cited there). A card is Task 13's shape, { kind, lines, what?, standing? }, run by the same
  // actions and gurps-math's nextLine, pending and cardDone: a line is { kind, mod: 0, stat?, noRoll?, result, offers,
  // taken }, rolled against the row's `stat` (CON, INT) when it has one, its offers set at once when it has no roll.
  // `standing` names offers the card holds besides its lines (the Dying reminder's Stabilised).
  const cardTable = (rules) => (rules && rules.coc && rules.coc.cards && typeof rules.coc.cards === 'object' ? rules.coc.cards : null);
  const cline = (kind, more) => ({ kind, mod: 0, ...(more || {}), result: null, offers: [], taken: null });
  const offerLine = (kind) => ({ ...cline(kind, { noRoll: true }), offers: [kind] });
  const promptOf = (rules, key) => (rules && rules.prompts && isNum(rules.prompts[key]) ? rules.prompts[key] : null);

  // A hit's card (KR p119, p120): `row` as the hit left it (hp, max, majorWound), `hit` { damage, before }. Only the
  // first that applies: over max HP is dead; to 0 HP with the Major Wound box ticked (by this hit or before) is Dying;
  // a Major Wound otherwise is its CON roll; to 0 HP without it is Unconscious. A row already at 0 owes nothing but
  // the dead line. `major`: this hit ticks the box. No lines: no card.
  function cocCardForHit(row, hit, rules) {
    const out = { major: false, lines: [] };
    const at = promptOf(rules, 'majorWoundAt');
    if (!cardTable(rules) || !row || !hit || at === null) return out;
    const max = isNum(row.max) && row.max > 0 ? row.max : null;
    const dmg = hit.damage;
    if (max === null || !isNum(dmg) || dmg <= 0) return out;
    const major = dmg * at >= max;
    if (dmg > max) return { major, lines: [offerLine('dead')] };
    if (!isNum(hit.before) || hit.before <= 0 || !isNum(row.hp)) return out;
    out.major = major;
    if (row.hp <= 0) out.lines.push(offerLine(row.majorWound || major ? 'dying' : 'unconscious'));
    else if (major) out.lines.push(cline('major', { stat: 'con' }));
    return out;
  }
  // The Dying reminders a round's end owes (KR p120): a CON roll for each row in the fight, not Out, that has been Dying
  // since an earlier round (`dyingRound` < `round`, the round ending), with Stabilised standing. [{ row, card }]
  function cocCardsAtRoundEnd(rows, round, rules) {
    const K = cardTable(rules);
    if (!K || !Array.isArray(rows) || !isNum(round)) return [];
    const dying = (K.status && K.status.dying) || 'Dying';
    return rows.filter((r) => r && r.in && !r.out && r.kind !== 'lair' && Array.isArray(r.conds) && r.conds.includes(dying)
      && isNum(r.dyingRound) && r.dyingRound < round)
      .map((r) => ({ row: r.id, card: { kind: 'dying', lines: [cline('dyingCon', { stat: 'con' })], standing: ['stabilised'], what: `end of round ${round}` } }));
  }
  // A SAN loss in one entry (KR p155): `insanityAt` or more brings the INT roll's card; else null.
  function sanCard(row, loss, rules) {
    const at = promptOf(rules, 'insanityAt');
    if (!cardTable(rules) || !row || at === null || !isNum(loss) || loss < at) return null;
    return { kind: 'int', lines: [cline('int', { stat: 'int' })], what: `SAN −${loss}` };
  }

  // A line's figure: the row's CON or INT; null with none (an NPC's card asks for it first) or no roll.
  const lineTarget = (l, row) => (l && l.stat && !l.noRoll && row && isNum(row[l.stat]) ? row[l.stat] : null);
  const lineStat = (l) => (l && l.stat && !l.noRoll ? l.stat : null);
  const lineName = (l, K) => ((K && K.lines) || {})[l.kind] || l.kind;
  // "Major wound: CON 60", "Dying: CON ?", "Over max HP"; `log` gives the log's form ("Major wound, CON 60").
  function lineText(l, row, K, log) {
    const name = lineName(l, K);
    if (!lineStat(l)) return name;
    const v = row && isNum(row[l.stat]) ? row[l.stat] : '?';
    // the log names no figure it does not have: "Major wound, failed"
    if (log && v === '?') return name;
    return `${name}${log ? ',' : ':'} ${((K && K.stats) || {})[l.stat] || l.stat.toUpperCase()} ${v}`;
  }
  // A line's result as the reducer takes it: a PC's is the GM's tap of the player's roll ({ tap: 'passed' | 'failed' });
  // any other row's is the server's d100 (rollPercent's) at Regular with no dice. Null when it is neither, or the wrong
  // one for the row (the sheet never rolls for a PC).
  function rollResult(x, row) {
    if (!x || typeof x !== 'object') return null;
    const pc = Boolean(row && row.kind === 'pc');
    if (x.tap === 'passed' || x.tap === 'failed') return pc ? { tapped: true, passed: x.tap === 'passed' } : null;
    if (pc || !isLevel(x.level) || !isNum(x.kept) || !isNum(x.target) || (x.difficulty || 'regular') !== 'regular') return null;
    const asked = x.asked && typeof x.asked === 'object' ? x.asked : { bonus: x.bonus || 0, penalty: x.penalty || 0 };
    if (asked.bonus || asked.penalty) return null;
    return { kept: x.kept, target: x.target, level: x.level, passed: RANK[x.level] >= 1, ...(x.typed === true ? { typed: true } : {}) };
  }
  // "rolled 34, Regular", "rolled 34 (typed), Regular", "passed", "failed"
  const resultText = (res) => (res.tapped ? (res.passed ? 'passed' : 'failed') : `rolled ${res.kept}${res.typed ? ' (typed)' : ''}, ${levelName(res.level)}`);
  // What a rolled line offers: the Major Wound's Prone, folded with Unconscious on a failure; a failed Dying CON
  // death; a passed INT roll temporary insanity.
  function offersFor(l, res) {
    if (l.kind === 'major') return [res.passed ? 'prone' : 'proneOut'];
    if (l.kind === 'dyingCon') return res.passed ? [] : ['dead'];
    if (l.kind === 'int') return res.passed ? ['insane'] : [];
    return [];
  }
  // The bout's rounds from the server's die ({ sides, mod, die, total }, lib/dice roll), the sides the table names;
  // null when it is not that.
  function boutRoll(x, rules) {
    const K = cardTable(rules);
    const sides = K && K.bout && isNum(K.bout.sides) ? K.bout.sides : null;
    if (!x || typeof x !== 'object' || sides === null || x.sides !== sides || (x.mod || 0) !== 0) return null;
    return Number.isInteger(x.die) && x.die >= 1 && x.die <= sides && x.total === x.die ? x.die : null;
  }
  // "7 rounds", "1 round": the one place a bout's length is worded (the chip and the log)
  const roundsText = (n) => `${n} round${n === 1 ? '' : 's'}`;
  // "bout: 7 rounds", "bout: 1 round"; '' with none.
  const boutText = (b) => (b && isNum(b.left) && b.left > 0 ? `bout: ${roundsText(b.left)}` : '');

  // ---- a shot (Task 19): the range, the chips, Prone, the dive; the roll is the server's, a PC's level the GM's tap ----
  // `rules` is rules.coc, or the fight's rules holding it; its `firearm` table (systems/coc.js) holds every number.
  const fireOf = (rules) => {
    const C = rules && rules.coc && typeof rules.coc === 'object' ? rules.coc : rules;
    return C && C.firearm && typeof C.firearm === 'object' ? { C, F: C.firearm } : null;
  };
  // Every chip key a shot may carry: the ranges past regular, the chips, and the passed dive.
  function shotKeys(rules) {
    const x = fireOf(rules);
    return x ? x.F.ranges.filter((r) => r.difficulty !== 'regular').map((r) => r.key).concat(x.F.chips.map((c) => c.key), ['dive']) : [];
  }
  const onSet = (chips) => new Set(Array.isArray(chips) ? chips : Object.keys(chips || {}).filter((k) => chips[k]));
  // The farthest range chip on, else the regular one.
  function rangeOf(on, F) {
    const far = F.ranges.slice().reverse().find((r) => on.has(r.key));
    return far || F.ranges.find((r) => r.difficulty === 'regular') || F.ranges[0];
  }
  // Whether a size chip holds: by the target's Build when it has one (KR p113, p410), else as the GM set it.
  function sizeOn(c, on, target, F) {
    if (!c.size || !target || !isNum(target.build)) return on.has(c.key);
    return c.key === 'large' ? target.build >= F.size.large : target.build <= F.size.small;
  }
  // A shot's dice (KR p91, p112-113, p128): `chips` the keys on (an array or { key: true }). { range, rangeLabel,
  // difficulty, net, asked: { bonus, penalty } (the net, one side 0, uncapped: what the server is asked), rolled (capped
  // at maxDice), over (more asked than rolled), why: the chips' labels that count }. Null where there is no table.
  function shotDice(chips, shooter, target, rules) {
    const x = fireOf(rules);
    if (!x) return null;
    const { C, F } = x;
    const on = onSet(chips);
    const range = rangeOf(on, F);
    let net = 0;
    const why = range.difficulty === 'regular' ? [] : [range.label];
    for (const c of F.chips) {
      if (!sizeOn(c, on, target, F) || (c.notWith && on.has(c.notWith))) continue;
      net += (c.bonus || 0) - (c.penalty || 0);
      why.push(c.label);
    }
    if (on.has('dive') && F.dive) { net -= F.dive.penalty || 0; why.push(F.dive.label); }
    const cap = maxDiceOf(C);
    const asked = { bonus: net > 0 ? net : 0, penalty: net < 0 ? -net : 0 };
    const rolled = { bonus: Math.min(cap, asked.bonus), penalty: Math.min(cap, asked.penalty) };
    return { range: range.key, rangeLabel: range.label, difficulty: range.difficulty, net, asked, rolled, over: Math.abs(net) > cap, why };
  }
  // The chips a shot opens with: aimed when the shooter declared its aim the round before, and Prone from the statuses
  // (KR p128). `round` the fight's round now.
  function shotChipsFrom(shooter, target, round, rules) {
    const x = fireOf(rules);
    if (!x) return [];
    const out = [];
    if (aimReady(shooter, round)) out.push('aim');
    if (proneOn(target, x.C)) out.push('proneTarget');
    if (proneOn(shooter, x.C)) out.push('proneShooter');
    return out;
  }
  // A row's firearms (the reader's list), and the figure a shot rolls: the gun's own skill, else the row's Firearms.
  const gunsOf = (row) => (row && Array.isArray(row.guns) ? row.guns : []);
  const shotSkill = (row, gun) => (gun && isNum(gun.skill) ? gun.skill : topOf(row && row.firearms));
  // Whether a row may shoot: a PC (the player rolls), or a row with a Firearms figure or a gun.
  const canShoot = (row) => Boolean(row) && (row.kind === 'pc' || topOf(row.firearms) !== null || gunsOf(row).length > 0);
  // A level that hits at the difficulty (KR p112): at least Regular, and at least the difficulty.
  const shotHits = (level, difficulty) => isLevel(level) && RANK[level] >= Math.max(1, RANK[difficulty] || 1);
  // An NPC's shot as the server rolled it: against `skill` at the shot's difficulty with the dice asked. { level, kept,
  // tens, needed } or null.
  function shotRoll(x, skill, dice) {
    if (!x || typeof x !== 'object' || !dice || !isNum(skill) || x.target !== skill) return null;
    if (!isLevel(x.level) || !isNum(x.kept) || (x.difficulty || 'regular') !== dice.difficulty) return null;
    const asked = x.asked && typeof x.asked === 'object' ? x.asked : null;
    if (!asked || (asked.bonus || 0) !== dice.asked.bonus || (asked.penalty || 0) !== dice.asked.penalty) return null;
    return { level: x.level, kept: x.kept, tens: Array.isArray(x.tens) ? x.tens.filter(isNum) : [], needed: isNum(x.needed) ? x.needed : null, ...(x.typed === true ? { typed: true } : {}) };
  }
  // A malfunction number as written (a weapon line, a sheet's Malf column, the strip's box): 1 to 100, `00` read as
  // 100; anything else null.
  function malNumber(v) {
    const t = String(v == null ? '' : v).trim();
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = t === '00' ? 100 : Number(t);
    return n >= 1 && n <= 100 ? n : null;
  }
  // The number a shot is checked against (the one parser, the reducer's and the page's): a typed one, else the gun's;
  // null with neither; undefined when the typed words are no number (the shot is refused).
  function malfunctionOf(typed, gun) {
    const t = typed == null ? '' : String(typed).trim();
    if (t) { const n = malNumber(t); return n === null ? undefined : n; }
    return gun && isNum(gun.malfunction) ? gun.malfunction : null;
  }
  // Whether the shooter's aim counts for a shot in `round`: declared the round before (KR p113). Spent by a shot.
  const aimReady = (row, round) => Boolean(row && row.aiming && isNum(row.aiming.round) && isNum(round) && row.aiming.round === round - 1);
  // A kept roll against the malfunction number (KR p118): 'malfunction' at or over it; with no number, 'check' from the
  // table's hint; else ''.
  function malfunctionFlag(kept, number, rules) {
    const x = fireOf(rules);
    if (!isNum(kept)) return '';
    if (isNum(number)) return kept >= number ? 'malfunction' : '';
    const from = x && x.F.malfunction && isNum(x.F.malfunction.hintFrom) ? x.F.malfunction.hintFrom : null;
    return from !== null && kept >= from ? 'check' : '';
  }
  // A weapon's damage as the box's typed choices: `2D6/1D6` (by range) is two; one is one; none is none.
  const damageChoices = (text) => (typeof text === 'string' && text ? text.split('/').map((t) => t.trim()).filter(Boolean) : []);
  // "+1 bonus die", "−2 penalty dice (6 penalty dice asked: 2 rolled (KR p91))"; '' for none.
  function shotDiceText(d) {
    if (!d || !d.net) return '';
    const n = Math.abs(d.net);
    const kind = d.net > 0 ? 'bonus' : 'penalty';
    const r = d.net > 0 ? d.rolled.bonus : d.rolled.penalty;
    const dice = (k) => `${k === 1 ? 'die' : 'dice'}`;
    return `${d.net > 0 ? '+' : '\u2212'}${r} ${kind} ${dice(r)}${d.over ? ` (${n} ${kind} ${dice(n)} asked: ${r} rolled (KR p91))` : ''}`;
  }
  // The shot's line, for the log and the strip: "Dock Cultist 1 shoots Dock Cultist 2 (long range, point blank), +1
  // bonus die: Firearms 30 at Hard (15): rolled 33 (tens 30, 40): Fail: a miss." A PC's: "...: Hard needed: Regular: a
  // miss." `x` { dice, skill, roll (shotRoll's) or level, hit, flag, malfunction }.
  function shotLine(names, x) {
    const d = x.dice;
    const dt = shotDiceText(d);
    const head = `${names.shooter} shoots ${names.target}${d.why.length ? ` (${d.why.join(', ')})` : ''}${dt ? `, ${dt}` : ''}`;
    const diff = levelName(d.difficulty);
    const r = x.roll;
    const level = r ? r.level : x.level;
    const at = r ? `${isNum(x.skill) ? `Firearms ${x.skill} ` : ''}at ${diff}${isNum(r.needed) ? ` (${r.needed})` : ''}: rolled ${r.kept}${r.typed ? ' (typed)' : r.tens.length > 1 ? ` (tens ${r.tens.join(', ')})` : ''}` : `${diff} needed`;
    let tail = x.hit ? 'a hit' : 'a miss';
    if (x.flag === 'malfunction') tail = `malfunction (${x.malfunction})`;
    else if (x.flag === 'check') tail += `; check malfunction (${x.cite || 'KR p118'})`;
    return `${head}: ${at}: ${levelName(level)}: ${tail}.`;
  }
  // The dive's line: "Dock Cultist 2 dives for cover: Dodge rolled 15, Hard: a penalty die on the shot; loses its next
  // attack." A PC's: "... dives for cover: passed: ...".
  function diveLine(name, res, attacks) {
    const what = res.tapped ? (res.passed ? 'passed' : 'failed') : `Dodge rolled ${res.kept}${res.typed ? ' (typed)' : ''}, ${levelName(res.level)}`;
    return `${name} dives for cover: ${what}${res.passed ? ': a penalty die on the shot' : ''}; ${attacks > 1 ? `loses its next ${attacks} attacks` : 'loses its next attack'}.`;
  }
  // The row's marks: the lost attack (on its turn, and before it), the slow weapon's counter, the declared aim.
  function lostText(m) {
    if (!m) return '';
    const n = isNum(m.attacks) && m.attacks > 1 ? m.attacks : 1;
    if (m.on) return n > 1 ? `loses all ${n} attacks: dived for cover` : 'loses this attack: dived for cover';
    return n > 1 ? `dived for cover: loses its next ${n} attacks` : 'dived for cover: loses its next attack';
  }
  // A slow gun's counter (one per gun, `gun` its index in the row's list): "Flintlock pistol: ready again in 4 rounds";
  // a gun whose name another of the row's guns shares is numbered ("Flintlock pistol 2"). `row` the counter's row.
  function reloadName(c, row) {
    const guns = gunsOf(row);
    const same = guns.filter((g) => g && g.name === c.weapon).length;
    return same > 1 && isNum(c.gun) ? `${c.weapon} ${guns.slice(0, c.gun + 1).filter((g) => g && g.name === c.weapon).length}` : c.weapon || '';
  }
  const reloadText = (c, row) => (c && isNum(c.left) && c.left > 0 ? `${c.weapon ? `${reloadName(c, row)}: ` : ''}ready again in ${roundsText(c.left)}` : '');

  return {
    shotKeys, shotDice, shotChipsFrom, gunsOf, shotSkill, canShoot, shotHits, shotRoll, malfunctionFlag, damageChoices,
    shotDiceText, shotLine, diveLine, lostText, reloadText, reloadName, malNumber, malfunctionOf, aimReady,
    cocCardForHit, cocCardsAtRoundEnd, sanCard, lineTarget, lineStat, lineName, lineText, rollResult, resultText, offersFor,
    boutRoll, boutText, roundsText,
    DB_MODES, DB_WORDS, dbModeOf, dbTerm, halfTerm, damageRoll, cocDamage, extremeOffer,
    topOf, combatOf, TAP_LEVELS, LEVEL_NAMES, RANK, isLevel, levelName, RESPONSES, RESPONSE_WORDS, RESPONSE_NAMES,
    opposedMelee, skillOf, skillName, outnumbered, proneOn, attackDice, defenceAfter, diceOfNet, diceIn, netOf, autoIn, diceText,
    rowNotes, sideIn, sideText, meleeLine, limitOf,
  };
}));
