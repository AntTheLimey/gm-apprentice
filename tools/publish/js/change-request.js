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
        '<div class="cr-barhead">' +
          '<button type="button" class="cr-toggle" aria-expanded="false">✎ Request a change / ask a question</button>' +
          '<button type="button" class="cr-log-btn" aria-expanded="false" aria-label="Open chat history">💬 History</button>' +
        '</div>' +
        '<div class="cr-panel" hidden>' +
          '<p class="cr-hint">Type a change ("spend 1 xp to raise Streetwise") or a question ("is it worth raising DX?"). Can\'t afford something but the GM okayed it? Add "GM said OK" and it\'ll go through anyway.</p>' +
          '<input type="text" class="cr-code" maxlength="4" placeholder="4-char code" aria-label="Session code" hidden>' +
          '<textarea class="cr-text" rows="5" aria-label="Your message" placeholder="Type your change or question…"></textarea>' +
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

    // ---- chat log ----
    function getLog() { return readJSON(K_LOG) || []; }
    function setLog(l) { writeJSON(K_LOG, l); }
    var logBtn = root.querySelector('.cr-log-btn');

    // History renders in a modal appended to <body>. The modal behaviour is
    // system-agnostic; the parchment skin is gated to CoC via the `.coc` class.
    var backdrop = document.createElement('div');
    backdrop.className = 'cr-modal-backdrop';
    if (document.querySelector('.coc-sheet-root')) backdrop.classList.add('coc');
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="cr-modal" role="dialog" aria-modal="true" aria-label="Correspondence history">' +
        '<div class="cr-modal-head">' +
          '<span class="cr-modal-title">Correspondence — this device</span>' +
          '<button type="button" class="cr-modal-close" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="cr-modal-body"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    var logPanel = backdrop.querySelector('.cr-modal-body');
    var closeBtn = backdrop.querySelector('.cr-modal-close');

    var KIND_CLASSES = { applied: 1, rejected: 1, advice: 1 };
    function renderLog() {
      var l = getLog();
      if (!l.length) { logPanel.innerHTML = '<p class="cr-empty">No messages yet.</p>'; return; }
      logPanel.innerHTML = l.slice().reverse().map(function (e) {
        var kindCls = KIND_CLASSES[e.kind] ? ' cr-' + e.kind : '';
        var reply = e.reply
          ? '<div class="cr-reply' + kindCls + '">' + escapeHtml(e.reply) + '</div>'
          : '<div class="cr-reply cr-waiting">…</div>';
        return '<div class="cr-logentry"><div class="cr-you">' + escapeHtml(e.message) + '</div>' + reply + '</div>';
      }).join('');
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    renderLog();
    function openModal() {
      backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
      logBtn.setAttribute('aria-expanded', 'true');
      renderLog();
      closeBtn.focus();               // move focus into the dialog for keyboard/SR users
    }
    function closeModal() {
      backdrop.hidden = true;
      document.body.style.overflow = '';
      logBtn.setAttribute('aria-expanded', 'false');
      logBtn.focus();                 // restore focus to the trigger
    }
    logBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !backdrop.hidden) closeModal();
    });

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
