/* Shared party-board spine: adaptive poller, freshest-state grouping, and the
   generic fetch/DOMContentLoaded bootstrap. System skins (gurps-party.js,
   coc-party.js) supply a per-system paint() via mountBoard. Pure helpers are
   exported for Node tests; the DOM bootstrap runs only in a browser. */
(function (root) {
  'use strict';

  // Freshest state per PC. Key = loadout:<campaign>:<pcSlug>:<player>.
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

  // Adaptive poll scheduler: 60s only while active, never while hidden. Deps are
  // injected so it is testable with a fake clock. poll() resolves to the states
  // map (or undefined). Ported verbatim from the original gurps-party.js.
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
      if (isHidden()) { clear(); return; }
      return Promise.resolve(doPoll()).then(finish, finish);
    }
    function finish(states) {
      if (states && typeof states === 'object') {
        var mx = maxUpdatedAt(states);
        if (mx > lastMax) { lastMax = mx; lastActivity = now(); }
      }
      schedule();
    }
    function interact() {
      lastActivity = now();
      clear();
      if (!isHidden()) run();
    }
    return { start: run, stop: clear, interact: interact, isActive: active };
  }

  // Generic browser bootstrap. opts.setup(manifest) -> paint(statesByKey).
  function mountBoard(opts) {
    if (typeof document === 'undefined') return;
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById(opts.dataElId);
      if (!el) return;
      var manifest;
      try { manifest = JSON.parse(el.textContent); } catch (e) { return; }
      if (!manifest || !manifest.pcs || !manifest.pcs.length) return;
      var paint = opts.setup(manifest);
      if (!paint) return;
      var inFlight = false;
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
          .catch(function () { return undefined; })
          .then(function (states) { inFlight = false; return states; });
      }
      var poller = createPoller({
        now: function () { return Date.now(); },
        setTimer: function (fn, ms) { return setTimeout(fn, ms); },
        clearTimer: function (id) { clearTimeout(id); },
        isHidden: function () { return document.hidden; },
        poll: poll, pollMs: 60000, idleMs: 15 * 60 * 1000,
      });
      poller.start();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) poller.interact(); });
      document.addEventListener('keydown', function () { poller.interact(); });
      document.addEventListener('pointerdown', function () { poller.interact(); });
    });
  }

  var api = { groupLatestByPc: groupLatestByPc, maxUpdatedAt: maxUpdatedAt, createPoller: createPoller, mountBoard: mountBoard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__partyCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
