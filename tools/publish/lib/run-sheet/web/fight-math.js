'use strict';
// The run sheet's fight arithmetic, as pure helpers. UMD like state.js: `module.exports` under node,
// `window.RunSheetFightMath` in a page. No DOM, no fetch, no clock, no dice: dice live in lib/dice and
// the page asks the server. Nothing here changes its input; every function returns something new.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetFightMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // Status names only, no rules text (§3). Exhaustion is a value 0-6, Bloodied is worked out and never
  // stored, and a typed status is free text, so none of the three is in the list.
  const DND_STATUSES = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Down', 'Stable'];
  const EXHAUSTION_MAX = 6;

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ---- the HP box ----

  // `-37` and a bare `37` are damage, `+8` heals, `t5` sets temp HP. Integers 0-9999 only.
  function parseEntry(text) {
    const m = /^\s*([+-]|t)?\s*(\d+)\s*$/i.exec(String(text === null || text === undefined ? '' : text));
    if (!m) return null;
    const n = Number(m[2]);
    if (n > 9999) return null;
    const sign = (m[1] || '').toLowerCase();
    return { kind: sign === '+' ? 'heal' : sign === 't' ? 'temp' : 'damage', n };
  }

  // Half (one-shot) halves first, then resisted (sticky) halves again, each rounding down.
  function damageTaken(n, { half = false, resisted = false } = {}) {
    let d = n;
    if (half) d = Math.floor(d / 2);
    if (resisted) d = Math.floor(d / 2);
    return d;
  }

  // Temp HP takes damage first; HP stops at 0.
  function afterDamage({ hp, temp }, d) {
    const t = temp || 0;
    const soak = Math.min(t, d);
    // a row with no HP still loses the temp HP it was given
    if (hp === null || hp === undefined) return { hp: null, temp: t - soak };
    return { hp: Math.max(0, hp - (d - soak)), temp: t - soak };
  }

  // Healing stops at max (a row with no max just adds).
  function afterHeal({ hp, max }, n) {
    if (hp === null || hp === undefined) return null;
    const up = hp + n;
    return isNum(max) ? Math.min(max, up) : up;
  }

  // Over 0 and at most half of max; a row with no max or no HP is never Bloodied, nor is the Lair row.
  function isBloodied(row) {
    return Boolean(row) && row.kind !== 'lair' && Boolean(row.max) && isNum(row.hp) && row.hp > 0 && row.hp <= row.max / 2;
  }

  // ---- thresholds ----

  // `N HP or less` wins over the word Bloodied: `Bloodied (91 HP or less)` is 91.
  function thresholdOf(text) {
    const s = String(text === null || text === undefined ? '' : text);
    const m = /(\d+)\s*HP or less/i.exec(s);
    if (m) return { hp: Number(m[1]) };
    if (/\bBloodied\b/.test(s)) return { bloodied: true };
    return null;
  }

  // Lit while a row that can light it is above 0, not Out, and at or under the line.
  function isLit(threshold, row) {
    if (!threshold || !row || row.kind !== 'foe') return false;
    if (!row.in || row.out || !isNum(row.hp) || row.hp <= 0) return false;
    if (!(threshold.foes || []).includes(row.note)) return false;
    return threshold.hp !== null && threshold.hp !== undefined ? row.hp <= threshold.hp : isBloodied(row);
  }

  // ---- order and turns ----

  // Ticked first; initiative high to low with an empty box last; at a tie the Lair row after the others,
  // then the higher modifier, then PCs. Stable: equal rows keep their order.
  function sortRows(rows) {
    const ini = (r) => (isNum(r.ini) ? r.ini : -Infinity);
    return rows.map((r, i) => ({ r, i })).sort((a, b) => {
      const x = a.r;
      const y = b.r;
      if (x.in !== y.in) return x.in ? -1 : 1;
      const dx = ini(x);
      const dy = ini(y);
      if (dx !== dy) return dx > dy ? -1 : 1;
      if ((x.kind === 'lair') !== (y.kind === 'lair')) return x.kind === 'lair' ? 1 : -1;
      const mx = x.mod || 0;
      const my = y.mod || 0;
      if (mx !== my) return my - mx;
      if ((x.kind === 'pc') !== (y.kind === 'pc')) return x.kind === 'pc' ? -1 : 1;
      return a.i - b.i;
    }).map((o) => o.r);
  }

  const live = (r) => Boolean(r) && r.in && !r.out;
  // The Lair row has a turn only while one of its owners is live.
  const takesTurn = (r, rows) => live(r) && (r.kind !== 'lair' || !(r.of || []).length || r.of.some((id) => live(rows.find((x) => x.id === id))));

  // The next live row after the turn's row (the Lair row counts while an owner is live); `wrapped` when it passed the end.
  // With no turn row (or one that is gone) it starts from the top.
  function nextLive(rows, turnId) {
    const n = rows.length;
    let i = rows.findIndex((r) => r.id === turnId);
    let wrapped = false;
    for (let step = 0; step < n; step++) {
      i += 1;
      if (i >= n) { i = 0; wrapped = true; }
      if (takesTurn(rows[i], rows)) return { row: rows[i], wrapped };
    }
    return { row: null, wrapped };
  }

  // ---- sides (plan 6a) ----

  // A row's side is its kind plus a neutral flag: a neutral is `kind: 'foe', neutral: true`, so it is
  // everything a foe is (Out at 0 HP, unseen, numbered, a foe's keys on the players' screen) except a foe
  // the panel picks or the vitals hold. The panel's switch cycles foe, ally, neutral, foe.
  const SIDES = ['foe', 'ally', 'neutral'];
  const isSide = (v) => SIDES.includes(v);
  const nextSide = (side) => SIDES[(SIDES.indexOf(side) + 1) % SIDES.length];
  function sideOfRow(r) {
    if (!r || (r.kind !== 'foe' && r.kind !== 'ally')) return null;
    return r.kind === 'ally' ? 'ally' : (r.neutral ? 'neutral' : 'foe');
  }
  // A foe the panel may pick: never a neutral.
  const isFoe = (r) => Boolean(r) && r.kind === 'foe' && !r.neutral;
  // An ally from the GM's own words starts seen; one the reader infers (affiliation, relationships, a bare
  // Quick Reference "ally") starts unseen. A foe made before allyBy existed (no key at all) is 5b's shape,
  // where every ally was the Plan's.
  const GM_WORDS = new Set(['plan', 'stats']);
  const byGm = (foe) => foe.allyBy === undefined || GM_WORDS.has(foe.allyBy);

  // Whose panel the fight view shows (decision 22): the pinned one; else the current row; on a PC's turn
  // the last foe to act, or the next foe due; before the start, the first foe.
  function actingRow(fight, peekId) {
    const rows = (fight && fight.rows) || [];
    const byId = (id) => (id ? rows.find((r) => r.id === id) || null : null);
    const picked = byId(peekId);
    if (picked) return { row: picked, why: 'picked' };
    const cur = byId(fight && fight.turn);
    if (!cur) {
      const first = rows.find((r) => isFoe(r) && r.in);
      return first ? { row: first, why: 'first-foe' } : { row: null, why: null };
    }
    if (cur.kind !== 'pc') return { row: cur, why: 'acting' };
    const last = byId(fight.lastFoe);
    if (last) return { row: last, why: 'last-foe' };
    const at = rows.indexOf(cur);
    const next = rows.slice(at).concat(rows.slice(0, at)).find((r) => isFoe(r) && live(r));
    return next ? { row: next, why: 'next-foe' } : { row: null, why: null };
  }

  // ---- names ----

  // What the GM sees: the unmasked name when there is one, then the copy number once there are two.
  function gmName(row, unmaskOf, copies) {
    if (row.kind === 'lair') return 'Lair action';
    const base = (unmaskOf && row.note && unmaskOf(row.note)) || row.name;
    return copies > 1 && row.copy ? `${base} ${row.copy}` : base;
  }

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const ARTICLE = /^(?:a|an|the)\s+/i;

  // The number a foe row gets, by word, fixed when first ticked in: a row that has one keeps it; a ticked
  // row without one takes the next after the highest. An unticked row with no number gets none, nor does a
  // row already seen (shown before the fight): it takes a number only if it goes back to unseen.
  // Foes are numbered by the word they show, article dropped: `a guard` and `the guard` both show `Guard N`,
  // so they share one run of numbers. A kept number already taken in its run (two runs that met) takes the
  // next free one instead.
  const unseenKey = (word) => String(word || '').trim().replace(ARTICLE, '').toLowerCase();
  function unseenNumbers(rows, wordOf) {
    const out = new Map();
    const top = new Map();
    const used = new Map();
    const fresh = [];
    for (const r of rows) {
      if (r.kind !== 'foe') continue;
      const w = unseenKey(wordOf(r));
      if (!used.has(w)) used.set(w, new Set());
      const kept = r.unseenN !== null && r.unseenN !== undefined;
      if (kept && !used.get(w).has(r.unseenN)) {
        out.set(r.id, r.unseenN);
        used.get(w).add(r.unseenN);
        top.set(w, Math.max(top.get(w) || 0, r.unseenN));
      } else if (kept || (r.in && !r.seen)) fresh.push([r, w]);
    }
    for (const [r, w] of fresh) {
      const n = (top.get(w) || 0) + 1;
      top.set(w, n);
      out.set(r.id, n);
    }
    return out;
  }

  // The word an unseen foe shows: `Brother 1` once two share a word (a leading a/an/the dropped), else the
  // word as written, capitalised. Rows that are unticked and unnumbered do not count towards the numbering.
  function unseenLabels(rows, wordOf) {
    const numbers = unseenNumbers(rows, wordOf);
    const members = new Map();
    for (const r of rows) {
      if (r.kind !== 'foe' || !numbers.has(r.id)) continue;
      const w = unseenKey(wordOf(r));
      members.set(w, (members.get(w) || 0) + 1);
    }
    const labels = new Map();
    for (const r of rows) {
      if (r.kind !== 'foe') continue;
      const word = String(wordOf(r) || '').trim();
      labels.set(r.id, numbers.has(r.id) && members.get(unseenKey(word)) >= 2 ? `${cap(word.replace(ARTICLE, ''))} ${numbers.get(r.id)}` : cap(word));
    }
    return labels;
  }

  // ---- building rows ----

  const groupOfBeat = (beat, spotKey) => {
    const spots = beat.spots || [];
    return spotKey && spots.length > 1 && spots.some((s) => s.key === spotKey) ? spotKey : beat.key;
  };
  const stripCopy = (name) => String(name || '').replace(/\s+\d+$/, '');

  function blankRow(over) {
    return {
      id: null, kind: 'foe', note: null, foeKey: null, type: null, name: '', copy: null, in: true, group: null,
      ini: null, mod: 0, ac: null, hp: null, max: null, temp: 0, conds: [], exhaustion: 0, conc: false,
      ds: { s: 0, f: 0 }, out: false, seen: false, seenTick: null, seenFrom: null, neutral: false, sideFrom: null, half: false, resisted: false,
      lrMax: 0, lr: 0, laMax: 0, la: 0, recharge: [], lair: false, of: [], unseenN: null, word: null,
      start: { hp: null, max: null, conds: [], exhaustion: 0, conc: false }, at: null, hpAt: null, ...over,
    };
  }

  // A vitals figure's conditions text (`Down, Prone, Exhaustion 2, Concentrating`) as statuses and a level.
  // Concentration starts empty in a new fight, so it is dropped.
  function readConditions(text) {
    const conds = [];
    let exhaustion = 0;
    for (const part of String(text || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
      const m = /^Exhaustion\s+(\d+)$/i.exec(part);
      if (m) exhaustion = Math.min(EXHAUSTION_MAX, Number(m[1]));
      else if (!/^Concentrating$/i.test(part) && !conds.includes(part)) conds.push(part);
    }
    return { conds, exhaustion };
  }

  function withStart(row) {
    return { ...row, start: { hp: row.hp, max: row.max, conds: row.conds.slice(), exhaustion: row.exhaustion, conc: row.conc } };
  }

  const castOf = (model, note) => (model.cast || []).find((c) => c.note === note) || null;
  const typeOf = (model, foe) => {
    const c = castOf(model, foe.note);
    return (c && c.type) || (model.notes && model.notes[foe.note] && model.notes[foe.note].type) || (foe.ally ? 'npc' : 'creature');
  };
  // The word an unseen foe goes by: its note's `unseen_as`, else the withheld person word. Stored on the row
  // so `reduce` can number unseen foes when they are first ticked in, with no model.
  const wordOf = (model, note) => {
    const c = castOf(model, note);
    const n = model.notes && model.notes[note];
    return (c && c.unseenAs) || (n && n.unseenAs) || (model.withheldWords && model.withheldWords.person) || '';
  };
  const baseName = (model, foe) => {
    const c = castOf(model, foe.note);
    return c && c.name ? c.name : stripCopy(foe.name);
  };

  // One foe or ally fight row. A PC or ally starts from the vitals figure (Review H1), a named NPC from its
  // last fight, a creature from its note. Temp HP, concentration and death saves always start empty.
  //
  // Its side (plan 6a): the side the GM set tonight, then one carried from an earlier session's Table Log
  // (both "you set it"), then the reader's, then foe. It starts seen when it is an ally from the GM's own
  // words or a side the GM set, when it was shown before, or when the model's `seenFrom` holds it; the row
  // carries `seenFrom` for the seen button's title, and `sideFrom` for its side's.
  function foeRowFrom(ctx, foe, over) {
    const type = typeOf(ctx.model, foe);
    const start = startingSide(ctx, foe);
    const ally = start.side === 'ally';
    let hp = num(foe.hp);
    let max = num(foe.hp);
    let conds = [];
    let exhaustion = 0;
    let out = false;
    if (ally) {
      const v = ctx.vitals.get(over.copy > 1 ? `${foe.note}#${over.copy}` : foe.note);
      if (v) {
        const read = readConditions(v.conditions);
        max = num(v.max) !== null ? num(v.max) : max;
        hp = num(v.hp) !== null ? num(v.hp) : (num(foe.hpNow) !== null ? num(foe.hpNow) : hp);
        conds = read.conds;
        exhaustion = read.exhaustion;
      } else if (num(foe.hpNow) !== null) hp = num(foe.hpNow);
    } else if (type === 'npc') {
      const last = ctx.lastFightRow(foe.note);
      if (last) {
        hp = num(last.hp);
        max = num(last.max) !== null ? num(last.max) : max;
        conds = (last.conds || []).slice();
        exhaustion = last.exhaustion || 0;
        out = hp === 0;
      }
    }
    const at = foe.rechargeAt || {};
    const seenFrom = typeof ctx.seenFrom[foe.note] === 'string' && ctx.seenFrom[foe.note] ? ctx.seenFrom[foe.note] : null;
    const shown = Boolean(ctx.state.shownEver && ctx.state.shownEver[foe.note]);
    return withStart(blankRow({
      kind: ally ? 'ally' : 'foe', neutral: start.side === 'neutral', sideFrom: start.why, seenFrom,
      note: foe.note, foeKey: foe.key, type, name: baseName(ctx.model, foe),
      group: ctx.foeGroup, mod: num(foe.init) || 0, ac: num(foe.ac), hp, max, conds, exhaustion, out,
      seen: (ally && start.byGm) || shown || Boolean(seenFrom),
      lrMax: foe.legendaryResistance || 0, lr: foe.legendaryResistance || 0,
      laMax: foe.legendaryActions || 0, la: foe.legendaryActions || 0,
      recharge: (foe.recharge || []).map((name) => ({ name, at: isNum(at[name]) ? at[name] : 6, ready: true, rolled: null })),
      // every row the GM can switch keeps its unseen word: an ally may be unseen, or become a foe
      lair: Boolean(foe.lair), word: wordOf(ctx.model, foe.note), ...over,
    }));
  }

  // { side, why, byGm } for a foe object: why is "you set it" for a side the GM set, else the reader's
  // allyFrom (null for a plain foe). A stored value that is no side is passed over.
  function startingSide(ctx, foe) {
    const set = ctx.sides[foe.note];
    if (isSide(set)) return { side: set, why: 'you set it', byGm: true };
    const carried = ctx.sidesCarried[foe.note];
    if (isSide(carried)) return { side: carried, why: 'you set it', byGm: true };
    if (foe.ally) return { side: 'ally', why: foe.allyFrom || null, byGm: byGm(foe) };
    return { side: 'foe', why: null, byGm: false };
  }

  function pcRowFrom(ctx, pc, group, on) {
    const v = ctx.vitals.get(pc.note);
    const read = readConditions(v && v.conditions);
    const max = v && num(v.max) !== null ? num(v.max) : num(pc.hpMax);
    const hp = v && num(v.hp) !== null ? num(v.hp) : (num(pc.hpNow) !== null ? num(pc.hpNow) : max);
    return withStart(blankRow({
      kind: 'pc', note: pc.note, type: 'pc', name: pc.name, in: on, group, mod: num(pc.init) || 0, ac: num(pc.ac),
      hp, max, conds: read.conds, exhaustion: read.exhaustion, seen: true,
    }));
  }

  const lairRow = (owners, group) => blankRow({
    kind: 'lair', name: 'Lair action', in: true, group, ini: 20, mod: -99, of: owners.map((r) => r.id), seen: true,
  });

  // Shared set-up for the two builders.
  function contextOf({ model, derived, state, positions }) {
    const st = state || {};
    const beats = (derived && derived.beats) || model.beats || [];
    const vitals = new Map(((derived && derived.vitals) || []).map((v) => [v.rowId, v]));
    const byKey = new Map(beats.map((b) => [b.key, b]));
    const groupOf = (note) => {
      if (positions && Object.prototype.hasOwnProperty.call(positions, note)) return positions[note];
      const p = st.positions && st.positions[note];
      if (!p) return null;
      if (p.off) return 'off';
      const b = byKey.get(p.beat);
      return b ? groupOfBeat(b, p.spot) : p.beat;
    };
    const inBeat = (note, beat) => {
      const g = groupOf(note);
      return g !== null && g !== undefined && (g === beat.key || (beat.spots || []).some((s) => s.key === g));
    };
    const lastFightRow = (note) => {
      const fights = st.fights || [];
      for (let i = fights.length - 1; i >= 0; i--) {
        const r = (fights[i].rows || []).find((x) => x.note === note);
        if (r) return r;
      }
      return null;
    };
    // the sides and seen the rows start from: the state's and the model's, as `reduce` never sees the model
    const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    return { model, state: st, beats, byKey, vitals, groupOf, inBeat, lastFightRow, foeGroup: null,
      sides: obj(st.sides), sidesCarried: obj(model.sidesCarried), seenFrom: obj(model.seenFrom) };
  }

  // The threshold lines a beat holds, each with the notes that can light it (decision 20). `foeRows` are the
  // beat's fight rows.
  function thresholdsOf(beat, foeRows) {
    const out = [];
    const bosses = foeRows.filter((r) => r.kind === 'foe');
    // `cond` is what sets the line off; `text` is what the Log says (an If-row also says its `then`)
    const lines = (beat.points || []).map((p) => ({ key: p.key, cond: p.text, text: p.text }))
      .concat((beat.ifs || []).map((p) => ({ key: p.key, cond: p.text || p.do, then: p.text ? '' : p.then, text: p.text || [p.do, p.then].filter(Boolean).join(': ') })));
    for (const l of lines) {
      const t = thresholdOf(l.cond);
      if (!t) continue;
      // an HP line can only be crossed by a foe whose max is over it
      const can = t.hp !== undefined ? bosses.filter((r) => isNum(r.max) && r.max > t.hp) : bosses;
      // the foe Do names, else the foe Then names, else the biggest (Review L4: an HP line too)
      // whole names only: a Rat is not named by "Pirate"
      const names = (text, name) => Boolean(name) && new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text);
      const naming = (s) => can.filter((r) => {
        const text = String(s || '');
        const stem = String(r.note || '').split('/').pop().replace(/\.md$/, '');
        return names(text, String(r.name || '')) || names(text, stem);
      });
      let pick = naming(l.cond);
      if (!pick.length) pick = naming(l.then);
      if (!pick.length) {
        const top = can.reduce((m, r) => (isNum(r.max) && r.max > m ? r.max : m), 0);
        pick = top ? can.filter((r) => r.max === top).slice(0, 1) : [];
      }
      const foes = pick.map((r) => r.note);
      out.push({ key: l.key, beat: beat.key, text: String(l.text), hp: t.hp === undefined ? null : t.hp, bloodied: t.hp === undefined, foes: [...new Set(foes)] });
    }
    return out;
  }

  // Number rows `<idBase>-r<n>`. The ids come from the action's own id, so a re-applied action makes the same rows.
  const ider = (idBase) => { let n = 0; return () => `${idBase}-r${++n}`; };

  // The foes a beat gives a fight: its own, the allies brought in (derive already holds those), and anyone
  // else brought in who has a fight row (Review M7). `on` says whether each is ticked: someone an arrivals
  // cue names (`Arriving, start of round 3`) joins benched, for the GM to tick in when they arrive.
  function beatFoes(ctx, beat) {
    const own = beat.foes || [];
    const arriving = new Set((beat.arrivals || []).flatMap((a) => a.people || []));
    const rows = own.map((f) => ({ foe: f, on: !arriving.has(f.note) }));
    const have = new Set(own.map((f) => f.note));
    for (const b of (ctx.state.brought && ctx.state.brought[beat.key]) || []) {
      if (have.has(b.note)) continue;
      const c = castOf(ctx.model, b.note);
      if (!c || !c.foe) continue;
      have.add(b.note);
      rows.push({ foe: c.foe, on: startingSide(ctx, c.foe).side === 'ally' || Boolean(beat.impro) });
    }
    return rows;
  }

  // Number the copies of each note, after the highest already taken (`taken`: note -> highest copy).
  function numberCopies(foes, taken) {
    const seen = new Map(taken);
    return foes.map((x) => {
      const copy = (seen.get(x.foe.note) || 0) + 1;
      seen.set(x.foe.note, copy);
      return copy;
    });
  }

  // The rows for a new fight on a beat (decision 13). `groups` is the page's focused group(s), used when no
  // PC stands in the beat (a contingency, an improvised beat); `positions` maps a PC note to its group id
  // and defaults to the state's positions.
  function rowsForFight({ model, derived, state, beatKey, groups, idBase, positions }) {
    const ctx = contextOf({ model, derived, state, positions });
    const beat = ctx.byKey.get(beatKey) || null;
    const id = ider(idBase);
    const pcs = model.pcs || [];
    let here = beat ? pcs.filter((p) => ctx.inBeat(p.note, beat)) : [];
    if (!here.length && groups && groups.length) here = pcs.filter((p) => groups.includes(ctx.groupOf(p.note)));
    const rows = pcs.map((p) => {
      const on = here.length === 0 || here.some((h) => h.note === p.note);
      return { ...pcRowFrom(ctx, p, ctx.groupOf(p.note), on), id: id() };
    });
    // the fight's groups: every group holding a ticked PC (proof M2: a beat where no PC stands ticks them all)
    const placed = (g) => g !== null && g !== undefined && g !== 'off';
    const held = [...new Set(rows.filter((r) => r.in && placed(r.group)).map((r) => r.group))];
    const fightGroups = held.length ? held : (groups && groups.length ? groups.slice() : [beatKey]);
    ctx.foeGroup = fightGroups[0];
    const foes = beat ? beatFoes(ctx, beat) : [];
    const copies = numberCopies(foes, new Map());
    const foeRows = foes.map((x, i) => ({ ...foeRowFrom(ctx, x.foe, { copy: copies[i], in: x.on }), id: id() }));
    rows.push(...foeRows);
    const owners = rows.filter((r) => r.lair && r.in);
    if (owners.length) rows.push({ ...lairRow(owners, fightGroups[0]), id: id() });
    return { rows, groups: fightGroups, thresholds: beat ? thresholdsOf(beat, foeRows) : [] };
  }

  // Add to a running fight (decision 14). `add` is one of { cast, count }, { group } or { beat }. Answers the
  // new rows, the ids of existing rows to tick in, the groups and thresholds the fight does not have yet, and
  // `refused` (a sentence) when nothing can be added. A new Lair row is only made when the fight has none.
  function joinRows({ model, derived, state, fight, add, idBase, positions }) {
    const ctx = contextOf({ model, derived, state, positions });
    const id = ider(idBase);
    const have = fight.rows || [];
    const out = { rows: [], tick: [], groups: [], thresholds: [], refused: null };
    ctx.foeGroup = (fight.groups || [])[0] || null;
    const tickIn = (r) => { if (!r.in && !out.tick.includes(r.id)) out.tick.push(r.id); };
    const lairIfNew = () => {
      if (have.some((r) => r.kind === 'lair')) return;
      const owners = have.concat(out.rows).filter((r) => r.lair && (r.in || out.tick.includes(r.id) || out.rows.includes(r)));
      if (owners.length) out.rows.push({ ...lairRow(owners, ctx.foeGroup), id: id() });
    };
    const addGroup = (g) => { if (g && !(fight.groups || []).includes(g) && !out.groups.includes(g)) out.groups.push(g); };

    if (add && add.cast) {
      const c = castOf(model, add.cast);
      if (!c) { out.refused = 'That note is not in the cast.'; return out; }
      if (c.type === 'pc') {
        const r = have.find((x) => x.note === c.note);
        if (r) tickIn(r);
        else {
          const p = (model.pcs || []).find((x) => x.note === c.note) || { note: c.note, name: c.name };
          out.rows.push({ ...pcRowFrom(ctx, p, ctx.groupOf(c.note), true), id: id() });
        }
        return out;
      }
      const n = Math.max(1, Math.min(20, Math.floor(add.count) || 1));
      const mine = have.filter((x) => x.note === c.note);
      const benched = mine.filter((x) => !x.in);
      // a benched arrival ticked in may be the first lair owner able to act: its Lair row comes with it
      if (benched.length) { benched.slice(0, n).forEach(tickIn); lairIfNew(); return out; }
      if (c.type === 'npc' && mine.length) { out.refused = `${c.name} is already in this fight.`; return out; }
      const foe = c.foe || { key: `cast.${c.note}`, note: c.note, name: c.name, ally: false, ac: null, hp: null, init: null };
      const top = mine.reduce((m, x) => Math.max(m, x.copy || 0), 0);
      for (let i = 1; i <= n; i++) out.rows.push({ ...foeRowFrom(ctx, foe, { copy: top + i, in: true }), id: id() });
      lairIfNew();
      return out;
    }

    // A group or a beat: its PCs and the beat's foes and allies.
    let beat = null;
    let pcsIn = [];
    if (add && add.group) {
      beat = ctx.beats.find((b) => b.key === add.group || (b.spots || []).some((s) => s.key === add.group)) || null;
      pcsIn = (model.pcs || []).filter((p) => ctx.groupOf(p.note) === add.group);
      addGroup(add.group);
    } else if (add && add.beat) {
      beat = ctx.byKey.get(add.beat) || null;
      pcsIn = beat ? (model.pcs || []).filter((p) => ctx.inBeat(p.note, beat)) : [];
      const gs = [...new Set(pcsIn.map((p) => ctx.groupOf(p.note)))];
      (gs.length ? gs : [add.beat]).forEach(addGroup);
    } else { out.refused = 'Nothing to add.'; return out; }
    for (const p of pcsIn) {
      const r = have.find((x) => x.note === p.note);
      if (r) tickIn(r);
      else out.rows.push({ ...pcRowFrom(ctx, p, ctx.groupOf(p.note), true), id: id() });
    }
    if (beat) {
      const taken = new Map();
      for (const r of have) if (r.note) taken.set(r.note, Math.max(taken.get(r.note) || 0, r.copy || 0));
      // A named NPC already in the fight from another beat is the same person: ticked in if benched, never a
      // second row (the rule Add by name keeps). A beat listing a note twice still makes both.
      const foes = beatFoes(ctx, beat).filter((x) => !have.some((r) => r.foeKey === x.foe.key)).filter((x) => {
        const mine = typeOf(ctx.model, x.foe) === 'npc' ? have.filter((r) => r.note === x.foe.note) : [];
        if (!mine.length) return true;
        if (x.on) mine.filter((r) => !r.in).slice(0, 1).forEach(tickIn);
        return false;
      });
      const copies = numberCopies(foes, taken);
      const built = foes.map((x, i) => ({ ...foeRowFrom(ctx, x.foe, { copy: copies[i], in: x.on }), id: id() }));
      out.rows.push(...built);
      const notes = new Set(beatFoes(ctx, beat).map((x) => x.foe.note));
      const known = new Set((fight.thresholds || []).map((t) => t.key));
      out.thresholds = thresholdsOf(beat, have.concat(built).filter((r) => notes.has(r.note))).filter((t) => !known.has(t.key));
      lairIfNew();
    }
    return out;
  }

  // The groups a fight takes in (proof M2): the ones it was given or added, and every group (`{ key, pcs }`,
  // show.js's groupsOf) where a PC ticked into it now stands.
  function fightGroupKeys(fight, groups) {
    const out = (fight && Array.isArray(fight.groups) ? fight.groups : []).slice();
    const ticked = new Set(((fight && fight.rows) || []).filter((r) => r && r.kind === 'pc' && r.in && r.note).map((r) => r.note));
    for (const g of groups || []) if (!out.includes(g.key) && (g.pcs || []).some((p) => ticked.has(p))) out.push(g.key);
    return out;
  }

  return {
    DND_STATUSES, EXHAUSTION_MAX, fightGroupKeys,
    parseEntry, damageTaken, afterDamage, afterHeal, isBloodied,
    thresholdOf, isLit, sortRows, takesTurn, nextLive, actingRow,
    gmName, lairRow, unseenKey, unseenNumbers, unseenLabels, rowsForFight, joinRows,
    SIDES, isSide, nextSide, sideOfRow, isFoe,
  };
}));
