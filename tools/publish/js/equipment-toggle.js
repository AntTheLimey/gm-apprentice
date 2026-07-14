/* GURPS live loadout recalc. Pure helpers are exported for Node tests; the DOM
   bootstrap at the bottom only runs in a browser. Mirrors js/change-request.js. */
(function (root) {
  'use strict';

  function sumCarriedWeight(items, checked) {
    return (items || []).reduce((sum, it) => sum + (checked[it.key] ? (it.weight || 0) : 0), 0);
  }

  function levelForWeight(total, levels) {
    for (let i = 0; i < levels.length; i++) {
      if (total <= levels[i].maxWeight) return { level: i, overloaded: false };
    }
    return { level: levels.length - 1, overloaded: true };
  }

  function pair(arr, level) {
    return arr ? { base: arr[0], cur: arr[level] } : null;
  }

  function applyModifiers(data, level) {
    const lv = data.levels[level];
    const skills = {};
    for (const k of Object.keys(data.skills || {})) skills[k] = pair(data.skills[k], level);
    const weapons = {};
    for (const k of Object.keys(data.weapons || {})) {
      const w = data.weapons[k];
      weapons[k] = { toHit: pair(w.toHit, level), parry: pair(w.parry, level), block: pair(w.block, level) };
    }
    return {
      level, levelName: lv.name,
      move: { base: data.levels[0].move, cur: lv.move },
      dodge: { base: data.levels[0].dodge, cur: lv.dodge },
      skills, weapons,
    };
  }

  const api = { sumCarriedWeight, levelForWeight, applyModifiers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__equipmentToggle = api;

  // --- DOM bootstrap (browser only; added in Task 8) ---
})(typeof window !== 'undefined' ? window : globalThis);
