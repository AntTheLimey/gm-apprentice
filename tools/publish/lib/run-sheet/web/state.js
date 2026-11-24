'use strict';
// The run sheet's play state, as one pure module. It runs in node (the Table Log writer, the tests)
// and in the browser (the page) with no build step: `module.exports` under node, `window.RunSheetState`
// in a page. No DOM, no fetch, no clock: time comes in as an argument. `reduce` is the one way state
// changes and `derive` the one way the page and the record read it, so they cannot disagree.
//
// State is stored against the reader's keys (beat, spot, point, loot, handout), each with the words
// it had, so an item whose key the Plan later loses can still be shown (an orphan) and re-attached.
// `rev`, `stateId` and `recordHash` belong to the server: `reduce` never touches them. Keys the page
// does not know pass through `reduce` and `derive` untouched.
//
// The fight (plan 5b) lives here too: fight-math.js holds its pure helpers and fight.js its handlers, which
// `reduce` takes as its own. In a page both load before this file; under node it requires them. show.js
// (what the GM shows the players) joins the same way.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fight-math'), require('./fight'), require('./show'));
  else root.RunSheetState = factory(root.RunSheetFightMath, root.RunSheetFight, root.RunSheetShow);
}(typeof self !== 'undefined' ? self : this, function (FM, Fight, Show) {
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
      fight: null, fights: [], panels: {}, shownEver: {},
      // the notes whose rows the players saw by name in a fight that has ended (final review, ledger 86): a foe
      // starts seen from it, never an inferred ally (re-review)
      seenEver: {},
      // the last side the GM set per note (plan 6a): 'foe' | 'ally' | 'neutral'
      sides: {},
    };
  }

  // A saved state brought up to this version's shape: each top-level key (and each `end.*` key) that is
  // missing is filled from `fresh` (emptyState), so a file an older version wrote still derives. A key
  // of the wrong kind (an array where an object belongs) throws, code BAD_STATE: the file is broken.
  function upgrade(state, fresh) {
    const bad = (why) => { const e = new TypeError(`the saved state is not one this sheet can read: ${why}`); e.code = 'BAD_STATE'; return e; };
    const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    const fill = (obj, base, where) => {
      if (kind(obj) !== 'object') throw bad(`${where || 'the state'} is not an object`);
      const out = { ...obj };
      for (const [k, v] of Object.entries(base)) {
        if (!has(out, k) || out[k] === undefined) { out[k] = clone(v); continue; }
        // Only the containers are checked: they are what derive reads into. A scalar (stateId, plan,
        // startedAt…) or a key the empty state leaves null (stopped) takes any value.
        if ((kind(v) === 'object' || kind(v) === 'array') && kind(out[k]) !== kind(v)) throw bad(`${where ? `${where}.` : ''}${k} is ${kind(out[k])}, not ${kind(v)}`);
      }
      return out;
    };
    const base = fresh || emptyState({});
    const out = fill(state, base, '');
    out.end = fill(out.end, base.end, 'end');
    // The entries derive and the handlers read into: each one an object (a `null` jot would stop the page).
    const entries = (list, where) => list.forEach((v, i) => { if (kind(v) !== 'object') throw bad(`${where}[${i}] is ${kind(v)}, not object`); });
    for (const k of ['jots', 'events', 'improvised']) entries(out[k], k);
    for (const k of ['positions', 'visited', 'points', 'fired', 'loot', 'handouts']) {
      for (const [id, v] of Object.entries(out[k])) if (kind(v) !== 'object') throw bad(`${k}.${id} is ${kind(v)}, not object`);
    }
    for (const [id, v] of Object.entries(out.brought)) {
      if (kind(v) !== 'array') throw bad(`brought.${id} is ${kind(v)}, not array`);
      entries(v, `brought.${id}`);
    }
    if (out.stopped !== null && kind(out.stopped) !== 'object') throw bad(`stopped is ${kind(out.stopped)}, not object`);
    // The fight and the players' panels: a running fight is an object or null, each fight's rows a list
    // of objects, and each group's panel an object. `shownEver` and `seenEver` hold a time (or true) per note: any value.
    if (out.fight !== null && kind(out.fight) !== 'object') throw bad(`fight is ${kind(out.fight)}, not object`);
    entries(out.fights, 'fights');
    for (const [where, f] of [...(out.fight ? [['fight', out.fight]] : []), ...out.fights.map((f, i) => [`fights[${i}]`, f])]) {
      if (f.rows === undefined) continue;
      if (kind(f.rows) !== 'array') throw bad(`${where}.rows is ${kind(f.rows)}, not array`);
      entries(f.rows, `${where}.rows`);
    }
    for (const [id, v] of Object.entries(out.panels)) if (kind(v) !== 'object') throw bad(`panels.${id} is ${kind(v)}, not object`);
    return out;
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
    // keys the rewrite leaves alone go in first, so a moved value wins a collision
    const out = {};
    const moved = [];
    for (const [k, v] of Object.entries(obj || {})) { if (re(k) === k) out[k] = v; else moved.push([re(k), v]); }
    for (const [k, v] of moved) out[k] = v;
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
      // a hub's spot keeps its own first arrival, for the Table Log's Places the party went (Task 13 proof)
      const v = s.visited[to.beat];
      if (to.spot && v && typeof v === 'object') {
        if (!v.spots || typeof v.spots !== 'object' || Array.isArray(v.spots)) v.spots = {};
        if (!v.spots[to.spot]) v.spots[to.spot] = at;
      }
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
    // `place` (plan 6a Task 7): a known place's note, for Fight here. Its key is the reader's `pl-<hash>`.
    improvise(s, a, at) {
      const title = String(a.title || '').trim();
      if (!title) return;
      // the key comes from the action, never from what the state holds, so a re-applied action keeps its beat
      const key = a.key || (a.id != null ? `i-${a.id}` : `i-${s.improvised.length + 1}`);
      if (s.improvised.some((i) => i.key === key)) return;
      s.improvised.push({ key, title, at, ...(typeof a.place === 'string' && a.place ? { place: a.place } : {}) });
      // Fight here's own place beat is quiet: its "Fight starts at…" line says it (review M4)
      if (!a.quiet) log(s, at, key, 'Improvised beat.', title);
    },
    // Move them (plan 6a Task 7): the PCs to a known place (`place`, with the reader's `key` and its `title`) or
    // to a typed name (`name`), making its place beat if it has none. A typed name the night already holds, in
    // any case and with or without "the", is that place again; a new one is keyed `pn-<action id>`. One Log line.
    // A place the Plan has a beat or hub spot for (`to`, from `planTarget`) is that beat: the PCs move as `move`
    // moves them, and the line names the beat (review I1), so no second beat shadows the Plan's.
    moveGroup(s, a, at) {
      const pcs = (Array.isArray(a.pcs) ? a.pcs : []).filter((p) => typeof p === 'string' && p);
      if (!pcs.length) return;
      const said = () => pcs.map((pc, i) => String((Array.isArray(a.names) && a.names[i]) || '').trim() || stem(pc));
      const verb = (names) => `${names.join(', ')} ${names.length > 1 ? 'move' : 'moves'} to`;
      if (a.to && typeof a.to === 'object' && typeof a.to.beat === 'string' && a.to.beat) {
        const to = { beat: a.to.beat, spot: a.to.spot || null, title: String(a.to.title || '') };
        for (const pc of pcs) HANDLERS.move(s, { pc, to }, at);
        const where = String(a.title || '').trim() || stem(a.place) || to.title;
        const label = String(a.to.label || to.title || '').trim();
        log(s, at, to.beat, `${verb(said())} ${where}${label ? ` (the Plan's beat: ${label})` : ''}.`, to.title);
        return;
      }
      let place;
      if (typeof a.place === 'string' && a.place) {
        const key = String(a.key || '');
        if (!key || key.includes('.')) return;
        place = s.improvised.find((i) => i.key === key);
        if (!place) { place = { key, title: String(a.title || '').trim() || stem(a.place), at, place: a.place }; s.improvised.push(place); }
      } else {
        const name = String(a.name == null ? '' : a.name).replace(/\s+/g, ' ').trim();
        if (!name) return;
        place = s.improvised.find((i) => i.newPlace && FM.sameName(i.title, name));
        if (!place) {
          const key = `pn-${String(a.id != null ? a.id : s.improvised.length + 1).replace(/\./g, '-')}`;
          if (s.improvised.some((i) => i.key === key)) return;
          place = { key, title: name, at, place: null, newPlace: true };
          s.improvised.push(place);
        }
      }
      for (const pc of pcs) HANDLERS.move(s, { pc, to: { beat: place.key, spot: null, title: place.title } }, at);
      log(s, at, place.key, `${verb(said())} ${place.title}${place.newPlace ? ' (a new place)' : ''}.`, place.title);
    },
    // Take off (v8, review F13): a place typed tonight that nobody stands at goes, with its lines; never while the
    // running fight is at it or has it behind a panel (review M2).
    unplace(s, a) {
      const place = s.improvised.find((i) => i.key === a.key);
      if (!place || !place.newPlace) return;
      if (Object.values(s.positions).some((p) => p && p.beat === a.key)) return;
      if (placeInFight(s, a.key)) return;
      HANDLERS.unimprovise(s, { key: a.key });
    },
    unimprovise(s, a) {
      s.improvised = s.improvised.filter((i) => i.key !== a.key);
      delete s.visited[a.key];
      delete s.brought[a.key];
      delete s.fired[a.key];
      if (s.stopped && s.stopped.beat === a.key) s.stopped = null;
      const under = (k) => k === a.key || k.startsWith(`${a.key}.`);
      for (const m of ['points', 'loot']) for (const k of Object.keys(s[m])) if (under(k)) delete s[m][k];
      for (const [pc, p] of Object.entries(s.positions)) if (p.beat === a.key) delete s.positions[pc];
      s.jots = s.jots.filter((j) => j.beat !== a.key);
      // a fight's lines stay: the fight happened, wherever it was started
      s.events = s.events.filter((e) => e.beat !== a.key || e.fight);
    },
    bring(s, a, at) {
      if (!a.beat || !a.note) return;
      const list = s.brought[a.beat] || (s.brought[a.beat] = []);
      if (list.some((b) => b.note === a.note)) return;
      list.push({ note: a.note, name: a.name || stem(a.note), at });
      log(s, at, a.beat, `${a.name || stem(a.note)} brought in.`, a.title);
    },
    unbring(s, a, at) {
      const gone = (s.brought[a.beat] || []).find((b) => b.note === a.note);
      if (!gone) return;
      s.brought[a.beat] = s.brought[a.beat].filter((b) => b.note !== a.note);
      if (!s.brought[a.beat].length) delete s.brought[a.beat];
      log(s, at, a.beat, `${gone.name || stem(a.note)} taken off.`, a.title);
    },
    unmask(s, a, at) {
      if (!a.note || (a.on && !a.name)) return;
      s.unmask[a.note] = { on: !!a.on, name: a.name || '', at };
      const was = a.was || stem(a.note);
      log(s, at, a.beat, a.on ? `${was} unmasked as ${a.name}.` : `${was} masked again.`, a.title);
    },
    handOver(s, a, at) {
      if (!a.handout) return;
      if (!a.on) { delete s.handouts[a.handout]; return; }
      s.handouts[a.handout] = { text: a.text || '', ...(a.name ? { name: a.name } : {}), note: a.note || null, at };
      // the handout's name (the page sends it), never its Notes cell; a name that ends a sentence gets no second stop
      const name = String(a.name || stem(a.note) || a.text || 'a handout').trim();
      log(s, at, null, `Handed over: ${/[.!?]["'”’)]?$/.test(name) ? name : `${name}.`}`);
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
      // the fight, its thresholds and lit marks, and the ended fights follow the beat (Review M10)
      const rows = (list) => { for (const r of list || []) { r.group = re(r.group); r.foeKey = re(r.foeKey); } };
      if (s.fight) {
        const f = s.fight;
        f.beat = re(f.beat);
        f.groups = (f.groups || []).map(re);
        for (const t of f.thresholds || []) { t.beat = re(t.beat); t.key = re(t.key); }
        // a lit key is `<threshold key>|<row id>`: only the part before the bar names a place
        f.lit = Object.fromEntries(Object.entries(f.lit || {}).map(([k, v]) => {
          const i = k.lastIndexOf('|');
          return [i < 0 ? re(k) : `${re(k.slice(0, i))}${k.slice(i)}`, v];
        }));
        rows(f.rows);
        if (f.backdrop && typeof f.backdrop === 'object') f.backdrop = { group: re(f.backdrop.group), place: re(f.backdrop.place) };
      }
      for (const f of s.fights || []) { f.beat = re(f.beat); rows(f.rows); }
      // the players' panels are kept by position, so they move with it (Review M10)
      if (s.panels && typeof s.panels === 'object') s.panels = rekey(s.panels, re);
      s.attached[a.from] = a.to;
    },
    // Each field set here is stamped with when, so a later fight or long rest can be told from it (decision 17).
    endSet(s, a, at) {
      for (const [id, v] of Object.entries(a.vitals || {})) {
        const old = s.end.vitals[id] || {};
        // each field keeps its own time: a conditions edit must not make an older HP look newer than a fight
        const was = old.at && typeof old.at === 'object' ? old.at : (old.at ? { hp: old.at, max: old.at, conditions: old.at } : {});
        const stamp = { ...was };
        for (const k of Object.keys(v)) stamp[k] = at;
        s.end.vitals[id] = { ...old, ...v, at: stamp };
      }
      for (const [pc, text] of Object.entries(a.where || {})) { if (String(text || '').trim()) s.end.where[pc] = String(text); else delete s.end.where[pc]; }
      if (typeof a.advancement === 'string') s.end.advancement = a.advancement;
    },
    // A long rest sets every row to full; `longRest {on: false}` takes it back, with the figures the GM had set.
    longRest(s, a, at) {
      if (a.on === false) {
        for (const v of Object.values(s.end.vitals)) {
          if (v.rested) { if (v.hp === undefined) v.hp = v.rested.hp; if (v.max === undefined) v.max = v.rested.max; delete v.rested; }
          if (v.hp === undefined) delete v.hp;
          if (v.max === undefined) delete v.max;
        }
        delete s.end.longRest;
        delete s.end.longRestAt;
        return;
      }
      for (const v of Object.values(s.end.vitals)) {
        if (v.hp !== undefined || v.max !== undefined) v.rested = { hp: v.hp, max: v.max };
        delete v.hp; delete v.max;
      }
      s.end.longRest = true;
      s.end.longRestAt = at;
    },
  };
  Object.assign(HANDLERS, Fight.FIGHT_HANDLERS, Show.SHOW_HANDLERS);

  // Whether the running fight is at a place beat, or has it behind a panel.
  const placeInFight = (s, key) => Boolean(s.fight && (s.fight.beat === key || (s.fight.backdrop && s.fight.backdrop.place === key)));

  // Where Move them takes a group to a place the Plan already has (review I1): the beat whose place it is, or a
  // hub's spot that names it; of several, the first not yet visited, else the first. Null when the Plan has
  // none (the place gets a `pl-` beat of its own). `label` names the beat, and the spot at a hub.
  // `pcs` (Fight here, final review O2): when one of these PCs stands at one of the place's beats or spots now,
  // that one, before the first unvisited.
  function planTarget(model, state, note, pcs) {
    const hits = [];
    for (const b of (model && model.beats) || []) {
      if (b.contingency) continue;
      const spots = b.spots || [];
      if (b.place === note) hits.push({ beat: b.key, spot: null, title: b.title, label: b.title });
      else if (spots.length > 1) {
        const sp = spots.find((x) => x.note === note);
        if (sp) hits.push({ beat: b.key, spot: sp.key, title: b.title, label: `${b.title} · ${sp.name}` });
      }
    }
    const positions = (state && state.positions) || {};
    const standing = (pcs || []).map((p) => positions[p]).filter((x) => x && !x.off);
    const here = hits.find((h) => standing.some((x) => x.beat === h.beat && (h.spot === null || x.spot === h.spot)));
    if (here) return here;
    const visited = (state && state.visited) || {};
    return hits.find((h) => !visited[h.beat]) || hits[0] || null;
  }

  // An action made before an `attach` (queued in another window, or re-applied on a newer state) still
  // names the old keys: map them through what was attached. `key` is an improvised or place beat's
  // (improvise, moveGroup, unplace: review M3).
  const KEY_FIELDS = ['beat', 'point', 'item', 'handout', 'spot', 'group', 'key'];
  function remapKey(attached, k) {
    if (typeof k !== 'string' || !attached) return k;
    let cur = k;
    for (let n = 0; n < 10; n++) {
      let next = has(attached, cur) ? attached[cur] : null;
      if (next === null) {
        const dot = cur.indexOf('.');
        if (dot > 0 && has(attached, cur.slice(0, dot))) next = attached[cur.slice(0, dot)] + cur.slice(dot);
      }
      if (next === null || next === cur) break;
      cur = next;
    }
    return cur;
  }
  function remapAction(attached, a) {
    if (a.type === 'attach' || !attached || !Object.keys(attached).length) return a;
    const out = { ...a };
    for (const f of KEY_FIELDS) if (out[f] != null) out[f] = remapKey(attached, out[f]);
    if (out.to && typeof out.to === 'object') out.to = { ...out.to, beat: remapKey(attached, out.to.beat), spot: remapKey(attached, out.to.spot) };
    // a fight action built before the attach: its groups, rows and thresholds
    const re = (k) => remapKey(attached, k);
    if (Array.isArray(out.groups)) out.groups = out.groups.map(re);
    if (Array.isArray(out.rows)) out.rows = out.rows.map((r) => (r && typeof r === 'object' ? { ...r, group: re(r.group), foeKey: re(r.foeKey) } : r));
    if (Array.isArray(out.thresholds)) out.thresholds = out.thresholds.map((t) => (t && typeof t === 'object' ? { ...t, beat: re(t.beat), key: re(t.key) } : t));
    if (out.backdrop && typeof out.backdrop === 'object') out.backdrop = { ...out.backdrop, group: re(out.backdrop.group), place: re(out.backdrop.place) };
    return out;
  }

  // reduce(state, action, at) -> a new state. An action id already in `applied` changes nothing; an
  // unknown action returns the same object.
  function reduce(state, action, at) {
    if (!action || typeof action !== 'object' || !has(HANDLERS, action.type)) return state;
    if (action.id != null && state.applied && state.applied.includes(action.id)) return state;
    const s = clone(state);
    if (!s.startedAt) s.startedAt = at || null;
    HANDLERS[action.type](s, remapAction(s.attached, action), at || null);
    if (action.id != null) {
      s.applied = (s.applied || []).concat(action.id).slice(-APPLIED_KEEP);
    }
    // the server's keys are never the page's to change
    s.rev = state.rev;
    s.stateId = state.stateId;
    s.recordHash = state.recordHash;
    return s;
  }

  // A handout's name for the Log: its note's name, else the row's first cell with its links read as words.
  function handoutName(h) {
    if (!h) return '';
    if (h.note) return stem(h.note);
    return String(h.name || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, alias) => alias || target.split('/').pop()).trim();
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

  // A note's side as the GM has it now (plan 6a): the side set tonight, then one carried from an earlier
  // Table Log, then the reader's (`readerAlly`). 'foe' | 'ally' | 'neutral'.
  function sideNow(model, state, note, readerAlly) {
    return FM.noteSide(state.sides, model.sidesCarried, note, readerAlly).side;
  }

  // The beats the page shows: the Plan's, the improvised ones, and each beat's "Who's here" with
  // whoever the GM brought in.
  function beatsOf(model, state) {
    const cast = new Map((model.cast || []).map((c) => [c.note, c]));
    // a brought-in ally gets a fight row too (unless the beat already has one), so it has a vitals row
    const broughtFoes = (key, foes) => (state.brought[key] || []).flatMap((x) => {
      const f = (cast.get(x.note) || {}).foe;
      return f && sideNow(model, state, x.note, f.ally) === 'ally' && !foes.some((o) => o.note === x.note) ? [{ ...f, key: `${key}.brought.${x.note}`, broughtIn: true }] : [];
    });
    const real = (model.beats || []).map((b) => {
      const extra = (state.brought[b.key] || []).map((x) => {
        const c = cast.get(x.note) || {};
        return { key: `${b.key}.brought.${x.note}`, note: x.note, name: c.name || x.name, knownAs: '', count: 1,
          wants: c.wants || '', playAs: c.playAs || '', dead: !!c.dead, brought: true };
      });
      if (!extra.length) return b;
      const foes = b.foes || [];
      return { ...b, who: (b.who || []).concat(extra), foes: foes.concat(broughtFoes(b.key, foes)) };
    });
    // A place beat (plan 6a Task 7) is an improvised beat at a place: a known one (`place`, its people from the
    // model's placePeople, v8's placeBeat) or one typed tonight (`newPlace`, nobody yet). No Points, no If-they.
    // Its people's foes are keyed under it; anyone but a creature joins a fight benched.
    const impro = state.improvised.map((i) => {
      const place = typeof i.place === 'string' && i.place ? i.place : null;
      const people = place ? ((model.placePeople && model.placePeople[place]) || []).filter((n) => typeof n === 'string') : [];
      const who = people.map((note) => {
        const c = cast.get(note) || {};
        return { key: `${i.key}.who.${note}`, note, name: c.name || stem(note), knownAs: '', count: 1, wants: c.wants || '', playAs: c.playAs || '', dead: !!c.dead };
      }).concat((state.brought[i.key] || []).filter((x) => !people.includes(x.note))
        .map((x) => ({ key: `${i.key}.brought.${x.note}`, note: x.note, name: x.name, brought: true, count: 1 })));
      const own = people.flatMap((note) => {
        const c = cast.get(note);
        return c && c.foe ? [{ ...c.foe, key: `${i.key}.foe.${note}`, benched: c.type !== 'creature' }] : [];
      });
      return {
        key: i.key, title: i.title, impro: true, contingency: false, sceneNote: null, place, spots: [],
        placeBeat: Boolean(place || i.newPlace), newPlace: Boolean(i.newPlace),
        who, points: [], ifs: [], treasure: [], foes: own.concat(broughtFoes(i.key, own)), handouts: [], entities: place ? [place] : [],
      };
    });
    return real.concat(impro);
  }

  const lower = (x) => String(x == null ? '' : x).trim().toLowerCase();
  // The party note a PC fight row stands for: by path, then by name (decision 18); null when neither holds.
  function partyNoteOf(model, row) {
    const pcs = model.pcs || [];
    const p = pcs.find((x) => x.note === row.note) || pcs.find((x) => lower(x.name) && lower(x.name) === lower(row.name));
    return p ? p.note : null;
  }
  const condText = (r) => Fight.statusesOf(r).join(', ');
  // "Changed" means the row differs from where it started; touched and put back is not changed (Review L7).
  // A max corrected in the fight counts (a row from before the start kept its max has none to compare).
  // A pool the row started with (CoC's MP, SAN and Luck, GURPS's FP: step 6b) that moved counts too.
  const POOLS = ['fp', 'mp', 'san', 'luck', 'er'];
  function changed(r) {
    const st = r.start || {};
    const same = (x, y) => JSON.stringify((x || []).slice().sort()) === JSON.stringify((y || []).slice().sort());
    return r.hp !== st.hp || (has(st, 'max') && r.max !== st.max) || !same(r.conds, st.conds)
      || (r.exhaustion || 0) !== (st.exhaustion || 0) || !!r.conc !== !!st.conc
      || POOLS.some((k) => has(st, k) && r[k] !== st[k]);
  }
  // The pools a fight row holds, by the row's own names (fp/fpMax, mp/mpMax, san/sanMax, luck, er/erMax), for the
  // vitals Task 20 writes; a pool the row lacks is left out, so a D&D figure is as before.
  const POOL_FIGURES = ['fp', 'fpMax', 'mp', 'mpMax', 'san', 'sanMax', 'luck', 'er', 'erMax'];
  function poolFigures(r) {
    const out = {};
    for (const k of POOL_FIGURES) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = r[k];
    if (Object.keys(out).length && r.poolAt) out.poolAt = r.poolAt;
    return out;
  }
  // Each PC's and ally's figures from every fight, ended or running, that changed it or had a status cleared
  // after it: vitals rowId -> [figure], oldest fight first. All are replayed, so a rest between two fights
  // still sees the HP the first one left (a later fight's figure stays the current one).
  function fightFigures(model, state) {
    const out = new Map();
    const allies = new Map();
    const fights = (Array.isArray(state.fights) ? state.fights : []).concat(state.fight && Array.isArray(state.fight.rows) ? [state.fight] : []);
    for (const f of fights) {
      for (const r of f.rows || []) {
        let rowId = null;
        if (r.kind === 'pc') rowId = partyNoteOf(model, r);
        else if (r.kind === 'ally' && r.note) {
          rowId = r.copy > 1 ? `${r.note}#${r.copy}` : r.note;
          if (!allies.has(rowId)) allies.set(rowId, { rowId, ally: true, copy: r.copy || 1, note: r.note, name: r.name, base: { hp: (r.start || {}).hp ?? r.max ?? null, max: r.max ?? null, ...poolBase(r.start || {}, r, nightPools(model)) } });
        }
        // HP and max at their own time, conditions at theirs (Review H1); a row from before them reads `at`
        const at = r.at || f.endedAt || f.startedAt || null;
        const clears = Array.isArray(r.clears) ? r.clears.filter((c) => c && Array.isArray(c.removed)) : [];
        const moved = changed(r);
        if (!rowId || (!moved && !clears.length)) continue;
        if (!out.has(rowId)) out.set(rowId, []);
        // the pools this fight moved (a pool it left alone is not the fight's figure: the vitals keep theirs)
        const st = r.start || {};
        const poolsMoved = POOLS.filter((k) => has(st, k) && r[k] !== st[k]);
        out.get(rowId).push({ changed: moved, hp: r.hp, max: r.max, conditions: condText(r), condAt: r.condAt || at, hpAt: r.hpAt || at, clears, ...poolFigures(r), poolsMoved });
      }
    }
    return { figures: out, allies };
  }
  // A long rest: HP to max, Down and Stable gone, Exhaustion one lower; every other status kept.
  function restedConditions(text) {
    return String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).flatMap((c) => {
      if (/^(?:Down|Stable)$/i.test(c)) return [];
      const m = /^Exhaustion\s+(\d+)$/i.exec(c);
      if (m) return Number(m[1]) > 1 ? [`Exhaustion ${Number(m[1]) - 1}`] : [];
      return [c];
    }).join(', ');
  }

  // A conditions text with the statuses a clear took off; an Exhaustion clear takes any Exhaustion level.
  function withoutStatuses(text, removed) {
    const gone = new Set(removed);
    const tired = removed.some((x) => /^Exhaustion\b/.test(x));
    return String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      .filter((c) => !gone.has(c) && !(tired && /^Exhaustion\b/i.test(c))).join(', ');
  }

  // The system's vitals columns (model.rules.vitals: the ontology's `run_sheet.vitals`, each { column, field, shape,
  // max?, pcs_only? }), and the pools among them (step 6b: CoC's MP, SAN and Luck, GURPS's FP). Each pool's max is
  // the field its column names (`max`); a model with none has no pools, as D&D.
  function vitalColumns(model) {
    const v = model && model.rules && model.rules.vitals;
    return Array.isArray(v) ? v.filter((c) => c && typeof c === 'object' && typeof c.field === 'string') : [];
  }
  const poolColumns = (model) => vitalColumns(model).filter((c) => c.field !== 'hp' && c.field !== 'conditions');
  // The pools the night holds: the columns', and any other pool the system's fight keeps (model.rules.pools, each
  // { key, max }: GURPS's Energy Reserve), which has no column. Such a pool is replayed like the others, so the next
  // fight that night starts from it, but it is never written to the Table Log (vitalsRecorded reads the columns) and
  // so never carried to the next session.
  function nightPools(model) {
    const cols = poolColumns(model);
    const more = (model && model.rules && Array.isArray(model.rules.pools) ? model.rules.pools : [])
      .filter((p) => p && typeof p.key === 'string' && !cols.some((c) => c.field === p.key))
      .map((p) => ({ field: p.key, max: typeof p.max === 'string' ? p.max : null, column: null }));
    return cols.concat(more);
  }
  const numOr = (...xs) => { for (const x of xs) if (typeof x === 'number' && Number.isFinite(x)) return x; return null; };
  // A pool's current figure as the readers name it: `mpNow`, `sanNow`, `fpNow` (a PC's sheet, a carried figure);
  // Luck is `luck`.
  const nowOf = (o, k) => (k === 'luck' ? o.luck : o[`${k}Now`]);
  // A PC's pools from its sheet's numbers.
  function pcPools(p, cols) {
    const out = {};
    for (const c of cols) { out[c.field] = numOr(nowOf(p, c.field), c.max && p[c.max]); if (c.max) out[c.max] = numOr(p[c.max]); }
    return out;
  }
  // An ally's from its fight row as the reader gave it: a carried figure first (the last Table Log's), then a block's
  // stated start (`fpStart`), then the block's figure. Luck is a PC's alone.
  function allyPools(f, cols) {
    const out = {};
    for (const c of cols) {
      out[c.field] = c.pcs_only ? null : numOr(nowOf(f, c.field), f[`${c.field}Start`], f[c.field], c.max && f[c.max]);
      if (c.max) out[c.max] = numOr(f[c.max], f[c.field]);
    }
    return out;
  }
  // A fought ally's (one only a fight held), from the fight row: where it started, and its maxima.
  function poolBase(start, r, cols) {
    const out = {};
    for (const c of cols) {
      out[c.field] = c.pcs_only ? null : numOr(start[c.field], c.max && r[c.max]);
      if (c.max) out[c.max] = numOr(r[c.max]);
    }
    return out;
  }
  // The pools an end-panel vitals entry holds, as `MP 4` (its column word and figure), for a line about vitals kept for
  // someone the Plan no longer has (the record's Changed since play started, and the end panel's).
  function poolWords(model, v) {
    return poolColumns(model).filter((c) => v && v[c.field] !== undefined && v[c.field] !== null && v[c.field] !== '')
      .map((c) => `${c.column} ${String(v[c.field]).replace(/\s+/g, ' ').trim()}`);
  }

  // Ally rows: one per ally note, a copy row for each extra number a beat holds (`Guard 2`), and any ally a
  // fight held. Each row's figure is the latest of: the note, each fight that changed it, the end panel,
  // a long rest (decision 17). `source` says where the HP came from.
  function vitalRows(model, state, beats, reached) {
    const rows = [];
    const cols = nightPools(model);
    for (const p of model.pcs || []) {
      rows.push({ rowId: p.note, ally: false, copy: 1, note: p.note, name: p.name, base: { hp: p.hpNow ?? p.hpMax ?? null, max: p.hpMax ?? null, ...pcPools(p, cols) } });
    }
    const allies = new Map();
    const inPlay = new Set();
    for (const b of beats) {
      const seen = new Map();
      for (const f of b.foes || []) {
        // the side as the GM has it now: a reader-ally set neutral or foe has no vitals row (review P-S4)
        if (sideNow(model, state, f.note, f.ally) !== 'ally') continue;
        if (reached.has(b.key) || f.broughtIn) inPlay.add(f.note);
        const copy = (seen.get(f.note) || 0) + 1;
        seen.set(f.note, copy);
        if (!allies.has(f.note)) allies.set(f.note, []);
        const list = allies.get(f.note);
        if (!list[copy - 1]) list[copy - 1] = { rowId: copy === 1 ? f.note : `${f.note}#${copy}`, ally: true, copy, note: f.note, name: f.name, base: { hp: f.hpNow ?? f.hp ?? null, max: f.hp ?? null, ...allyPools(f, cols) } };
      }
    }
    for (const list of allies.values()) for (const r of list) if (r) rows.push(r);
    const { figures, allies: fought } = fightFigures(model, state);
    for (const [rowId, r] of fought) {
      if (rows.some((x) => x.rowId === rowId)) continue;
      // an ally in a fight the GM has set to another side since
      if (sideNow(model, state, r.note, true) !== 'ally') continue;
      rows.push(r);
      inPlay.add(r.note);
    }
    const ord = (t) => (typeof t === 'string' ? t : '');
    return rows.map((r) => {
      let o = state.end.vitals[r.rowId] || {};
      const covered = state.end.longRest && (!r.ally || inPlay.has(r.note));
      // an ally who was not in play keeps the figures the GM set before the rest, unless set again since
      if (state.end.longRest && !covered && o.rested) o = { ...o, hp: o.hp !== undefined ? o.hp : o.rested.hp, max: o.max !== undefined ? o.max : o.rested.max };
      const setHp = o.hp !== undefined && o.hp !== '';
      const setMax = o.max !== undefined && o.max !== '';
      const fig = { hp: r.base.hp, max: r.base.max, conditions: '', source: 'note', at: null };
      // each pool (CoC's MP, SAN and Luck, GURPS's FP, Energy Reserve) is a figure of its own, with its own source
      // and time, replayed as HP is: the note's, then each fight that moved it, then the end panel
      const pool = {};
      const maxima = {};
      for (const c of cols) {
        pool[c.field] = { fig: r.base[c.field] ?? null, source: 'note' };
        if (c.max) maxima[c.max] = r.base[c.max] ?? null;
      }
      const steps = [];
      const ffs = figures.get(r.rowId) || [];
      for (const ff of ffs) {
        if (ff.changed) {
          steps.push({ t: ord(ff.hpAt), k: 0, run: () => Object.assign(fig, { hp: ff.hp, max: ff.max ?? fig.max, source: 'fight', at: ff.hpAt }) });
          for (const c of cols) {
            const k = c.field;
            if (!(ff.poolsMoved || []).includes(k) || typeof ff[k] !== 'number') continue;
            // each pool at the time it moved (fight.js stamps `poolAt` per pool; an older row holds one time for all)
            const pa = ff.poolAt && typeof ff.poolAt === 'object' ? ff.poolAt[k] : ff.poolAt;
            steps.push({ t: ord(pa || ff.hpAt), k: 0, run: () => {
              pool[k] = { fig: ff[k], source: 'fight' };
              if (c.max && typeof ff[c.max] === 'number') maxima[c.max] = ff[c.max];
            } });
          }
          // the text is the row's now: a status cleared since is gone already, and its clear below takes it off
          // whatever stands then too (an end-panel edit, a rest's Exhaustion step), never puts the fight's back
          steps.push({ t: ord(ff.condAt), k: 0, run: () => { fig.conditions = ff.conditions; } });
        }
        for (const c of ff.clears) steps.push({ t: ord(c.at), k: 0, run: () => { fig.conditions = withoutStatuses(fig.conditions, c.removed); } });
      }
      // each field has its own time; a 5a row holds one time for all of them, a row with none loses to a fight
      const when = (k) => (o.at && typeof o.at === 'object' ? o.at[k] : o.at);
      if (setMax) steps.push({ t: ord(when('max')), k: 1, run: () => { fig.max = o.max; } });
      if (o.conditions !== undefined) steps.push({ t: ord(when('conditions')), k: 1, run: () => { fig.conditions = o.conditions || ''; } });
      let restSkipped = false;
      // the HP and max the GM set before the rest (the rest set them aside) stand at their own times, before it,
      // so a 0 typed then still means the rest does nothing
      const typed = (x) => x !== undefined && x !== null && x !== '';
      if (covered && o.rested) {
        const rest = ord(state.end.longRestAt);
        const before = (k) => [ord(when(k)), rest].sort()[0];
        if (typed(o.rested.max)) steps.push({ t: before('max'), k: 1, run: () => { fig.max = o.rested.max; } });
        if (typed(o.rested.hp)) steps.push({ t: before('hp'), k: 1, run: () => Object.assign(fig, { hp: o.rested.hp, source: 'end', at: when('hp') || null }) });
      }
      if (covered) {
        // SRD: a creature at 0 HP gets no long rest benefit; its row is left as it is
        steps.push({ t: ord(state.end.longRestAt), k: 2, run: () => {
          if (fig.hp === 0) { restSkipped = true; return; }
          // SRD 5.2.1: a long rest restores a reduced HP maximum too
          if (typeof r.base.max === 'number' && (typeof fig.max !== 'number' || fig.max < r.base.max)) fig.max = r.base.max;
          Object.assign(fig, { hp: fig.max, conditions: restedConditions(fig.conditions), source: 'rest', at: state.end.longRestAt || null });
        } });
      }
      // a long rest moves the HP the GM had set aside, so an HP still set was typed after it
      if (setHp) steps.push({ t: covered ? [ord(when('hp')), ord(state.end.longRestAt)].sort().pop() : ord(when('hp')), k: 3, run: () => Object.assign(fig, { hp: o.hp, source: 'end', at: when('hp') || null }) });
      for (const { field: k } of cols) {
        if (o[k] !== undefined && o[k] !== '') steps.push({ t: ord(when(k)), k: 3, run: () => { pool[k] = { fig: o[k], source: 'end' }; } });
      }
      steps.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.k - y.k)).forEach((x) => x.run());
      const pools = {};
      for (const { field: k } of cols) { pools[k] = pool[k].fig; pools[`${k}Source`] = pool[k].source; }
      return { restSkipped, rowId: r.rowId, ally: r.ally, copy: r.copy, note: r.note, name: r.name,
        hp: fig.hp, max: fig.max, conditions: fig.conditions, ...pools, ...maxima,
        set: has(state.end.vitals, r.rowId), rest: fig.source === 'rest', setHp: fig.source === 'end',
        fight: ffs.some((x) => x.changed), source: fig.source, at: fig.at };
    });
  }

  // Why an end-panel figure for a PC cannot be saved, or null when it can (step 6b). `sheet set` takes no figure over
  // the sheet's maximum, so HP, MP, SAN and FP are held to the maxima the site's readers give the PC (`hpMax`, `mpMax`,
  // `sanMax`, `fpMax`), and to 0 below, except GURPS's HP and FP, which go below 0. An ally, a blank or a figure
  // that is not a number (kept as typed, as before), and D&D (as before 6b) are never refused.
  function endFigureProblem(model, rowId, field, value) {
    const rules = (model && model.rules) || {};
    if (!rules.family || rules.family === 'dnd' || typeof value !== 'number' || !Number.isFinite(value)) return null;
    const pc = ((model && model.pcs) || []).find((p) => p.note === rowId);
    if (!pc) return null;
    // the column's max on a PC's sheet: the ontology's `sheet` name with Max (hp: `hpMax`, mp: `mpMax`), where the
    // vitals row's own max field (`max`, for HP) is another name
    const col = vitalColumns(model).find((c) => c.field === field);
    const sheetMax = col && col.max ? (typeof col.sheet === 'string' ? `${col.sheet}Max` : col.max) : null;
    const max = sheetMax ? pc[sheetMax] : null;
    if (typeof max === 'number' && value > max) return `over the sheet's max (${max}): not saved`;
    const below = rules.family === 'gurps' && (field === 'hp' || field === 'fp');
    if (value < 0 && !below) return 'below 0: not saved';
    return null;
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

    const vitals = vitalRows(model, state, beats, reached);
    const vitalsRecorded = vitals
      .filter((v) => v.set || v.rest || v.fight)
      .map((v) => {
        // a pool goes into the record only when a fight or the end panel set it, as HP; its max goes with it
        const pools = {};
        for (const c of poolColumns(model)) {
          const k = c.field;
          if (v[`${k}Source`] === 'note' || v[k] === null || v[k] === undefined) continue;
          // a `pcs_only` column (Luck) is never an ally's
          if (c.pcs_only && v.ally) continue;
          pools[k] = v[k];
          if (c.max) pools[c.max] = v[c.max] ?? null;
        }
        return { rowId: v.rowId, ally: v.ally, copy: v.copy, note: v.note, name: v.name,
          hp: v.source === 'note' ? null : v.hp, max: v.max, conditions: v.conditions, source: v.source, at: v.at, ...pools };
      });

    const loot = [];
    for (const b of beats) {
      for (const t of b.treasure || []) {
        const l = state.loot[t.key];
        if (l && l.to) loot.push({ key: t.key, beat: b.key, beatTitle: b.title, text: t.text, item: t.item || l.item || null, to: l.to });
      }
    }

    const titleOf = (key, saved) => (byKey.get(key) ? byKey.get(key).title : saved || '');
    const entries = state.jots.map((j, i) => ({ at: j.at, o: i, beatKey: j.beat, beatTitle: j.beat ? titleOf(j.beat, j.title) : '', text: j.text, id: j.id }))
      .concat(state.events.map((e, i) => ({ at: e.at, o: 1e6 + i, beatKey: e.beat, beatTitle: e.beat ? titleOf(e.beat, e.title) : '', text: e.text, ...(e.fight ? { fight: true } : {}), ...(e.tookBack ? { tookBack: true } : {}) })));
    // a long rest passes over anyone at 0 HP, and says so at the time of the rest
    for (const v of vitals) {
      if (v.restSkipped) entries.push({ at: state.end.longRestAt, o: 2e6, beatKey: null, beatTitle: '', text: `${v.name} is at 0 HP, so the long rest does nothing for them.` });
    }
    const logLines = entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.o - b.o)).map(({ o, ...rest }) => rest);

    // one entry per note: the state's entry decides on or off; a carried unmasking shows only when the state is silent
    const unmaskedNow = [];
    const maskedAgain = [];
    const noteIds = new Set([...Object.keys(model.notes || {}), ...Object.keys(state.unmask)]);
    for (const note of noteIds) {
      const since = model.notes && model.notes[note] && model.notes[note].unmask && model.notes[note].unmask.since;
      const u = state.unmask[note];
      if (u) {
        if (u.on) unmaskedNow.push({ note, name: u.name, carried: false });
        else if (since) maskedAgain.push({ note });
      } else if (since) unmaskedNow.push({ note, name: model.notes[note].unmask.name, carried: true });
    }

    // anything keyed that the Plan no longer holds
    const orphans = [];
    const seenBeat = new Map();
    // A beat's title as the actions made in it carried it: a beat known only by a brought-in person or
    // a PC standing there still shows its title, never its key.
    const savedTitle = new Map();
    const keep = (key, title) => { if (key && title && !savedTitle.has(key)) savedTitle.set(key, title); };
    for (const e of state.events) keep(e.beat, e.title);
    for (const j of state.jots) keep(j.beat, j.title);
    for (const p of Object.values(state.points)) keep(p.beat, p.beatTitle);
    for (const l of Object.values(state.loot)) keep(l.beat, l.beatTitle);
    const beatOrphan = (key, title0, use) => {
      if (byKey.has(key)) return;
      const title = title0 || savedTitle.get(key) || '';
      if (!seenBeat.has(key)) { const o = { kind: 'beat', key, text: title || '', beatTitle: title || '', value: [] }; seenBeat.set(key, o); orphans.push(o); }
      const o = seenBeat.get(key);
      if (title && !o.text) { o.text = title; o.beatTitle = title; }
      if (!o.value.includes(use)) o.value.push(use);
    };
    for (const [k, v] of Object.entries(state.visited)) beatOrphan(k, v.title, 'visited');
    for (const [k, v] of Object.entries(state.fired)) beatOrphan(k, v.title, 'fired');
    if (state.stopped) beatOrphan(state.stopped.beat, state.stopped.title, 'stopped');
    for (const k of Object.keys(state.brought)) beatOrphan(k, '', 'brought');
    // a jot in a beat the Plan lost: the beat shows, so its jots can be attached to what it became
    for (const j of state.jots) if (j.beat) beatOrphan(j.beat, j.title, 'jotted in');
    for (const [pc, p] of Object.entries(state.positions)) {
      if (!p.beat) continue;
      if (!byKey.has(p.beat)) beatOrphan(p.beat, '', `stood: ${pc}`);
      else if (p.spot && (byKey.get(p.beat).spots || []).length > 1 && !spotKeys.has(p.spot)) orphans.push({ kind: 'spot', key: p.spot, text: '', beatTitle: byKey.get(p.beat).title, value: pc });
    }
    for (const [k, v] of Object.entries(state.points)) if (!pointKeys.has(k)) orphans.push({ kind: 'point', key: k, text: v.text, beatTitle: v.beatTitle, value: v.mark });
    for (const [k, v] of Object.entries(state.loot)) if (!lootKeys.has(k)) orphans.push({ kind: 'loot', key: k, text: v.text, beatTitle: v.beatTitle, value: v.to });
    for (const [k, v] of Object.entries(state.handouts)) if (!handoutKeys.has(k)) orphans.push({ kind: 'handout', key: k, text: v.name || v.text, beatTitle: '', value: 'handed over' });
    // vitals the GM set for a row the model no longer has (a note renamed or dropped mid-session)
    const rowIds = new Set(vitals.map((v) => v.rowId));
    const given = (x) => x !== undefined && x !== null && x !== '';
    for (const [id, v] of Object.entries(state.end.vitals)) {
      if (rowIds.has(id) || !v || typeof v !== 'object') continue;
      const hp = given(v.hp) ? v.hp : (v.rested && given(v.rested.hp) ? v.rested.hp : null);
      const max = given(v.max) ? v.max : (v.rested && given(v.rested.max) ? v.rested.max : null);
      const conditions = String(v.conditions || '').trim();
      if (hp === null && max === null && !conditions) continue;
      const m = /^(.*)#(\d+)$/.exec(id);
      orphans.push({ kind: 'vitals', key: id, note: m ? m[1] : id, copy: m ? Number(m[2]) : 1, text: '', beatTitle: '', value: { hp, max, conditions } });
    }

    return {
      beats, reached, whereEnded, pointsBy, notReached, orphans, vitals, vitalsRecorded, loot,
      log: logLines,
      stopped: state.stopped ? { beat: state.stopped.beat, title: titleOf(state.stopped.beat, state.stopped.title) } : null,
      fired: Object.entries(state.fired).map(([beat, v]) => ({ beat, title: titleOf(beat, v.title) })),
      improvised: state.improvised.slice(),
      handedOver: Object.entries(state.handouts).map(([key, v]) => ({ key, text: v.text, name: v.name || '', note: v.note })),
      unmaskedNow, maskedAgain,
      // the sides the GM set this session, one per note, for the Table Log's Sides set
      sidesSet: Object.entries(state.sides && typeof state.sides === 'object' ? state.sides : {})
        .filter(([, side]) => FM.isSide(side)).map(([note, side]) => ({ note, side })),
      advancement: state.end.advancement || '',
      fight: fightView(model, state, byKey, unmaskedNow),
      fightLog: logLines.filter((l) => l.fight),
      afterFight: afterFightOf(model, state, unmaskedNow),
    };
  }

  // The GM's name for a fight row: unmasked when Unmask is on (this session or carried), then the copy number.
  function namer(rows, unmaskedNow) {
    const unmasked = new Map(unmaskedNow.map((u) => [u.note, u.name]));
    return (r) => FM.gmName(r, (note) => unmasked.get(note) || null, r.note ? rows.filter((x) => x.note === r.note && x.kind !== 'pc').length : 1);
  }

  // The running fight with what the page draws from it: rows (a PC row whose note left the party marked
  // `gone`), whose panel shows, which rows are Bloodied and which thresholds are lit now.
  function fightView(model, state, byKey, unmaskedNow) {
    const f = state.fight;
    if (!f || typeof f !== 'object') return null;
    const raw = Array.isArray(f.rows) ? f.rows : [];
    const name = namer(raw, unmaskedNow);
    const rows = raw.map((r) => ({ ...r, gmName: name(r), ...(r.kind === 'pc' && !partyNoteOf(model, r) ? { gone: true } : {}) }));
    const acting = FM.actingRow({ ...f, rows }, null);
    const bloodied = new Set(rows.filter((r) => FM.isBloodied(r)).map((r) => r.id));
    const lit = new Set();
    for (const t of f.thresholds || []) if (rows.some((r) => FM.isLit(t, r))) lit.add(t.key);
    return { ...f, view: { rows, acting, bloodied, lit, beatGone: !byKey.has(f.beat) } };
  }

  // The last ended fight's rows that still hold a status, for the After the fight box; null while a fight
  // runs or when none is left.
  function afterFightOf(model, state, unmaskedNow) {
    if (state.fight) return null;
    const fights = Array.isArray(state.fights) ? state.fights : [];
    const f = fights[fights.length - 1];
    if (!f) return null;
    const rows = Array.isArray(f.rows) ? f.rows : [];
    const name = namer(rows, unmaskedNow);
    const left = rows.filter((r) => r.kind !== 'lair' && Fight.statusesOf(r).length)
      .map((r) => ({ id: r.id, kind: r.kind, note: r.note, name: name(r), statuses: Fight.statusesOf(r) }));
    return left.length ? { fight: f.id, title: f.title || '', rows: left } : null;
  }

  return { emptyState, upgrade, reduce, derive, cyclePoint, armClick, castSearch, handoutName, planTarget, placeInFight, fightFigures, endFigureProblem, vitalColumns, poolWords };
}));
