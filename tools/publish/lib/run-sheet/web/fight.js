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
  function nameOf(s, f, r) {
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
  function figureOf(s, f, r) {
    const st = statusesOf(r).concat(r.out ? ['Out'] : []);
    const hp = isNum(r.hp) ? ` ${r.hp}${isNum(r.max) ? `/${r.max}` : ''}` : '';
    return `${nameOf(s, f, r)}${hp}${st.length ? ` (${st.join(', ')})` : ''}`;
  }
  const roster = (s, f) => f.rows.filter((r) => r.in && r.kind !== 'lair').map((r) => figureOf(s, f, r)).join(', ');

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

  // The number an unseen foe keeps, fixed when it is first ticked in (decision 5).
  function numberUnseen(f) {
    const nums = FM.unseenNumbers(f.rows, (r) => r.word || '');
    for (const r of f.rows) if (r.kind === 'foe' && r.in && (r.unseenN === null || r.unseenN === undefined) && nums.has(r.id)) r.unseenN = nums.get(r.id);
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

  // What follows an HP change: a foe going Bloodied is logged; at 0 a foe is Out, a PC or ally is Down, and
  // concentration ends; healing from 0 clears Down, Stable and the death saves; thresholds light.
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

  // Damage after half and resisted, into temp HP first. Answers what the row took.
  function hurt(r, n, half) {
    const d = FM.damageTaken(n, { half, resisted: r.resisted });
    const next = FM.afterDamage({ hp: isNum(r.hp) ? r.hp : null, temp: r.temp }, d);
    r.hp = next.hp;
    r.temp = next.temp;
    return d;
  }

  // What was left of `d` after temp HP and HP: the damage past 0.
  const overOf = (d, temp, hp) => (isNum(hp) ? d - (temp || 0) - hp : null);

  const turnStart = (f, r, at) => {
    if (r.laMax) { r.la = r.laMax; touch(r, at); }
    if (r.kind === 'foe') f.lastFoe = r.id;
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

  const FIGHT_HANDLERS = {
    fightStart(s, a, at) {
      if (s.fight || a.id == null || !Array.isArray(a.rows)) return;
      const f = {
        id: a.id, beat: a.beat || null, title: String(a.title || ''), groups: clone(a.groups || []),
        round: 0, turn: null, started: false, sorted: false, paused: false, lastFoe: null,
        rows: clone(a.rows).map((r) => entered(r, at)), thresholds: clone(a.thresholds || []), lit: {}, startedAt: at,
        carried: clone(a.carried || {}),
      };
      numberUnseen(f);
      lairOf(f);
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
      for (const t of clone(a.thresholds || [])) if (!have.has(t.key)) { f.thresholds.push(t); have.add(t.key); }
      for (const [note, name] of Object.entries(a.carried || {})) if (!f.carried[note]) f.carried[note] = name;
      // newcomers go to the bottom until the next Sort; the turn stays with its row
      numberUnseen(f);
      lairOf(f);
      if (!fresh.length && !ticked.length && !groups.length) return;
      const who = fresh.concat(ticked).filter((r) => r.kind !== 'lair');
      const label = String(a.label || '').trim() || who.map((r) => nameOf(s, f, r)).join(', ');
      if (label) say(s, f, at, `${label} ${who.length > 1 ? 'join' : 'joins'} the fight.`);
    },
    fightTick: onRow((s, f, r, a, at) => {
      r.in = !!a.in;
      touch(r, at);
      numberUnseen(f);
      // an owner ticked in later gets the fight's Lair row when it has none
      if (r.in && r.lair && r.kind !== 'lair' && !f.rows.some((x) => x.kind === 'lair')) f.rows.push({ ...FM.lairRow([r], r.group), id: `${a.id || f.id}-lair` });
      lairOf(f);
    }),
    setInit: onRow((s, f, r, a, at) => {
      if (a.ini === null || a.ini === '' || a.ini === undefined) r.ini = null;
      else { const n = int(a.ini); if (n === null) return; r.ini = n; }
      touch(r, at);
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
      }
    },
    fightSort(s, a) {
      const f = running(s, a);
      if (!f) return;
      f.rows = FM.sortRows(f.rows);
      f.sorted = true;
    },
    // Built on a turn and a round: a second Next built on the same turn is dropped (Review M3).
    fightNext(s, a, at) {
      const f = running(s, a);
      if (!f) return;
      if ((a.from === undefined ? null : a.from) !== f.turn || a.round !== f.round) return;
      if (!f.started) {
        if (!f.sorted) { f.rows = FM.sortRows(f.rows); f.sorted = true; }
        const first = FM.nextLive(f.rows, null).row;
        if (!first) return;
        f.started = true;
        f.round = 1;
        f.turn = first.id;
        const order = f.rows.filter((r) => FM.takesTurn(r, f.rows)).map((r) => `${nameOf(s, f, r)}${isNum(r.ini) ? ` ${r.ini}` : ''}`);
        say(s, f, at, `Round 1: ${order.join(', ')}.`);
        turnStart(f, first, at);
        return;
      }
      const { row, wrapped } = FM.nextLive(f.rows, f.turn);
      if (!row) return;
      if (wrapped) {
        say(s, f, at, `Round ${f.round} ends: ${roster(s, f)}.`);
        f.round += 1;
      }
      f.turn = row.id;
      turnStart(f, row, at);
    },
    hp: onRow((s, f, r, a, at) => {
      if (r.kind === 'lair') return;
      const e = FM.parseEntry(a.entry);
      if (!e) return;
      const before = r.hp;
      const temp = r.temp;
      let over = null;
      if (e.kind === 'temp') r.temp = e.n;
      else if (e.kind === 'heal') { if (!isNum(r.hp)) return; r.hp = FM.afterHeal({ hp: r.hp, max: r.max }, e.n); } else { over = overOf(hurt(r, e.n, r.half), temp, before); r.half = false; }
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
      if (n !== null && !isNum(r.hp)) r.hp = n;
      // SRD: HP never goes above the maximum
      if (n !== null && isNum(r.hp) && r.hp > n) r.hp = n;
      touchIfHp(r, at, before, maxBefore);
      afterHp(s, f, r, before, at);
    }),
    setAc: onRow((s, f, r, a, at) => {
      const n = a.ac === null || a.ac === '' ? null : int(a.ac);
      if (n === null && a.ac !== null && a.ac !== '') return;
      r.ac = n;
      touch(r, at);
    }),
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
        const took = hurt(r, n, !!h.half);
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
    seen: onRow((s, f, r, a, at) => {
      if (r.kind !== 'foe') return;
      r.seen = !!a.on;
      touch(r, at);
      // back to unseen: a row that never had a number takes the next one
      if (!r.seen) numberUnseen(f);
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
      say(s, f, at, `Fight ends ${f.round ? `after round ${f.round}` : 'before the first turn'}: ${roster(s, f)}.`);
      if (!Array.isArray(s.fights)) s.fights = [];
      s.fights.push({ id: f.id, beat: f.beat, title: f.title, round: f.round, startedAt: f.startedAt, endedAt: at, rows: f.rows, carried: f.carried || {} });
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

  return { FIGHT_HANDLERS, statusesOf };
}));
