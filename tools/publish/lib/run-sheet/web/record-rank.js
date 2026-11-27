'use strict';
// The no-Plan sheet's ranking of cards around where the crew stands, as pure helpers. UMD like fight-math.js:
// `module.exports` under node (read-record.js), `window.RunSheetRecordRank` in a page. No DOM, no fetch, no vault
// index: `loc` is the plain map `{ <place path>: { parent: <path>|null, type } }` the reader puts on the model, and
// `peopleAt` is `{ <npc path>: <place path> }`. Nothing here changes its input.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetRecordRank = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const AREA_TYPES = /^(city|town|village|settlement|space station|station|outpost|base|ship)$/i;
  const STEPS = 12;

  // The settlement a place is in: the first place on its parent chain (itself first, at most 12 steps) whose type is a
  // settlement; else its parent, else itself. A place the map does not know is its own area.
  function areaOf(place, loc) {
    if (!place) return null;
    const map = loc || {};
    if (!map[place]) return place;
    let cur = place;
    for (let d = 0; cur && map[cur] && d < STEPS; d++) {
      if (AREA_TYPES.test(String(map[cur].type || ''))) return cur;
      cur = map[cur].parent;
    }
    return map[place].parent || place;
  }

  // Is `place` the area itself or inside it (on its parent chain, at most 12 steps)?
  function within(place, area, loc) {
    let cur = place;
    for (let d = 0; cur && d < STEPS; d++) {
      if (cur === area) return true;
      cur = loc && loc[cur] ? loc[cur].parent : null;
    }
    return false;
  }

  // Here: a place the card names, or a person it names who stands in the area. Could come to them: the card names no
  // place and none of its people has one on record. Elsewhere: it names places, none in the area. Order is kept.
  // `where` is a place path, null (no place known: every card could come), or a typed name that is not in `loc`
  // (no area, so no card is Here).
  function rankCards(cards, where, loc, peopleAt) {
    const out = { here: [], could: [], elsewhere: [] };
    const area = where && loc && loc[where] ? areaOf(where, loc) : null;
    for (const c of cards || []) {
      const named = [...(c.places || []), ...(c.people || []).map((p) => (peopleAt || {})[p]).filter(Boolean)];
      if (!where || !named.length) out.could.push(c);
      else if (area && named.some((p) => within(p, area, loc))) out.here.push(c);
      else out.elsewhere.push(c);
    }
    return out;
  }

  // Where they are, the places inside it, then the places the Here cards name; each once.
  function placesFor(where, loc, hereCards) {
    const map = loc || {};
    const list = [];
    if (where && map[where]) list.push(where);
    if (where) list.push(...Object.keys(map).sort().filter((p) => p !== where && within(p, where, map)));
    for (const c of hereCards || []) list.push(...(c.places || []));
    return [...new Set(list)];
  }

  return { areaOf, rankCards, placesFor };
}));
