/* CoC investigator live tracking: persist the SP1 status-bar controls (HP/MP
   pips, SAN/Luck/Reputation steps, condition chips) and per-skill experience
   ticks to the shared live-state store. Bookkeeping, not a rules engine — the
   only derived output is two advisory notes. Pure helpers are exported for Node
   tests; the DOM bootstrap runs only in a browser. Mirrors js/gurps-live.js. */
(function (root) {
  'use strict';

  function cocNotes(vals) {
    var notes = [];
    var hp = vals && vals.hp, san = vals && vals.san;
    if (hp && hp.cur != null && hp.cur <= 0) notes.push('0 HP — unconscious / dying (CON roll)');
    if (san && san.cur === 0) notes.push('Sanity 0 — permanently insane');
    return notes;
  }

  function reassocTicks(ticks, skillNames) {
    var out = {};
    if (!ticks) return out;
    var live = {};
    (skillNames || []).forEach(function (n) { live[n] = true; });
    Object.keys(ticks).forEach(function (n) { if (ticks[n] && live[n]) out[n] = true; });
    return out;
  }

  function clampScalar(n, max) {
    var x = Math.round(Number(n));
    if (isNaN(x)) x = 0;
    if (x < 0) x = 0;
    if (max != null && x > max) x = max;
    return x;
  }

  // Tapping a pip sets the track to that pip's ordinal (index+1), EXCEPT tapping
  // the current topmost filled pip drops the track by one — the only gesture that
  // lets a track fall (down to 0). Mirrors the approved sheet mockup.
  function pipTarget(filled, clickedIndex) {
    var target = clickedIndex + 1;
    return filled === target ? clickedIndex : target;
  }

  // Sanity-bar fill percentage. 0 when the value or max is missing.
  function barPct(val, max) {
    if (val == null || !max) return 0;
    return Math.round((Number(val) / Number(max)) * 100);
  }

  var api = { cocNotes: cocNotes, reassocTicks: reassocTicks, clampScalar: clampScalar,
    pipTarget: pipTarget, barPct: barPct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__cocLive = api;

  // --- DOM bootstrap (browser only) ---
  if (typeof document === 'undefined') return;

  // The five chips are authored in CONDITION_CHIPS order (coc/layout.js).
  var COND_KEYS = ['temporaryInsanity', 'indefiniteInsanity', 'majorWound', 'unconscious', 'dying'];

  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('coc-live-data');
    if (!el || !root.__liveState) return;
    var data;
    try { data = JSON.parse(el.textContent); } catch (e) { return; }
    if (!data || !data.campaignId) return;

    var store = root.__liveState.createStore({ campaignId: data.campaignId, pcSlug: data.pcSlug });
    var bar = document.querySelector('.statusbar');
    if (!bar) return;

    function q(sel) { return bar.querySelector(sel); }
    function pipTrack(track) { return bar.querySelector('.pips[data-track="' + track + '"]'); }

    function readScalar(field) {
      var b = q('[data-' + field + ']');
      if (!b) return null;
      var n = parseInt(b.textContent, 10);
      return isNaN(n) ? null : n;
    }
    function maxFor(field) {
      var b = q('[data-' + field + ']');
      var cell = b && b.closest ? b.closest('.sb-num') : null;
      var m = cell ? parseInt(cell.getAttribute('data-max'), 10) : NaN;
      return isNaN(m) ? null : m;
    }
    function pipCount(track) {
      var t = pipTrack(track);
      if (!t) return null;
      return t.querySelectorAll('.pip.on').length;
    }
    function skillButtons() {
      return Array.prototype.slice.call(document.querySelectorAll('.skill[data-skill] .exp'));
    }
    function skillName(btn) {
      var row = btn.closest('.skill');
      return row ? row.getAttribute('data-skill') : null;
    }

    // Gather current DOM -> opaque blob (the store's payload).
    function readState() {
      var conditions = {};
      Array.prototype.forEach.call(bar.querySelectorAll('.cond-chip'), function (chip, i) {
        if (COND_KEYS[i]) conditions[COND_KEYS[i]] = chip.classList.contains('on');
      });
      var ticks = {};
      skillButtons().forEach(function (btn) {
        if (btn.getAttribute('aria-pressed') === 'true') { var n = skillName(btn); if (n) ticks[n] = true; }
      });
      var blob = {
        v: data.buildVersion,
        hp: pipCount('hp'), mp: pipCount('mp'),
        san: readScalar('san'), luck: readScalar('luck'),
        conditions: conditions, ticks: ticks,
      };
      if (q('[data-rep]')) blob.rep = readScalar('rep');
      return blob;
    }

    function setPips(track, n) {
      var t = pipTrack(track);
      if (!t || n == null) return;
      Array.prototype.forEach.call(t.querySelectorAll('.pip'), function (p, i) {
        var on = i < n;
        p.classList.toggle('on', on);
        p.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // Keep the prominent numeric readout (<b data-hp>/<b data-mp>) in sync with
      // the filled pip count — on tap and on restore from cache/KV.
      var out = q('[data-' + track + ']');
      if (out) out.textContent = n;
    }
    function setScalar(field, val) {
      var b = q('[data-' + field + ']');
      if (!b || val == null) return;
      var max = maxFor(field);
      var v = clampScalar(val, max);
      b.textContent = v;
      // Sanity has a progress bar that must track the number (Luck/Rep have none).
      if (field === 'san') {
        var fill = bar.querySelector('.sanbar .fill');
        if (fill) fill.style.width = barPct(v, max) + '%';
      }
    }

    // Apply an opaque blob -> DOM. Structural-drift safety: ticks apply only to
    // skills that still exist; scalars clamp to the authored max.
    function applyState(blob) {
      if (!blob) return;
      if (blob.hp != null) setPips('hp', blob.hp);
      if (blob.mp != null) setPips('mp', blob.mp);
      setScalar('san', blob.san);
      setScalar('luck', blob.luck);
      if (blob.rep != null) setScalar('rep', blob.rep);
      if (blob.conditions) {
        Array.prototype.forEach.call(bar.querySelectorAll('.cond-chip'), function (chip, i) {
          if (COND_KEYS[i]) chip.classList.toggle('on', !!blob.conditions[COND_KEYS[i]]);
        });
      }
      var ticks = reassocTicks(blob.ticks, data.skills || []);
      skillButtons().forEach(function (btn) {
        var n = skillName(btn);
        btn.setAttribute('aria-pressed', n && ticks[n] ? 'true' : 'false');
      });
      renderNotes();
    }

    function defaults() {
      var conditions = {};
      COND_KEYS.forEach(function (k) { conditions[k] = !!(data.conditions && data.conditions[k]); });
      var blob = {
        v: data.buildVersion,
        hp: data.hp ? data.hp.cur : null, mp: data.mp ? data.mp.cur : null,
        san: data.san ? data.san.cur : null, luck: data.luck ? data.luck.cur : null,
        conditions: conditions, ticks: {},
      };
      if (data.rep) blob.rep = data.rep.cur;
      return blob;
    }

    function renderNotes() {
      var host = q('.sb-live-notes');
      if (!host) {
        host = document.createElement('p');
        host.className = 'sb-live-notes';
        host.hidden = true;
        bar.appendChild(host);
      }
      var notes = cocNotes({ hp: { cur: pipCount('hp') }, san: { cur: readScalar('san') } });
      host.hidden = notes.length === 0;
      host.textContent = notes.join('  •  ');
    }

    function change() { store.save(readState()); renderNotes(); }

    // Wire controls.
    ['hp', 'mp'].forEach(function (track) {
      var t = pipTrack(track);
      if (!t) return;
      Array.prototype.forEach.call(t.querySelectorAll('.pip'), function (pip, i) {
        pip.addEventListener('click', function () { setPips(track, pipTarget(pipCount(track), i)); change(); });
      });
    });
    ['san', 'luck', 'rep'].forEach(function (field) {
      var b = q('[data-' + field + ']');
      var cell = b && b.closest ? b.closest('.sb-num') : null;
      if (!cell) return;
      var dn = cell.querySelector('.step.dn'), up = cell.querySelector('.step.up');
      if (dn) dn.addEventListener('click', function () { setScalar(field, (readScalar(field) || 0) - 1); change(); });
      if (up) up.addEventListener('click', function () { setScalar(field, (readScalar(field) || 0) + 1); change(); });
    });
    Array.prototype.forEach.call(bar.querySelectorAll('.cond-chip'), function (chip) {
      chip.addEventListener('click', function () { chip.classList.toggle('on'); change(); });
    });
    skillButtons().forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        change();
      });
    });

    // Initial state: localStorage cache -> authored defaults; then late KV wins.
    applyState(store.readCache() || defaults());
    store.hydrate(function (state) { applyState(state); });
  });
})(typeof window !== 'undefined' ? window : globalThis);
