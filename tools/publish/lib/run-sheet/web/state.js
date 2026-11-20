'use strict';
// The run sheet's play state, as one pure module. It runs in node (the Table Log writer, the tests)
// and in the browser (the page) with no build step: `module.exports` under node, `window.RunSheetState`
// in a page. No DOM, no fetch, no clock: time comes in as an argument. `reduce` is the one way state
// changes and `derive` the one way the page and the record read it, so they cannot disagree.
//
// State is stored against the reader's keys (beat, spot, point, loot, handout), each with the words
// it had, so an item whose key the Plan later loses can still be shown (an orphan) and re-attached.
// `rev`, `stateId` and `recordHash` belong to the server: `reduce` never touches them. Keys the page
// does not know (5b's `fight`, `shown`, `panels`, `rolls`) pass through `reduce` and `derive` untouched.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetState = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const APPLIED_KEEP = 500;
  const POINT_MARKS = ['landed', 'missed', 'overtaken'];

  function emptyState({ stateId, session, plan } = {}) {
    return {
      version: 1, stateId: stateId || null, rev: 0, session: session || null, plan: plan || null, startedAt: null,
      applied: [], recordHash: null,
      positions: {}, visited: {}, points: {}, fired: {}, stopped: null, improvised: [],
      brought: {}, unmask: {}, handouts: {}, loot: {}, jots: [], events: [],
      end: { vitals: {}, where: {}, advancement: '' },
      attached: {},
    };
  }

  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const stem = (p) => String(p || '').split('/').pop().replace(/\.md$/, '');

  // `from` is a beat key (no dot) or a single item key. A beat key also carries every key under it
  // (`<beat>.pt.<hash>`), so an item whose text is unchanged is re-homed by its hash alone.
  function rewriter(from, to) {
    const beat = !String(from).includes('.');
    return (k) => {
      if (typeof k !== 'string') return k;
      if (k === from) return to;
      if (beat && k.startsWith(`${from}.`)) return to + k.slice(from.length);
      return k;
    };
  }
  function rekey(obj, re) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) out[re(k)] = v;
    return out;
  }

  const log = (s, at, beat, text, title) => { s.events.push({ at, beat: beat || null, text, ...(title ? { title } : {}) }); };

  // Each handler changes the (already cloned) state `s`. `a.id` is made by the page; fields beyond
  // the action's own words (titles, text) are the words to keep for an orphan or the Log.
  const HANDLERS = {
    move(s, a, at) {
      if (!a.pc) return;
      const to = a.to;
      if (to === 'off' || (to && to.off)) { s.positions[a.pc] = { off: true }; return; }
      if (!to || !to.beat) return;
      s.positions[a.pc] = { beat: to.beat, spot: to.spot || null };
      if (!s.visited[to.beat]) s.visited[to.beat] = { title: to.title || '', at };
    },
    moveAll(s, a, at) { for (const pc of a.pcs || []) HANDLERS.move(s, { pc, to: a.to }, at); },
    mark(s, a, at) {
      if (!a.point) return;
      if (!POINT_MARKS.includes(a.mark)) { delete s.points[a.point]; return; }
      s.points[a.point] = { mark: a.mark, beat: a.beat || null, beatTitle: a.beatTitle || '', text: a.text || '', at };
    },
    jot(s, a, at) {
      const text = String(a.text == null ? '' : a.text).trim();
      if (!text) return;
      s.jots.push({ id: a.id, beat: a.beat || null, spot: a.spot || null, text, at, ...(a.title ? { title: a.title } : {}) });
    },
    unjot(s, a) { s.jots = s.jots.filter((j) => j.id !== a.jot); },
    fire(s, a, at) {
      if (!a.beat) return;
      if (a.on) {
        if (s.fired[a.beat]) return;
        s.fired[a.beat] = { title: a.title || '', at };
        log(s, at, a.beat, 'Contingency fired.', a.title);
      } else delete s.fired[a.beat];
    },
    stop(s, a, at) {
      if (!a.beat) { s.stopped = null; return; }
      s.stopped = { beat: a.beat, title: a.title || '', at };
      log(s, at, a.beat, 'Stopped here.', a.title);
    },
    improvise(s, a, at) {
      const title = String(a.title || '').trim();
      if (!title) return;
      const n = s.improvised.reduce((m, i) => Math.max(m, Number(String(i.key).slice(2)) || 0), 0) + 1;
      const key = `i-${n}`;
      s.improvised.push({ key, title, at });
      log(s, at, key, 'Improvised beat.', title);
    },
    unimprovise(s, a) {
      s.improvised = s.improvised.filter((i) => i.key !== a.key);
      delete s.visited[a.key];
      delete s.brought[a.key];
      for (const [pc, p] of Object.entries(s.positions)) if (p.beat === a.key) delete s.positions[pc];
      s.jots = s.jots.filter((j) => j.beat !== a.key);
      s.events = s.events.filter((e) => e.beat !== a.key);
    },
    bring(s, a, at) {
      if (!a.beat || !a.note) return;
      const list = s.brought[a.beat] || (s.brought[a.beat] = []);
      if (list.some((b) => b.note === a.note)) return;
      list.push({ note: a.note, name: a.name || stem(a.note), at });
      log(s, at, a.beat, `${a.name || stem(a.note)} brought in.`, a.title);
    },
    unbring(s, a) {
      if (!s.brought[a.beat]) return;
      s.brought[a.beat] = s.brought[a.beat].filter((b) => b.note !== a.note);
      if (!s.brought[a.beat].length) delete s.brought[a.beat];
    },
    unmask(s, a, at) {
      if (!a.note) return;
      s.unmask[a.note] = { on: !!a.on, name: a.name || '', at };
      const was = a.was || stem(a.note);
      log(s, at, a.beat, a.on ? `${was} unmasked as ${a.name}.` : `${was} masked again.`, a.title);
    },
    handOver(s, a, at) {
      if (!a.handout) return;
      if (!a.on) { delete s.handouts[a.handout]; return; }
      s.handouts[a.handout] = { text: a.text || '', note: a.note || null, at };
      log(s, at, null, `Handed over: ${String(a.text || stem(a.note) || 'a handout').replace(/\.$/, '')}.`);
    },
    loot(s, a, at) {
      if (!a.item) return;
      if (!a.to) { delete s.loot[a.item]; return; }
      s.loot[a.item] = { to: a.to, text: a.text || '', item: a.note || null, beat: a.beat || null, beatTitle: a.beatTitle || '', at };
    },
    attach(s, a) {
      if (!a.from || !a.to || a.from === a.to) return;
      const re = rewriter(a.from, a.to);
      for (const k of ['points', 'visited', 'fired', 'brought', 'loot', 'handouts']) s[k] = rekey(s[k], re);
      for (const v of Object.values(s.points)) v.beat = re(v.beat);
      for (const v of Object.values(s.loot)) v.beat = re(v.beat);
      for (const p of Object.values(s.positions)) { if (p.beat) { p.beat = re(p.beat); p.spot = re(p.spot); } }
      if (s.stopped) s.stopped.beat = re(s.stopped.beat);
      for (const j of s.jots) { j.beat = re(j.beat); j.spot = re(j.spot); }
      for (const e of s.events) e.beat = re(e.beat);
      s.attached[a.from] = a.to;
    },
    endSet(s, a) {
      for (const [id, v] of Object.entries(a.vitals || {})) s.end.vitals[id] = { ...(s.end.vitals[id] || {}), ...v };
      for (const [pc, text] of Object.entries(a.where || {})) { if (String(text || '').trim()) s.end.where[pc] = String(text); else delete s.end.where[pc]; }
      if (typeof a.advancement === 'string') s.end.advancement = a.advancement;
    },
    longRest(s) {
      for (const v of Object.values(s.end.vitals)) { delete v.hp; delete v.max; }
      s.end.longRest = true;
    },
  };

  // reduce(state, action, at) -> a new state. An action id already in `applied` changes nothing; an
  // unknown action returns the same object.
  function reduce(state, action, at) {
    if (!action || typeof action !== 'object' || !has(HANDLERS, action.type)) return state;
    if (action.id != null && state.applied && state.applied.includes(action.id)) return state;
    const s = clone(state);
    if (!s.startedAt) s.startedAt = at || null;
    HANDLERS[action.type](s, action, at || null);
    if (action.id != null) {
      s.applied = (s.applied || []).concat(action.id).slice(-APPLIED_KEEP);
    }
    // the server's keys are never the page's to change
    s.rev = state.rev;
    s.stateId = state.stateId;
    s.recordHash = state.recordHash;
    return s;
  }

  function cyclePoint(mark) {
    const i = POINT_MARKS.indexOf(mark);
    return i === -1 ? POINT_MARKS[0] : (POINT_MARKS[i + 1] || '');
  }

  // Taking something off takes two clicks within the window: the first arms, the second fires.
  function armClick(armed, id, nowMs, windowMs = 3000) {
    if (armed && armed.id === id && nowMs - armed.at <= windowMs) return { fire: true, armed: null };
    return { fire: false, armed: { id, at: nowMs } };
  }

  const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();

  // Name, aliases and gm aliases, case and accent blind. A word-prefix match comes before a
  // match inside a word; within a rank, the name's own match comes first, then by name.
  function castSearch(cast, query, limit = 8) {
    const q = fold(query).trim();
    if (!q) return [];
    const rank = (c) => {
      const fields = [[c.name, 0], ...(c.aliases || []).map((x) => [x, 1]), ...(c.gmAliases || []).map((x) => [x, 1])];
      let best = Infinity;
      for (const [text, base] of fields) {
        const t = fold(text);
        if (!t) continue;
        let r = Infinity;
        if (t.startsWith(q)) r = base;
        else if (t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) r = 2 + base;
        else if (t.includes(q)) r = 4 + base;
        best = Math.min(best, r);
      }
      return best;
    };
    return (cast || [])
      .map((c, i) => ({ c, i, r: rank(c) }))
      .filter((x) => x.r !== Infinity)
      .sort((a, b) => a.r - b.r || fold(a.c.name).localeCompare(fold(b.c.name)) || a.i - b.i)
      .slice(0, limit)
      .map((x) => x.c);
  }

  // The beats the page shows: the Plan's, the improvised ones, and each beat's "Who's here" with
  // whoever the GM brought in.
  function beatsOf(model, state) {
    const cast = new Map((model.cast || []).map((c) => [c.note, c]));
    const real = (model.beats || []).map((b) => {
      const extra = (state.brought[b.key] || []).map((x) => {
        const c = cast.get(x.note) || {};
        return { key: `${b.key}.brought.${x.note}`, note: x.note, name: c.name || x.name, knownAs: '', count: 1,
          wants: c.wants || '', playAs: c.playAs || '', dead: !!c.dead, brought: true };
      });
      return extra.length ? { ...b, who: (b.who || []).concat(extra) } : b;
    });
    const impro = state.improvised.map((i) => ({
      key: i.key, title: i.title, impro: true, contingency: false, sceneNote: null, place: null, spots: [],
      who: (state.brought[i.key] || []).map((x) => ({ key: `${i.key}.brought.${x.note}`, note: x.note, name: x.name, brought: true, count: 1 })),
      points: [], ifs: [], treasure: [], foes: [], handouts: [], entities: [],
    }));
    return real.concat(impro);
  }

  // Ally rows: one per ally note, a copy row for each extra number a beat holds (`Guard 2`).
  function vitalRows(model, state, beats) {
    const rows = [];
    for (const p of model.pcs || []) {
      rows.push({ rowId: p.note, ally: false, copy: 1, note: p.note, name: p.name, base: { hp: p.hpNow ?? p.hpMax ?? null, max: p.hpMax ?? null } });
    }
    const allies = new Map();
    for (const b of beats) {
      const seen = new Map();
      for (const f of b.foes || []) {
        if (!f.ally) continue;
        const copy = (seen.get(f.note) || 0) + 1;
        seen.set(f.note, copy);
        if (!allies.has(f.note)) allies.set(f.note, []);
        const list = allies.get(f.note);
        if (!list[copy - 1]) list[copy - 1] = { rowId: copy === 1 ? f.note : `${f.note}#${copy}`, ally: true, copy, note: f.note, name: f.name, base: { hp: f.hpNow ?? f.hp ?? null, max: f.hp ?? null } };
      }
    }
    for (const list of allies.values()) for (const r of list) if (r) rows.push(r);
    return rows.map((r) => {
      const o = state.end.vitals[r.rowId] || {};
      const hp = o.hp !== undefined && o.hp !== '' ? o.hp : r.base.hp;
      const max = o.max !== undefined && o.max !== '' ? o.max : r.base.max;
      const rest = state.end.longRest && !(o.hp !== undefined && o.hp !== '');
      return { rowId: r.rowId, ally: r.ally, copy: r.copy, note: r.note, name: r.name,
        hp: rest ? max : hp, max, conditions: o.conditions || '',
        set: has(state.end.vitals, r.rowId), setHp: o.hp !== undefined && o.hp !== '' };
    });
  }

  function derive(model, state) {
    const beats = beatsOf(model, state);
    const byKey = new Map(beats.map((b) => [b.key, b]));
    const spotKeys = new Set();
    const pointKeys = new Set();
    const lootKeys = new Set();
    for (const b of beats) {
      (b.spots || []).forEach((x) => spotKeys.add(x.key));
      (b.points || []).forEach((x) => pointKeys.add(x.key));
      (b.treasure || []).forEach((x) => lootKeys.add(x.key));
    }
    const handoutKeys = new Set((model.handouts || []).map((h) => h.key));

    // a beat is reached if it is visited, marked, jotted in, fired or stopped in
    const reached = new Set(Object.keys(state.visited));
    for (const p of Object.values(state.points)) if (p.beat) reached.add(p.beat);
    for (const j of state.jots) if (j.beat) reached.add(j.beat);
    for (const k of Object.keys(state.fired)) reached.add(k);
    if (state.stopped) reached.add(state.stopped.beat);

    const pointsBy = { landed: [], missed: [], overtaken: [], open: [] };
    for (const b of beats) {
      if (b.contingency) continue;
      for (const p of b.points || []) {
        const mark = state.points[p.key] && state.points[p.key].mark;
        const row = { key: p.key, beat: b.key, beatTitle: b.title, text: p.text };
        if (POINT_MARKS.includes(mark)) pointsBy[mark].push(row);
        else if (reached.has(b.key)) pointsBy.open.push(row);
      }
    }
    const notReached = beats
      .filter((b) => !b.contingency && !b.impro && !reached.has(b.key))
      .map((b) => ({ key: b.key, title: b.title, note: b.sceneNote || null }));

    const whereEnded = (model.pcs || []).map((pc) => {
      const pos = state.positions[pc.note];
      const text = state.end.where[pc.note] || '';
      const r = { pc: pc.note, name: pc.name, status: 'unplaced', beat: null, spot: null, place: null, spotName: null, title: '', text };
      if (!pos) return r;
      if (pos.off) return { ...r, status: 'off', title: 'Off-screen' };
      const beat = byKey.get(pos.beat);
      if (!beat) return { ...r, status: 'gone', title: '(gone from the Plan)' };
      const spot = pos.spot && (beat.spots || []).length > 1 ? (beat.spots.find((x) => x.key === pos.spot) || null) : null;
      if (pos.spot && !spot && (beat.spots || []).length > 1) return { ...r, status: 'gone', beat, title: '(gone from the Plan)' };
      return { ...r, status: spot ? 'spot' : 'beat', beat, spot,
        place: (spot && spot.note) || beat.place || null,
        spotName: spot && !spot.note ? spot.name : null,
        title: spot ? `${beat.title} · ${spot.name}` : beat.title };
    });

    const vitals = vitalRows(model, state, beats);
    const vitalsRecorded = vitals
      .filter((v) => v.set || state.end.longRest)
      .map((v) => ({ rowId: v.rowId, ally: v.ally, copy: v.copy, note: v.note, name: v.name,
        hp: v.setHp || state.end.longRest ? v.hp : null, max: v.max, conditions: v.conditions }));

    const loot = [];
    for (const b of beats) {
      for (const t of b.treasure || []) {
        const l = state.loot[t.key];
        if (l && l.to) loot.push({ key: t.key, beat: b.key, beatTitle: b.title, text: t.text, item: t.item || l.item || null, to: l.to });
      }
    }

    const titleOf = (key, saved) => (byKey.get(key) ? byKey.get(key).title : saved || '');
    const entries = state.jots.map((j, i) => ({ at: j.at, o: i, beatKey: j.beat, beatTitle: j.beat ? titleOf(j.beat, j.title) : '', text: j.text, id: j.id }))
      .concat(state.events.map((e, i) => ({ at: e.at, o: 1e6 + i, beatKey: e.beat, beatTitle: e.beat ? titleOf(e.beat, e.title) : '', text: e.text })));
    const logLines = entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.o - b.o)).map(({ o, ...rest }) => rest);

    const unmaskedNow = [];
    const maskedAgain = [];
    for (const [note, n] of Object.entries(model.notes || {})) {
      if (n && n.unmask && n.unmask.since && !(state.unmask[note] && state.unmask[note].on === false)) unmaskedNow.push({ note, name: n.unmask.name, carried: true });
    }
    for (const [note, u] of Object.entries(state.unmask)) {
      const carried = model.notes && model.notes[note] && model.notes[note].unmask && model.notes[note].unmask.since;
      if (u.on) unmaskedNow.push({ note, name: u.name, carried: false });
      else if (carried) maskedAgain.push({ note });
    }

    // anything keyed that the Plan no longer holds
    const orphans = [];
    const seenBeat = new Map();
    const beatOrphan = (key, title, use) => {
      if (byKey.has(key)) return;
      if (!seenBeat.has(key)) { const o = { kind: 'beat', key, text: title || '', beatTitle: title || '', value: [] }; seenBeat.set(key, o); orphans.push(o); }
      const o = seenBeat.get(key);
      if (title && !o.text) { o.text = title; o.beatTitle = title; }
      if (!o.value.includes(use)) o.value.push(use);
    };
    for (const [k, v] of Object.entries(state.visited)) beatOrphan(k, v.title, 'visited');
    for (const [k, v] of Object.entries(state.fired)) beatOrphan(k, v.title, 'fired');
    if (state.stopped) beatOrphan(state.stopped.beat, state.stopped.title, 'stopped');
    for (const k of Object.keys(state.brought)) beatOrphan(k, '', 'brought');
    for (const [pc, p] of Object.entries(state.positions)) {
      if (!p.beat) continue;
      if (!byKey.has(p.beat)) beatOrphan(p.beat, '', `stood: ${pc}`);
      else if (p.spot && (byKey.get(p.beat).spots || []).length > 1 && !spotKeys.has(p.spot)) orphans.push({ kind: 'spot', key: p.spot, text: '', beatTitle: byKey.get(p.beat).title, value: pc });
    }
    for (const [k, v] of Object.entries(state.points)) if (!pointKeys.has(k)) orphans.push({ kind: 'point', key: k, text: v.text, beatTitle: v.beatTitle, value: v.mark });
    for (const [k, v] of Object.entries(state.loot)) if (!lootKeys.has(k)) orphans.push({ kind: 'loot', key: k, text: v.text, beatTitle: v.beatTitle, value: v.to });
    for (const [k, v] of Object.entries(state.handouts)) if (!handoutKeys.has(k)) orphans.push({ kind: 'handout', key: k, text: v.text, beatTitle: '', value: 'handed over' });

    return {
      beats, reached, whereEnded, pointsBy, notReached, orphans, vitals, vitalsRecorded, loot,
      log: logLines,
      stopped: state.stopped ? { beat: state.stopped.beat, title: titleOf(state.stopped.beat, state.stopped.title) } : null,
      fired: Object.entries(state.fired).map(([beat, v]) => ({ beat, title: titleOf(beat, v.title) })),
      improvised: state.improvised.slice(),
      handedOver: Object.entries(state.handouts).map(([key, v]) => ({ key, text: v.text, note: v.note })),
      unmaskedNow, maskedAgain,
      advancement: state.end.advancement || '',
      fightLog: [],
    };
  }

  return { emptyState, reduce, derive, cyclePoint, armClick, castSearch };
}));
