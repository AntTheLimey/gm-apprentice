/* GURPS live-session recalc: equipment loadout + current HP/FP with the Reeling
   and Tired condition penalties. Pure helpers are exported for Node tests; the
   DOM bootstrap at the bottom only runs in a browser. Mirrors js/change-request.js. */
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

  // Derive the panel's effects-row content from a recalc result. Move/Dodge show
  // when either condition is active (before = encumbrance-adjusted, after =
  // condition-adjusted); ST shows only when Tired. Sub-zero HP/FP add a static
  // GM reminder (informational, not enforced — the deeper ladder is out of scope).
  function vitalsView(r, vitals) {
    const deltas = [];
    if (r.reeling || r.tired) {
      deltas.push({ field: 'move', before: r.move.enc, after: r.move.cur });
      deltas.push({ field: 'dodge', before: r.dodge.enc, after: r.dodge.cur });
      if (r.tired && r.st) deltas.push({ field: 'st', before: r.st.base, after: r.st.cur });
    }
    const notes = [];
    if (vitals && vitals.hp && vitals.hp.cur <= 0) notes.push('0 HP — GM: consciousness rolls apply');
    if (vitals && vitals.fp && vitals.fp.cur <= 0) notes.push('0 FP — GM: collapse rolls apply');
    return { active: !!(r.reeling || r.tired), reeling: r.reeling, tired: r.tired, deltas, notes };
  }

  const api = { sumCarriedWeight, levelForWeight, applyModifiers, vitalsView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__gurpsLive = api;

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
    var panel = document.querySelector('.gl-status-panel');
    var vitalInputs = { hp: document.querySelector('[data-gl-vital="hp"]'), fp: document.querySelector('[data-gl-vital="fp"]') };

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
    function writeLocal(checked, vit) {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: data.buildVersion, items: checked, hp: vit.hp, fp: vit.fp }));
    }
    function syncKV(checked, vit) {
      try {
        fetch('/api/loadout', { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: KV_KEY, state: { v: data.buildVersion, items: checked, hp: vit.hp, fp: vit.fp } }) }).catch(function () {});
      } catch (e) {}
    }
    function currentVitals() {
      var v = data.vitals || null;
      if (!v) return null;
      function read(input, seed) {
        if (!input) return seed;
        var n = parseInt(input.value, 10);
        return isNaN(n) ? seed : n;
      }
      return { hp: { cur: read(vitalInputs.hp, v.hp.cur), max: v.hp.max },
               fp: { cur: read(vitalInputs.fp, v.fp.cur), max: v.fp.max } };
    }

    function currentChecked() {
      var m = {}; toggles.forEach(function (t) { m[t.getAttribute('data-item-key')] = t.checked; }); return m;
    }
    function setText(id, val) { var n = document.getElementById(id); if (n) n.textContent = val; }

    function recalc(persist) {
      var checked = currentChecked();
      var vit = currentVitals();
      var total = api.sumCarriedWeight(data.items, checked);
      var lvl = api.levelForWeight(total, data.levels);
      var r = api.applyModifiers(data, lvl.level, vit || undefined);
      setText('gl-weight', Math.round(total * 10) / 10);
      setText('gl-level', r.levelName + (lvl.overloaded ? ' (overloaded!)' : ''));
      // Move/Dodge appear in several places (readout, Attributes, status pips,
      // Combat chips); update every live field so they all track encumbrance.
      document.querySelectorAll('[data-gl-field="move"]').forEach(function (el) { el.textContent = r.move.cur; });
      document.querySelectorAll('[data-gl-field="dodge"]').forEach(function (el) { el.textContent = r.dodge.cur; });
      if (r.st) document.querySelectorAll('[data-gl-field="st"]').forEach(function (el) { el.textContent = r.st.cur; });
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
      if (panel && vit) renderPanel(api.vitalsView(r, vit));
      if (persist && vit) { writeLocal(checked, { hp: vit.hp.cur, fp: vit.fp.cur }); syncKV(checked, { hp: vit.hp.cur, fp: vit.fp.cur }); }
      else if (persist) { writeLocal(checked, { hp: null, fp: null }); syncKV(checked, { hp: null, fp: null }); }
    }

    function renderPanel(view) {
      if (!panel) return;
      panel.classList.toggle('reeling', view.reeling);
      panel.classList.toggle('tired', view.tired);
      var rb = panel.querySelector('.gl-badge-reeling'); if (rb) rb.hidden = !view.reeling;
      var tb = panel.querySelector('.gl-badge-tired'); if (tb) tb.hidden = !view.tired;
      var effects = panel.querySelector('.gl-status-effects');
      var byField = {}; view.deltas.forEach(function (d) { byField[d.field] = d; });
      ['move', 'dodge', 'st'].forEach(function (f) {
        var span = panel.querySelector('[data-gl-delta="' + f + '"]');
        if (!span) return;
        var d = byField[f];
        span.hidden = !d;
        if (d) {
          var before = span.querySelector('.gl-delta-before'); if (before) before.textContent = d.before;
          var after = span.querySelector('.gl-delta-after'); if (after) after.textContent = d.after;
        }
      });
      var note = panel.querySelector('.gl-status-note');
      if (note) { note.hidden = view.notes.length === 0; note.textContent = view.notes.join('  •  '); }
      if (effects) effects.hidden = !(view.active || view.notes.length > 0);
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
    (function seedCachedVitals() {
      try {
        var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (s && s.v === data.buildVersion) {
          if (vitalInputs.hp && s.hp != null) vitalInputs.hp.value = s.hp;
          if (vitalInputs.fp && s.fp != null) vitalInputs.fp.value = s.fp;
        }
      } catch (e) {}
    })();
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
            applyChecked(j.state.items);
            if (vitalInputs.hp && j.state.hp != null) vitalInputs.hp.value = j.state.hp;
            if (vitalInputs.fp && j.state.fp != null) vitalInputs.fp.value = j.state.fp;
            var vNow = currentVitals();
            writeLocal(j.state.items, vNow ? { hp: vNow.hp.cur, fp: vNow.fp.cur } : { hp: null, fp: null });
            recalc(false);
          }
        })
        .catch(function () {});
    } catch (e) {}

    toggles.forEach(function (t) { t.addEventListener('change', function () { locallyChanged = true; recalc(true); }); });
    Array.prototype.slice.call(document.querySelectorAll('.gl-step')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-gl-step');
        var delta = parseInt(btn.getAttribute('data-delta'), 10) || 0;
        var input = vitalInputs[kind];
        if (!input) return;
        var n = parseInt(input.value, 10); if (isNaN(n)) n = 0;
        input.value = n + delta;
        locallyChanged = true; recalc(true);
      });
    });
    ['hp', 'fp'].forEach(function (kind) {
      var input = vitalInputs[kind];
      if (input) input.addEventListener('input', function () { locallyChanged = true; recalc(true); });
    });
    var reset = document.getElementById('gl-reset');
    if (reset) reset.addEventListener('click', function () {
      applyChecked(defaults());
      if (data.vitals) {
        if (vitalInputs.hp) vitalInputs.hp.value = data.vitals.hp.cur;
        if (vitalInputs.fp) vitalInputs.fp.value = data.vitals.fp.cur;
      }
      localStorage.removeItem(LS_KEY);
      recalc(true);
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
