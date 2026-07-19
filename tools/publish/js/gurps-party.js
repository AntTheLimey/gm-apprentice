/* GURPS party board skin: derives each PC's live view and paints the initiative
   table. Generic spine lives in party-core.js. Pure helpers are exported for
   Node tests; the DOM bootstrap only runs in a browser. */
(function (root) {
  'use strict';
  var core = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./party-core') : (root.__partyCore || {});

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function stat(base, cur) {
    if (base === cur) return esc(cur);
    return '<span class="gl-was">' + esc(base) + '</span>' + esc(cur);
  }
  function ratio(cur, base) {
    if (base == null) return esc(cur);
    return esc(cur) + '<span class="gl-of">/' + esc(base) + '</span>';
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
      move: ratio(view.move.cur, view.move.base),
      dodge: stat(view.dodge.enc, view.dodge.cur),
      st: view.st ? stat(view.st.base, view.st.cur) : '—',
      status: status,
      enc: enc,
    };
  }

  var api = {
    groupLatestByPc: core.groupLatestByPc,
    maxUpdatedAt: core.maxUpdatedAt,
    createPoller: core.createPoller,
    rowCells: rowCells,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__gurpsParty = api;

  // --- DOM / poll bootstrap (browser only) ---
  if (typeof document === 'undefined') return;
  function setup(manifest) {
    var gl = root.__gurpsLive;
    if (!gl || !gl.deriveLive) return null;
    return function paint(statesByKey) {
      var latest = core.groupLatestByPc(statesByKey || {});
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
    };
  }
  core.mountBoard({ dataElId: 'gurps-party-data', setup: setup });
})(typeof window !== 'undefined' ? window : this);
