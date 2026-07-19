/* CoC party board skin: renders each investigator's read-only row (HP/SAN/MP as
   bar+number, Luck as a bare number, DEX, optional Rep, condition badges) and
   paints live updates. Generic spine lives in party-core.js. cocRowCells is
   exported for Node tests + the server renderer; the DOM bootstrap is browser
   only. Mirrors js/gurps-party.js. */
(function (root) {
  'use strict';
  var core = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./party-core') : (root.__partyCore || {});

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function bar(kind, cur, max) {
    var c = (cur == null) ? 0 : cur, m = (max == null) ? 0 : max;
    var pct = m > 0 ? Math.max(0, Math.min(100, Math.round((c / m) * 100))) : 0;
    return '<span class="gl-vnum' + (3 * c < m ? ' gl-low' : '') + '">' + esc(c) +
      '<span class="gl-max">/' + esc(m) + '</span></span>' +
      '<span class="gl-bar gl-bar-' + kind + '"><i style="width:' + pct + '%"></i><span class="gl-third"></span></span>';
  }

  // Authored order mirrors CONDITION_CHIPS / COND_KEYS in coc-live.js.
  var COND = [
    ['temporaryInsanity', 'cond-insanity', 'Temp. Insanity'],
    ['indefiniteInsanity', 'cond-insanity', 'Indefinite Insanity'],
    ['majorWound', 'cond-wound', 'Major Wound'],
    ['unconscious', 'cond-unconscious', 'Unconscious'],
    ['dying', 'cond-dying', 'Dying'],
  ];
  var MAD = { temporaryInsanity: 1, indefiniteInsanity: 1 };
  var HURT = { majorWound: 1, unconscious: 1, dying: 1 };

  function statusCell(conditions) {
    var cond = conditions || {};
    var badges = COND.filter(function (c) { return cond[c[0]]; })
      .map(function (c) { return '<span class="gl-badge ' + c[1] + '">' + c[2] + '</span>'; });
    return badges.length ? badges.join(' ') : '<span class="gl-badge ok">Ready</span>';
  }
  function rowClassFor(conditions) {
    var cond = conditions || {};
    var mad = Object.keys(MAD).some(function (k) { return cond[k]; });
    var hurt = Object.keys(HURT).some(function (k) { return cond[k]; });
    return (mad ? 'mad' : '') + (mad && hurt ? ' ' : '') + (hurt ? 'hurt' : '');
  }

  // Merge authored-default manifest values (pc) with the flat live blob (state).
  function cocRowCells(pc, state) {
    var st = state || {};
    var hpCur = st.hp != null ? st.hp : (pc.hp ? pc.hp.cur : null);
    var sanCur = st.san != null ? st.san : (pc.san ? pc.san.cur : null);
    var mpCur = st.mp != null ? st.mp : (pc.mp ? pc.mp.cur : null);
    var luck = st.luck != null ? st.luck : pc.luck;
    var rep = st.rep != null ? st.rep : pc.rep;
    var conditions = st.conditions || pc.conditions || {};
    return {
      rowClass: rowClassFor(conditions),
      dex: '<span class="gl-dex">' + esc(pc.dex != null ? pc.dex : '—') + '</span>',
      hp: bar('hp', hpCur, pc.hp ? pc.hp.max : null),
      san: bar('san', sanCur, pc.san ? pc.san.max : null),
      mp: bar('mp', mpCur, pc.mp ? pc.mp.max : null),
      luck: '<span class="gl-vnum' + (luck != null && luck < 15 ? ' gl-low' : '') + '">' + esc(luck != null ? luck : '—') + '</span>',
      rep: rep != null ? '<span class="gl-rep">' + esc(rep) + '</span>' : '',
      status: statusCell(conditions),
      player: pc.player ? esc(pc.player) : '',
    };
  }

  var api = { cocRowCells: cocRowCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__cocParty = api;

  // --- DOM / poll bootstrap (browser only) ---
  if (typeof document === 'undefined') return;
  function setup(manifest) {
    return function paint(statesByKey) {
      var latest = core.groupLatestByPc(statesByKey || {});
      manifest.pcs.forEach(function (pc) {
        var row = document.querySelector('[data-gl-party="' + pc.pcSlug.replace(/["\\]/g, '\\$&') + '"]');
        if (!row) return;
        var cells = cocRowCells(pc, latest[pc.pcSlug] || null);
        row.className = 'gl-party-row ' + cells.rowClass;
        ['hp', 'san', 'mp', 'luck', 'rep', 'status'].forEach(function (f) {
          var cell = row.querySelector('[data-gl-party-field="' + f + '"]');
          if (cell) cell.innerHTML = cells[f];
        });
      });
      var ind = document.querySelector('.gl-party-live-time');
      if (ind) ind.textContent = 'updated just now';
    };
  }
  core.mountBoard({ dataElId: 'coc-party-data', setup: setup });
})(typeof window !== 'undefined' ? window : globalThis);
