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

  function halveUp(x) { return Math.ceil(x / 2); }

  function applyModifiers(data, level, vitals) {
    const lv = data.levels[level];
    const skills = {};
    for (const k of Object.keys(data.skills || {})) skills[k] = pair(data.skills[k], level);
    const weapons = {};
    for (const k of Object.keys(data.weapons || {})) {
      const w = data.weapons[k];
      weapons[k] = { toHit: pair(w.toHit, level), parry: pair(w.parry, level), block: pair(w.block, level) };
    }
    // Encumbrance-adjusted (pre-condition) Move/Dodge from the answer key.
    const encMove = lv.move, encDodge = lv.dodge;
    const baseSt = data.vitals && data.vitals.st != null ? data.vitals.st : null;
    let move = encMove, dodge = encDodge, st = baseSt;
    let reeling = false, tired = false;
    if (vitals) {
      // Both charts state "All effects are cumulative" — halve in sequence (B419/B426).
      if (vitals.hp && 3 * vitals.hp.cur < vitals.hp.max) {
        reeling = true; move = halveUp(move); dodge = halveUp(dodge);
      }
      if (vitals.fp && 3 * vitals.fp.cur < vitals.fp.max) {
        tired = true; move = halveUp(move); dodge = halveUp(dodge);
        if (st != null) st = halveUp(st);  // ST-based quantities (BL, enc, damage) are NOT re-derived
      }
    }
    return {
      level, levelName: lv.name,
      move: { base: data.levels[0].move, enc: encMove, cur: move },
      dodge: { base: data.levels[0].dodge, enc: encDodge, cur: dodge },
      st: baseSt != null ? { base: baseSt, cur: st != null ? st : baseSt } : null,
      reeling, tired, skills, weapons,
    };
  }

  const api = { sumCarriedWeight, levelForWeight, applyModifiers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__equipmentToggle = api;

  // --- DOM bootstrap (browser only) ---
  if (typeof document === 'undefined') return;
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('gurps-live-data');
    if (!el) return;
    var data;
    try { data = JSON.parse(el.textContent); } catch (e) { return; }
    if (!data || !data.levels) return;

    var LOADOUT_KEY = 'loadout:' + data.campaignId + ':' + data.pcSlug;
    var toggles = Array.prototype.slice.call(document.querySelectorAll('.eq-toggle'));

    function playerKey() {
      try {
        var cr = JSON.parse(localStorage.getItem('cr:code') || 'null');
        if (cr && cr.code) return cr.code;
      } catch (e) {}
      var d = localStorage.getItem('loadout:device');
      if (!d) { d = 'd' + Date.now().toString(36); localStorage.setItem('loadout:device', d); }
      return d;
    }
    var KV_KEY = LOADOUT_KEY + ':' + playerKey();
    // Partition the local cache by the same player identity as KV, so two players
    // sharing one browser (or one player before/after entering a session code)
    // never read each other's stored loadout.
    var LS_KEY = KV_KEY;

    function defaults() {
      var m = {}; (data.items || []).forEach(function (it) { m[it.key] = !!it.defaultCarried; }); return m;
    }
    function readLocal() {
      try {
        var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (s && s.v === data.buildVersion && s.items) return s.items;
      } catch (e) {}
      return null;
    }
    function writeLocal(checked) {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: data.buildVersion, items: checked, hp: null, fp: null }));
    }
    function syncKV(checked) {
      try {
        fetch('/api/loadout', { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: KV_KEY, state: { v: data.buildVersion, items: checked, hp: null, fp: null } }) }).catch(function () {});
      } catch (e) {}
    }

    function currentChecked() {
      var m = {}; toggles.forEach(function (t) { m[t.getAttribute('data-item-key')] = t.checked; }); return m;
    }
    function setText(id, val) { var n = document.getElementById(id); if (n) n.textContent = val; }

    function recalc(persist) {
      var checked = currentChecked();
      var total = api.sumCarriedWeight(data.items, checked);
      var lvl = api.levelForWeight(total, data.levels);
      var r = api.applyModifiers(data, lvl.level);
      setText('gl-weight', Math.round(total * 10) / 10);
      setText('gl-level', r.levelName + (lvl.overloaded ? ' (overloaded!)' : ''));
      // Move/Dodge appear in several places (readout, Attributes, status pips,
      // Combat chips); update every live field so they all track encumbrance.
      document.querySelectorAll('[data-gl-field="move"]').forEach(function (el) { el.textContent = r.move.cur; });
      document.querySelectorAll('[data-gl-field="dodge"]').forEach(function (el) { el.textContent = r.dodge.cur; });
      document.querySelectorAll('.enc [data-level], table.enc tr[data-level]').forEach(function (row) {
        row.classList.toggle('cur', Number(row.getAttribute('data-level')) === lvl.level);
      });
      Object.keys(r.skills).forEach(function (name) {
        var row = document.querySelector('[data-skill-key="' + cssq(name) + '"] .sk-cur');
        if (row && r.skills[name]) row.textContent = r.skills[name].cur;
      });
      Object.keys(r.weapons).forEach(function (name) {
        var w = r.weapons[name];
        var th = document.querySelector('[data-weapon-key="' + cssq(name) + '"] .wp-tohit');
        var pa = document.querySelector('[data-weapon-key="' + cssq(name) + '"] .wp-parry');
        if (th && w.toHit) th.textContent = w.toHit.cur;
        if (pa && w.parry) pa.textContent = w.parry.cur;
      });
      if (persist) { writeLocal(checked); syncKV(checked); }
    }
    function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    function applyChecked(map) {
      toggles.forEach(function (t) {
        var k = t.getAttribute('data-item-key');
        if (Object.prototype.hasOwnProperty.call(map, k)) t.checked = !!map[k];
      });
    }

    // Initial state: KV -> localStorage -> defaults.
    var initial = readLocal() || defaults();
    applyChecked(initial);
    var readout = document.querySelector('.gl-readout'); if (readout) readout.hidden = false;
    document.documentElement.classList.add('gl-active');
    recalc(false);
    // Late KV hydration must not clobber a toggle the player made while the GET
    // was in flight; and remote state we accept should seed the local cache.
    var locallyChanged = false;
    try {
      fetch('/api/loadout?key=' + encodeURIComponent(KV_KEY)).then(function (res) { return res.json(); })
        .then(function (j) {
          if (!locallyChanged && j && j.state && j.state.v === data.buildVersion && j.state.items) {
            applyChecked(j.state.items); writeLocal(j.state.items); recalc(false);
          }
        })
        .catch(function () {});
    } catch (e) {}

    toggles.forEach(function (t) { t.addEventListener('change', function () { locallyChanged = true; recalc(true); }); });
    var reset = document.getElementById('gl-reset');
    if (reset) reset.addEventListener('click', function () {
      applyChecked(defaults());
      localStorage.removeItem(LS_KEY);
      recalc(true);
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
