'use strict';
// The fight's `reduce` handlers (plan 5b decision 1). UMD like state.js: `module.exports` under node,
// `window.RunSheetFight` in a page, where fight-math.js loads first. state.js merges FIGHT_HANDLERS into its
// own, so the page, the server, the record and the players' view share one `reduce`.
//
// Each handler changes the (already cloned) state `s`. Every action but `fightStart` names the running fight
// (`fight: <id>`) and is dropped when it names another, or a row the fight does not hold (Review M3). The
// `afterClear` actions name an ended fight instead. Rows, groups and thresholds come in the action, built by
// the page with fight-math's `rowsForFight`/`joinRows`, so `reduce` never sees the model.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fight-math'), require('./gurps-math'));
  else root.RunSheetFight = factory(root.RunSheetFightMath, root.RunSheetGurpsMath);
}(typeof self !== 'undefined' ? self : this, function (FM, GM) {
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const int = (v) => (isNum(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : null);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // An initiative or a stat: any finite number, rounded to `places` decimals; one with more places is refused (null),
  // never truncated (GURPS's Speed keeps 2, the rest none).
  const figureIn = (v, places) => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean' || typeof v === 'object') return null;
    const n = Number(v);
    if (!isNum(n)) return null;
    const k = 10 ** places;
    const r = Math.round(n * k) / k;
    return Math.abs(r - n) < 1e-9 ? r : null;
  };
  const initPlaces = (rules) => (isNum(rules.initDecimals) && rules.initDecimals > 0 ? Math.floor(rules.initDecimals) : 0);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // The fight's lines are ordinary Log lines, marked `fight: true` (decision 2).
  const say = (s, f, at, text) => { s.events.push({ at, beat: f.beat || null, text, title: f.title || '', fight: true }); };

  // The GM's name for a row at this moment: unmasked when Unmask is on, then the copy number once there are two.
  // A line of the fight's log that names a row marks it `logged`, so a row the log names is never taken back
  // by Undo (a line naming it would stay in the Table Log). `quiet` is for the join's own line, which goes with it.
  function nameOf(s, f, r, quiet) {
    if (!quiet) r.logged = true;
    const u = s.unmask && r.note ? s.unmask[r.note] : null;
    const unmasked = u ? (u.on ? u.name : null) : ((f.carried && r.note && f.carried[r.note]) || null);
    const copies = r.note ? f.rows.filter((x) => x.note === r.note && x.kind !== 'pc').length : 1;
    return FM.gmName(r, () => unmasked, copies);
  }

  // Statuses as added, then exhaustion, then concentration: `Down, Prone, Exhaustion 2, Concentrating`.
  function statusesOf(r) {
    return (r.conds || []).concat(r.exhaustion ? [`Exhaustion ${r.exhaustion}`] : [], r.conc ? ['Concentrating'] : []);
  }

  // `Kael 12/40 (Prone, Exhaustion 1)`; a row with no numbers is its name; an Out row says so.
  function figureOf(s, f, r, quiet) {
    const st = statusesOf(r).concat(r.out ? ['Out'] : []);
    const hp = isNum(r.hp) ? ` ${r.hp}${isNum(r.max) ? `/${r.max}` : ''}` : '';
    return `${nameOf(s, f, r, quiet)}${hp}${st.length ? ` (${st.join(', ')})` : ''}`;
  }
  // A roster line (the Round 1 order, a round's end, the fight's end) lists everyone ticked in. It does not mark
  // them `logged`: it keeps its items (`roster`), so an Undo can take an undone row's name out of it.
  // A roster line: "Round 1: Ada 22/30, …." With nobody to list (a Fight here where no one stands, ended before the
  // first turn), the head's colon goes: "Fight ends before the first turn." (Task 13 proof)
  const rosterText = (head, items, tail) => (items.length ? `${head}${items.map((x) => x.text).join(', ')}${tail}` : `${head.replace(/:\s*$/, '')}${tail}`);
  const sayRoster = (s, f, at, head, items, tail) => {
    say(s, f, at, rosterText(head, items, tail));
    s.events[s.events.length - 1].roster = { head, tail, items };
  };
  const rosterItems = (s, f) => f.rows.filter((r) => r.in && r.kind !== 'lair').map((r) => ({ id: r.id, text: figureOf(s, f, r, true) }));

  const touch = (r, at) => { r.at = at; };
  // HP and max keep their own time (Review H1): a status cleared after the fight must not make the fight's
  // HP newer than a rest or an end-panel edit made since. `at` stays the time of anything else.
  const touchHp = (r, at) => { r.at = at; r.hpAt = at; };
  // HP's own time moves only when HP or max did: temp HP alone never makes an older HP the newer figure
  const touchIfHp = (r, at, hp, max) => { if (r.hp !== hp || r.max !== max) touchHp(r, at); else touch(r, at); };
  // A row as it enters a fight: its HP is the figure of that moment.
  const entered = (r, at) => {
    if (r && typeof r === 'object') { if (!r.hpAt) r.hpAt = at; if (!r.condAt) r.condAt = at; }
    return r;
  };

  // The number an unseen foe keeps, fixed when it is first ticked in (decision 5); an unseen ally keeps one
  // too, so its label never drifts (plan 6a fix round 1 / review M4).
  function numberUnseen(f) {
    const nums = FM.unseenNumbers(f.rows, (r) => r.word || '');
    for (const r of f.rows) if (FM.sideOfRow(r) && r.in && (r.unseenN === null || r.unseenN === undefined) && nums.has(r.id)) r.unseenN = nums.get(r.id);
  }

  // A Lair row lists the rows whose block has lair actions.
  function lairOf(f) {
    const lair = f.rows.find((r) => r.kind === 'lair');
    if (!lair) return;
    const of = new Set(lair.of || []);
    for (const r of f.rows) if (r.lair && r.kind !== 'lair') of.add(r.id);
    lair.of = [...of];
  }

  // Thresholds lit by this row (decision 20): logged once per threshold and row.
  function lightThresholds(s, f, r, at) {
    for (const t of f.thresholds || []) {
      const key = `${t.key}|${r.id}`;
      if (f.lit[key] || !FM.isLit(t, r)) continue;
      f.lit[key] = at;
      say(s, f, at, `${nameOf(s, f, r)}: ${t.text}`);
    }
  }

  // The system's marks a row's HP lights (GURPS's Reeling and 0 or less): each logged once as it is crossed, and
  // gone when healing lifts the row above it; `deepest` keeps the deepest minus-HP line passed (Task 13's). `quiet`
  // sets them with no line (a row entering the fight). Nothing for a system with no marks.
  function settleMarks(s, f, r, at, quiet) {
    const rules = FM.rulesOf(f);
    if (!Array.isArray(rules.marks) || !rules.marks.length) return;
    const m = FM.marksOf(r, rules);
    const was = Array.isArray(r.marks) ? r.marks : [];
    if (!quiet) {
      for (const name of m.chips) {
        if (was.includes(name)) continue;
        const mark = rules.marks.find((x) => x && x.name === name);
        say(s, f, at, `${nameOf(s, f, r)}: ${(mark && mark.log) || name}.`);
      }
    }
    r.marks = m.chips;
    r.deepest = m.deepest ? m.deepest.times : 0;
  }
  // The system's Tired (GURPS's, by FP): logged when crossed, gone when FP is back above it.
  function settleTired(s, f, r, at, quiet) {
    const rules = FM.rulesOf(f);
    if (!rules.tiredAt) return;
    const now = FM.tiredOf(r, rules);
    if (now && !r.tired && !quiet) say(s, f, at, `${nameOf(s, f, r)}: ${rules.tiredAt.name || 'Tired'}.`);
    r.tired = now;
  }

  // What follows an HP change: a foe going Bloodied is logged; at 0 a foe (a neutral too: its kind is foe)
  // is Out, a PC or ally is Down, and concentration ends; healing from 0 clears Down, Stable and the death
  // saves; thresholds light. Where the rules put nobody Out by themselves (`autoOut: false`, CoC and GURPS),
  // none of D&D's follows: the marks are set and the thresholds light.
  // `opts.over` is the damage left after temp HP and HP.
  function afterHp(s, f, r, before, at, opts) {
    if (FM.rulesOf(f).autoOut === false) {
      settleMarks(s, f, r, at);
      lightThresholds(s, f, r, at);
      return;
    }
    const o = opts || {};
    const was = { ...r, hp: before };
    if (r.kind === 'foe' && FM.isBloodied(r) && !FM.isBloodied(was)) say(s, f, at, `${nameOf(s, f, r)} is Bloodied.`);
    if (r.hp === 0 && isNum(before) && before > 0) {
      if (r.kind === 'foe') {
        if (!r.out) { r.out = true; say(s, f, at, `${nameOf(s, f, r)} drops.`); }
      } else if (r.kind === 'pc' || r.kind === 'ally') {
        if (!r.conds.includes('Down')) r.conds.push('Down');
        say(s, f, at, `${nameOf(s, f, r)} is Down.`);
      }
      if (r.conc) { r.conc = false; say(s, f, at, `${nameOf(s, f, r)}'s concentration ends.`); }
    }
    if (before === 0 && isNum(r.hp) && r.hp > 0) {
      r.conds = r.conds.filter((c) => c !== 'Down' && c !== 'Stable');
      r.ds = { s: 0, f: 0 };
      // a foe healed from 0 is back in the fight
      if (r.kind === 'foe' && r.out) { r.out = false; say(s, f, at, `${nameOf(s, f, r)} is back in the fight.`); }
    }
    if ((r.kind === 'pc' || r.kind === 'ally') && isNum(o.over) && o.over > 0) {
      // SRD: damage at 0 HP is a death save failure and ends Stable (a crit's second failure goes on the
      // pips); damage left over that reaches the HP max is for the GM to rule on.
      if (isNum(r.max) && r.max > 0 && o.over >= r.max) say(s, f, at, `${nameOf(s, f, r)}: the damage left over is at least the HP max.`);
      if (before === 0 && r.hp === 0) {
        r.conds = r.conds.filter((c) => c !== 'Stable');
        const ds = { s: (r.ds && r.ds.s) || 0, f: (r.ds && r.ds.f) || 0 };
        const wasF = ds.f;
        ds.f = Math.min(3, ds.f + 1);
        r.ds = ds;
        say(s, f, at, `${nameOf(s, f, r)} takes damage at 0 HP: a death save failure.`);
        if (ds.f === 3 && wasF < 3) say(s, f, at, `${nameOf(s, f, r)} has failed three death saves.`);
      }
    }
    lightThresholds(s, f, r, at);
  }

  // Damage after half and resisted, into temp HP first, down to the fight's floor. Answers what the row took.
  function hurt(f, r, n, half) {
    const d = FM.damageTaken(n, { half, resisted: r.resisted });
    const next = FM.afterDamage({ hp: isNum(r.hp) ? r.hp : null, temp: r.temp }, d, FM.rulesOf(f));
    r.hp = next.hp;
    r.temp = next.temp;
    return d;
  }

  // What was left of `d` after temp HP and HP: the damage past 0.
  const overOf = (d, temp, hp) => (isNum(hp) ? d - (temp || 0) - hp : null);

  // A neutral's turn is its own, but it is never the last foe the panel falls back to (plan 6a).
  const turnStart = (f, r, at) => {
    r.turned = true;
    if (r.laMax) { r.la = r.laMax; touch(r, at); }
    if (FM.isFoe(r)) f.lastFoe = r.id;
  };

  // The running fight this action names, and the row it names when it names one.
  function running(s, a) {
    const f = s.fight;
    if (!f || !Array.isArray(f.rows) || a.fight == null || a.fight !== f.id) return null;
    return f;
  }
  const rowOf = (f, id) => (id == null ? null : f.rows.find((r) => r.id === id) || null);
  // A handler for one row of the running fight.
  const onRow = (fn) => (s, a, at) => {
    const f = running(s, a);
    const r = f && rowOf(f, a.row);
    if (r) fn(s, f, r, a, at);
  };

  function endedFight(s, id) {
    return (s.fights || []).find((x) => x.id === id) || null;
  }
  function clearStatus(r, status) {
    if (status === 'Concentrating') r.conc = false;
    else if (status === 'Exhaustion' || /^Exhaustion\s+\d+$/.test(String(status))) r.exhaustion = 0;
    else r.conds = r.conds.filter((c) => c !== status);
  }
  const clearAll = (r) => { r.conds = []; r.exhaustion = 0; r.conc = false; };
  const holdsStatus = (r) => r.conds.length > 0 || r.exhaustion > 0 || r.conc;
  // Incapacitated and the conditions that include it (SRD 5.2.1): each ends Concentration.
  const INCAPACITATING = new Set(['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious']);

  // The stat keys Same for all copies (D&D's, `STAT_KEYS`); CoC and GURPS copy their own stats and pool maxima
  // (statKeysOf, by the rules' initiative). Nothing else is copied.
  const STAT_KEYS = ['max', 'ac', 'mod'];
  function statKeysOf(rules) {
    const ru = FM.rulesOf({ rules });
    if (ru.initiative === 'dex') return ['max', 'mpMax', 'sanMax', 'dex'];
    if (ru.initiative === 'speed') return ['max', 'fpMax', 'st', 'ht', 'dx', 'speed', 'dodge', 'parry', 'block'];
    return STAT_KEYS;
  }
  // A pool's current figure that follows its max: HP its `max`, FP and MP theirs.
  const FOLLOWS = { max: 'hp', fpMax: 'fp', mpMax: 'mp', sanMax: 'san', erMax: 'er' };
  // A max typed (or worked out) on a row: a row with no figure in the pool, or one that was full, takes the new
  // max (final review P4.3: 21, a slip to 2, then 20 gives 20/20); the figure never goes above it.
  function fitMax(r, maxKey, n) {
    const cur = FOLLOWS[maxKey];
    const was = r[maxKey];
    r[maxKey] = n;
    if (!cur || n === null) return;
    if (!isNum(r[cur])) r[cur] = n;
    else if (isNum(was) && r[cur] === was) r[cur] = n;
    if (isNum(r[cur]) && r[cur] > n) r[cur] = n;
  }
  const typedKey = (r, k, on) => {
    if (!r.typedKeys || typeof r.typedKeys !== 'object' || Array.isArray(r.typedKeys)) r.typedKeys = {};
    if (on) r.typedKeys[k] = true; else delete r.typedKeys[k];
  };
  // The word an initiative goes by in the fixed-order line.
  const initWord = (rules) => (rules.initiative === 'speed' ? 'Speed' : 'initiative');

  // A row given a number is re-placed by one insert, the turn kept: after Start always (ruling "latest entry wins"),
  // and before Start where the order opens sorted (CoC and GURPS; D&D's Sort is the GM's button). The log says so
  // after Start when it moved (`quiet` drops that line, for a caller that wrote its own). `hold` sets the number
  // only and marks the row `held`, for placeHeld. In a fixed order (GURPS after Start, B363) a row with a place keeps
  // it, with a log line; a row without one (added after Start, or blank at Start) takes its place when its first
  // number arrives, and is fixed from then on.
  function replace(s, f, r, at, opts) {
    const o = opts || {};
    const rules = FM.rulesOf(f);
    if (o.hold) { r.held = true; return; }
    if (r.held) r.held = false;
    if (!f.started) {
      if (rules.initiative === 'roll' || rules.initiative === undefined) return;
      f.rows = FM.placeRow(f.rows, r.id, rules);
      return;
    }
    if (rules.orderFixed) {
      if (r.fixed) { say(s, f, at, `${nameOf(s, f, r)}: ${initWord(rules)} ${isNum(r.ini) ? r.ini : 'cleared'}; the order stays as it started.`); return; }
      if (!isNum(r.ini)) return;
      r.fixed = true;
    }
    const was = f.rows.indexOf(r);
    f.rows = FM.placeRow(f.rows, r.id, rules);
    if (f.rows.indexOf(r) !== was && !o.quiet) say(s, f, at, `${nameOf(s, f, r)} moves in the order: initiative ${isNum(r.ini) ? r.ini : 'cleared'}.`);
  }
  // Every ticked-in row with a number holds its place in a fixed order (at Start, and at a Sort after it). A row
  // benched then has no place yet: ticked in later, it takes one (placeLate).
  const fixAll = (f) => { if (FM.rulesOf(f).orderFixed) for (const r of f.rows) if (r.in && isNum(r.ini)) r.fixed = true; };
  // In a fixed order after Start, a ticked-in row with a number and no place yet (it joined, or was ticked in, after
  // Start) takes its sorted place by one insert, the turn kept, and holds it from then on.
  function placeLate(f, r) {
    if (!f.started || !FM.rulesOf(f).orderFixed || !r.in || r.fixed || r.kind === 'lair' || !isNum(r.ini)) return;
    f.rows = FM.placeRow(f.rows, r.id, FM.rulesOf(f));
    r.fixed = true;
  }

  // The stats setStat takes, each to its row fields (the brief's one map); `ini` follows from DEX and Speed.
  // CoC's combat figures are the panel's boxes (Task 7); their full use is Tasks 16-17's.
  const STAT_FIELDS = {
    st: ['st'], ht: ['ht'], dx: ['dx'], dex: ['dex'], speed: ['speed'], hp: ['max'], fp: ['fpMax'], mp: ['mpMax'],
    san: ['san', 'sanMax'], dodge: ['dodge'], parry: ['parry'], block: ['block'], dr: ['dr'],
    fighting: ['fighting'], firearms: ['firearms'], db: ['db'], armour: ['armour'], build: ['build'], attacks: ['attacks'],
  };
  // The keys setStat takes, by the rules' initiative: GURPS's stats, pools and defences; CoC's DEX, MP, SAN, HP and
  // combat figures; none for D&D (its panel has setMax and setAc).
  function setStatKeysOf(rules) {
    const ru = FM.rulesOf({ rules });
    if (ru.initiative === 'speed') return ['st', 'ht', 'dx', 'hp', 'fp', 'speed', 'dodge', 'parry', 'block', 'dr'];
    if (ru.initiative === 'dex') return ['dex', 'mp', 'san', 'hp', 'fighting', 'firearms', 'dodge', 'db', 'armour', 'build', 'attacks'];
    return [];
  }
  // DR and CoC's damage bonus may be words (`2 (face 0)`, `+1D4`); Build and a damage bonus may be below 0.
  const WORDS_OK = new Set(['dr', 'db']);
  const SIGNED = new Set(['build', 'db']);
  // A worked-out figure's `from` key, cleared when the GM types the figure itself.
  const FROM_KEY = { max: 'hp', fpMax: 'fp', mpMax: 'mp', speed: 'speed' };

  // GURPS's worked-out figures (gurps-math's deriveGurps, the one copy): HP from ST, FP from HT, Basic Speed from
  // DX and HT, each only where the GM did not type it and the row's own block did not state it, marked in `from`.
  function deriveStats(r) {
    if (!GM || typeof GM.deriveGurps !== 'function') return;
    const from = r.from && typeof r.from === 'object' && !Array.isArray(r.from) ? r.from : {};
    const stated = (field) => isNum(r[field]) && !from[FROM_KEY[field]];
    const tk = r.typedKeys || {};
    const keep = { max: Boolean(tk.max) || stated('max'), fpMax: Boolean(tk.fpMax) || stated('fpMax'), speed: Boolean(tk.speed) || stated('speed') };
    const d = GM.deriveGurps(r, keep);
    r.from = { ...from };
    if (d.max !== undefined) { fitMax(r, 'max', d.max); r.from.hp = d.from.hp; }
    if (d.fpMax !== undefined) { fitMax(r, 'fpMax', d.fpMax); r.from.fp = d.from.fp; }
    if (d.speed !== undefined) { r.speed = d.speed; r.from.speed = d.from.speed; }
  }

  // An entry into a pool other than HP (CoC's `m-4`, `s-6`; GURPS's `f-8`): it stops at the pool's floor and cap
  // (FM.afterPool); reaching 0 is logged, and GURPS's Tired follows FP. A row with no figure in the pool is unchanged.
  function poolEntry(s, f, r, e, at) {
    const pool = FM.poolOf(FM.rulesOf(f), e.pool);
    const next = FM.afterPool(r, pool, e);
    if (next === null) return;
    const was = r[pool.key];
    r[pool.key] = next;
    touch(r, at);
    r.poolAt = at;
    if (was > 0 && next <= 0) say(s, f, at, `${nameOf(s, f, r)}: ${pool.label || pool.key} ${next === 0 && isNum(pool.floor) && pool.floor === 0 ? '0' : '0 or less'}.`);
    settleTired(s, f, r, at);
  }

  // A hit (GURPS, Task 12): GM.gurpsInjury's injury to HP (a `fat` hit's to FP), `r.hit` { line, injury, location,
  // side, type } for Task 13, the working logged, a `crippled` place added and logged once.
  function hitEntry(s, f, r, e, at) {
    const out = GM.gurpsInjury({ ...e.hit, n: e.n, dice: e.dice || null }, r, FM.rulesOf(f).wounding);
    r.hit = { line: out.line, injury: out.injury, location: out.location, side: out.side, type: out.type };
    touch(r, at);
    say(s, f, at, `${nameOf(s, f, r)}, ${out.place}: ${out.line}.`);
    if (out.injury <= 0) return;
    if (out.type === 'fat') { poolEntry(s, f, r, { pool: 'fp', kind: 'damage', n: out.injury }, at); return; }
    const before = r.hp;
    const temp = r.temp;
    const over = overOf(hurt(f, r, out.injury, false), temp, before);
    touchIfHp(r, at, before, r.max);
    if (out.crippled) {
      const mark = `crippled (${out.place})`;
      const had = Array.isArray(r.crippled) ? r.crippled : [];
      if (!had.includes(out.place)) { r.crippled = had.concat(out.place); say(s, f, at, `${nameOf(s, f, r)}: ${mark}.`); }
    }
    afterHp(s, f, r, before, at, { over });
    owed(f, r, before, out.injury, { location: out.location, place: out.place, crippled: out.crippled });
  }

  // ---- what a hit and a turn owe (GURPS, Task 13): the shock chip and cards of prompts, never an outcome ----
  // The system's consequences table (model.rules.fight.consequences); null where there is none (D&D, CoC).
  const consequencesOf = (f) => {
    const C = FM.rulesOf(f).consequences;
    return C && typeof C === 'object' && GM && typeof GM.cardForHit === 'function' ? C : null;
  };
  const cardsOf = (r) => { if (!Array.isArray(r.cards)) r.cards = []; return r.cards; };
  // A card's id is the fight's count, so a replay makes the same ids.
  function addCard(f, r, kind, lines, what) {
    f.cardN = (isNum(f.cardN) ? f.cardN : 0) + 1;
    cardsOf(r).push({ id: `k${f.cardN}`, kind, lines, ...(what ? { what } : {}) });
  }
  // A card of this kind (a turn's start or end) replaces the row's last one, answered or not.
  function replaceCards(f, r, kind, cards) {
    if (!cards.length && !(Array.isArray(r.cards) && r.cards.some((c) => c.kind === kind))) return;
    r.cards = cardsOf(r).filter((c) => c.kind !== kind);
    for (const c of cards) addCard(f, r, c.kind, c.lines);
  }
  // Injury a row took (a typed hit, a raw number, an area's share): its shock (B419), added to any still on, and a
  // card when it owes more than shock. `shockEnds` counts the row's turn ends left. `hit` is null for raw injury.
  function owed(f, r, before, injury, hit) {
    const C = consequencesOf(f);
    if (!C || !isNum(injury) || injury <= 0) return;
    const out = GM.cardForHit(r, { injury, before, location: hit ? hit.location : null, crippled: Boolean(hit && hit.crippled) }, C);
    if (out.shock > 0) {
      const cap = C.shock && isNum(C.shock.cap) ? C.shock.cap : out.shock;
      r.shock = Math.min(cap, (isNum(r.shock) ? r.shock : 0) + out.shock);
      r.shockEnds = f.turn === r.id ? 2 : 1;
    }
    if (out.lines.length) addCard(f, r, 'hit', out.lines, `${injury} injury${hit && hit.place ? `, ${hit.place}` : ''}`);
  }
  // A row's turn ends: its shock counts down, and HT to recover while it is Stunned.
  function turnEnds(f, r, at) {
    const C = consequencesOf(f);
    if (!C || !r) return;
    if (isNum(r.shock) && r.shock > 0) {
      r.shockEnds = (isNum(r.shockEnds) ? r.shockEnds : 1) - 1;
      if (r.shockEnds <= 0) { r.shock = 0; r.shockEnds = 0; }
      touch(r, at);
    }
    replaceCards(f, r, 'recover', GM.cardsAtTurnEnd(r, C));
  }
  // A row's turn starts: HT to stay conscious at 0 HP or less.
  function turnStarts(f, r) {
    const C = consequencesOf(f);
    if (C && r) replaceCards(f, r, 'conscious', GM.cardsAtTurnStart(r, C));
  }
  // Already Mortal wound for line `i`: the row has the status, or an earlier line of this card offers or took it.
  const mortalBefore = (r, card, C, i) => (r.conds || []).includes(C.mortalStatus)
    || card.lines.slice(0, i).some((x) => x.taken === 'mortal' || (GM.pending(x) && x.offers.includes('mortal')));
  // Rolled lines from `from` on that nobody has answered take their offers again as things stand now.
  function reoffer(r, card, C, from) {
    for (let i = from; i < card.lines.length; i++) {
      const l = card.lines[i];
      if (l.result && !l.taken && !l.declined) l.offers = GM.offersFor(l, l.result, C, mortalBefore(r, card, C, i));
    }
  }
  const cardOf = (r, id) => (Array.isArray(r.cards) ? r.cards.find((c) => c.id === id) || null : null);
  const dropCard = (r, id) => { r.cards = cardsOf(r).filter((c) => c.id !== id); };

  const FIGHT_HANDLERS = {
    fightStart(s, a, at) {
      if (s.fight || a.id == null || !Array.isArray(a.rows)) return;
      const f = {
        id: a.id, beat: a.beat || null, title: String(a.title || ''), groups: clone(a.groups || []),
        round: 0, turn: null, started: false, sorted: false, paused: false, lastFoe: null,
        rows: clone(a.rows).map((r) => entered(r, at)), thresholds: clone(a.thresholds || []), lit: {}, startedAt: at,
        carried: clone(a.carried || {}),
      };
      // the system's part for the reducer (model.rules.fight, step 6b): a fight with none runs as D&D (FM.rulesOf)
      if (a.rules && typeof a.rules === 'object' && !Array.isArray(a.rules)) f.rules = clone(a.rules);
      numberUnseen(f);
      lairOf(f);
      // CoC and GURPS sort at Fight (S6-D8), when the order opens prefilled from DEX or Speed, blanks last; D&D's
      // Sort stays the GM's button. Held rows sort with the rest, and the marks a row enters with are set quietly.
      const rules = FM.rulesOf(f);
      if (rules.initiative !== 'roll' && rules.initiative !== undefined) {
        f.rows = FM.sortRows(f.rows, rules);
        f.sorted = true;
        for (const r of f.rows) if (r.held) r.held = false;
      }
      for (const r of f.rows) { settleMarks(s, f, r, at, true); settleTired(s, f, r, at, true); }
      // Fight here (plan 6a Task 7, review P3): the place goes behind the focused group's panel until End fight
      const bd = a.backdrop;
      if (bd && typeof bd === 'object' && typeof bd.group === 'string' && bd.group && typeof bd.place === 'string' && bd.place) {
        if (!s.panels || typeof s.panels !== 'object' || Array.isArray(s.panels)) s.panels = {};
        const p = s.panels[bd.group] && typeof s.panels[bd.group] === 'object' ? s.panels[bd.group] : (s.panels[bd.group] = { people: [], backdrop: null, placeOff: false });
        p.backdrop = bd.place;
        f.backdrop = { group: bd.group, place: bd.place };
      }
      s.fight = f;
      say(s, f, at, `Fight starts at ${f.title || 'the fight'}.`);
    },
    fightJoin(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      const ids = new Set(f.rows.map((r) => r.id));
      // A group or beat joined from two windows at once brings its planned foes once; a PC never joins twice.
      // Add by name (no `planned`) keeps its copies.
      const keys = new Set(a.planned ? f.rows.map((r) => r.foeKey).filter(Boolean) : []);
      const pcs = new Set(f.rows.filter((r) => r.kind === 'pc').map((r) => r.note));
      const dupe = (r) => (r.kind === 'pc' ? pcs.has(r.note) : Boolean(r.foeKey) && keys.has(r.foeKey));
      const added = clone(a.rows || []).filter((r) => r && r.id != null && !ids.has(r.id) && !dupe(r)).map((r) => entered(r, at));
      // a second Lair row never joins: the fight's own lists the newcomers
      const fresh = f.rows.some((r) => r.kind === 'lair') ? added.filter((r) => r.kind !== 'lair') : added;
      f.rows.push(...fresh);
      const ticked = [];
      for (const id of a.tick || []) {
        const r = rowOf(f, id);
        if (r && !r.in) { r.in = true; touch(r, at); ticked.push(r); }
      }
      const groups = (a.groups || []).filter((g) => !f.groups.includes(g));
      f.groups.push(...groups);
      const have = new Set((f.thresholds || []).map((t) => t.key));
      let newThresholds = 0;
      for (const t of clone(a.thresholds || [])) if (!have.has(t.key)) { f.thresholds.push(t); have.add(t.key); newThresholds += 1; }
      for (const [note, name] of Object.entries(a.carried || {})) if (!f.carried[note]) f.carried[note] = name;
      // newcomers go to the bottom until the next Sort; the turn stays with its row. In a fixed order after Start
      // (GURPS), a newcomer with its Speed takes its place by one insert and holds it; one without waits for it.
      for (const r of fresh.concat(ticked)) placeLate(f, r);
      for (const r of fresh) { settleMarks(s, f, r, at, true); settleTired(s, f, r, at, true); }
      numberUnseen(f);
      lairOf(f);
      if (!fresh.length && !ticked.length && !groups.length) return;
      // a benched newcomer (a statless NPC, an Entities NPC) sits out until ticked: the line names who is in
      const who = fresh.concat(ticked).filter((r) => r.kind !== 'lair' && r.in !== false);
      const label = String(a.label || '').trim() || who.map((r) => nameOf(s, f, r, true)).join(', ');
      if (label && who.length) say(s, f, at, `${label} ${who.length > 1 ? 'join' : 'joins'} the fight.`);
      // a join that only added rows can be taken back: its line and its rows carry the join's id, for Undo. A group
      // or beat join (it ticks, adds groups or thresholds) carries none, so `undoable` says no to it.
      if (label && fresh.length && a.id != null && !ticked.length && !groups.length && !newThresholds) {
        s.events[s.events.length - 1].join = a.id;
        for (const r of fresh) r.joinId = a.id;
      }
    },
    fightTick: onRow((s, f, r, a, at) => {
      r.in = !!a.in;
      touch(r, at);
      placeLate(f, r);
      numberUnseen(f);
      // an owner ticked in later gets the fight's Lair row when it has none
      if (r.in && r.lair && r.kind !== 'lair' && !f.rows.some((x) => x.kind === 'lair')) f.rows.push({ ...FM.lairRow([r], r.group), id: `${a.id || f.id}-lair` });
      lairOf(f);
    }),
    // Before Start the number is all that changes (Sort stays the GM's button). After Start the latest entry
    // wins (ruling "latest entry wins", step6.md): that one row is re-placed by one insert at its sorted
    // place, the rest are not re-sorted, and `f.turn` stays on the same row.
    // The number keeps the rules' decimals (GURPS's 5.25), never truncated; more places than that is refused.
    // `hold` sets the number without moving the row (placeHeld moves it).
    setInit: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const clear = a.ini === null || a.ini === '' || a.ini === undefined;
      if (clear) r.ini = null;
      else { const n = figureIn(a.ini, initPlaces(FM.rulesOf(f))); if (n === null) return; r.ini = n; }
      r.typed = true;
      typedKey(r, 'ini', !clear);
      touch(r, at);
      replace(s, f, r, at, { hold: a.hold });
    }),
    // Roll fills only boxes still empty, so a number typed meanwhile wins; a PC's box is never rolled.
    rollInit(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      for (const [id, v] of Object.entries(a.values || {})) {
        const r = rowOf(f, id);
        const n = figureIn(v, initPlaces(FM.rulesOf(f)));
        if (!r || r.kind === 'pc' || n === null || isNum(r.ini)) continue;
        r.ini = n;
        touch(r, at);
        replace(s, f, r, at);
      }
    },
    // In a fixed order after Start (GURPS), Sort is how a mistyped Speed is put right: the whole order once, the
    // turn kept on its row, with a line naming the new order.
    fightSort(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      f.rows = FM.sortRows(f.rows, FM.rulesOf(f));
      f.sorted = true;
      for (const r of f.rows) if (r.held) r.held = false;
      if (f.started && FM.rulesOf(f).orderFixed) {
        fixAll(f);
        const items = f.rows.filter((r) => FM.takesTurn(r, f.rows)).map((r) => ({ id: r.id, text: `${nameOf(s, f, r, true)}${isNum(r.ini) ? ` ${r.ini}` : ''}` }));
        sayRoster(s, f, at, 'The order is sorted again: ', items, '.');
      }
    },
    // Re-places every held row by one insert each, the turn kept (the page sends it, Task 23).
    placeHeld(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      for (const r of f.rows.filter((x) => x.held)) replace(s, f, r, at);
    },
    // Built on a turn and a round: a second Next built on the same turn is dropped (Review M3).
    fightNext(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      if ((a.from === undefined ? null : a.from) !== f.turn || a.round !== f.round) return;
      if (!f.started) {
        // Start sorts held rows with the rest: all of them when the order is not sorted yet, else one insert each
        if (!f.sorted) { f.rows = FM.sortRows(f.rows, FM.rulesOf(f)); f.sorted = true; }
        else for (const r of f.rows.filter((x) => x.held)) f.rows = FM.placeRow(f.rows, r.id, FM.rulesOf(f));
        for (const r of f.rows) if (r.held) r.held = false;
        const first = FM.nextLive(f.rows, null).row;
        if (!first) return;
        fixAll(f);
        f.started = true;
        f.round = 1;
        f.turn = first.id;
        const order = f.rows.filter((r) => FM.takesTurn(r, f.rows)).map((r) => ({ id: r.id, text: `${nameOf(s, f, r, true)}${isNum(r.ini) ? ` ${r.ini}` : ''}` }));
        sayRoster(s, f, at, 'Round 1: ', order, '.');
        turnStart(f, first, at);
        turnStarts(f, first);
        return;
      }
      const ending = rowOf(f, f.turn);
      const { row, wrapped } = FM.nextLive(f.rows, f.turn);
      if (!row) return;
      turnEnds(f, ending, at);
      if (wrapped) {
        sayRoster(s, f, at, `Round ${f.round} ends: `, rosterItems(s, f), '.');
        f.round += 1;
      }
      f.turn = row.id;
      turnStart(f, row, at);
      turnStarts(f, row);
    },
    // `rolled` is the server's total for an entry of dice (`2d+1 imp vitals`): the page rolls, never the reducer.
    hp: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const e = FM.parseEntry(a.entry, FM.rulesOf(f));
      if (!e) return;
      if (e.dice) {
        const n = int(a.rolled);
        if (n === null || n < 0 || n > 9999 || Number(a.rolled) !== n) return;
        e.n = n;
      }
      // the last hit's working stays on the row until the next entry
      if (r.hit) { r.hit = null; touch(r, at); }
      if (e.hit) { hitEntry(s, f, r, e, at); return; }
      if (e.dice) say(s, f, at, `${nameOf(s, f, r)}: ${e.dice} = ${e.n}.`);
      if (e.pool !== 'hp' && e.pool !== 'temp') { poolEntry(s, f, r, e, at); return; }
      const before = r.hp;
      const temp = r.temp;
      let over = null;
      let took = null;
      if (e.kind === 'temp') r.temp = e.n;
      else if (e.kind === 'heal') { if (!isNum(r.hp)) return; r.hp = FM.afterHeal({ hp: r.hp, max: r.max }, e.n); } else { took = hurt(f, r, e.n, r.half); over = overOf(took, temp, before); r.half = false; }
      touchIfHp(r, at, before, r.max);
      afterHp(s, f, r, before, at, { over });
      // raw injury (`-9`, a bare `2d+1`) owes its shock and the lines it crosses (GURPS)
      if (took !== null) owed(f, r, before, took, null);
    }),
    half: onRow((s, f, r, a, at) => { r.half = !!a.on; touch(r, at); }),
    // A card's line rolled (GURPS, Task 13): the server's result onto the card's next line (the reducer never rolls,
    // so a replay is the same). Dropped when the line is not the next, or HT changed since the roll was asked.
    cardRolled: onRow((s, f, r, a, at) => {
      const C = consequencesOf(f);
      const card = C && cardOf(r, a.card);
      if (!card) return;
      const i = GM.nextLine(card, C);
      const res = GM.rollResult(a.result);
      if (i < 0 || a.line !== i || !res) return;
      const l = card.lines[i];
      if (GM.lineTarget(l, r) !== res.target) return;
      l.result = res;
      l.offers = GM.offersFor(l, res, C, mortalBefore(r, card, C, i));
      touch(r, at);
      say(s, f, at, `${nameOf(s, f, r)}: ${GM.lineText(l, r, C, true)}, ${GM.resultText(res)}.`);
      if (GM.cardDone(card, C)) dropCard(r, card.id);
    }),
    // A card answered: one of a line's offers applied (`line`, `take`), the card's standing Out (`take: 'out'`), or the
    // card dismissed (`take: 'dismiss'`, no log line). Each applied tap is one log line.
    card: onRow((s, f, r, a, at) => {
      const C = consequencesOf(f);
      const card = C && cardOf(r, a.card);
      if (!card) return;
      // a dismissed line: its offers declined, nothing logged; the lines after it that were rolled are offered again
      // as they stand now (a declined Mortal wound no longer counts for them)
      if (a.take === 'dismiss' && a.line !== undefined && a.line !== null) {
        const l = card.lines[a.line];
        if (!l || !GM.pending(l)) return;
        l.offers = [];
        l.declined = true;
        reoffer(r, card, C, a.line + 1);
        touch(r, at);
        if (GM.cardDone(card, C)) dropCard(r, card.id);
        return;
      }
      if (a.take === 'dismiss') { dropCard(r, card.id); touch(r, at); return; }
      if (a.take === 'out') {
        dropCard(r, card.id);
        touch(r, at);
        if (!r.out) { r.out = true; say(s, f, at, `${nameOf(s, f, r)} is out of the fight.`); }
        return;
      }
      const l = card.lines[a.line];
      const o = GM.offerOf(C, a.take);
      if (!l || !o || !GM.pending(l) || !l.offers.includes(a.take)) return;
      l.taken = a.take;
      for (const st of o.add || []) if (!r.conds.includes(st)) r.conds.push(st);
      if (o.remove) r.conds = r.conds.filter((c) => !o.remove.includes(c));
      if (o.out) r.out = true;
      touch(r, at);
      say(s, f, at, `${nameOf(s, f, r)}: ${GM.lineName(l, C, true)}: ${o.label}.`);
      if (GM.cardDone(card, C)) dropCard(r, card.id);
    }),
    // The shock chip tapped (GURPS): its size set, 1 to the cap, or 0 to clear; a new one lasts to the end of the row's
    // next turn.
    setShock: onRow((s, f, r, a, at) => {
      const C = consequencesOf(f);
      const n = int(a.n);
      const cap = C && C.shock && isNum(C.shock.cap) ? C.shock.cap : null;
      if (!C || n === null || n < 0 || (cap !== null && n > cap) || Number(a.n) !== n) return;
      if (!(isNum(r.shock) && r.shock > 0) && n > 0) r.shockEnds = f.turn === r.id ? 2 : 1;
      r.shock = n;
      if (n === 0) r.shockEnds = 0;
      touch(r, at);
    }),
    resisted: onRow((s, f, r, a, at) => { r.resisted = !!a.on; touch(r, at); }),
    // the face-open toggle (GURPS, Task 12), read by GM.gurpsInjury
    faceOpen: onRow((s, f, r, a, at) => { if (r.kind === 'lair') return; r.faceOpen = !!a.on; touch(r, at); }),
    // A max typed on a row with no numbers sets its HP too, so a stock creature runs once its HP is typed; a row that
    // was full stays full, and HP never goes above the maximum (SRD) (fitMax).
    setMax: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const clear = a.max === null || a.max === '';
      const n = clear ? null : int(a.max);
      if (!clear && (n === null || n < 0)) return;
      const before = r.hp;
      const maxBefore = r.max;
      fitMax(r, 'max', n);
      r.typed = true;
      typedKey(r, 'max', !clear);
      if (r.from && r.from.hp) { r.from = { ...r.from }; delete r.from.hp; }
      touchIfHp(r, at, before, maxBefore);
      afterHp(s, f, r, before, at);
    }),
    setAc: onRow((s, f, r, a, at) => {
      const n = a.ac === null || a.ac === '' ? null : int(a.ac);
      if (n === null && a.ac !== null && a.ac !== '') return;
      r.ac = n;
      r.typed = true;
      typedKey(r, 'ac', n !== null);
      touch(r, at);
    }),
    // A stat typed in the panel (latest entry wins): `key` is one of STAT_FIELDS's, `value` a number (Speed to two
    // places; DR and DB may be text, Build and DB below 0), or blank to clear it. GURPS works out the figures not
    // typed (deriveStats); a new DEX or Speed replaces the initiative and re-places the row (replace), a blank one
    // never clears it. `hold` as setInit.
    setStat: onRow((s, f, r, a, at) => {
      const rules = FM.rulesOf(f);
      if (r.kind === 'lair' || typeof a.key !== 'string' || !has(STAT_FIELDS, a.key) || !setStatKeysOf(rules).includes(a.key)) return;
      const clear = a.value === null || a.value === '' || a.value === undefined;
      let v = null;
      if (!clear) {
        if (WORDS_OK.has(a.key) && typeof a.value === 'string' && !isNum(Number(a.value))) v = a.value.replace(/\s+/g, ' ').trim().slice(0, 40) || null;
        else v = figureIn(a.value, a.key === 'speed' ? 2 : 0);
        if (v === null || (isNum(v) && v < 0 && !SIGNED.has(a.key))) return;
      }
      const before = r.hp;
      const maxBefore = r.max;
      const fpBefore = r.fp;
      const iniBefore = FM.initOf(r, rules);
      for (const k of STAT_FIELDS[a.key]) {
        if (has(FOLLOWS, k)) fitMax(r, k, v); else r[k] = v;
        typedKey(r, k, !clear);
        if (FROM_KEY[k] && r.from && r.from[FROM_KEY[k]]) { r.from = { ...r.from }; delete r.from[FROM_KEY[k]]; }
      }
      if (rules.initiative === 'speed') deriveStats(r);
      r.typed = true;
      if (r.hp !== before || r.max !== maxBefore) touchHp(r, at); else touch(r, at);
      if (r.fp !== fpBefore) r.poolAt = at;
      // DEX or Speed typed is the latest initiative entry; another stat changes the initiative only when the figure
      // it is worked out from moved (an ST typed never undoes a typed initiative)
      const ini = FM.initOf(r, rules);
      const own = a.key === 'dex' || a.key === 'speed';
      if (ini !== null && ini !== r.ini && (own || ini !== iniBefore)) {
        r.ini = ini;
        // a worked-out Speed that replaces a typed initiative leaves it untyped
        if (!own) typedKey(r, 'ini', false);
        if (!(f.started && rules.orderFixed && r.fixed)) say(s, f, at, `${nameOf(s, f, r)}: initiative ${ini} from the typed stats.`);
        replace(s, f, r, at, { hold: a.hold, quiet: true });
      }
      // DEX or Speed typed with a number is a typed initiative, even when it equals the one the row had
      if (own && ini !== null) typedKey(r, 'ini', true);
      afterHp(s, f, r, before, at);
      settleTired(s, f, r, at);
    }),
    // CoC's firearm ready: its initiative is DEX plus the rules' firearmBonus while it is on, re-placed as a typed
    // number is (after Start, and before it where the order opened sorted).
    firearm: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const on = !!a.on;
      if (!!r.gun === on) return;
      r.gun = on;
      touch(r, at);
      const ini = FM.initOf(r, FM.rulesOf(f));
      if (ini !== null && ini !== r.ini) { r.ini = ini; replace(s, f, r, at, { hold: a.hold }); }
    }),
    // A counted row's typed numbers go to the others of this group nobody has typed into, hurt or given a status
    // (FM.untouched), and their HP is the max. The stat keys come (`STAT_KEYS`: max, ac and mod for D&D);
    // nothing else does (not HP, initiative, side, seen or typed).
    sameForAll: onRow((s, f, r, a, at) => {
      const others = FM.groupMates(f.rows, r).filter((x) => x !== r && FM.untouched(x, true));
      if (!others.length) return;
      const fields = statKeysOf(FM.rulesOf(f)).filter((k) => isNum(r[k]));
      for (const x of others) {
        for (const k of fields) x[k] = r[k];
        // each pool full at the copied max (HP as before)
        for (const k of fields) if (k !== 'max' && FOLLOWS[k]) x[FOLLOWS[k]] = r[k];
        if (isNum(r.max)) x.hp = r.max;
        x.copied = { hp: x.hp, max: x.max };
        touchHp(x, at);
      }
      // naming the copies in this line marks them touched, rightly: copying numbers onto them is an act on them
      say(s, f, at, `${others.map((x) => nameOf(s, f, x)).join(', ')}: the same numbers as ${nameOf(s, f, r)}.`);
    }),
    // Takes back the rows one join added, while none has been touched. One line says so; the join's own line
    // goes with its rows, so no line of the fight names an undone row (the Table Log never will).
    undoAdd(s, a, at) {
      const f = running(s, a);
      if (!f || a.join == null) return;
      const line = s.events.findIndex((e) => e.fight && e.join === a.join);
      if (line < 0 || !FM.undoable(f, a.join)) return;
      const gone = f.rows.filter((r) => r.joinId === a.join);
      const ids = new Set(gone.map((r) => r.id));
      f.rows = f.rows.filter((r) => !ids.has(r.id));
      for (const r of f.rows) if (r.kind === 'lair') r.of = (r.of || []).filter((id) => !ids.has(id));
      s.events.splice(line, 1);
      // a roster line written since the join is rewritten without the undone rows
      for (const e of s.events) {
        if (!e.roster || !e.roster.items.some((x) => ids.has(x.id))) continue;
        e.roster.items = e.roster.items.filter((x) => !ids.has(x.id));
        e.text = rosterText(e.roster.head, e.roster.items, e.roster.tail);
      }
      const counts = new Map();
      for (const r of gone.filter((x) => x.kind !== 'lair')) { const k = String(r.name).replace(/\s+\d+$/, ''); counts.set(k, (counts.get(k) || 0) + 1); }
      say(s, f, at, `Took back: ${[...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')}.`);
      s.events[s.events.length - 1].tookBack = true;
    },
    status: onRow((s, f, r, a, at) => {
      if (a.add !== undefined) {
        const name = String(a.add || '').replace(/\s+/g, ' ').trim();
        if (!name || r.conds.includes(name)) return;
        r.conds.push(name);
        // SRD 5.2.1: Concentration ends when the concentrator is Incapacitated, a condition these all include
        if (r.conc && INCAPACITATING.has(name)) { r.conc = false; say(s, f, at, `${nameOf(s, f, r)}'s concentration ends.`); }
      } else if (a.remove !== undefined) {
        if (!r.conds.includes(a.remove)) return;
        r.conds = r.conds.filter((c) => c !== a.remove);
      } else return;
      touch(r, at);
    }),
    exhaustion: onRow((s, f, r, a, at) => {
      const n = int(a.level);
      if (n === null) return;
      r.exhaustion = clamp(n, 0, FM.EXHAUSTION_MAX);
      touch(r, at);
    }),
    concentrating: onRow((s, f, r, a, at) => { r.conc = !!a.on; touch(r, at); }),
    // Three successes add Stable, reset both counts and are logged; three failures are logged only, since the GM rules.
    deathSave: onRow((s, f, r, a, at) => {
      const was = { s: (r.ds && r.ds.s) || 0, f: (r.ds && r.ds.f) || 0 };
      const next = { ...was };
      if (a.s !== undefined) { const n = int(a.s); if (n !== null) next.s = clamp(n, 0, 3); }
      if (a.f !== undefined) { const n = int(a.f); if (n !== null) next.f = clamp(n, 0, 3); }
      r.ds = next;
      touch(r, at);
      if (next.s === 3 && was.s < 3) {
        if (!r.conds.includes('Stable')) r.conds.push('Stable');
        r.ds = { s: 0, f: 0 };
        say(s, f, at, `${nameOf(s, f, r)} is Stable.`);
      }
      else if (next.f === 3 && was.f < 3) say(s, f, at, `${nameOf(s, f, r)} has failed three death saves.`);
    }),
    out: onRow((s, f, r, a, at) => {
      const on = !!a.on;
      if (r.out === on) return;
      r.out = on;
      touch(r, at);
      say(s, f, at, on ? `${nameOf(s, f, r)} is out of the fight.` : `${nameOf(s, f, r)} is back in the fight.`);
    }),
    counter: onRow((s, f, r, a, at) => {
      if (a.kind !== 'lr' && a.kind !== 'la') return;
      const n = int(a.value);
      if (n === null) return;
      r[a.kind] = clamp(n, 0, r[`${a.kind}Max`] || 0);
      touch(r, at);
    }),
    recharge: onRow((s, f, r, a, at) => {
      const rc = (r.recharge || []).find((x) => x.name === a.name);
      if (!rc) return;
      rc.ready = !!a.ready;
      touch(r, at);
    }),
    // Decision 4: one roll per row, name and round; a ready recharge takes none; at or over `at` makes it ready.
    rechargeRoll: onRow((s, f, r, a, at) => {
      const rc = (r.recharge || []).find((x) => x.name === a.name);
      const roll = int(a.roll);
      if (!rc || rc.ready || roll === null || a.round !== f.round || (rc.rolled && rc.rolled.round === a.round)) return;
      rc.rolled = { round: a.round, roll };
      if (roll >= (isNum(rc.at) ? rc.at : 6)) rc.ready = true;
      touch(r, at);
    }),
    // One log line naming each hit, then what follows each (drops, Down, thresholds).
    area(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      const n = int(a.amount);
      if (n === null || n < 0 || n > 9999) return;
      const done = new Set();
      const hits = [];
      for (const h of a.hits || []) {
        const r = h && rowOf(f, h.row);
        if (!r || r.kind === 'lair' || done.has(r.id)) continue;
        done.add(r.id);
        const before = r.hp;
        const temp = r.temp;
        const took = hurt(f, r, n, !!h.half);
        touchIfHp(r, at, before, r.max);
        hits.push({ r, before, took, half: !!h.half, over: overOf(took, temp, before) });
      }
      let spent = null;
      if (a.spend && a.spend.row != null) {
        const r = rowOf(f, a.spend.row);
        const rc = r && (r.recharge || []).find((x) => x.name === a.spend.name);
        if (rc) { rc.ready = false; touch(r, at); spent = rc.name; }
      }
      if (!hits.length && !spent) return;
      const list = hits.map((x) => `${nameOf(s, f, x.r)} ${x.took}${x.half ? ' (half)' : ''}`).join(', ');
      say(s, f, at, `${spent ? `${spent}: ` : 'Area: '}${n} damage${list ? ` to ${list}` : ''}.`);
      for (const x of hits) { afterHp(s, f, x.r, x.before, at, { over: x.over }); owed(f, x.r, x.before, x.took, null); }
    },
    // A foe's, or an ally's (one the reader inferred starts unseen): the GM's tick is kept apart as `seenTick`,
    // so a side switched later leaves it standing.
    seen: onRow((s, f, r, a, at) => {
      if (r.kind !== 'foe' && r.kind !== 'ally') return;
      r.seen = !!a.on;
      r.seenTick = r.seen;
      touch(r, at);
      // back to unseen: a row that never had a number takes the next one
      if (!r.seen) numberUnseen(f);
    }),
    // The GM sets a row's side (plan 6a): ally makes it seen. Leaving ally, a row the players have seen and
    // that is ticked in stays seen (its name only, a foe's keys: plan 6a fix round 1 / review I2); else it is
    // as seen as a foe starts (the GM's own tick, else shown before or the model's seenFrom the row carries),
    // so a Plan ally turned never puts its name on the players' screen by itself. Foe to neutral and back
    // leaves seen alone: the players see the two alike. The note's side is kept in `s.sides` (which the next
    // fight starts from and the Table Log carries) only while every copy of it in the fight has that side:
    // one Guard of three turned is that Guard's, never the note's (review C1).
    setSide: onRow((s, f, r, a, at) => {
      const side = a.side;
      const was = FM.sideOfRow(r);
      if (!FM.isSide(side) || !was || was === side) return;
      r.kind = side === 'ally' ? 'ally' : 'foe';
      r.neutral = side === 'neutral';
      r.sideFrom = 'you set it';
      if (side === 'ally') r.seen = true;
      else if (was === 'ally') {
        const shown = Boolean(r.note && ((s.shownEver && s.shownEver[r.note]) || (s.seenEver && s.seenEver[r.note])));
        const foeStart = r.seenTick === true || r.seenTick === false ? r.seenTick : (shown || Boolean(r.seenFrom));
        r.seen = (r.seen === true && Boolean(r.in)) || foeStart;
      }
      if (r.note) {
        if (!s.sides || typeof s.sides !== 'object' || Array.isArray(s.sides)) s.sides = {};
        const copies = f.rows.filter((x) => x.note === r.note && FM.sideOfRow(x));
        if (copies.every((x) => FM.sideOfRow(x) === side)) s.sides[r.note] = side;
        else delete s.sides[r.note];
      }
      touch(r, at);
      numberUnseen(f);
      say(s, f, at, `${nameOf(s, f, r)} is now ${side === 'neutral' ? 'neutral' : side === 'ally' ? 'an ally' : 'a foe'}.`);
    }),
    fightPause(s, a, at) {
      const f = running(s, a);
      if (!f || f.paused === !!a.on) return;
      f.paused = !!a.on;
      say(s, f, at, f.paused ? 'Fight paused.' : 'Fight resumed.');
    },
    fightEnd(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      sayRoster(s, f, at, `Fight ends ${f.round ? `after round ${f.round}` : 'before the first turn'}: `, rosterItems(s, f), '.');
      if (!Array.isArray(s.fights)) s.fights = [];
      s.fights.push({ id: f.id, beat: f.beat, title: f.title, round: f.round, startedAt: f.startedAt, endedAt: at, rows: f.rows, carried: f.carried || {} });
      // a row the players saw by name (seen and ticked in) is remembered for its note (`seenEver`), so a turned ally
      // never comes back next fight as a "Stranger" (final review, ledger 86). It starts a foe seen (its name, never
      // its HP); an ally the reader only infers does not start seen from it (re-review): that is `seenFrom`'s, or the
      // GM's own act tonight
      for (const r of f.rows || []) {
        if (!r.note || r.seen !== true || !r.in || (r.kind !== 'foe' && r.kind !== 'ally')) continue;
        if (!s.seenEver || typeof s.seenEver !== 'object' || Array.isArray(s.seenEver)) s.seenEver = {};
        if (!s.seenEver[r.note]) s.seenEver[r.note] = at || true;
      }
      // the place Fight here put behind a panel goes, and the group's own place is back; one the GM chose since stays
      const bd = f.backdrop;
      const p = bd && s.panels && s.panels[bd.group];
      if (p && typeof p === 'object' && p.backdrop === bd.place) p.backdrop = null;
      s.fight = null;
    },
    // After the fight (decision 24): clear one status, all of a row's, or every row's, on an ended fight.
    afterClear(s, a, at) {
      const f = endedFight(s, a.fight);
      const r = f && (f.rows || []).find((x) => x.id === a.row);
      if (!r) return;
      const was = statusesOf(r);
      if (a.all) { if (!holdsStatus(r)) return; clearAll(r); } else if (a.status !== undefined) clearStatus(r, a.status);
      else return;
      cleared(r, was, at);
    },
    afterClearAll(s, a, at) {
      const f = endedFight(s, a.fight);
      if (!f) return;
      for (const r of f.rows || []) if (r.kind !== 'lair' && holdsStatus(r)) { const was = statusesOf(r); clearAll(r); cleared(r, was, at); }
    },
  };

  // A clear after the fight is kept as what it took off, at its time: derive takes those statuses off the
  // figure of that moment (an end-panel edit or a rest since the fight), never puts the fight's back.
  function cleared(r, was, at) {
    const now = new Set(statusesOf(r));
    const removed = was.filter((x) => !now.has(x));
    if (!removed.length) return;
    r.clears = (Array.isArray(r.clears) ? r.clears : []).concat({ at, removed });
    touch(r, at);
  }

  // Conditions keep their own time too: an initiative or a toggle after an end-panel clear must not make the
  // fight's older statuses the newer figure. Every handler on the running fight stamps the rows it changed.
  for (const [type, fn] of Object.entries(FIGHT_HANDLERS)) {
    if (type === 'afterClear' || type === 'afterClearAll') continue;
    FIGHT_HANDLERS[type] = (s, a, at) => {
      const rows = s.fight && Array.isArray(s.fight.rows) ? s.fight.rows : [];
      const before = new Map(rows.map((r) => [r, statusesOf(r).join('\n')]));
      fn(s, a, at);
      for (const [r, was] of before) if (statusesOf(r).join('\n') !== was) r.condAt = at;
      // a row Out, by any route, owes nothing more: its cards go, with no line
      for (const r of s.fight && Array.isArray(s.fight.rows) ? s.fight.rows : []) if (r.out && Array.isArray(r.cards) && r.cards.length) r.cards = [];
    };
  }

  return { FIGHT_HANDLERS, statusesOf, STAT_KEYS, STAT_FIELDS, statKeysOf, setStatKeysOf };
}));
