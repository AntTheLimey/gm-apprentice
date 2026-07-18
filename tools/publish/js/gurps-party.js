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

  // current/basic, e.g. "3/6" — always show both so the GM sees how far
  // encumbrance/conditions have knocked a value down from its unloaded value.
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

  // Freshest updatedAt across every state — how the poller detects a live game.
  function maxUpdatedAt(statesByKey) {
    var mx = 0;
    Object.keys(statesByKey || {}).forEach(function (key) {
      var st = statesByKey[key];
      var at = (st && typeof st.updatedAt === 'number') ? st.updatedAt : 0;
      if (at > mx) mx = at;
    });
    return mx;
  }

  // Adaptive poll scheduler. The board used to setInterval(poll, 5000), which
  // one open tab left running for hours — each poll is a kv.list on the free
  // tier's 1,000/day cap. Now it polls every 60s only while "active", and goes
  // silent otherwise. Active = interacted-or-edited within the idle window.
  // Deps (now/setTimer/clearTimer/isHidden/poll) are injected so it is testable
  // with a fake clock; the browser bootstrap passes the real ones.
  //   poll() must return a Promise resolving to the states map (or undefined).
  function createPoller(opts) {
    var now = opts.now, setTimer = opts.setTimer, clearTimer = opts.clearTimer;
    var isHidden = opts.isHidden || function () { return false; };
    var doPoll = opts.poll;
    var POLL_MS = opts.pollMs || 60000;
    var IDLE_MS = opts.idleMs || 15 * 60 * 1000;
    var lastActivity = now();
    var lastMax = 0;
    var timer = null;

    function active() { return (now() - lastActivity) < IDLE_MS; }
    function clear() { if (timer !== null) { clearTimer(timer); timer = null; } }
    function schedule() {
      clear();
      if (!isHidden() && active()) timer = setTimer(tick, POLL_MS);
    }
    function tick() { timer = null; run(); }
    function run() {
      if (isHidden()) { clear(); return; }   // dormant while backgrounded
      return Promise.resolve(doPoll()).then(finish, finish);
    }
    function finish(states) {
      // A newer max updatedAt means a player edited during play → keep polling.
      if (states && typeof states === 'object') {
        var mx = maxUpdatedAt(states);
        if (mx > lastMax) { lastMax = mx; lastActivity = now(); }
      }
      schedule();
    }
    function interact() {           // visible again / keydown → poll now, resume
      lastActivity = now();
      clear();
      if (!isHidden()) run();
    }
    return { start: run, stop: clear, interact: interact, isActive: active };
  }

  var api = { groupLatestByPc, rowCells, maxUpdatedAt, createPoller };
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
    // Resolves with the states map (so the scheduler can spot a live game) or
    // undefined when the poll was skipped/failed — either way it keeps last-good.
    function poll() {
      if (document.hidden || inFlight) return Promise.resolve(undefined);
      inFlight = true;
      return fetch('/api/loadout-list?campaign=' + encodeURIComponent(manifest.campaignId))
        .then(function (r) { if (!r.ok) throw new Error('loadout-list ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || !j.states || typeof j.states !== 'object') throw new Error('bad loadout-list payload');
          paint(j.states);
          return j.states;
        })
        .catch(function () { return undefined; /* keep last-good */ })
        .then(function (states) { inFlight = false; return states; });
    }

    var poller = api.createPoller({
      now: function () { return Date.now(); },
      setTimer: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimer: function (id) { clearTimeout(id); },
      isHidden: function () { return document.hidden; },
      poll: poll,
      pollMs: 60000,
      idleMs: 15 * 60 * 1000,
    });
    poller.start();
    // Becoming visible, a keypress, or a pointer press on the board all count as
    // activity: poll now and resume the 60s cadence. Hiding lets the next tick
    // fall dormant. (A visible board with no interaction and no player edits for
    // 15 min goes silent by design — any of these events revives it.)
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poller.interact(); });
    document.addEventListener('keydown', function () { poller.interact(); });
    document.addEventListener('pointerdown', function () { poller.interact(); });
  });
})(typeof window !== 'undefined' ? window : this);
