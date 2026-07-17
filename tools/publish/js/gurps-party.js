/* GURPS party board: aggregates every PC's live KV state into the read-only
   initiative table on the roster page. Pure helpers are exported for Node tests;
   the DOM/poll bootstrap only runs in a browser. Mirrors js/gurps-live.js. */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  // Pick the freshest state per PC. Key = loadout:<campaign>:<pcSlug>:<player>.
  function groupLatestByPc(statesByKey) {
    var best = {}, bestAt = {};
    Object.keys(statesByKey || {}).forEach(function (key) {
      var parts = key.split(':');
      if (parts.length < 4) return;
      var slug = parts[2];
      var st = statesByKey[key];
      var at = (st && typeof st.updatedAt === 'number') ? st.updatedAt : 0;
      if (!(slug in bestAt) || at >= bestAt[slug]) { best[slug] = st; bestAt[slug] = at; }
    });
    return best;
  }

  // base→cur when a condition changed the value, else a plain number.
  function stat(base, cur) {
    if (base === cur) return esc(cur);
    return '<span class="gl-was">' + esc(base) + '</span>' + esc(cur);
  }

  function bar(kind, cur, max) {
    var pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
    return '<span class="gl-vnum' + (3 * cur < max ? ' gl-low' : '') + '">' + esc(cur) + '<span class="gl-max">/' + esc(max) + '</span></span>' +
      '<span class="gl-bar gl-bar-' + kind + '"><i style="width:' + pct + '%"></i><span class="gl-third"></span></span>';
  }

  function rowCells(view) {
    var rowClass = view.reeling && view.tired ? 'both' : view.reeling ? 'reeling' : view.tired ? 'tired' : '';
    var badges = [];
    if (view.reeling) badges.push('<span class="gl-badge reeling">⚠ Reeling</span>');
    if (view.tired) badges.push('<span class="gl-badge tired">⚠ Tired</span>');
    var status = badges.length ? badges.join(' ') : '<span class="gl-badge ok">Ready</span>';
    var enc = (view.encLevel > 0) ? '<span class="gl-enc-chip">' + esc(view.encName) + '</span>' : '';
    return {
      rowClass: rowClass,
      hp: view.hp ? bar('hp', view.hp.cur, view.hp.max) : '—',
      fp: view.fp ? bar('fp', view.fp.cur, view.fp.max) : '—',
      move: stat(view.move.enc, view.move.cur),
      dodge: stat(view.dodge.enc, view.dodge.cur),
      st: view.st ? stat(view.st.base, view.st.cur) : '—',
      status: status,
      enc: enc,
    };
  }

  var api = { groupLatestByPc, rowCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__gurpsParty = api;

  // --- DOM / poll bootstrap (browser only) ---
  if (typeof document === 'undefined') return;
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('gurps-party-data');
    if (!el) return;
    var manifest;
    try { manifest = JSON.parse(el.textContent); } catch (e) { return; }
    if (!manifest || !manifest.pcs || !manifest.pcs.length) return;
    var gl = root.__gurpsLive;
    if (!gl || !gl.deriveLive) return;
    var bySlug = {};
    manifest.pcs.forEach(function (pc) { bySlug[pc.pcSlug] = pc; });

    function paint(statesByKey) {
      var latest = groupLatestByPc(statesByKey || {});
      manifest.pcs.forEach(function (pc) {
        var row = document.querySelector('[data-gl-party="' + pc.pcSlug.replace(/["\\]/g, '\\$&') + '"]');
        if (!row) return;
        var cells = rowCells(gl.deriveLive(pc, latest[pc.pcSlug] || null));
        row.className = 'gl-party-row ' + cells.rowClass;
        ['hp', 'fp', 'move', 'dodge', 'st', 'status', 'enc'].forEach(function (f) {
          var cell = row.querySelector('[data-gl-party-field="' + f + '"]');
          if (cell) cell.innerHTML = cells[f];
        });
      });
      var ind = document.querySelector('.gl-party-live-time');
      if (ind) ind.textContent = 'updated just now';
    }

    var inFlight = false;
    function poll() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      fetch('/api/loadout-list?campaign=' + encodeURIComponent(manifest.campaignId))
        .then(function (r) { if (!r.ok) throw new Error('loadout-list ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || !j.states || typeof j.states !== 'object') throw new Error('bad loadout-list payload');
          paint(j.states);
        })
        .catch(function () { /* keep last-good */ })
        .then(function () { inFlight = false; });
    }
    poll();
    setInterval(poll, 5000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  });
})(typeof window !== 'undefined' ? window : this);
