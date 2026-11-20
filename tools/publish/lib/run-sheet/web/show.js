'use strict';
// What the GM shows the players (plan 5b decisions 6, 11 and 12). UMD like state.js: `module.exports` under
// node, `window.RunSheetShow` in a page, where it loads before state.js. state.js merges SHOW_HANDLERS into
// its own `reduce`; `groupsOf` says which panels the players' screen has.
//
// The state only says what the GM asked for: `panels[group] = { people, backdrop, placeOff }`, keyed by
// position (a beat key, or a hub spot's key), and `shownEver[note]`. Whether a note may go up at all, and
// under which name, is decided on the server by players.js, never here: `reduce` has no model.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetShow = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

  // The PCs who share a position, one group each: a beat, or a spot of a beat with more than one (a hub).
  // In run order (the Plan's beats, then the improvised ones; within a beat, the beat itself, then its
  // spots), so a panel stays put when a PC joins it. Off-screen, unplaced and gone PCs are in none.
  function groupsOf(model, state) {
    const beats = (model.beats || []).concat(((state && state.improvised) || []).map((i) => ({ key: i.key, spots: [] })));
    const positions = (state && state.positions) || {};
    const groups = [];
    for (const b of beats) {
      const spots = b.spots || [];
      const hub = spots.length > 1;
      const slots = [{ key: b.key, spot: null }].concat(hub ? spots.map((x) => ({ key: x.key, spot: x.key })) : []);
      for (const slot of slots) {
        const pcs = (model.pcs || []).filter((p) => {
          const pos = positions[p.note];
          if (!pos || pos.off || pos.beat !== b.key) return false;
          const at = hub && pos.spot && spots.some((x) => x.key === pos.spot) ? pos.spot : null;
          return at === slot.spot;
        }).map((p) => p.note);
        if (pcs.length) groups.push({ key: slot.key, beat: b.key, spot: slot.spot, pcs });
      }
    }
    return groups;
  }

  // The (already cloned) state's panel for a position, made when first named.
  function panelOf(s, group) {
    if (!isObj(s.panels)) s.panels = {};
    if (!isObj(s.panels[group])) s.panels[group] = { people: [], backdrop: null, placeOff: false };
    const p = s.panels[group];
    if (!Array.isArray(p.people)) p.people = [];
    return p;
  }

  // Shown is seen: every fight row of the note, and any row that joins later (decision 6).
  function markShown(s, note, at) {
    if (!isObj(s.shownEver)) s.shownEver = {};
    if (!s.shownEver[note]) s.shownEver[note] = at || true;
    if (s.fight && Array.isArray(s.fight.rows)) {
      for (const r of s.fight.rows) if (r.note === note && !r.seen) { r.seen = true; r.at = at; }
    }
  }

  const SHOW_HANDLERS = {
    // On a panel, or off it. Off leaves the person seen: the players have seen them.
    show(s, a, at) {
      if (!a.group || typeof a.note !== 'string' || !a.note) return;
      const p = panelOf(s, a.group);
      if (a.on) {
        if (!p.people.includes(a.note)) p.people.push(a.note);
        markShown(s, a.note, at);
      } else p.people = p.people.filter((x) => x !== a.note);
    },
    // A beat's people who have notes, and its place.
    showBeat(s, a, at) {
      if (!a.group) return;
      const p = panelOf(s, a.group);
      for (const note of Array.isArray(a.people) ? a.people : []) {
        if (typeof note !== 'string' || !note) continue;
        if (!p.people.includes(note)) p.people.push(note);
        markShown(s, note, at);
      }
      if (typeof a.place === 'string' && a.place) { p.backdrop = a.place; p.placeOff = false; }
    },
    // A place or a map behind the panel; null goes back to the group's own place.
    backdrop(s, a) {
      if (!a.group) return;
      panelOf(s, a.group).backdrop = typeof a.note === 'string' && a.note ? a.note : null;
    },
    // Place on panel, off or on. Kept by position, so it holds for PCs who arrive later.
    placeOff(s, a) {
      if (!a.group) return;
      panelOf(s, a.group).placeOff = !!a.on;
    },
  };

  return { groupsOf, SHOW_HANDLERS };
}));
