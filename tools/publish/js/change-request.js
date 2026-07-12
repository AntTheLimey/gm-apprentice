/* Change-request widget. Prepended to PC sheet pages via #cr-root. Submits
   natural-language sheet-edit requests to the Pages Function (Part 1), remembers
   the session code for 72h, and auto-refreshes when the player's change goes live.
   Pure helpers are exported for node tests; the DOM bootstrap only runs in a browser. */
(function () {
  var CODE_TTL_MS = 72 * 3600 * 1000;
  var POLL_MS = 15000;
  var ENDPOINT = '/api/request';
  var K_CODE = 'cr:code', K_PENDING = 'cr:pending', K_LIVE = 'cr:live';

  function shouldPromptForCode(stored, nowMs) {
    if (!stored || typeof stored.at !== 'number' || !stored.code) return true;
    return (nowMs - stored.at) >= CODE_TTL_MS;
  }

  function partitionStatuses(statuses) {
    var handled = [], flagged = [], pending = [];
    Object.keys(statuses || {}).forEach(function (id) {
      var s = statuses[id];
      if (s === 'handled') handled.push(id);
      else if (s === 'flagged') flagged.push(id);
      else pending.push(id); // pending | applied
    });
    return { handled: handled, flagged: flagged, pending: pending };
  }

  function decide(part) {
    if (part.handled.length) return 'reload';
    if (!part.pending.length && part.flagged.length) return 'flagged-only';
    return 'poll';
  }

  function classifySubmitError(httpStatus) {
    if (httpStatus === 403) return 'code';
    if (httpStatus === 429) return 'rate';
    return 'bad';
  }

  // ---- exports for node tests (no-op in browser) ----
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CODE_TTL_MS: CODE_TTL_MS,
      shouldPromptForCode: shouldPromptForCode,
      partitionStatuses: partitionStatuses,
      decide: decide,
      classifySubmitError: classifySubmitError,
    };
  }

  if (typeof document === 'undefined') return; // not a browser — done.

  // ---- browser storage helpers ----
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function getPending() { return readJSON(K_PENDING) || []; }
  function setPending(ids) { writeJSON(K_PENDING, ids); }

  // ---- DOM ----
  function init() {
    var root = document.getElementById('cr-root');
    if (!root) return;
    var character = root.getAttribute('data-character') || '';

    root.innerHTML =
      '<div class="cr-bar">' +
        '<button type="button" class="cr-toggle" aria-expanded="false">✎ Request a change</button>' +
        '<div class="cr-panel" hidden>' +
          '<input type="text" class="cr-code" maxlength="4" placeholder="4-char code" hidden>' +
          '<textarea class="cr-text" rows="2" placeholder="e.g. spend 1 xp to raise Streetwise"></textarea>' +
          '<button type="button" class="cr-send">Send</button>' +
          '<span class="cr-msg" role="status"></span>' +
        '</div>' +
      '</div>';

    var toggle = root.querySelector('.cr-toggle');
    var panel = root.querySelector('.cr-panel');
    var codeInput = root.querySelector('.cr-code');
    var textInput = root.querySelector('.cr-text');
    var send = root.querySelector('.cr-send');
    var msg = root.querySelector('.cr-msg');

    // Persisted "your change is live" flag from before a reload.
    if (localStorage.getItem(K_LIVE) === '1') {
      localStorage.removeItem(K_LIVE);
      msg.textContent = '✓ your change is live';
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      codeInput.hidden = !shouldPromptForCode(readJSON(K_CODE), Date.now());
    }

    // Strip the cache-busting param left over from the forced reload above.
    if (location.search.indexOf('_cr=') !== -1 && window.history && history.replaceState) {
      var cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('_cr');
      history.replaceState(null, '', cleanUrl.pathname + (cleanUrl.search || '') + cleanUrl.hash);
    }

    toggle.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) codeInput.hidden = !shouldPromptForCode(readJSON(K_CODE), Date.now());
    });

    send.addEventListener('click', function () {
      var text = (textInput.value || '').trim();
      if (!text) { msg.textContent = 'Type your request first.'; return; }
      var stored = readJSON(K_CODE);
      var code = codeInput.hidden ? (stored && stored.code) : (codeInput.value || '').trim();
      msg.textContent = 'Sending…';

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code, character: character, text: text }),
      }).then(function (res) {
        if (res.ok) return res.json().then(function (out) {
          writeJSON(K_CODE, { code: code, at: Date.now() });   // refresh 72h window
          var ids = getPending(); ids.push(out.id); setPending(ids);
          textInput.value = '';
          msg.textContent = 'Request received.';
          startPolling();
        });
        var kind = classifySubmitError(res.status);
        if (kind === 'code') {
          localStorage.removeItem(K_CODE);
          codeInput.hidden = false; codeInput.value = '';
          msg.textContent = 'Code expired — enter the new one.';
        } else if (kind === 'rate') {
          msg.textContent = 'Too many requests — wait a moment.';
        } else {
          msg.textContent = "Couldn't submit — check with your GM.";
        }
      }).catch(function () { msg.textContent = 'Network error — try again.'; });
    });

    var timer = null;
    function startPolling() {
      if (timer || !getPending().length) return;
      timer = setInterval(poll, POLL_MS);
    }
    function poll() {
      var ids = getPending();
      if (!ids.length) { clearInterval(timer); timer = null; return; }
      fetch(ENDPOINT + '?ids=' + encodeURIComponent(ids.join(','))).then(function (res) {
        return res.json();
      }).then(function (statuses) {
        var part = partitionStatuses(statuses);
        var action = decide(part);
        if (action === 'reload') {
          // Keep still-pending ids; drop resolved ones so we don't re-wait after reload.
          setPending(part.pending);
          localStorage.setItem(K_LIVE, '1');
          // Cache-bust: a plain reload() can be served from bfcache on mobile,
          // showing the "live" banner over stale content. A unique URL forces
          // a fresh document fetch.
          var u = new URL(location.href);
          u.searchParams.set('_cr', String(Date.now()));
          location.replace(u.href);
        } else if (action === 'flagged-only') {
          setPending([]);
          clearInterval(timer); timer = null;
          msg.textContent = 'Your request needs the GM — ask them to look.';
        }
      }).catch(function () { /* transient; try again next tick */ });
    }

    // Backgrounded mobile tabs throttle the 15s poll timer; poll immediately
    // when the tab regains focus so a returning player doesn't have to wait.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && getPending().length) poll();
    });

    if (getPending().length) startPolling();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
