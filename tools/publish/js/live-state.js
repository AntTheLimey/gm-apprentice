/* Shared live-session state store. Identity + persistence + hydration for any
   system's per-device sheet state. The state blob is OPAQUE here — clients
   (gurps-live.js, coc-live.js) own its shape and their own DOM wiring/recalc.
   Persistence rule: KV present -> current; else localStorage; else the client's
   authored defaults. No buildVersion gate. Pure helpers are exported for Node
   tests; nothing here touches the DOM. Mirrors the plumbing formerly inline in
   js/gurps-live.js. */
(function (root) {
  'use strict';

  var PREFIX = 'loadout:';

  function playerKey(storage) {
    try {
      var cr = JSON.parse(storage.getItem('cr:code') || 'null');
      if (cr && cr.code) return cr.code;
    } catch (e) {}
    var d = storage.getItem('loadout:device');
    if (!d) { d = 'd' + Date.now().toString(36); storage.setItem('loadout:device', d); }
    return d;
  }

  function kvKey(campaignId, pcSlug, player) {
    return PREFIX + campaignId + ':' + pcSlug + ':' + player;
  }

  function createStore(opts) {
    var storage = opts.storage || root.localStorage;
    var fetchImpl = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
    var player = playerKey(storage);
    var key = kvKey(opts.campaignId, opts.pcSlug, player);
    var locallyChanged = false;
    var inFlight = false, pending = null;

    function readCache() {
      try {
        var s = JSON.parse(storage.getItem(key) || 'null');
        return s && typeof s === 'object' ? s : null;
      } catch (e) { return null; }
    }

    // Coalesce + serialize remote writes: keep only the latest pending blob and
    // send it after the current PUT resolves, so out-of-order writes never leave
    // KV holding a stale value.
    function syncKV(blob) {
      pending = blob;
      if (inFlight || !fetchImpl) return;
      (function flush() {
        if (!pending) return;
        var body = pending; pending = null; inFlight = true;
        var done = function () { inFlight = false; flush(); };
        try {
          fetchImpl('/api/loadout', {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: key, state: body }),
          }).then(done, done);
        } catch (e) { inFlight = false; }
      })();
    }

    function save(blob) {
      locallyChanged = true;
      try { storage.setItem(key, JSON.stringify(blob)); } catch (e) {}
      syncKV(blob);
    }

    // Late KV read must not clobber a control the player touched while the GET was
    // in flight (locallyChanged guard). Accepted remote state seeds the cache.
    function hydrate(onState) {
      if (!fetchImpl) return;
      try {
        fetchImpl('/api/loadout?key=' + encodeURIComponent(key))
          .then(function (res) { return res.json(); })
          .then(function (j) {
            if (!locallyChanged && j && j.state && typeof j.state === 'object') {
              try { storage.setItem(key, JSON.stringify(j.state)); } catch (e) {}
              onState(j.state);
            }
          })
          .catch(function () {});
      } catch (e) {}
    }

    return { key: key, player: player, readCache: readCache, save: save, hydrate: hydrate };
  }

  var api = { playerKey: playerKey, kvKey: kvKey, createStore: createStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__liveState = api;
})(typeof window !== 'undefined' ? window : globalThis);
