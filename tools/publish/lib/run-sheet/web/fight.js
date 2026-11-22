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
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fight-math'));
  else root.RunSheetFight = factory(root.RunSheetFightMath);
}(typeof self !== 'undefined' ? self : this, function (FM) {
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const int = (v) => (isNum(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : null);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

  // What follows an HP change: a foe going Bloodied is logged; at 0 a foe (a neutral too: its kind is foe)
  // is Out, a PC or ally is Down, and concentration ends; healing from 0 clears Down, Stable and the death
  // saves; thresholds light.
  // `opts.over` is the damage left after temp HP and HP.
  function afterHp(s, f, r, before, at, opts) {
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

  // The stat keys Same for all copies (D&D's); 6b adds the keys a system declares here. Nothing else is copied.
  const STAT_KEYS = ['max', 'ac', 'mod'];

  // After Start, a row given a number is re-placed by one insert; the log says so when it moved.
  function replace(s, f, r, at) {
    if (!f.started) return;
    const was = f.rows.indexOf(r);
    f.rows = FM.placeRow(f.rows, r.id, FM.rulesOf(f));
    if (f.rows.indexOf(r) !== was) say(s, f, at, `${nameOf(s, f, r)} moves in the order: initiative ${isNum(r.ini) ? r.ini : 'cleared'}.`);
  }

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
      // newcomers go to the bottom until the next Sort; the turn stays with its row
      numberUnseen(f);
      lairOf(f);
      if (!fresh.length && !ticked.length && !groups.length) return;
      const who = fresh.concat(ticked).filter((r) => r.kind !== 'lair');
      const label = String(a.label || '').trim() || who.map((r) => nameOf(s, f, r, true)).join(', ');
      if (label) say(s, f, at, `${label} ${who.length > 1 ? 'join' : 'joins'} the fight.`);
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
      numberUnseen(f);
      // an owner ticked in later gets the fight's Lair row when it has none
      if (r.in && r.lair && r.kind !== 'lair' && !f.rows.some((x) => x.kind === 'lair')) f.rows.push({ ...FM.lairRow([r], r.group), id: `${a.id || f.id}-lair` });
      lairOf(f);
    }),
    // Before Start the number is all that changes (Sort stays the GM's button). After Start the latest entry
    // wins (ruling "latest entry wins", step6.md): that one row is re-placed by one insert at its sorted
    // place, the rest are not re-sorted, and `f.turn` stays on the same row.
    setInit: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      if (a.ini === null || a.ini === '' || a.ini === undefined) r.ini = null;
      else { const n = int(a.ini); if (n === null) return; r.ini = n; }
      r.typed = true;
      touch(r, at);
      replace(s, f, r, at);
    }),
    // Roll fills only boxes still empty, so a number typed meanwhile wins; a PC's box is never rolled.
    rollInit(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      for (const [id, v] of Object.entries(a.values || {})) {
        const r = rowOf(f, id);
        const n = int(v);
        if (!r || r.kind === 'pc' || n === null || isNum(r.ini)) continue;
        r.ini = n;
        touch(r, at);
        replace(s, f, r, at);
      }
    },
    fightSort(s, a) {
      const f = running(s, a);
      if (!f) return;
      f.rows = FM.sortRows(f.rows, FM.rulesOf(f));
      f.sorted = true;
    },
    // Built on a turn and a round: a second Next built on the same turn is dropped (Review M3).
    fightNext(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      if ((a.from === undefined ? null : a.from) !== f.turn || a.round !== f.round) return;
      if (!f.started) {
        if (!f.sorted) { f.rows = FM.sortRows(f.rows, FM.rulesOf(f)); f.sorted = true; }
        const first = FM.nextLive(f.rows, null).row;
        if (!first) return;
        f.started = true;
        f.round = 1;
        f.turn = first.id;
        const order = f.rows.filter((r) => FM.takesTurn(r, f.rows)).map((r) => ({ id: r.id, text: `${nameOf(s, f, r, true)}${isNum(r.ini) ? ` ${r.ini}` : ''}` }));
        sayRoster(s, f, at, 'Round 1: ', order, '.');
        turnStart(f, first, at);
        return;
      }
      const { row, wrapped } = FM.nextLive(f.rows, f.turn);
      if (!row) return;
      if (wrapped) {
        sayRoster(s, f, at, `Round ${f.round} ends: `, rosterItems(s, f), '.');
        f.round += 1;
      }
      f.turn = row.id;
      turnStart(f, row, at);
    },
    hp: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const e = FM.parseEntry(a.entry, FM.rulesOf(f));
      if (!e) return;
      const before = r.hp;
      const temp = r.temp;
      let over = null;
      if (e.kind === 'temp') r.temp = e.n;
      else if (e.kind === 'heal') { if (!isNum(r.hp)) return; r.hp = FM.afterHeal({ hp: r.hp, max: r.max }, e.n); } else { over = overOf(hurt(f, r, e.n, r.half), temp, before); r.half = false; }
      touchIfHp(r, at, before, r.max);
      afterHp(s, f, r, before, at, { over });
    }),
    half: onRow((s, f, r, a, at) => { r.half = !!a.on; touch(r, at); }),
    resisted: onRow((s, f, r, a, at) => { r.resisted = !!a.on; touch(r, at); }),
    // A max typed on a row with no numbers sets its HP too, so a stock creature runs once its HP is typed.
    setMax: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const clear = a.max === null || a.max === '';
      const n = clear ? null : int(a.max);
      if (!clear && (n === null || n < 0)) return;
      const before = r.hp;
      const maxBefore = r.max;
      r.max = n;
      r.typed = true;
      if (n !== null && !isNum(r.hp)) r.hp = n;
      // a row that was full stays full: a corrected max (21, a slip to 2, then 20) gives 20/20 (final review P4.3)
      else if (n !== null && isNum(maxBefore) && r.hp === maxBefore) r.hp = n;
      // SRD: HP never goes above the maximum
      if (n !== null && isNum(r.hp) && r.hp > n) r.hp = n;
      touchIfHp(r, at, before, maxBefore);
      afterHp(s, f, r, before, at);
    }),
    setAc: onRow((s, f, r, a, at) => {
      const n = a.ac === null || a.ac === '' ? null : int(a.ac);
      if (n === null && a.ac !== null && a.ac !== '') return;
      r.ac = n;
      r.typed = true;
      touch(r, at);
    }),
    // A counted row's typed numbers go to the others of this group nobody has typed into, hurt or given a status
    // (FM.untouched), and their HP is the max. The stat keys come (`STAT_KEYS`: max, ac and mod for D&D);
    // nothing else does (not HP, initiative, side, seen or typed).
    sameForAll: onRow((s, f, r, a, at) => {
      const others = FM.groupMates(f.rows, r).filter((x) => x !== r && FM.untouched(x, true));
      if (!others.length) return;
      const fields = STAT_KEYS.filter((k) => isNum(r[k]));
      for (const x of others) {
        for (const k of fields) x[k] = r[k];
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
      for (const x of hits) afterHp(s, f, x.r, x.before, at, { over: x.over });
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
    };
  }

  return { FIGHT_HANDLERS, statusesOf, STAT_KEYS };
}));
