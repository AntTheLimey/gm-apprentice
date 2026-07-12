/* Change-request widget. Prepended to PC sheet pages via #cr-root. Submits
   natural-language sheet-edit requests to the Pages Function (Part 1), remembers
   the session code for 72h, and auto-refreshes when the player's change goes live.
   Pure helpers are exported for node tests; the DOM bootstrap only runs in a browser. */
(function () {
  var CODE_TTL_MS = 72 * 3600 * 1000;
  var POLL_MS = 15000;
  var ENDPOINT = '/api/request';
  var LOG_MAX = 50;
  var K_CODE = 'cr:code', K_PENDING = 'cr:pending', K_LIVE = 'cr:live', K_LOG = 'cr:log';

  function shouldPromptForCode(stored, nowMs) {
    if (!stored || typeof stored.at !== 'number' || !stored.code) return true;
    return (nowMs - stored.at) >= CODE_TTL_MS;
  }

  function resolvedResults(results, pendingIds) {
    var out = [];
    (pendingIds || []).forEach(function (id) {
      var r = (results || {})[id];
      if (r && r.response != null) out.push({ id: id, response: r.response, kind: r.kind });
    });
    return out;
  }

  function staleIds(results, pendingIds) {
    var out = [];
    (pendingIds || []).forEach(function (id) {
      var r = (results || {})[id];
      if (r && r.status === 'handled' && r.response == null) out.push(id);
    });
    return out;
  }

  function needsReload(resolvedList) {
    return (resolvedList || []).some(function (x) { return x.kind === 'applied'; });
  }

  function appendLog(log, entry) {
    var next = (log || []).concat([entry]);
    return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
  }

  function setLogReply(log, id, reply, kind) {
    return (log || []).map(function (e) {
      return e.id === id ? Object.assign({}, e, { reply: reply, kind: kind }) : e;
    });
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
      LOG_MAX: LOG_MAX,
      shouldPromptForCode: shouldPromptForCode,
      resolvedResults: resolvedResults,
      staleIds: staleIds,
      needsReload: needsReload,
      appendLog: appendLog,
      setLogReply: setLogReply,
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
        '<button type="button" class="cr-toggle" aria-expanded="false">✎ Request a change / ask a question</button>' +
        '<button type="button" class="cr-log-btn" aria-label="Open chat log" hidden>💬</button>' +
        '<div class="cr-panel" hidden>' +
          '<p class="cr-hint">Type a change ("spend 1 xp to raise Streetwise") or a question ("is it worth raising DX?").</p>' +
          '<input type="text" class="cr-code" maxlength="4" placeholder="4-char code" aria-label="Session code" hidden>' +
          '<div class="cr-inputrow">' +
            '<textarea class="cr-text" rows="3" aria-label="Your message"></textarea>' +
            '<button type="button" class="cr-expand" aria-label="Expand or shrink the box">⤢</button>' +
          '</div>' +
          '<button type="button" class="cr-send">Send</button>' +
          '<span class="cr-msg" role="status"></span>' +
        '</div>' +
        '<div class="cr-logpanel" hidden></div>' +
      '</div>';

    var toggle = root.querySelector('.cr-toggle');
    var panel = root.querySelector('.cr-panel');
    var codeInput = root.querySelector('.cr-code');
    var textInput = root.querySelector('.cr-text');
    var send = root.querySelector('.cr-send');
    var msg = root.querySelector('.cr-msg');

    // ---- chat log ----
    function getLog() { return readJSON(K_LOG) || []; }
    function setLog(l) { writeJSON(K_LOG, l); }
    var logBtn = root.querySelector('.cr-log-btn');
    var logPanel = root.querySelector('.cr-logpanel');
    var expandBtn = root.querySelector('.cr-expand');

    function renderLog() {
      var l = getLog();
      logBtn.hidden = l.length === 0;
      if (!l.length) { logPanel.innerHTML = '<p class="cr-empty">No messages yet.</p>'; return; }
      logPanel.innerHTML = l.slice().reverse().map(function (e) {
        var kind = e.kind ? ' cr-' + e.kind : '';
        var reply = e.reply
          ? '<div class="cr-reply' + kind + '">' + escapeHtml(e.reply) + '</div>'
          : '<div class="cr-reply cr-waiting">…</div>';
        return '<div class="cr-logentry"><div class="cr-you">' + escapeHtml(e.message) + '</div>' + reply + '</div>';
      }).join('');
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    renderLog();
    logBtn.addEventListener('click', function () { logPanel.hidden = !logPanel.hidden; if (!logPanel.hidden) renderLog(); });
    expandBtn.addEventListener('click', function () { textInput.classList.toggle('cr-big'); });

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
          setLog(appendLog(getLog(), { id: out.id, ts: Date.now(), message: text }));
          renderLog();
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
      }).then(function (results) {
        var done = resolvedResults(results, ids);
        var stale = staleIds(results, ids);
        if (!done.length && !stale.length) return; // still waiting
        // record replies into the log and drop resolved + gone/expired ids from pending
        var log = getLog();
        var removeIds = {};
        done.forEach(function (d) { removeIds[d.id] = true; log = setLogReply(log, d.id, d.response, d.kind); });
        stale.forEach(function (id) { removeIds[id] = true; });
        setLog(log);
        setPending(ids.filter(function (id) { return !removeIds[id]; }));
        renderLog();
        if (needsReload(done)) {
          localStorage.setItem(K_LIVE, '1');
          // Cache-bust: a plain reload() can be served from bfcache on mobile,
          // showing the "live" banner over stale content. A unique URL forces
          // a fresh document fetch.
          var u = new URL(location.href);
          u.searchParams.set('_cr', String(Date.now()));
          location.replace(u.href);
        } else {
          // advice / rejected only — show the newest reply inline, keep the log open-able
          // (stale-only ticks have no response to show; the log entry is left as-is)
          if (done.length) msg.textContent = done[done.length - 1].response;
          if (!getPending().length) { clearInterval(timer); timer = null; }
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
