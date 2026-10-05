/* D&D party board skin: one read-only row per character (armour class, hit
   points with temporary, passive Perception, spell save DC, status) painted from
   the note and then from live state. The generic spine is party-core.js; the
   state rules are dnd-live.js. dndRowCells is exported for Node tests and the
   server renderer. Mirrors js/coc-party.js. */
(function (root) {
  'use strict';
  var node = (typeof require === 'function' && typeof module !== 'undefined');
  var core = node ? require('./party-core') : (root.__partyCore || {});
  var live = node ? require('./dnd-live') : (root.__dndLive || {});

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function plain(v) { return '<span class="gl-vnum">' + (v === '' || v == null ? '—' : esc(v)) + '</span>'; }

  var BADGE = { dying: 'gl-badge cond-dying', bad: 'gl-badge cond-wound', conc: 'gl-badge', good: 'gl-badge ok' };

  function hpCell(state, max) {
    if (max == null || state.hp == null) return plain('');
    var pct = max > 0 ? Math.max(0, Math.min(100, Math.round((state.hp / max) * 100))) : 0;
    return '<span class="gl-vnum' + (3 * state.hp < max ? ' gl-low' : '') + '">' + esc(state.hp) +
      '<span class="gl-max">/' + esc(max) + '</span>' + (state.temp ? ' <span class="gl-max">+' + esc(state.temp) + ' temp</span>' : '') + '</span>' +
      '<span class="gl-bar gl-bar-hp"><i style="width:' + pct + '%"></i><span class="gl-third"></span></span>';
  }

  // The note's values (pc) with the saved record (state) fitted over them.
  function dndRowCells(pc, state) {
    if (pc.unreadable) {   // nothing live in this note: the note's facts and dashes, whatever the store holds
      var b = pc.board || {};
      return { rowClass: '', who: b.who ? esc(b.who) : '', ac: plain(b.ac), hp: plain(''), pp: plain(b.pp), dc: plain(b.dc), status: plain('') };
    }
    var s = live.fit(state, pc);
    var bits = live.statusBits(s);
    var board = pc.board || {};
    return {
      rowClass: s.hp === 0 ? 'hurt' : '',
      who: board.who ? esc(board.who) : '',
      ac: plain(board.ac),
      hp: hpCell(s, pc.hpMax),
      pp: plain(board.pp),
      dc: plain(board.dc),
      status: bits.length
        ? bits.map(function (b) { return '<span class="' + BADGE[b.kind] + '">' + esc(b.text) + '</span>'; }).join(' ')
        : '<span class="gl-badge ok">Fine</span>',
    };
  }

  var api = { dndRowCells: dndRowCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__dndParty = api;

  // --- DOM / poll bootstrap (browser only) ---
  if (typeof document === 'undefined') return;
  function setup(manifest) {
    return function paint(statesByKey) {
      var latest = core.groupLatestByPc(statesByKey || {});
      manifest.pcs.forEach(function (pc) {
        var row = document.querySelector('[data-gl-party="' + pc.pcSlug.replace(/["\\]/g, '\\$&') + '"]');
        if (!row || pc.unreadable) return;
        var cells = dndRowCells(pc, latest[pc.pcSlug] || null);
        row.className = 'gl-party-row ' + cells.rowClass;
        ['hp', 'status'].forEach(function (f) {
          var cell = row.querySelector('[data-gl-party-field="' + f + '"]');
          if (cell) cell.innerHTML = cells[f];
        });
      });
      var ind = document.querySelector('.gl-party-live-time');
      if (ind) ind.textContent = 'updated just now';
    };
  }
  core.mountBoard({ dataElId: 'dnd-party-data', setup: setup });
})(typeof window !== 'undefined' ? window : globalThis);
