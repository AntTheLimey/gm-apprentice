'use strict';
// The run sheet's GM page (spec §6.3): a thin DOM layer over `RunSheetState` (web/state.js, loaded
// first). The page keeps one { model, state, rev, stateId } and every click is an action: `reduce`,
// a redraw, then the action goes to the server. The server owns `rev`; the page never sends a state.
//
// Saving (5a decision 16, 5b decision 25): each action is applied here at once and queued. One
// `POST /api/actions` is in flight with everything queued; the server runs the same `reduce` on its
// own state and answers with it, and the page takes that state and re-applies what was queued since.
// Each action carries an id `<clientId>-<n>`, so `reduce` never applies one twice. An action the
// server could not apply comes back in `rejected`: it leaves the queue and the header names it.
// Answered is not saved: answered actions are kept until a `saved` event covers their rev, and go
// back to the head of the queue when the server turns out to be a new one (a crash before its
// write). `savedRev` is the disk's rev, from `saved` and from a `hello`'s `savedRev`, so either can
// prune. A 409 'session' reloads and drops the queue, and no action is taken until the new session is
// in. A network failure shows "Not connected" until the server answers again; then the page rebases
// its queue on the server's state.
//
// The seam (`window.RunSheetPage`): `dispatch`, `model()`, `state()`, `derived()`, `ui`, `render()`
// and `parts`, an array of { beatButtons(beat) -> html, side() -> html|null, click(event) -> bool,
// probe() -> object, sheetTop(derived) -> html, beforeBeat(beat) -> html, sectionButtons(id) -> html, focusAttrs: [attribute],
// pane(derived) -> { title, beat, cut } | null }. A part's `pane` makes `#sheet` the fight's right pane
// (plan 6a Task 10): the cut, the whole beat or the whole sheet under a bar, in its own scroll.
// Scripts loaded after this one push parts in (the fight view, gm-fight.js); the page calls them on
// every draw. A part that takes the right column puts `part-side` on `#app`. The page holds no dice code: rolls come from the server.
(function () {
  // The sides' colours (plan 6a Task 9), one table for the page's variables and the Colours menu's swatches.
  // Order: PC, ally, foe, neutral. Every colour reaches 4.5:1 as text on the page, panel and current-row
  // backgrounds in its mode (test/run-sheet-side-colours.test.js is the judge). Colour-blind safe is the
  // Okabe-Ito hues. Three light values are darkened from v8 to pass on the current-turn row: Pens' PC
  // and neutral (from #2e7d3c and #6b7078, 4.3 and 4.2:1) and Colour-blind safe's PC (from #0072b2, 4.37:1). The
  // vault setting's own-colour defaults (lib/settings/registry.js) are the Pens light set, and a test holds them equal.
  const SIDE_NAMES = ['pc', 'ally', 'foe', 'neutral'];
  const SIDE_PRESETS = {
    pens: { light: ['#2c7739', '#7a3fb0', '#b3261e', '#646870'], dark: ['#6fcf7f', '#c39bf0', '#f0766b', '#a7abb2'] },
    colour_blind: { light: ['#006ca9', '#8f3f73', '#7a5300', '#5f646b'], dark: ['#56b4e9', '#cc79a7', '#f0e442', '#a7abb2'] },
  };
  // A choice is { preset, own: { pc, ally, foe, neutral } }; my own colours are one set for both modes.
  function swatches(choice, mode) {
    const c = choice || {};
    if (c.preset === 'own' && c.own) return SIDE_NAMES.map((n, i) => c.own[n] || SIDE_PRESETS.pens.light[i]);
    return (SIDE_PRESETS[c.preset] || SIDE_PRESETS.pens)[mode === 'dark' ? 'dark' : 'light'].slice();
  }
  const sideVars = (colours) => colours.map((c, i) => `--${SIDE_NAMES[i]}:${c}`).join(';');
  // The light set on :root, the dark set under the dark media query (and the forced-dark theme).
  function sideCss(choice) {
    const own = Boolean(choice) && choice.preset === 'own';
    if (own) return `:root{${sideVars(swatches(choice, 'light'))}}`;
    const dark = sideVars(swatches(choice, 'dark'));
    return `:root{${sideVars(swatches(choice, 'light'))}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`;
  }
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { SIDE_PRESETS, sideCss, swatches };
    return;
  }
  const RS = window.RunSheetState;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const PROBE = params.get('probe') === '1';
  const probeErrors = [];
  if (PROBE) {
    window.addEventListener('error', (e) => { probeErrors.push(String(e.message || e)); });
    window.addEventListener('unhandledrejection', (e) => { probeErrors.push(String((e.reason && e.reason.message) || e.reason)); });
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stem = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '');
  const first = (n) => String(n || '').split(' ')[0];
  const encodePath = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  const picUrl = (p) => (p ? `/vault/${encodePath(p)}` : null);
  const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); };
  // A tab's name for itself (not a die: the dice live on the server). Short, and different per tab.
  const randomId = () => {
    const c = window.crypto || {};
    if (c.randomUUID) return c.randomUUID().slice(0, 8);
    return `${Date.now().toString(16)}${Math.floor(performance.now()).toString(16)}`.slice(-8);
  };

  // ------------------------------------------------------------------ the one page state
  const G = {
    model: null, session: null, stateId: null, tableLog: null, tableLogOnFirst: false, serverId: null,
    state: null, rev: 0,
    pending: [], answered: [], inflight: false, clientId: randomId(), seq: 0, switching: false,
    down: false, putFailing: false, saveFailed: false, putRev: 0, savedRev: 0, heardRev: 0,
    retry: null, resyncTimer: null, notes: [], drafts: {},
    // badVital: an end-panel figure refused (`rowId|field` -> { text, why, saved }), kept as typed and never saved, until
    // the saved figure changes by another route
    ui: { focus: null, focusGroup: null, armed: null, record: '', copyMsg: '', hits: {}, badVital: {} },
    modelAt: 0,
    view: null, viewTicket: 0, drawerNote: null,
  };
  const parts = []; // RunSheetPage.parts: see the seam at the end
  const MAX_SEND = 200; // the server takes at most 200 actions in one POST
  // A status typed on a PC or ally row reaches the players word for word (Review L7): the fight view's
  // `other…` box uses this placeholder.
  const OTHER_STATUS_PLACEHOLDER = 'other… (players see it as typed)';

  // Tests only: count requests by route, so a test can say no whole state was ever sent.
  const requests = {};
  if (PROBE && window.fetch) {
    const send = window.fetch.bind(window);
    window.fetch = (url, opts = {}) => {
      const k = `${String(opts.method || 'GET').toUpperCase()} ${String(url).split('?')[0]}`;
      requests[k] = (requests[k] || 0) + 1;
      return send(url, opts);
    };
  }

  // UI-only memory: folds and Read-aloud. Never the play state; a browser that keeps nothing still works.
  const mem = {
    key: (k) => `rs:${G.stateId}:${k}`,
    get(k) { try { return window.localStorage.getItem(this.key(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) window.localStorage.removeItem(this.key(k)); else window.localStorage.setItem(this.key(k), v); } catch (e) { /* not kept */ } },
  };

  // ------------------------------------------------------------------ talking to the server
  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) { const err = new Error((body && body.error) || `${url}: ${res.status}`); err.status = res.status; throw err; }
    return body;
  }

  function note(text, { kind = '', id = null } = {}) {
    if (id && G.notes.some((n) => n.id === id)) return;
    G.notes.push({ text, kind, id: id || `n${G.notes.length}-${Date.now()}` });
    renderNotes();
  }

  function takeModel(m) {
    G.model = m.model;
    G.session = m.session;
    G.tableLog = m.tableLog;
    G.tableLogOnFirst = !!m.tableLogOnFirst;
    serverIs(m.serverId);
    G.modelAt = Date.now();
    if (sideKept && sideKept.base !== baseOf(G.model.sideColours)) dropKept();
    applySides();
    for (const n of m.notices || []) {
      if (n.kind === 'record-kept') note(keptText(n.path), { id: `kept:${n.path}` });
      else if (n.kind === 'state-broken') note(n.text, { kind: 'bad', id: `broken:${n.path}` });
    }
    takeStatus({
      saving: (m.notices || []).some((n) => n.kind === 'save-failing') ? 'failing' : 'ok',
      record: (m.notices || []).some((n) => n.kind === 'record-failing') ? 'failing' : 'ok',
      recordError: ((m.notices || []).find((n) => n.kind === 'record-failing') || {}).error,
    });
  }
  const recordFailedText = (error) => `The Table Log could not be written: ${error || 'no reason given'}. The sheet keeps the state and tries again.`;
  // What the server says about saving and the record, whenever the page connects or loads.
  function takeStatus(st) {
    if (!st) return;
    G.saveFailed = st.saving === 'failing';
    if (st.record === 'failing') note(recordFailedText(st.recordError), { kind: 'bad', id: `rf:${st.recordError}` });
    else recordOk();
    indicator();
  }
  function recordOk() {
    const before = G.notes.length;
    G.notes = G.notes.filter((n) => !String(n.id).startsWith('rf:'));
    if (G.notes.length !== before) renderNotes();
  }
  const keptText = (p) => `The Table Log was changed outside the sheet; the earlier text is kept at ${p}.`;

  // A new server (a restart, maybe after a crash before its write): what it answered but never saved
  // goes back to the head of the queue. `applied` drops any that did reach the disk (Review M2). Its revs
  // are the new server's from here on, so the save counters start again.
  function serverIs(id) {
    if (G.serverId && id && id !== G.serverId) {
      const queued = new Set(G.pending.map((p) => p.a.id));
      G.pending = G.answered.filter((x) => !queued.has(x.a.id)).map(({ a, at }) => ({ a, at })).concat(G.pending);
      G.answered = [];
      G.putRev = 0;
      G.savedRev = 0;
      G.heardRev = 0;
    }
    if (id) G.serverId = id;
  }
  // The server has `rev` on disk (a `saved` event, or a `hello`'s savedRev): what it answered up to there
  // is safe, and is forgotten.
  function saved(rev) {
    G.savedRev = Math.max(G.savedRev, rev);
    prune();
  }
  function prune() { G.answered = G.answered.filter((x) => x.rev > G.savedRev); }

  function rebase(serverState, rev) {
    let s = serverState;
    for (const p of G.pending) s = RS.reduce(s, p.a, p.at);
    G.state = s;
    G.rev = rev;
  }

  // Every change: reduce, redraw, send.
  function act(a) {
    if (G.switching) return; // the sheet is changing session: nothing is done to the old one
    a.id = `${G.clientId}-${++G.seq}`;
    const at = new Date().toISOString();
    a.at = at; // the server keeps the action's own time (Review L2), so a queued action logs when it was done
    G.state = RS.reduce(G.state, a, at);
    G.pending.push({ a, at });
    update();
    pump();
  }

  async function pump() {
    if (G.inflight || !G.pending.length || G.down || G.retry || G.switching) return;
    G.inflight = true;
    const batch = G.pending.slice(0, MAX_SEND);
    indicator();
    let res;
    try {
      res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId: G.stateId, base: G.rev, actions: batch.map((p) => p.a), clientId: G.clientId }),
      });
    } catch (e) {
      G.inflight = false;
      lost();
      return;
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    G.inflight = false;
    if (res.ok && body && typeof body.rev === 'number' && body.state && typeof body.state === 'object') {
      const sent = new Set(batch.map((p) => p.a.id));
      G.pending = G.pending.filter((p) => !sent.has(p.a.id));
      const rejected = Array.isArray(body.rejected) ? body.rejected : [];
      const bad = new Set(rejected.map((x) => x.id));
      for (const p of batch) if (!bad.has(p.a.id)) G.answered.push({ a: p.a, at: p.at, rev: body.rev });
      for (const x of rejected) note(`One change could not be applied: ${x.type}.`, { kind: 'bad', id: `rejected:${x.id}` });
      G.putRev = Math.max(G.putRev, body.rev);
      G.putFailing = false;
      const before = JSON.stringify(G.state);
      rebase(body.state, body.rev);
      prune();
      if (JSON.stringify(G.state) !== before) update();
      else indicator();
      // another window wrote while this answer was on its way: its state is newer than ours (proof M3)
      if (!G.pending.length && G.heardRev > G.rev) refresh();
      pump();
      return;
    }
    if (res.status === 409 && body) { await conflict(body); return; }
    // The server could not take the batch at all (Review L6): sending it again would fail again. Drop it,
    // say so, and take the server's state, so its local effect goes too.
    if (res.status === 400) {
      const sent = new Set(batch.map((p) => p.a.id));
      G.pending = G.pending.filter((p) => !sent.has(p.a.id));
      const what = batch.length === 1 ? 'One change' : `${batch.length} changes`;
      note(`${what} could not be applied: ${(body && body.error) || 'the server refused them'}.`, { kind: 'bad', id: `refused:${batch[0].a.id}` });
      try {
        const st = await getJson('/api/state');
        if (st.stateId === G.stateId) rebase(st.state, st.rev);
      } catch (e) { lost(); return; }
      update();
      pump();
      return;
    }
    G.putFailing = true;
    indicator();
    G.retry = setTimeout(() => { G.retry = null; pump(); }, 2000);
  }

  async function conflict(body) {
    if (body.reason === 'session') {
      const was = G.session ? G.session.label : 'another session';
      G.pending = [];
      G.answered = [];
      // No action until the new session's model and state are both in: one taken meanwhile would be
      // made against the old sheet and lost.
      G.switching = true;
      try {
        const m = await getJson('/api/model');
        const st = await getJson('/api/state');
        takeModel(m);
        G.stateId = st.stateId;
        loadKept();
        applySides();
        G.serverId = st.serverId || G.serverId;
        G.state = st.state;
        G.rev = st.rev;
        // the save counters are the new session's: the old one's revs mean nothing here
        G.putRev = st.rev;
        G.savedRev = st.rev;
      } catch (e) { G.switching = false; lost(); return; }
      G.switching = false;
      note(`This page was showing ${was}; it now shows ${body.label || (G.session && G.session.label) || 'another session'}.`);
      update();
      return;
    }
    // 'stale': another window changed the sheet. Take its state and re-apply every pending action.
    try {
      const st = await getJson('/api/state');
      serverIs(st.serverId);
      rebase(st.state, st.rev);
    } catch (e) { lost(); return; }
    note('Another window changed the sheet; reloaded.', { id: `stale:${G.rev}` });
    update();
    pump();
  }

  // The server stopped answering: keep the pending actions and ask again every 2 s.
  function lost() {
    G.down = true;
    indicator();
    if (!G.resyncTimer) G.resyncTimer = setTimeout(resync, 2000);
  }
  async function resync() {
    G.resyncTimer = null;
    let st;
    try { st = await getJson('/api/state'); } catch (e) { lost(); return; }
    // the server now runs another session: its label is the one to name, never this page's own
    if (st.stateId !== G.stateId) { await conflict({ reason: 'session', label: st.label || '' }); G.down = false; indicator(); return; }
    // two recoveries can cross (the retry timer's and a hello's): the same server's older state never rolls
    // back a newer one an answer brought meanwhile, whose actions have left the queue
    if (st.serverId && st.serverId === G.serverId && st.rev < G.rev) { G.down = false; indicator(); pump(); return; }
    serverIs(st.serverId);
    rebase(st.state, st.rev);
    G.down = false;
    update();
    pump();
  }

  // Another window wrote: take the server's state when nothing of ours is waiting. While ours is on its
  // way, the answer's end asks again if the other write is newer than the answer (proof M3). A redraw
  // keeps the box being typed in (update).
  async function refresh() {
    if (G.inflight || G.pending.length) return;
    try {
      const st = await getJson('/api/state');
      if (G.inflight || G.pending.length || st.stateId !== G.stateId) return;
      // a new server (a restart): what it answered but never saved goes again, on its state
      if (st.serverId && st.serverId !== G.serverId) { serverIs(st.serverId); rebase(st.state, st.rev); update(); pump(); return; }
      // an answer no newer than the state shown (two refreshes crossed, or our own answer) never rolls the view back
      if (st.rev <= G.rev) return;
      G.state = st.state;
      G.rev = st.rev;
      update();
    } catch (e) { lost(); }
  }

  function listen() {
    let es;
    try { es = new EventSource('/api/events'); } catch (e) { return; }
    const data = (ev) => { try { return JSON.parse(ev.data); } catch (e) { return {}; } };
    es.addEventListener('hello', (ev) => {
      const d = data(ev);
      const restarted = G.serverId && d.serverId && d.serverId !== G.serverId;
      serverIs(d.serverId); // first: a new server's revs say nothing of what the old one answered
      if (typeof d.savedRev === 'number') saved(d.savedRev);
      if (d.status) takeStatus(d.status);
      if (G.down || restarted) { if (G.resyncTimer) { clearTimeout(G.resyncTimer); G.resyncTimer = null; } resync(); }
      indicator();
      loadView();
    });
    es.addEventListener('saved', (ev) => {
      saved(data(ev).rev || 0);
      G.saveFailed = false;
      indicator();
      loadView();
    });
    es.addEventListener('players-ok', () => loadView());
    // Another window saved the colours: the vault's answer wins over whatever a failed save left here.
    es.addEventListener('side-colours', (ev) => {
      const c = readChoice(data(ev));
      if (!c || !G.model) return;
      G.model.sideColours = c;
      dropKept();
      applySides();
    });
    es.addEventListener('save-failed', () => { G.saveFailed = true; indicator(); });
    es.addEventListener('state', (ev) => {
      const d = data(ev);
      if (d.clientId === G.clientId) return;
      if (typeof d.rev === 'number') G.heardRev = Math.max(G.heardRev, d.rev);
      probe();
      refresh();
    });
    es.addEventListener('record-kept', (ev) => { const d = data(ev); if (d.path) note(keptText(d.path), { id: `kept:${d.path}` }); });
    es.addEventListener('record-filed', (ev) => { const d = data(ev); if (d.path && !G.tableLog) { G.tableLog = d.path; update(); } });
    es.addEventListener('record-failed', (ev) => { const d = data(ev); recordOk(); note(recordFailedText(d.error), { kind: 'bad', id: `rf:${d.error}` }); });
    es.addEventListener('record-ok', () => recordOk());
    es.onerror = () => { if (!G.down) lost(); };
  }

  function saveWord() {
    if (G.down) return ['Not connected', 'bad', 'The server is not answering; the page keeps what you do and sends it when it is back.'];
    if (G.putFailing || G.saveFailed) return ['Not saving', 'bad', 'The server could not keep the last change; it keeps trying.'];
    if (G.inflight || G.pending.length || G.savedRev < G.putRev) return ['Saving…', 'wait', 'On its way to the vault.'];
    return ['Saved', '', 'Kept in the vault.'];
  }
  function indicator() {
    const [word, cls, title] = saveWord();
    const el = $('#saved');
    if (el) { el.textContent = word; el.className = `saved ${cls}`; el.title = title; }
    probe();
  }

  // ------------------------------------------------------------------ lookups
  const D = () => RS.derive(G.model, G.state);
  const noteInfo = (p) => (G.model.notes && G.model.notes[p]) || (G.model.placeNotes && G.model.placeNotes[p]) || null;
  const castOf = (p) => (G.model.cast || []).find((c) => c.note === p) || null;
  const pcOf = (p) => (G.model.pcs || []).find((x) => x.note === p) || null;
  // a place goes by its title, the reader's one rule (place-name.js): never a folder note's "index"
  const nameOf = (p) => { const pc = pcOf(p); if (pc) return pc.name; const c = castOf(p); if (c) return c.name; const n = noteInfo(p); return n ? (n.title || n.name) : stem(p); };
  const portraitOf = (p) => { const pc = pcOf(p); if (pc && pc.portrait) return pc.portrait; const n = noteInfo(p); if (n && n.portrait) return n.portrait; const c = castOf(p); return c ? c.portrait : null; };
  const unmaskOf = (p) => { const n = noteInfo(p); return n && n.unmask ? n.unmask : null; };
  const isUnmasked = (d, p) => d.unmaskedNow.some((u) => u.note === p);
  const link = (p, text) => (p ? `<a class="lk" data-note="${esc(p)}">${esc(text || nameOf(p))}</a>` : esc(text || ''));
  function face(p, cls = 'face', d = null) {
    const um = d && isUnmasked(d, p) ? unmaskOf(p) : null;
    const pic = (um && um.portrait) || portraitOf(p);
    const nm = (um && um.name) || nameOf(p);
    if (pic) return `<img class="${cls}" src="${esc(picUrl(pic))}" alt="">`;
    return `<span class="${cls}" aria-hidden="true">${esc(String(nm || '?').trim().charAt(0).toUpperCase())}</span>`;
  }
  const pcs = () => G.model.pcs || [];
  const posOf = (pc) => G.state.positions[pc] || null;
  const pcsAtBeat = (key) => pcs().filter((p) => { const x = posOf(p.note); return x && x.beat === key; });
  const pcsAtSpot = (key, spot, hub) => pcs().filter((p) => { const x = posOf(p.note); return x && x.beat === key && (hub ? x.spot === spot : true); });

  // ------------------------------------------------------------------ the players' screen: groups and targets
  const SHOW = window.RunSheetShow;
  const PERSON_TYPES = new Set(['npc', 'creature']);
  const typeOf = (p) => { const n = noteInfo(p) || castOf(p); return n ? String(n.type || '').toLowerCase() : ''; };
  const showablePerson = (p) => Boolean(p) && PERSON_TYPES.has(typeOf(p));
  const showableMaps = () => G.model.showableMaps || [];
  const mapName = (p) => { const m = (G.model.mapNotes || {})[p]; return (m && m.name) || stem(p); };
  const groups = () => (SHOW && G.model && G.state ? SHOW.groupsOf(G.model, G.state) : []);
  const panelOf = (g) => (G.state.panels && G.state.panels[g]) || { people: [], backdrop: null, placeOff: false };
  // The focused group (plan decision 12): the last group whose beat the GM touched, else the first group.
  function focusedGroup(gs = groups()) {
    if (!gs.length) return null;
    if (G.ui.focusGroup && gs.some((g) => g.key === G.ui.focusGroup)) return G.ui.focusGroup;
    const atBeat = G.ui.focus && gs.find((g) => g.beat === G.ui.focus);
    return (atBeat || gs[0]).key;
  }
  // Where a beat's Show goes: the beat's own group (the focused one when a hub has several), else the focused group.
  function groupForBeat(b, gs = groups()) {
    const own = b.contingency ? [] : gs.filter((g) => g.beat === b.key);
    if (!own.length) return focusedGroup(gs);
    const f = focusedGroup(gs);
    return own.some((g) => g.key === f) ? f : own[0].key;
  }
  // A group's name for the GM: the beat's title, and the spot at a hub.
  function groupLabel(key, d = D()) {
    for (const b of d.beats) {
      if (b.key === key) return b.title;
      const sp = (b.spots || []).find((x) => x.key === key);
      if (sp) return `${b.title} · ${sp.name}`;
    }
    return key;
  }
  const touch = (group) => { if (group) G.ui.focusGroup = group; };

  // ------------------------------------------------------------------ Move them (plan 6a Task 7, review F13)
  // Every place in the vault the party can go: the reader's placeKeys, each with its own note's name.
  const FM = window.RunSheetFightMath;
  // Each goes by its title (the reader's one rule, place-name.js: name, first alias, a folder note's folder, the
  // stem with `_` as spaces); two that would show the same carry their folder in brackets (review M1).
  function knownPlaces() {
    const keys = G.model.placeKeys || {};
    const list = Object.keys(keys).map((note) => {
      const n = noteInfo(note) || {};
      const aliases = Array.isArray(n.aliases) ? n.aliases : [];
      const name = n.title || (n.named && n.name) || aliases[0] || stem(note).replace(/_/g, ' ');
      return { note, name, type: 'location', aliases };
    });
    const count = new Map();
    for (const p of list) count.set(p.name.toLowerCase(), (count.get(p.name.toLowerCase()) || 0) + 1);
    for (const p of list) {
      if (count.get(p.name.toLowerCase()) < 2) continue;
      const folder = p.note.split('/').slice(-2, -1)[0];
      if (folder) p.name = `${p.name} (${folder})`;
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const NEW_PLACE = (t) => `+ New place: ${t}`;
  const NO_PLACE = 'No known place by that name: choose "+ New place" to make one';
  const placeChoices = (text) => (FM ? FM.addChoices(knownPlaces(), text, RS.castSearch, 8, NEW_PLACE) : []);
  // A group's place, for the GM: its beat's place (or spot's), else the place beat's, else its beat's title.
  function groupPlace(g, d = D()) {
    const b = d.beats.find((x) => x.key === g.beat);
    const spot = b && g.spot ? (b.spots || []).find((x) => x.key === g.spot) : null;
    const place = (spot && spot.note) || (b && b.place) || null;
    return place ? link(place) : esc(groupLabel(g.key, d));
  }
  // The box: type a place (the page's own list under it offers the near ones; no browser datalist as well, final
  // review P-A2), Enter takes the top known hit, and a new one is only ever the explicit "+ New place: <typed>"
  // choice under it (P-S10).
  // `where` tells a group's boxes apart (Hand over, a Here strip): each keeps its own focus and choices.
  function moveBoxHTML(group, where) {
    const id = `${where}|${group}`;
    const hits = (G.ui.moveHits && G.ui.moveHits[id]) || [];
    return `<span class="movebox"><input data-moveg="${esc(group)}" data-movebox="${esc(id)}" placeholder="Move them to…" aria-label="Move ${esc(groupWho(group))} to a place" autocomplete="off"><span class="hits" data-mhits="${esc(id)}">${moveHitsHTML(group, hits)}</span></span>`;
  }
  function moveHitsHTML(group, hits) {
    return hits.map((c) => (c.isNew
      ? `<button type="button" class="new" data-movenew="${esc(c.name)}" data-moveg="${esc(group)}">${esc(c.label)}</button>`
      : `<button type="button" data-movepick="${esc(c.note)}" data-moveg="${esc(group)}">${esc(c.name)}</button>`)).join('');
  }
  const groupWho = (key) => ((groups().find((g) => g.key === key) || {}).pcs || []).map((p) => first(nameOf(p))).join(', ');
  // The Move list closes on Esc and on any press outside its box (final review P-A1), as the Colours menu does: the
  // press goes on to do what it says, and the typed words stay in the box. `keep` is the box pressed in, if any.
  function closeMoveLists(keep = null) {
    let closed = false;
    for (const [id, hits] of Object.entries(G.ui.moveHits || {})) {
      if (id === keep || !hits.length) continue;
      G.ui.moveHits[id] = [];
      const box = document.querySelector(`[data-mhits="${CSS.escape(id)}"]`);
      if (box) box.innerHTML = '';
      closed = true;
    }
    return closed;
  }
  // A box that still holds typed words opens its list again when it is pressed or tabbed back into (re-review).
  function reopenMoveList(input) {
    if (!input || !input.value.trim()) return;
    const id = input.dataset.movebox;
    G.ui.moveHits = G.ui.moveHits || {};
    if ((G.ui.moveHits[id] || []).length) return;
    G.ui.moveHits[id] = placeChoices(input.value);
    const box = document.querySelector(`[data-mhits="${CSS.escape(id)}"]`);
    if (box) box.innerHTML = moveHitsHTML(input.dataset.moveg, G.ui.moveHits[id]);
    placeMoveList(box);
  }
  // The Move list opens upward when it would run past the window's bottom and there is more room above
  // (PRENTICE's PR review 2)
  function placeMoveList(box) {
    if (!box) return;
    box.classList.remove('up');
    if (!box.firstChild) return;
    const r = box.getBoundingClientRect();
    const input = box.parentElement.querySelector('input[data-movebox]');
    const top = input ? input.getBoundingClientRect().top : r.top;
    if (r.bottom > window.innerHeight && top > window.innerHeight - r.top) box.classList.add('up');
  }
  document.addEventListener('pointerdown', (ev) => {
    const mb = ev.target.closest && ev.target.closest('.movebox');
    const input = mb && mb.querySelector('input[data-movebox]');
    closeMoveLists(input ? input.dataset.movebox : null);
    if (input && ev.target === input) reopenMoveList(input);
  }, true);
  document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches('input[data-movebox]')) reopenMoveList(ev.target); });
  // Move a group's PCs to a known place (`note`) or a typed one (`name`). The place's beat becomes the focus.
  function moveGroup(group, { note, name }) {
    const g = groups().find((x) => x.key === group);
    if (!g) return;
    if (G.ui.moveHits) for (const k of Object.keys(G.ui.moveHits)) if (k.endsWith(`|${group}`)) delete G.ui.moveHits[k];
    document.querySelectorAll(`input[data-moveg="${CSS.escape(group)}"]`).forEach((box) => { box.value = ''; });
    const names = g.pcs.map((p) => first(nameOf(p)));
    let key;
    // a place the Plan has a beat or hub spot for is that beat (review I1); only any other gets a place beat
    const plan = note ? RS.planTarget(G.model, G.state, note) : null;
    if (plan) {
      key = plan.beat;
      act({ type: 'moveGroup', pcs: g.pcs, place: note, title: nameOf(note), to: plan, names });
      G.ui.focus = key;
      touch(plan.spot || plan.beat);
      update();
      goTo(`beat:${key}`);
      return;
    }
    if (note) {
      key = (G.model.placeKeys || {})[note];
      if (!key) return;
      act({ type: 'moveGroup', pcs: g.pcs, place: note, key, title: nameOf(note), names });
    } else {
      const typed = String(name || '').replace(/\s+/g, ' ').trim();
      if (!typed) return;
      const had = G.state.improvised.find((i) => i.newPlace && FM.sameName(i.title, typed));
      key = had ? had.key : `pn-${G.clientId}-${G.seq + 1}`;
      act({ type: 'moveGroup', pcs: g.pcs, name: typed, names });
    }
    G.ui.focus = key;
    touch(key);
    update();
    // the sheet (the pane, in a fight) goes to where they went (final review P4.5)
    goTo(`beat:${key}`);
  }
  // "Where the party is" (F13): one row per group at the top of Hand over, with its place and Move them.
  function partyWhereHTML(d) {
    const gs = groups();
    if (!gs.length) return '';
    return `<h4 class="lab">Where the party is</h4><ul class="where-party">${gs.map((g) => `<li><span class="fc">${g.pcs.map((p) => face(p)).join('')}</span> <b>${esc(groupWho(g.key))}</b> at ${groupPlace(g, d)} ${moveBoxHTML(g.key, 'handover')}</li>`).join('')}</ul>`;
  }

  // The beat the header jot writes to: the one last worked on, else where the first placed PC stands.
  function focusBeat(d) {
    const keys = new Set(d.beats.map((b) => b.key));
    // during a fight, the fight's beat (the prototype's jotTarget); paused, the beat the GM is playing
    const f = G.state.fight;
    if (f && !f.paused && keys.has(f.beat)) return d.beats.find((b) => b.key === f.beat);
    if (G.ui.focus && keys.has(G.ui.focus)) return d.beats.find((b) => b.key === G.ui.focus);
    for (const p of pcs()) { const x = posOf(p.note); if (x && x.beat && keys.has(x.beat)) return d.beats.find((b) => b.key === x.beat); }
    return null;
  }

  // ------------------------------------------------------------------ drawing
  function focusKey(el) {
    const own = ['data-jot', 'data-bring', 'data-movebox', 'data-vhp', 'data-vkey', 'data-vcond', 'data-where', 'data-orphan', 'data-pt', 'data-hand', 'data-stop', 'data-fire'];
    for (const a of own.concat(...parts.map((p) => p.focusAttrs || []))) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${CSS.escape(v)}"]`;
    }
    return el.id ? `#${CSS.escape(el.id)}` : null;
  }
  // An end-panel box saves on `change`, which a redraw would swallow: the box is replaced, its words put
  // back, and leaving it then fires nothing. So a box whose words differ from the saved ones commits first.
  const COMMIT_ON_CHANGE = '#sheet [data-where], #sheet [data-vhp], #sheet [data-vkey], #sheet [data-vcond], #sheet #advance';
  let committing = false;
  let renders = 0;

  // A press holds the redraws (review F1). Pressing the mouse leaves the box being edited, and its commit
  // redraws; a redraw between press and release replaces what is under the pointer, so no click fires.
  // The commit's action goes at once; the redraw waits until after the click (or a release with no click,
  // a cancelled press or the window losing focus), and then focus goes where the click put it. However long
  // the press is held: only a release that never comes is cut off, after 2 s.
  // `n` counts presses: a timer set for one press never ends the next (#852). On a slow machine a click's handler
  // can run long enough for the next press to be waiting; the browser takes that press before the timer the last
  // release set, and the timer would then drop the new press's hold, so a redraw mid-press ate its click.
  const press = { on: false, owed: false, timer: null, n: 0 };
  function endHold() {
    clearTimeout(press.timer);
    press.on = false;
    if (press.owed) { press.owed = false; update(); }
    // what a part owes the release, after the click has landed and the redraw has come (Task 23, D3c: the fight's held
    // rows are placed now, never on the press, so nothing moves under the pointer)
    for (const p of parts) if (p.afterPress) p.afterPress();
  }
  const endHoldOf = (n) => () => { if (press.n === n) endHold(); };
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    press.on = true;
    press.n++;
    clearTimeout(press.timer);
    // A release that never comes is cut off after 2 s. A press held that long ends its hold here, mid-press: the
    // redraw owed comes, and afterPress may place the fight's held rows (Task 23) while the button is still down.
    press.timer = setTimeout(endHoldOf(press.n), 2000);
  }, true);
  // the click's own handlers redraw as usual (capture, before them); a redraw still owed comes after them
  window.addEventListener('click', () => { press.on = false; }, true);
  window.addEventListener('click', endHold);
  // a release with no click: the click, when there is one, comes in the same task as the release
  document.addEventListener('pointerup', () => { if (press.on) setTimeout(endHoldOf(press.n), 0); }, true);
  document.addEventListener('pointercancel', endHold, true);
  window.addEventListener('blur', () => { if (press.on) endHold(); });

  // Focus a part moved on purpose (Tab to the next box): a redraw that finds focus on nothing puts it back
  // there, by the box's key, wherever its row now stands. Any press, or focus going elsewhere, forgets it.
  let wantFocus = null;
  function focusTo(key) {
    wantFocus = key;
    const el = key && document.querySelector(key);
    if (!el) return null;
    el.focus({ preventScroll: false });
    if (el.select) el.select();
    return el;
  }
  document.addEventListener('pointerdown', () => { wantFocus = null; }, true);
  document.addEventListener('focusin', (ev) => { if (wantFocus && ev.target.getAttribute && focusKey(ev.target) !== wantFocus) wantFocus = null; });

  // Every change: redraw, then put focus, caret and half-typed words back.
  // A refused end-panel figure stands until the saved one changes by another route (another window, a long rest): then
  // the box shows what is saved. Pruned here, where the figure changes, not while the panel is drawn.
  function pruneBadVitals() {
    const keys = Object.keys(G.ui.badVital);
    if (!keys.length || !G.model || !G.state) return;
    const rows = D().vitals;
    for (const key of keys) {
      const at = key.lastIndexOf('|');
      const v = rows.find((x) => x.rowId === key.slice(0, at));
      if (!v || String(G.ui.badVital[key].saved ?? '') !== String(v[key.slice(at + 1)] ?? '')) delete G.ui.badVital[key];
    }
  }
  function update() {
    if (press.on) { press.owed = true; return; }
    // called from inside a redraw (a box the redraw removes fires blur and change): once it is done
    if (drawing) { drawAgain = true; return; }
    press.owed = false;
    pruneBadVitals();
    let a = document.activeElement;
    if ((!a || a === document.body) && wantFocus) a = document.querySelector(wantFocus) || a;
    if (!committing && a && a.matches && a.matches(COMMIT_ON_CHANGE) && a.value.trim() !== a.defaultValue.trim()) {
      const before = renders;
      committing = true;
      // the redraw that follows removes the box, and the browser fires its own `change`: that one sends nothing
      a.dataset.sent = a.value;
      try { a.dispatchEvent(new Event('change', { bubbles: true })); } finally { committing = false; }
      if (renders !== before) return; // the change's action redrew
    }
    const sel = a && a !== document.body && a.getAttribute ? focusKey(a) : null;
    const caret = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    G.drafts = {};
    document.querySelectorAll('#sheet input[data-jot], #sheet input[data-bring], #sheet input[data-movebox], #newBeat').forEach((el) => { if (el.value) G.drafts[focusKey(el)] = el.value; });
    // the box being typed in keeps its words too (an end-panel box changes the state only on blur)
    const typing = sel && a.closest && a.closest('#sheet, #side') && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? a.value : null;
    render();
    if (typing !== null) { const el = document.querySelector(sel); if (el) el.value = typing; }
    for (const [k, v] of Object.entries(G.drafts)) { const el = k && document.querySelector(k); if (el && !el.value) el.value = v; }
    if (sel) {
      const el = document.querySelector(sel);
      if (el) { el.focus({ preventScroll: true }); if (caret && el.setSelectionRange) try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text box */ } }
    }
  }

  // A focused box the redraw removes fires blur and change while `innerHTML` is being set; a redraw from
  // in there would throw ("the node to be removed is no longer a child"), leave the page half drawn and
  // focus on nothing. So the handlers can tell (`drawing()`), and a redraw asked for meanwhile comes after.
  let drawing = false;
  let drawAgain = false;
  function render() {
    if (drawing) { drawAgain = true; return; }
    drawing = true;
    try { draw(); } finally { drawing = false; }
    if (drawAgain) { drawAgain = false; setTimeout(update, 0); }
  }
  function draw() {
    if (!G.model || !G.state) return;
    renders++;
    const d = D();
    const m = G.model;
    $('#ttl').textContent = [m.campaign, G.session && G.session.label].filter(Boolean).join(' · ') || 'Run sheet';
    document.title = `${(G.session && G.session.label) || 'Run sheet'} · ${m.campaign || 'run sheet'}`;
    $('#sub').textContent = m.system || '';
    const f = G.state.fight;
    const rd = $('#round');
    if (rd) { rd.textContent = f ? `${f.round ? `Round ${f.round}` : 'Setting up'}${f.paused ? ' · paused' : ''}` : ''; rd.hidden = !f; }
    jotLabel(d);
    const w = (m.warnings || []).length;
    $('#warnBtn').textContent = w ? `${w} prep note${w === 1 ? '' : 's'}` : 'No prep notes';
    renderNotes();
    // the boxes that scroll on their own keep their place through the redraw
    const wasPane = Boolean(G.pane);
    const kept = {};
    document.querySelectorAll('[data-keepscroll]').forEach((el) => { kept[el.dataset.keepscroll] = el.scrollTop; });
    const sheetTop = $('#sheet').scrollTop;
    G.pane = null;
    for (const part of parts) if (!G.pane && part.pane) G.pane = part.pane(d) || null;
    $('#rail').innerHTML = railHTML(d);
    $('#sheet').innerHTML = sheetHTML(d);
    renderSide(d);
    if (G.pane && wasPane) $('#sheet').scrollTop = sheetTop;
    document.querySelectorAll('[data-keepscroll]').forEach((el) => { if (kept[el.dataset.keepscroll]) el.scrollTop = kept[el.dataset.keepscroll]; });
    G.om = G.pane ? orderMin(d) : ORDER_FLOOR;
    applyLayout();
    document.querySelectorAll('[data-mhits]').forEach(placeMoveList);
    drawerShow();
    decorate(document);
    indicator();
  }

  // The header jot box names the beat it writes to.
  function jotLabel(d = D()) {
    const fb = focusBeat(d);
    $('#hjot').placeholder = `Jot (J) → ${fb ? fb.title : 'the night'}`;
  }

  // The sticky header's height, for the scroll offset of a beat or a section jumped to.
  function measureTop() {
    const top = $('#top');
    if (top) document.documentElement.style.setProperty('--toph', `${top.offsetHeight}px`);
  }

  function renderNotes() {
    const el = $('#hnotes');
    if (!el) return;
    el.innerHTML = G.notes.map((n) => `<div class="hnote ${n.kind}"><span>${esc(n.text)}</span><button type="button" data-dismiss="${esc(n.id)}" aria-label="Dismiss">✕</button></div>`).join('');
    measureTop();
    probe();
  }

  // Links with no href (a note the drawer opens, a beat or section to jump to): reachable from the keyboard.
  function decorate(root) {
    root.querySelectorAll('a[data-note]:not([href]), a[data-go]:not([href]), a[data-pane]:not([href])').forEach((a) => { a.tabIndex = 0; a.setAttribute('role', 'link'); });
  }

  const RAIL_TOP = [['handover', 'Hand over'], ['pcs', 'The PCs'], ['run', 'The run']];
  const RAIL_END = [['people', 'People'], ['places', 'Places and maps'], ['threads', 'Threads'], ['long', 'If you run long'], ['end', 'End of the night'], ['prep', "Prep's working"]];
  function railHTML(d) {
    const faces = (list) => (list.length ? `<span class="fc">${list.map((p) => face(p.note)).join('')}</span>` : '');
    const beats = d.beats.filter((b) => !b.contingency).concat(d.beats.filter((b) => b.contingency));
    const off = pcs().filter((p) => { const x = posOf(p.note); return x && x.off; });
    const unplaced = pcs().filter((p) => !posOf(p.note));
    let h = '<button type="button" class="railstrip" id="railOpen" title="Open the run list" aria-label="Open the run list">⟩</button>';
    h += '<div class="hd rhd">Run sheet<button type="button" id="railFold" title="Fold the run list to a thin strip" aria-label="Fold the run list">⟨</button></div>';
    h += RAIL_TOP.map(([id, t]) => `<a data-go="${id}">${t}</a>`).join('');
    h += beats.map((b) => {
      const here = pcsAtBeat(b.key);
      return `<a class="b ${here.length ? 'here' : ''} ${b.impro ? 'impro' : ''}" data-go="beat:${esc(b.key)}" data-railbeat="1">${esc(b.contingency ? `If: ${b.title}` : b.title)}${faces(here)}</a>`;
    }).join('');
    h += `<a class="b ${off.length ? 'here' : ''}" title="A PC in no beat (asleep, elsewhere)">Off-screen${faces(off)}</a>`;
    const canGoOff = pcs().filter((p) => !off.includes(p));
    if (canGoOff.length) h += `<div class="offs">${canGoOff.map((p) => `<button class="mini" type="button" data-off="${esc(p.note)}" title="Move ${esc(p.name)} off-screen">${esc(first(p.name))}</button>`).join('')}</div>`;
    if (unplaced.length) h += `<a class="b" title="PCs the sheet has not placed at any beat yet">Not placed yet${faces(unplaced)}</a>`;
    h += RAIL_END.map(([id, t]) => `<a data-go="${id}">${t}</a>`).join('');
    return h;
  }

  // What a part puts above a beat (the After the fight box).
  const beforeBeat = (b) => parts.map((p) => (p.beforeBeat && p.beforeBeat(b)) || '').join('');
  // A section's buttons from the parts (`sectionButtons(id)`: the GURPS to-hit calculator's on the PCs) sit on its bar.
  const sec = (id, title, body) => {
    const btns = parts.map((p) => (p.sectionButtons && p.sectionButtons(id)) || '').join('');
    return `<section class="s" id="${id}">${btns ? `<div class="sbar"><h2>${title}</h2>${btns}</div>` : `<h2>${title}</h2>`}${body}</section>`;
  };
  const BRIEF_LABELS = { overview: 'Overview', world: 'World', stops: 'Good places to stop' };

  // The right pane in a fight: a strip for when it is folded, a bar (the fight's title, the way back, Fold ⟩), then
  // the cut, the whole beat, or the whole sheet (G.ui.pane: cut, beat, whole).
  function sheetHTML(d) {
    const pane = G.pane;
    if (!pane) return wholeHTML(d);
    const v = G.ui.pane || 'cut';
    const fb = d.beats.find((b) => b.key === pane.beat);
    const strip = `<button type="button" class="panestrip" id="paneOpen" title="Open the fight's beat" aria-label="Open the fight's beat"><span aria-hidden="true">⟨</span><span class="vtitle">⚔ ${esc(pane.title)}</span></button>`;
    const back = v === 'whole' ? "Back to the fight's beat" : v === 'beat' && fb ? 'Cut it down' : '';
    const bar = `<div class="rbar"><span class="t">⚔ ${esc(pane.title)}</span>${back ? `<button type="button" id="paneCut" data-pane="cut">${back}</button>` : ''}<button type="button" id="paneFold" title="Fold this pane to a thin strip: the fight takes the room">Fold ⟩</button></div>`;
    if (v === 'whole') return strip + bar + wholeHTML(d);
    const body = v === 'beat' && fb ? beforeBeat(fb) + beatHTML(fb, d) : pane.cut;
    return `${strip}${bar}${body}<p class="wholelink"><a class="lk" id="paneWhole" data-pane="whole">Whole run sheet</a> <span class="note">the brief, every beat, people, places and the end of the night</span></p>`;
  }
  function wholeHTML(d) {
    const m = G.model;
    let h = '';
    for (const part of parts) if (part.sheetTop) h += part.sheetTop(d) || '';
    if (d.orphans.length) h += changedHTML(d);
    // #855: started by gma table, the log is filed on the first thing that happens; a look leaves nothing.
    if (!G.tableLog) h += G.tableLogOnFirst
      ? '<div class="nolog"><b>No Table Log yet:</b> it is filed on the first thing that happens at the table, so a look leaves nothing in the vault.</div>'
      : '<div class="nolog"><b>No Table Log note yet:</b> start it with <code>gma table</code> to have the record written. The sheet keeps what you do meanwhile.</div>';
    const brief = Object.keys(m.brief || {}).filter((k) => !k.endsWith('Html') && m.brief[`${k}Html`]);
    if (brief.length) h += sec('brief', 'Brief', brief.map((k) => `<h4 class="lab">${esc(BRIEF_LABELS[k] || k)}</h4>${m.brief[`${k}Html`]}`).join(''));
    h += sec('handover', 'Hand over', handoverHTML(d));
    h += sec('pcs', 'The PCs', pcsHTML());
    h += sec('run', 'The run', (d.beats.length ? d.beats.filter((b) => !b.contingency).concat(d.beats.filter((b) => b.contingency)).map((b) => beforeBeat(b) + beatHTML(b, d)).join('') : '<p class="muted">This Plan has no beats the sheet can read: its prep is below, under Prep\'s working.</p>')
      + '<div class="addbeat"><input id="newBeat" placeholder="Name an improvised beat (Enter)" aria-label="Name an improvised beat" autocomplete="off"><button id="addBeat" type="button">+ Beat</button></div>');
    h += sec('people', 'People', peopleHTML(d));
    h += sec('places', 'Places and maps', placesHTML());
    h += sec('threads', 'Threads', m.threadsHtml || '<p class="muted">None listed.</p>');
    h += sec('long', 'If you run long', longHTML(d));
    h += sec('end', 'End of the night', endHTML(d));
    const prep = m.prep || [];
    const open = mem.get('fold:prep') === '1';
    h += `<section class="s" id="prep"><details class="fold" data-fold="prep" ${open ? 'open' : ''}><summary>Prep's working (not for the table)${prep.length ? `: ${esc(prep.map((p) => p.title).join(' · '))}` : ''}</summary>${prep.map((p) => `<h3>${esc(p.title)}</h3>${p.mdHtml || ''}`).join('') || '<p class="muted">None.</p>'}</details></section>`;
    return h;
  }

  function changedHTML(d) {
    const options = (kind) => {
      const out = [];
      for (const b of d.beats) {
        if (kind === 'beat') out.push([b.key, b.title]);
        if (kind === 'point') for (const p of b.points || []) out.push([p.key, `${b.title}: ${p.text}`]);
        if (kind === 'loot') for (const t of b.treasure || []) out.push([t.key, `${b.title}: ${t.text}`]);
        if (kind === 'spot' && (b.spots || []).length > 1) for (const s of b.spots) out.push([s.key, `${b.title} · ${s.name}`]);
      }
      if (kind === 'handout') for (const x of G.model.handouts || []) out.push([x.key, x.text || stem(x.note) || x.name]);
      return out;
    };
    const what = (o) => {
      const where = o.beatTitle ? ` (${esc(o.beatTitle)})` : '';
      if (o.kind === 'point') return `Point "${esc(o.text)}"${where}: ${esc(o.value)}`;
      if (o.kind === 'loot') return `Loot "${esc(o.text)}"${where}: to ${esc(o.value === 'party' ? 'the party' : nameOf(o.value))}`;
      if (o.kind === 'handout') return `Handout "${esc(o.text)}": handed over`;
      if (o.kind === 'spot') return `A spot at ${esc(o.beatTitle)}: ${esc(nameOf(o.value))} stood there`;
      if (o.kind === 'vitals') {
        const v = o.value;
        const hp = v.hp !== null ? `HP ${v.hp}${v.max !== null ? `/${v.max}` : ''}` : v.max !== null ? `HP max ${v.max}` : '';
        const pools = RS.poolWords(G.model, v);
        return `Vitals for ${esc(nameOf(o.note))}${o.copy > 1 ? ` ${o.copy}` : ''}: ${esc([hp, ...pools, v.conditions].filter(Boolean).join(', '))} (no longer on the end panel)`;
      }
      return `Beat "${esc(o.text || o.key)}": ${esc([].concat(o.value).map((v) => String(v).replace(/^stood: (.*)$/, (x, p) => `${nameOf(p)} stood there`)).join(', '))}`;
    };
    return `<div class="changed" id="changed"><b>Changed since play started:</b> marks kept against things the Plan no longer has. They go into the record as they are; attach one to what it became.<ul>${d.orphans.map((o) => {
      const opts = options(o.kind);
      return `<li>${what(o)} ${opts.length ? `<select data-orphan="${esc(o.key)}" aria-label="Attach to"><option value="">attach to…</option>${opts.map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select> <button type="button" data-attach="${esc(o.key)}">Attach</button>` : ''}</li>`;
    }).join('')}</ul></div>`;
  }

  function handoverHTML(d) {
    const list = G.model.handouts || [];
    return `${partyWhereHTML(d)}${list.length ? handoutsHTML(list) : '<p class="muted">Nothing to hand over.</p>'}${mapsHTML()}`;
  }
  // The maps the player site would publish (decision 9), each with Show to the focused group's panel.
  function mapsHTML() {
    const maps = showableMaps();
    if (!maps.length) return '';
    const group = focusedGroup();
    return `<h4 class="lab">Maps to show</h4><ul class="maps">${maps.map((p) => `<li>${link(p, mapName(p))} ${backdropBtn(p, group, 'data-mapshow')}</li>`).join('')}</ul>${group ? '' : '<p class="note">Place a PC at a beat to have a panel to show them on.</p>'}`;
  }
  function handoutsHTML(list) {
    return `<ul class="pts">${list.map((x) => {
      const on = !!G.state.handouts[x.key];
      return `<li class="${on ? 'landed' : ''}"><button class="ptb ${on ? 'landed' : ''}" data-hand="${esc(x.key)}" type="button" aria-pressed="${on}" title="${on ? 'Handed over. Click: not handed over' : 'Click: handed over'}">${on ? '✓' : ''}</button><span>${x.nameHtml || esc(x.name)}${x.scene ? ` <span class="muted">(${esc(x.scene)})</span>` : ''} ${x.textHtml || ''}${on ? ' <span class="note">handed over</span>' : ''}</span></li>`;
    }).join('')}</ul>`;
  }

  // The rules of the system, as the end panel and the PCs table read them
  const endRules = () => {
    const r = (G.model && G.model.rules) || {};
    // a model with no rules is D&D's, as gm-fight.js reads it
    return { toggles: r.toggles || { longRest: true }, words: { longRest: FM.DND_LONG_REST, ...(r.words || {}) } };
  };
  // A PC's figures in the system's own words (rules.words.pcLine): `HP 11/11 · MP 12`; a missing figure is `?`
  function pcLine(p) {
    const fig = (v, signed) => (v === null || v === undefined || v === '' ? '?' : (signed && Number(v) >= 0 ? '+' : '') + v);
    return (endRules().words.pcLine || []).map((c) => `${esc(c.word)} ${esc(fig(p[c.now], c.signed))}${c.max ? `/${esc(fig(p[c.max]))}` : ''}`).join(' · ');
  }

  // a field the server rendered (present.js `fHtml`), else its words escaped
  const md = (o, f) => (typeof o[`${f}Html`] === 'string' ? o[`${f}Html`] : esc(o[f]));
  function pcsHTML() {
    if (!pcs().length) return '<p class="muted">No party given: start the sheet with <code>gma table</code> to have the PCs on it.</p>';
    const src = { index: "the session's list", wrapup: "the session's wrap-up", plan: "the Plan's roster", given: 'the active PCs' }[G.model.partyFrom];
    return `${src ? `<p class="muted">This session's party, from ${src}.</p>` : ''}<div class="tw"><table><thead><tr><th>PC</th><th>This session</th></tr></thead><tbody>${pcs().map((p) => `<tr><td style="white-space:nowrap">${face(p.note)} ${link(p.note, p.name)}<div class="note">${esc(p.player || '')}${p.role ? ` · ${esc(p.role)}` : ''} · ${pcLine(p)}</div></td>
      <td>${p.moment ? `<b>Moment:</b> ${md(p, 'moment')}<br>` : ''}${p.touch ? `<span class="muted">Touchpoint:</span> ${md(p, 'touch')}<br>` : ''}${p.arc ? `<span class="muted">Arc:</span> ${md(p, 'arc')}` : ''}${p.thread ? `<br><span class="muted">Thread:</span> ${md(p, 'thread')}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const PT = { '': '', landed: '✓', missed: '✗', overtaken: '⊘' };
  const PT_TITLE = { '': 'Not marked. Click: landed ✓', landed: 'Landed ✓. Click: tried and missed ✗', missed: 'Tried and missed ✗. Click: overtaken ⊘', overtaken: 'Overtaken ⊘. Click: clear' };

  function beatHTML(b, d) {
    const lbl = b.contingency ? 'If triggered' : b.newPlace ? 'New place (typed tonight)' : b.placeBeat ? 'Place' : b.impro ? 'Improvised' : (b.place ? esc(nameOf(b.place)) : esc(b.placeText || ''));
    const here = pcsAtBeat(b.key);
    let h = `<div class="beat ${here.length ? 'here' : ''}" id="beat:${esc(b.key)}" data-beat="${esc(b.key)}"><div class="bh"><span class="lbl">${lbl}</span><h3>${esc(b.title)}</h3>${b.sceneNote ? link(b.sceneNote, 'scene note') : ''}</div>`;
    // 1 Here: faces per standing place; a hub gets one row per spot
    const gs = groups();
    const hub = (b.spots || []).length > 1;
    if (!b.contingency && pcs().length) {
      const strip = (spot, label) => {
        const to = JSON.stringify({ beat: b.key, spot: spot ? spot.key : null, title: b.title });
        const at = pcsAtSpot(b.key, spot && spot.key, hub);
        // a hub's spots each carry their own Show and Place on panel; a plain beat's are with its buttons
        const own = spot ? `${showBeatBtn(b, spot, gs)}${placeBtn(spot.key)}` : '';
        // the group standing here can be moved on, to any place (F13)
        const position = spot ? spot.key : b.key;
        const move = gs.some((g) => g.key === position) ? moveBoxHTML(position, 'here') : '';
        return `<div class="here-strip">${label ? `<span class="sl">${label}</span>` : 'Here:'} ${pcs().map((p) => `<button class="pcb ${at.includes(p) ? 'on' : ''}" data-move="${esc(p.note)}" data-to="${esc(to)}" type="button" title="Put ${esc(p.name)} here" aria-pressed="${at.includes(p)}">${face(p.note)}${esc(first(p.name))}</button>`).join('')} <button data-all="${esc(to)}" type="button">Everyone</button>${own ? `<span class="pv-btns">${own}</span>` : ''}${move}</div>`;
      };
      h += hub ? b.spots.map((s) => strip(s, s.note ? link(s.note, s.name) : esc(s.name))).join('') : strip(null, '');
    }
    // The beat's buttons
    const btns = [];
    if (!hub || b.contingency) btns.push(showBeatBtn(b, null, gs));
    if (!hub && !b.contingency) btns.push(placeBtn(b.key));
    if (b.contingency) btns.push(`<button data-fire="${esc(b.key)}" class="${G.state.fired[b.key] ? 'fired' : ''}" type="button" aria-pressed="${!!G.state.fired[b.key]}">${G.state.fired[b.key] ? 'Fired ✓' : 'It fired'}</button>`);
    const stopped = G.state.stopped && G.state.stopped.beat === b.key;
    btns.push(`<button data-stop="${esc(b.key)}" class="${stopped ? 'on' : ''}" type="button" aria-pressed="${stopped}">${stopped ? 'Stopped here ✓' : 'Stopped here'}</button>`);
    // a place typed tonight is taken back (Take off) once nobody stands there; any other improvised beat is removed
    if (b.newPlace) { if (!here.length && !RS.placeInFight(G.state, b.key)) btns.push(armBtn(`unplace:${b.key}`, 'Take off this place', `data-unplace="${esc(b.key)}"`, 'Take back this place typed tonight, and its lines')); }
    else if (b.impro) btns.push(armBtn(`unimpro:${b.key}`, 'Remove this beat', `data-unimpro="${esc(b.key)}"`));
    for (const part of parts) if (part.beatButtons) btns.push(part.beatButtons(b) || '');
    h += `<div class="bbtns">${btns.filter(Boolean).join('')}</div>`;
    if (b.contingency) h += `<div class="kv"><b>Trigger</b><span>${b.triggerHtml || esc(b.trigger || '')}</span></div>${b.thenHtml || ''}`;
    // 2 Points to land
    if ((b.points || []).length) {
      h += `<h4 class="lab">Points to land</h4><ul class="pts">${b.points.map((p) => {
        const st = (G.state.points[p.key] && G.state.points[p.key].mark) || '';
        return `<li class="${st}"><button class="ptb ${st}" data-pt="${esc(p.key)}" data-beat="${esc(b.key)}" type="button" title="${PT_TITLE[st]}" aria-label="${esc(PT_TITLE[st])}">${PT[st]}</button><span class="pt-t">${p.textHtml || esc(p.text)}</span></li>`;
      }).join('')}</ul>`;
    }
    // 3 Who's here
    h += `<h4 class="lab">Who's here</h4>${whoHTML(b, d)}`;
    // 4 If they… never folded
    if ((b.ifs || []).length) h += `<h4 class="lab">If they…</h4><div class="tw"><table class="ifs"><thead><tr><th>Do</th><th>Then</th></tr></thead><tbody>${b.ifs.map((r) => `<tr><td>${r.doHtml || esc(r.do)}</td><td>${r.thenHtml || esc(r.then)}</td></tr>`).join('')}</tbody></table></div>`;
    // 5 Read-aloud: open the first time
    if (b.readAloud) h += `<details class="fold" data-ra="${esc(b.key)}" ${mem.get(`ra:${b.key}`) === 'closed' ? '' : 'open'}><summary>Read aloud</summary><div class="ra">${b.readAloudHtml || esc(b.readAloud)}</div></details>`;
    // 6 The rest, in one fold
    const rest = [];
    if (b.situation) rest.push(['Situation', b.situationHtml]);
    if (b.startsIt) rest.push(['Starts it', b.startsItHtml]);
    if (b.complications) rest.push(['Complications', b.complicationsHtml]);
    if ((b.treasure || []).length) rest.push(['Treasure', lootHTML(b)]);
    if ((b.spots || []).length > 1) rest.push(['Where they can go', `<ul>${b.spots.map((s) => `<li><b>${s.note ? link(s.note, s.name) : esc(s.name)}</b>${s.mdHtml ? `: ${s.mdHtml}` : ''}</li>`).join('')}</ul>`]);
    if (b.extra) rest.push(['More from the Plan', b.extraHtml]);
    if (b.gmNotes) rest.push(['GM notes', b.gmNotesHtml]);
    if (rest.length) {
      const id = `rest:${b.key}`;
      h += `<details class="fold" data-fold="${esc(id)}" ${mem.get(`fold:${id}`) === '1' ? 'open' : ''}><summary>${rest.map((r) => r[0]).join(' · ')}</summary>${rest.map((r) => `<h4 class="lab">${r[0]}</h4>${r[1] || ''}`).join('')}</details>`;
    }
    // 7 The jot box and this beat's jots
    const js = G.state.jots.filter((j) => j.beat === b.key);
    h += `<ul class="jots">${js.map((j) => `<li><span class="tm">${esc(hhmm(j.at))}</span><span>${esc(j.text)}</span>${armBtn(`unjot:${j.id}`, '✕', `data-unjot="${esc(j.id)}" class="mini"`, 'Delete this jot')}</li>`).join('')}</ul>`;
    h += `<div class="jot"><input data-jot="${esc(b.key)}" placeholder="Jot what happened (Enter)" aria-label="Jot a line for ${esc(b.title)}" autocomplete="off"></div></div>`;
    return h;
  }

  // Show on a beat (or a hub's spot): the beat's people who have notes, and its place, to the group's panel.
  function showBeatBtn(b, spot, gs) {
    const own = spot ? gs.find((g) => g.key === spot.key) : null;
    const group = own ? own.key : groupForBeat(b, gs);
    if (!group) return '';
    return `<button type="button" data-showbeat="${esc(b.key)}" data-spot="${esc(spot ? spot.key : '')}" data-group="${esc(group)}" title="Show this beat's people and place on the players' screen (${esc(groupLabel(group))})">Show</button>`;
  }
  // Place on panel: always there, kept by position, so it holds for PCs who arrive later (Review L3).
  function placeBtn(position) {
    const on = !panelOf(position).placeOff;
    return `<button type="button" data-placeoff="${esc(position)}" class="${on ? 'on' : ''}" aria-pressed="${on}" title="${on ? 'The place is behind this panel. Click: take it off' : 'No place behind this panel. Click: put it back'}">${on ? 'Place on panel ✓' : 'Place on panel'}</button>`;
  }
  // Show or Remove for one person on the group's panel. Remove takes two clicks.
  function personBtn(p, group, name) {
    if (!group || !showablePerson(p)) return '';
    if (panelOf(group).people.includes(p)) return armBtn(`unshow:${group}|${p}`, 'Remove from panel', `data-unshow="${esc(p)}" data-group="${esc(group)}"`, `Take ${name} off the players' screen`);
    return `<button type="button" data-show="${esc(p)}" data-group="${esc(group)}" title="Show ${esc(name)} on the players' screen (${esc(groupLabel(group))})">Show</button>`;
  }
  // Show for a place or a map: it goes behind the group's panel. Shown already: the click puts the group's own place back.
  function backdropBtn(p, group, attr) {
    if (!group) return '';
    const on = panelOf(group).backdrop === p;
    return `<button type="button" ${attr}="${esc(p)}" data-group="${esc(group)}" class="${on ? 'on' : ''}" aria-pressed="${on}" title="${on ? 'Behind the panel now. Click: back to the group\'s own place' : `Show behind the players' panel (${esc(groupLabel(group))})`}">${on ? 'Shown ✓' : 'Show'}</button>`;
  }

  // A two-click button: the first click arms it (3 s), the second does it.
  function armBtn(id, label, attrs, title = '') {
    const armed = G.ui.armed && G.ui.armed.id === id && Date.now() - G.ui.armed.at <= 3000;
    const cls = /class="([^"]*)"/.exec(attrs);
    const rest = attrs.replace(/\s*class="[^"]*"/, '');
    return `<button type="button" ${rest} data-arm="${esc(id)}" class="${cls ? cls[1] : ''} ${armed ? 'arm' : ''}" title="${esc(title || label)}">${armed ? 'Sure? click again' : esc(label)}</button>`;
  }

  function whoHTML(b, d) {
    const inWho = new Set((b.who || []).map((w) => w.note).filter(Boolean));
    const target = groupForBeat(b);
    let h = (b.who || []).map((w) => {
      const p = w.note;
      const um = p ? unmaskOf(p) : null;
      const on = p && um && isUnmasked(d, p);
      const shown = on ? um.name : w.name;
      const pa = on && um.playAs ? esc(um.playAs) : (w.playAsHtml || esc(w.playAs || ''));
      const wants = w.wantsHtml || esc(w.wants || '');
      const foe = p && (b.foes || []).find((f) => f.note === p && f.prepNote);
      const tags = [];
      if (w.count > 1) tags.push(`×${w.count}`);
      if (w.knownAs && w.knownAs !== w.name && w.knownAs !== shown) tags.push(`<span class="muted">(known as ${esc(w.knownAs)})</span>`);
      if (w.dead) tags.push('<span class="dead">dead (per the note)</span>');
      if (w.brought) tags.push('<span class="muted">· brought in</span>');
      if (!p) tags.push('<span class="warn">no note: a Plan line, not a person</span>');
      const btns = [];
      if (um) btns.push(`<button type="button" data-unmask="${esc(p)}" data-beat="${esc(b.key)}" class="${on ? 'on' : ''}" aria-pressed="${!!on}">${on ? `Unmasked as ${esc(um.name)}` : `Unmask (${esc(um.name)})`}</button>`);
      if (p && target) btns.push(personBtn(p, target, shown));
      if (w.brought) btns.push(armBtn(`unbring:${b.key}|${p}`, 'Remove', `data-unbring="${esc(p)}" data-beat="${esc(b.key)}"`, `Take ${shown} off this beat`));
      return `<div class="who">${p ? face(p, 'av', d) : '<span class="av"></span>'}<div><div class="wn"><b>${p ? link(p, shown) : esc(shown)}</b>${tags.join(' ')} ${btns.join(' ')}</div>${pa ? `<div class="pa">${pa}</div>` : ''}${wants ? `<div class="wa">${wants}</div>` : ''}${foe ? `<div class="note">${esc(foe.prepNote)}</div>` : ''}</div></div>`;
    }).join('');
    if (!(b.who || []).length) h += '<p class="muted">Nobody listed.</p>';
    for (const a of b.arrivals || []) h += cueHTML(b, a, inWho);
    const hits = G.ui.hits[b.key] || [];
    h += `<div class="bring"><input data-bring="${esc(b.key)}" placeholder="Bring anyone in: type a name" aria-label="Bring someone into ${esc(b.title)}" autocomplete="off"><div class="hits" data-hits="${esc(b.key)}">${hitsHTML(b.key, hits)}</div></div>`;
    return h;
  }
  // An arrivals cue. While a fight runs, each person it names has Add to fight (a benched row is ticked in),
  // whether or not the Who line names them too (proof M1); else Bring in for anyone not here yet.
  function cueHTML(b, a, inWho) {
    const f = G.state.fight;
    const fighting = (p) => Boolean(f) && f.rows.some((r) => r.note === p && r.in);
    const btn = (p) => {
      if (f) return fighting(p) ? '' : `<button type="button" data-faddcast="${esc(p)}" title="Tick ${esc(nameOf(p))} into the fight">Add ${esc(nameOf(p))} to the fight</button>`;
      return inWho.has(p) ? '' : `<button type="button" data-bringin="${esc(p)}" data-beat="${esc(b.key)}">Bring in ${esc(nameOf(p))}</button>`;
    };
    return `<div class="cue"><b>${esc(a.when)}:</b> <span>${a.textHtml || esc(a.text)}</span>${(a.people || []).map(btn).join('')}</div>`;
  }
  function hitsHTML(beat, hits) {
    return hits.map((c) => `<button type="button" data-pick="${esc(c.note)}" data-beat="${esc(beat)}">${esc(c.name)}<span class="t">${esc(c.type)}${c.dead ? ', dead' : ''}${(c.aliases || []).length ? ` · ${esc(c.aliases.join(', '))}` : ''}</span></button>`).join('');
  }

  function lootHTML(b) {
    return `<ul>${b.treasure.map((t) => {
      const to = (G.state.loot[t.key] && G.state.loot[t.key].to) || '';
      return `<li>${t.textHtml || esc(t.text)} <select data-loot="${esc(t.key)}" data-beat="${esc(b.key)}" aria-label="Given to"><option value="">not handed out</option>${pcs().map((p) => `<option value="${esc(p.note)}" ${to === p.note ? 'selected' : ''}>to ${esc(p.name)}</option>`).join('')}<option value="party" ${to === 'party' ? 'selected' : ''}>to the party</option></select></li>`;
    }).join('')}</ul>`;
  }

  function peopleHTML(d) {
    const list = G.model.people || [];
    if (!list.length) return '<p class="muted">None listed.</p>';
    return `<div class="tw"><table><thead><tr><th>Name</th><th>Play as</th><th>Wants</th><th>Right now</th></tr></thead><tbody>${list.map((p) => {
      const um = p.note ? unmaskOf(p.note) : null;
      const on = um && isUnmasked(d, p.note);
      const pa = on && um.playAs ? esc(um.playAs) : (p.playAsHtml || '<span class="warn">none in the note</span>');
      return `<tr><td>${p.note ? `${face(p.note, 'face', d)} ${link(p.note, on ? um.name : p.name)}` : esc(p.name)}</td><td>${pa}</td><td>${p.wantsHtml || '—'}</td><td>${p.nowHtml || ''}${p.whereHtml ? `<div class="note">${p.whereHtml}</div>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function placesHTML() {
    const tile = (p) => {
      const pic = portraitOf(p);
      const btns = parts.map((x) => (x.placeButtons && x.placeButtons(p)) || '').join('');
      return `<div class="place"><div class="im">${pic ? `<img src="${esc(picUrl(pic))}" alt="">` : 'no picture yet'}</div><div class="cap">${link(p)}${btns ? ` ${btns}` : ''}</div></div>`;
    };
    const places = G.model.places || [];
    const maps = G.model.maps || [];
    if (!places.length && !maps.length) return '<p class="muted">None listed.</p>';
    return `${places.length ? `<div class="places">${places.map(tile).join('')}</div>` : ''}${maps.length ? `<h4 class="lab">Maps</h4><div class="places">${maps.map(tile).join('')}</div>` : ''}`;
  }

  function longHTML(d) {
    const N = G.model.runLong || {};
    let h = `<div class="kv"><b>Next Plan</b><span>${N.nextPlan ? link(N.nextPlan) : 'not written yet'}</span>`;
    h += `<b>Unplayed scenes</b><span>${(N.scenes || []).length ? N.scenes.map((p) => link(p)).join(' · ') : 'none'}</span>`;
    h += `<b>Planning</b><span>${(N.planning || []).map((p) => `${link(p.note)} <span class="note">${esc(p.kind)}</span>`).join(' · ') || 'none'}</span></div>`;
    const cont = d.beats.filter((b) => b.contingency);
    if (cont.length) h += `<p><b>This session's contingencies:</b> ${cont.map((b) => `<a class="lk" data-go="beat:${esc(b.key)}">${esc(b.title)}</a>`).join(' · ')}</p>`;
    return h;
  }

  const whereText = (w) => {
    if (w.status === 'unplaced') return 'not placed';
    if (w.status === 'off') return 'off-screen';
    return w.title || '';
  };
  // The vitals columns after Who: the system's, from the ontology (model.rules.vitals; the reader gives D&D's for a
  // vault with no system of its own).
  const vitalColumns = () => RS.vitalColumns(G.model);
  function endHTML(d) {
    let h = `<p class="note">Prefilled from the sheet. Change anything after rests: only a row you change${endRules().toggles.longRest ? ', or a long rest,' : ''} goes into the record.</p>`;
    if (pcs().length) {
      h += `<h4 class="lab">Where everyone ended</h4><table class="where"><tbody>${d.whereEnded.map((w) => `<tr><td style="width:12rem">${face(w.pc)} ${esc(w.name)}</td><td><input data-where="${esc(w.pc)}" value="${esc(w.text || whereText(w))}" data-default="${esc(whereText(w))}" aria-label="Where ${esc(w.name)} ended"></td></tr>`).join('')}</tbody></table>`;
    }
    if (d.vitals.length) {
      // the system's vitals columns (model.rules.vitals). D&D's (HP and Conditions) are one line a row, as before 6b: HP,
      // Max, Conditions. A system with pools (CoC's MP, SAN and Luck, GURPS's FP) gives each row two lines, so the
      // table fits the sheet's column at 1100 wide: the figures, each with its max beside it, then Conditions under them
      const cols = vitalColumns();
      const nums = cols.filter((c) => c.field !== 'conditions');
      const hasCond = cols.some((c) => c.field === 'conditions');
      const pooled = nums.some((c) => c.field !== 'hp');
      // a refused figure stands until the saved one changes by another route (`pruneBadVitals`, on every update)
      const bad = (v, field) => G.ui.badVital[`${v.rowId}|${field}`];
      // a figure refused (over the sheet's max, or below 0): kept as typed, marked, never saved
      const box = (v, field, attrs, label) => {
        const b = bad(v, field);
        const val = b ? b.text : (v[field] ?? '');
        return `<input ${attrs} value="${esc(val)}" inputmode="numeric" aria-label="${esc(label)}"${b ? ` aria-invalid="true" title="${esc(b.why)}"` : ''}>`;
      };
      const numBox = (v, c) => (c.field === 'hp' ? box(v, 'hp', `data-vhp="${esc(v.rowId)}"`, `${v.name} HP now`)
        : box(v, c.field, `data-vkey="${esc(`${v.rowId}|${c.field}`)}"`, `${v.name} ${c.column} now`));
      const condBox = (v) => `<input class="c" data-vcond="${esc(v.rowId)}" value="${esc(v.conditions || '')}" placeholder="conditions that carry" aria-label="${esc(v.name)} conditions">`;
      const who = (v) => `${esc(v.name)}${v.ally ? ' <span class="note">ally</span>' : ''}`;
      const rec = (v) => (v.set || v.rest ? '<span class="rec">recorded</span>' : '');
      let table;
      if (!pooled) {
        const head = cols.map((c) => (c.field === 'hp' ? `<th>${esc(c.column)}</th><th>Max</th>` : `<th>${esc(c.column)}</th>`)).join('');
        table = `<table class="vt"><thead><tr><th>Who</th>${head}<th></th></tr></thead><tbody>${d.vitals.map((v) => `<tr><td>${who(v)}</td>${cols.map((c) => (c.field === 'hp'
          ? `<td>${numBox(v, c)}</td><td>${esc(v.max ?? '?')}</td>` : `<td>${condBox(v)}</td>`)).join('')}<td>${rec(v)}</td></tr>`).join('')}</tbody></table>`;
      } else {
        const maxOf = (v, c) => (c.shape === 'current/max' && c.max ? v[c.max] : null);
        const cell = (v, c) => {
          // Luck is a PC's alone
          if (c.pcs_only && v.ally) return '<td></td>';
          const max = maxOf(v, c);
          return `<td>${numBox(v, c)}${max !== null && max !== undefined ? `<span class="of">/ ${esc(max)}</span>` : ''}</td>`;
        };
        table = `<table class="vt pools"><thead><tr><th>Who</th>${nums.map((c) => `<th>${esc(c.column)}</th>`).join('')}</tr></thead><tbody>${d.vitals.map((v) => {
          const why = nums.filter((c) => bad(v, c.field)).map((c) => `<span class="badnum">${esc(c.column)} ${esc(bad(v, c.field).text)}: ${esc(bad(v, c.field).why)}</span>`).join('');
          return `<tr class="vn"><td${hasCond ? ' rowspan="2"' : ''}>${who(v)}${rec(v) ? `<br>${rec(v)}` : ''}</td>${nums.map((c) => cell(v, c)).join('')}</tr>`
            + (hasCond ? `<tr class="vc"><td colspan="${nums.length}">${why}${condBox(v)}</td></tr>` : '');
        }).join('')}</tbody></table>`;
      }
      h += `<h4 class="lab">Vitals</h4><div class="tw">${table}</div>`;
      // the rest button is a D&D thing: only a system whose toggles have it, in its own words
      if (endRules().toggles.longRest) h += `<p><button id="longRest" type="button" class="${G.state.end.longRest ? 'on' : ''}" aria-pressed="${!!G.state.end.longRest}">${G.state.end.longRest ? 'Long rest taken ✓ (click to undo)' : esc(endRules().words.longRest)}</button></p>`;
    }
    h += `<h4 class="lab"><label for="advance">Advancement</label></h4><textarea id="advance" placeholder="${esc(endRules().words.advancement || '')}">${esc(G.state.end.advancement || '')}</textarea>`;
    h += `<p><button id="copyRecord" class="primary" type="button">Copy the Table Log</button> <span class="note" id="copyMsg">${esc(G.ui.copyMsg)}</span></p>`;
    if (G.ui.record) h += `<pre class="notes" id="recordText">${esc(G.ui.record)}</pre>`;
    return h;
  }

  // ------------------------------------------------------------------ the right column: the players' screen preview
  // A part (the fight view) may take the column; otherwise it shows the players' own view, drawn by their own
  // render.js inside a shadow root (their stylesheet stays out of this page's), at 0.35 scale. The view is the
  // server's filtered one, read again on this page's own `saved`. Each person on a panel gets a ✕ (two clicks).
  const PV_SCALE = 0.35;
  const PV_CSS = `:host { display: block; overflow: hidden; border-radius: 8px; background: #0d1117;
    --lamp: #e7a65a; --bad: #ff9d93; --soft: #c9d3df; }
  .pvbox { transform: scale(${PV_SCALE}); transform-origin: 0 0; padding: 12px; background: #0d1117; color: #e6edf3;
    font: 20px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; box-sizing: border-box; }
  .tile { position: relative; }
  .x { position: absolute; top: -8px; right: -4px; width: 56px; height: 56px; padding: 0; border-radius: 50%; cursor: pointer;
    font: 700 34px/1 system-ui, sans-serif; color: #fff; background: rgba(0, 0, 0, .78); border: 3px solid rgba(255, 255, 255, .8); }
  .x.arm { background: #a3302a; border-color: #fff; }`;
  let pvKey = '';
  function renderSide(d) {
    const side = $('#side');
    if (!side) return;
    let own = null;
    for (const part of parts) {
      if (!part.side) continue;
      const h = part.side();
      if (h != null) { own = h; break; }
    }
    $('#app').classList.toggle('part-side', own != null);
    if (own != null) {
      side.classList.add('part');
      side.innerHTML = own;
      return;
    }
    if (side.classList.contains('part') || !$('#pvctl')) {
      side.classList.remove('part');
      side.innerHTML = '<div id="pvctl" class="pvctl"></div>';
    }
    $('#pvctl').innerHTML = previewControls(d);
  }
  // The players' preview: one box, made once, that `applyLayout` puts where it belongs. Its shadow root (the
  // drawn view) goes with it. Folded it is its bar; in a fight, folded, it is nowhere (the toolbar brings it).
  const pvbox = document.createElement('div');
  pvbox.id = 'pvbox';
  pvbox.className = 'pvw';
  pvbox.innerHTML = '<div class="pvh"><b>Players\' screen</b><button type="button" id="playersBtn2" class="mini" title="Open the players\' window">Open</button><button type="button" id="pvToggle" class="mini" aria-controls="pv"></button></div><div id="pv" class="pv"></div>';
  const pvHost = pvbox.querySelector('#pv');
  // Under the preview: each panel's Shown backdrop, with a way back to the group's own place.
  function previewControls(d) {
    const gs = groups();
    if (!gs.length) return '<p class="note">No PC is at a beat yet: the players see the campaign\'s name.</p>';
    const f = focusedGroup(gs);
    return `<ul class="pvlist">${gs.map((g) => {
      const pn = panelOf(g.key);
      const typed = pn.backdrop ? G.state.improvised.find((i) => i.key === pn.backdrop && i.newPlace) : null;
      const back = pn.backdrop ? ` · <span class="muted">behind:</span> ${esc(typed ? typed.title : showableMaps().includes(pn.backdrop) ? mapName(pn.backdrop) : nameOf(pn.backdrop))} <button type="button" class="mini" data-unback="${esc(g.key)}" title="Back to the group's own place">✕</button>` : '';
      return `<li class="${g.key === f ? 'focus' : ''}"><a class="lk" data-pgroup="${esc(g.key)}" title="Show goes to this panel">${esc(groupLabel(g.key, d))}</a>${g.key === f ? ' <span class="note">· Show goes here</span>' : ''}${back}</li>`;
    }).join('')}</ul>`;
  }
  // The notes behind a view panel's people, as forPlayers keeps them: the panel's own list, people only, once each.
  function panelPeople(key) {
    const out = [];
    for (const p of panelOf(key).people || []) if (!out.includes(p) && (showablePerson(p) || typeOf(p) === 'pc')) out.push(p);
    return out;
  }
  // The most the preview may take: 40% of the right pane's height there (review F9), or 25% of the middle's when
  // it sits above the order, which keeps the rows in view (fix round 1, M5); elsewhere its width alone sets it.
  function pvCap() {
    const at = pvbox.parentElement;
    const bar = pvbox.querySelector('.pvh').offsetHeight + 16;
    if (at && at.id === 'sheet') return Math.max(80, at.clientHeight * 0.4 - bar);
    if (at && at.classList.contains('pvcol') && !$('#app').classList.contains('pvrow')) return Math.max(80, $('#side').clientHeight * 0.25 - bar);
    return Infinity;
  }
  function drawPreview() {
    const host = pvHost;
    const R = window.RunSheetPlayersRender;
    if (!host || !R || !pvbox.isConnected || !L.pv || !host.clientWidth) return;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const view = G.view || { campaign: G.model.campaign, layout: 'none', panels: [] };
    let w = Math.max(200, Math.floor(host.clientWidth / PV_SCALE));
    const cap = pvCap();
    if ((w * 9 * PV_SCALE) / 16 > cap) w = Math.max(200, Math.floor((cap / PV_SCALE) * 16 / 9));
    const hgt = Math.round((w * 9) / 16);
    const armedId = G.ui.armed && Date.now() - G.ui.armed.at <= 3000 ? G.ui.armed.id : '';
    const key = JSON.stringify([view, w, armedId]);
    if (key === pvKey) return;
    pvKey = key;
    host.style.height = `${Math.round(hgt * PV_SCALE)}px`;
    root.innerHTML = `<link rel="stylesheet" href="/players/players.css"><style>${PV_CSS}</style><div class="pvbox" style="width:${w}px;height:${hgt}px">${R.renderPlayers(view)}</div>`;
    // a ✕ on each person, when the panel's people line up with the state's (else the view is a step behind)
    const gs = groups();
    const panels = root.querySelectorAll('.panel');
    if (panels.length !== gs.length) return;
    gs.forEach((g, i) => {
      const notes = panelPeople(g.key);
      const tiles = panels[i].querySelectorAll('.ppl .tile');
      if (tiles.length !== notes.length) return;
      tiles.forEach((t, j) => {
        const id = `unshow:${g.key}|${notes[j]}`;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `x${armedId === id ? ' arm' : ''}`;
        b.textContent = '✕';
        b.title = armedId === id ? 'Sure? click again' : 'Take off the players\' screen';
        b.dataset.unshow = notes[j];
        b.dataset.group = g.key;
        b.dataset.arm = id;
        t.appendChild(b);
      });
    });
    if (!root.__wired) {
      root.__wired = true;
      root.addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('button.x');
        if (b) unshow(b.dataset.arm, b.dataset.group, b.dataset.unshow);
      });
    }
  }
  async function loadView() {
    const ticket = ++G.viewTicket;
    let v;
    try { v = await getJson('/api/players/view'); } catch (e) { return; } // the last view stays; the GM stream says why
    if (ticket !== G.viewTicket) return;
    G.view = v;
    if (G.model && G.state) drawPreview();
    probe();
  }

  // ------------------------------------------------------------------ the drawer
  async function openNote(p) {
    let n;
    try { n = await getJson(`/api/note?path=${encodeURIComponent(p)}`); } catch (e) {
      showDrawer(`<div class="dh"><h2>${esc(stem(p))}</h2><button id="closeDrawer" type="button">Close ✕</button></div><p class="warn">That note could not be opened (${esc(e.message)}).</p>`);
      return;
    }
    G.drawerNote = n;
    showDrawer(`<div class="dh"><div><div class="ty">${esc(n.type)}${n.withheld ? ' · withheld from players' : ''}</div><h2>${esc(n.name)}</h2></div><span class="dbtns"><span id="dshow"></span><button id="closeDrawer" type="button">Close ✕</button></span></div>${n.portrait ? `<img class="big" src="${esc(picUrl(n.portrait))}" alt="">` : ''}<div class="body">${n.html || ''}</div>`);
    drawerShow();
  }
  // The drawer's Show: a person to the focused group's panel; a place, or a map the player site would
  // publish, behind it. A GM map, a scene or anything else has none.
  function drawerShow() {
    const slot = $('#dshow');
    const n = G.drawerNote;
    if (!slot || !n || !$('#drawer').classList.contains('open')) return;
    const group = focusedGroup();
    const p = n.path;
    let h = '';
    const isPlace = String(n.type || '').toLowerCase() === 'location';
    if (showableMaps().includes(p) || isPlace) {
      h = backdropBtn(p, group, 'data-dshow');
      // any place in the vault, not only the Plan's: a part's buttons for it (Fight here)
      if (isPlace && (G.model.placeKeys || {})[p]) h += parts.map((x) => (x.placeButtons && x.placeButtons(p)) || '').join('');
    } else if (showablePerson(p)) {
      const on = group && panelOf(group).people.includes(p);
      h = on ? armBtn(`unshow:${group}|${p}`, 'Remove from panel', `data-unshow="${esc(p)}" data-group="${esc(group)}"`, `Take ${n.name} off the players' screen`)
        : (group ? `<button type="button" data-dshow="${esc(p)}" data-group="${esc(group)}" title="Show on the players' screen (${esc(groupLabel(group))})">Show</button>` : '');
    }
    slot.innerHTML = h;
  }
  function openWarnings() {
    const list = G.model.warnings || [];
    showDrawer(`<div class="dh"><h2>Prep notes</h2><button id="closeDrawer" type="button">Close ✕</button></div><p class="note">What the reader found missing. Nothing here stops the sheet.</p><ul>${list.map((w) => `<li>${w.note ? `${link(w.note)}: ` : ''}${esc(w.text)}</li>`).join('') || '<li>None.</li>'}</ul>`);
  }
  function showDrawer(html) {
    const dr = $('#drawer');
    dr.innerHTML = html;
    decorate(dr);
    dr.classList.add('open');
    dr.scrollTop = 0;
    dr.focus({ preventScroll: true });
  }
  const closeDrawer = () => { $('#drawer').classList.remove('open'); G.drawerNote = null; };

  // ------------------------------------------------------------------ actions from the page
  const beatOfKey = (key) => D().beats.find((b) => b.key === key) || null;
  const titleOfKey = (key) => { const b = beatOfKey(key); return b ? b.title : ''; };

  function jot(beat, text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (beat) G.ui.focus = beat;
    act({ type: 'jot', beat: beat || null, text: t, title: beat ? titleOfKey(beat) : undefined });
  }

  function bring(beat, p) {
    const b = beatOfKey(beat);
    if (!b || !p) return;
    G.ui.hits[beat] = [];
    const box = document.querySelector(`input[data-bring="${CSS.escape(beat)}"]`);
    if (box) box.value = '';
    if ((b.who || []).some((w) => w.note === p)) { update(); return; }
    act({ type: 'bring', beat, note: p, name: nameOf(p), title: b.title });
  }

  // Taking something off: the first click arms, a second within 3 s does it.
  function armed(id, then) {
    const r = RS.armClick(G.ui.armed, id, Date.now());
    G.ui.armed = r.armed;
    if (r.fire) { then(); return; }
    update();
    setTimeout(() => { if (G.ui.armed && G.ui.armed.id === id && Date.now() - G.ui.armed.at > 3000) { G.ui.armed = null; update(); } }, 3100);
  }

  function unshow(id, group, note) {
    armed(id, () => act({ type: 'show', group, note, on: false }));
  }
  function openPlayers() { window.open('/players', 'run-sheet-players'); }

  // A jump (the rail, End of night). In a fight it goes in the right pane: to the fight's beat, the whole beat;
  // to anything the cut does not hold, the whole sheet; a folded pane opens. One column (a narrow window): the
  // page scrolls to it instead.
  function goTo(id) {
    if (G.pane) {
      const sheet = $('#sheet');
      const here = document.getElementById(id);
      if (!here || !sheet.contains(here)) G.ui.pane = id === `beat:${G.pane.beat}` ? 'beat' : 'whole';
      openPane();
      update();
      const el = document.getElementById(id);
      if (el && sheet.contains(el) && fightLayout()) {
        const bar = sheet.querySelector('.rbar');
        sheet.scrollTop += el.getBoundingClientRect().top - sheet.getBoundingClientRect().top - (bar ? bar.offsetHeight : 0) - 8;
      } else if (el) el.scrollIntoView({ block: 'start' });
      probe();
      return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'start' });
  }

  // ------------------------------------------------------------------ the fight's layout (plan 6a Task 10)
  // In a fight the page is four columns: the rail | the order and the acting panel | the grip | the right pane.
  // The GM's choices are kept in this browser (`localStorage['rs:layout']`): the rail folded out of a fight and in
  // one (two flags: out of a fight the rail holds the PCs' faces and the Off-screen buttons), the pane folded, its
  // width, the preview open. A page that can keep nothing still works. When the columns cannot fit at their
  // least, the page folds for that window size by itself, the rail first, then the pane (`L.auto`, never kept);
  // a GM click that opens an auto-folded column holds until the next resize (ruling R5).
  const LKEY = 'rs:layout';
  const RAIL_W = 220;
  const RAIL_FOLDED = 28;
  const GRIP_W = 12;
  const RIGHT_MIN = 320;
  const RIGHT_DEF = 600;
  const PANE_LEAST = 260; // a pane the GM opened where 320 px will not fit gets what is left, down to this
  const PANE_FOLDED = 40;
  const ORDER_FLOOR = 560;
  const ORDER_CAP = 860; // the order's width once the acting panel sits beside it
  // The acting panel's working width: it goes beside the order once the middle holds the order's least width and
  // this (review F10; final review P4.6, which replaced a fixed 1,200 px), and keeps at least this beside it.
  const ACT_W = 420;
  const PV_BESIDE = 0.36; // the preview's share of the middle when the pane is folded, at least 300 px, less if the order needs it
  const PV_BESIDE_MIN = 300;
  const GRIP_TRAVEL = 120; // the grip hides with less travel than this
  const NARROW = 1000; // at this width and under, one column (gm.css)
  const L = (() => {
    const out = { railFolded: false, railFoldedFight: false, folded: false, rw: null, pv: false };
    try {
      const v = JSON.parse(window.localStorage.getItem(LKEY));
      if (v && typeof v === 'object') {
        for (const k of ['railFolded', 'railFoldedFight', 'folded', 'pv']) if (typeof v[k] === 'boolean') out[k] = v[k];
        if (typeof v.rw === 'number' && Number.isFinite(v.rw)) out.rw = v.rw;
      }
    } catch (e) { /* nothing kept, or no storage */ }
    out.auto = { rail: false, pane: false };
    return out;
  })();
  // `opened`: a GM click opened an auto-folded column (and `paneW`, the width that pane got where 320 px did not
  // fit); `held`: the folds the page made, which last until the next window resize, whatever the GM does with
  // the other column (ruling R5, fix round 1). Opening a column by hand lets its own fold go.
  const opened = { rail: false, pane: false, paneW: null };
  const held = { rail: false, pane: false };
  const forget = () => { opened.rail = false; opened.pane = false; opened.paneW = null; held.rail = false; held.pane = false; };
  function saveLayout() {
    try { window.localStorage.setItem(LKEY, JSON.stringify({ railFolded: L.railFolded, railFoldedFight: L.railFoldedFight, folded: L.folded, rw: L.rw, pv: L.pv })); } catch (e) { /* not kept */ }
  }
  G.lay = { rail: false, pane: false };
  G.om = ORDER_FLOOR;
  const fightLayout = () => Boolean(G.pane) && window.innerWidth > NARROW;
  // The order's least width: its widest row with every item as tight as it goes (a chip at its 2.4 rem, the name
  // whole up to 14 rem), plus the order box's padding, the scroll box's gutter and the column's border. Never under 560.
  function orderMin(d) {
    const ol = document.querySelector('#side ol.to');
    const fo = ol && ol.closest('.fo');
    if (!ol || !fo) return ORDER_FLOOR;
    ol.classList.add('measure');
    // the rows a part measures with as well (gm-fight.js measureRows: a row with every figure), taken out again below
    const extra = [];
    for (const part of parts) {
      for (const html of (part.measureRows && part.measureRows(d)) || []) {
        const t = document.createElement('template');
        t.innerHTML = String(html).trim();
        const li = t.content.firstElementChild;
        if (li) { li.setAttribute('aria-hidden', 'true'); ol.appendChild(li); extra.push(li); }
      }
    }
    let row = 0;
    // a row's second line (statuses that do not fit, a box's words) is never measured: it wraps
    // a name longer than its 6 rem least keeps its whole width (up to 14 rem) as its least, so a font wider than a
    // Mac's never cuts it: the row's other items shrink first
    // (a part may set its own: CoC's 11 rem, Task 38 fix round)
    const rem = parts.map((part) => part.nameCap && part.nameCap(d)).find((x) => typeof x === 'number' && x > 0) || 14;
    const cap = rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
    for (const nm of ol.querySelectorAll(':scope > li > .nm')) {
      nm.style.minWidth = '';
      if (nm.scrollWidth > nm.clientWidth + 1) nm.style.minWidth = `${Math.ceil(Math.min(nm.scrollWidth, cap))}px`;
    }
    for (const li of ol.children) if (li.dataset.row2 === undefined) row = Math.max(row, li.scrollWidth + li.offsetWidth - li.clientWidth);
    for (const li of extra) li.remove();
    ol.classList.remove('measure');
    const side = $('#side');
    const round = fo.offsetWidth - ol.clientWidth + (side.offsetWidth - side.clientWidth);
    return Math.max(ORDER_FLOOR, Math.ceil(row + round));
  }
  const railW = () => (G.lay.rail ? RAIL_FOLDED : RAIL_W);
  const appW = () => ($('#app') || {}).clientWidth || window.innerWidth;
  // The room the right pane has: from its 320 px least to what leaves the order its least.
  function rightRoom() {
    const max = Math.max(PANE_LEAST, appW() - railW() - GRIP_W - G.om);
    return { min: Math.min(RIGHT_MIN, max), max };
  }
  // The right pane's width: the GM's (or the default, room to drag both ways), kept inside the room.
  function rightWidth(want) {
    const room = rightRoom();
    const def = Math.max(room.min, Math.min(RIGHT_DEF, room.max - 80));
    const w = want != null ? want : L.rw != null ? L.rw : def;
    return Math.round(Math.max(room.min, Math.min(room.max, w)));
  }
  // The folds, the widths and where the preview sits, from the GM's choices and the room there is.
  function applyLayout() {
    const app = $('#app');
    if (!app || !G.state) return;
    const fight = fightLayout();
    const narrow = window.innerWidth <= NARROW;
    let rail = !narrow && (G.pane ? L.railFoldedFight : L.railFolded);
    let pane = fight && L.folded;
    L.auto = { rail: false, pane: false };
    if (!fight) { held.rail = false; held.pane = false; }
    if (fight) {
      const w = appW();
      if (held.rail && !rail && !opened.rail) { rail = true; L.auto.rail = true; }
      if (held.pane && !pane && !opened.pane) { pane = true; L.auto.pane = true; }
      const need = () => (rail ? RAIL_FOLDED : RAIL_W) + G.om + (pane ? PANE_FOLDED : GRIP_W + (opened.pane ? PANE_LEAST : RIGHT_MIN));
      if (need() > w && !rail && !opened.rail) { rail = true; L.auto.rail = true; }
      if (need() > w && !pane && !opened.pane) { pane = true; L.auto.pane = true; }
      // a column the GM opened yields too when the order would still be short: no row is ever clipped
      if (need() > w && !pane) { pane = true; L.auto.pane = true; }
      if (need() > w && !rail) { rail = true; L.auto.rail = true; }
      held.rail = held.rail || L.auto.rail;
      held.pane = held.pane || L.auto.pane;
    }
    G.lay = { rail, pane };
    const strip = $('#railOpen');
    if (strip) strip.title = fight && L.auto.rail && opened.rail ? 'No room to open the run list beside the fight at this width: widen the window' : 'Open the run list';
    app.classList.toggle('railf', rail);
    app.classList.toggle('panef', pane);
    const grip = $('#grip');
    let pvAt = null;
    let pvRow = false;
    if (fight) {
      const room = rightRoom();
      const showGrip = !pane && room.max - room.min >= GRIP_TRAVEL;
      let rw = pane ? PANE_FOLDED : rightWidth();
      // a pane the GM opened where 320 px will not fit keeps the width it got until a resize (narrower only if the
      // order needs it: no row is ever clipped)
      if (!pane && opened.pane && room.max < RIGHT_MIN) {
        if (opened.paneW == null) opened.paneW = rw;
        rw = Math.min(opened.paneW, room.max);
      }
      const gw = showGrip ? GRIP_W : 0;
      const mid = appW() - railW() - gw - rw;
      const side = $('#side');
      const border = side.offsetWidth - side.clientWidth;
      let pvw = 0;
      if (pane && L.pv) {
        // its share of the middle, narrowed (to 300 px at least) to leave the order its room beside it
        pvw = Math.round(Math.max(PV_BESIDE_MIN, Math.min(mid * PV_BESIDE, mid - G.om)));
        pvRow = mid - pvw >= G.om; // else the preview goes above the order, which keeps its room
      }
      const fv = mid - border - (pvRow ? pvw : 0);
      const ordMin = G.om - border;
      const beside = fv >= ordMin + ACT_W;
      app.classList.toggle('nogrip', !showGrip);
      app.classList.toggle('beside', beside);
      app.classList.toggle('pvrow', pvRow);
      app.style.setProperty('--rw', `${rw}px`);
      app.style.setProperty('--gripw', `${gw}px`);
      app.style.setProperty('--ordw', `${beside ? Math.max(ordMin, Math.min(ORDER_CAP, fv - ACT_W)) : fv}px`);
      app.style.setProperty('--pvw', `${pvw}px`);
      if (grip) grip.title = `Drag to resize: the pane ${room.min}-${room.max} px at this width · double-click to reset`;
      if (L.pv) {
        if (!pane) pvAt = $('#sheet');
        else {
          let col = side.querySelector('.pvcol');
          if (!col) { col = document.createElement('div'); col.className = 'pvcol'; }
          if (pvRow) side.appendChild(col); else side.insertBefore(col, side.firstChild);
          pvAt = col;
        }
      }
    } else {
      for (const c of ['nogrip', 'beside', 'pvrow']) app.classList.remove(c);
      // one column in a fight: the preview tops the pane, as on a wide window
      pvAt = G.pane ? (L.pv ? $('#sheet') : null) : $('#side');
    }
    if (pvAt) {
      const bar = pvAt.id === 'sheet' ? pvAt.querySelector('.rbar') : null;
      // the open preview stays under the pane's bar while the pane scrolls, Hide with it (fix round 1, M4)
      if (bar) pvAt.style.setProperty('--rbarh', `${bar.offsetHeight}px`);
      const before = bar ? bar.nextSibling : pvAt.firstChild;
      if (pvbox.parentElement !== pvAt || (bar && bar.nextSibling !== pvbox) || (!bar && pvAt.firstChild !== pvbox)) pvAt.insertBefore(pvbox, before);
    } else if (pvbox.parentElement) pvbox.remove();
    pvbox.classList.toggle('open', L.pv);
    const tg = pvbox.querySelector('#pvToggle');
    tg.textContent = L.pv ? 'Hide ▾' : 'Show ▸';
    tg.setAttribute('aria-expanded', String(L.pv));
    tg.title = L.pv ? 'Fold the preview away' : 'Show the preview of the players\' screen';
    drawPreview();
    for (const part of parts) if (part.afterLayout) part.afterLayout();
    probe();
  }
  // The pane brought to its top (Fight, Resume, Back to the fight's beat, Players' screen ▸: review F3).
  // True when the pane is its own column, so there was a pane to scroll.
  function paneTop() {
    if (!fightLayout()) return false;
    $('#sheet').scrollTop = 0;
    if (window.scrollY) window.scrollTo(0, 0);
    return true;
  }
  function openPane() {
    if (!G.lay.pane) return;
    if (L.folded) { L.folded = false; saveLayout(); }
    if (L.auto.pane) { opened.pane = true; opened.paneW = null; opened.rail = false; held.pane = false; }
  }
  function foldClick(id) {
    const fightNow = Boolean(G.pane);
    if (id === 'railFold') {
      if (fightNow) L.railFoldedFight = true; else L.railFolded = true;
      opened.rail = false;
    } else if (id === 'railOpen') {
      if (fightNow) L.railFoldedFight = false; else L.railFolded = false;
      // the last column opened wins: the other one folds again if the room is short
      if (L.auto.rail) { opened.rail = true; opened.pane = false; held.rail = false; }
    } else if (id === 'paneFold') { L.folded = true; opened.pane = false; } else if (id === 'paneOpen') openPane();
    saveLayout();
    update();
  }
  function layoutProbe() {
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const r = (v) => (v == null ? null : Math.round(v));
    const g = box($('#grip'));
    const gripShown = Boolean(g) && g.width > 0 && getComputedStyle($('#grip')).visibility !== 'hidden';
    const pv = L.pv && pvbox.isConnected ? box(pvbox) : null;
    const room = fightLayout() ? rightRoom() : null;
    return {
      grip: { left: r(g && g.left), width: r(g && g.width), shown: gripShown },
      railW: r(box($('#rail')).width), sheetW: r(box($('#sheet')).width), sideW: r(box($('#side')).width),
      folded: G.lay.pane, railFolded: G.lay.rail, auto: { ...L.auto }, saved: { railFolded: L.railFolded, railFoldedFight: L.railFoldedFight, folded: L.folded, rw: L.rw, pv: L.pv },
      pvOpen: Boolean(pv), pvTop: r(pv && pv.top), pvBottom: r(pv && pv.bottom), pvIn: pv ? (pvbox.parentElement.id || pvbox.parentElement.className) : null,
      paneTop: r($('#sheet').scrollTop), paneBox: (() => { const b = box($('#sheet')); return { top: r(b.top), bottom: r(b.bottom), left: r(b.left), right: r(b.right) }; })(),
      orderMin: G.om, gripMoves: G.gripMoves || 0, room, beside: $('#app').classList.contains('beside'), scrollY: r(window.scrollY),
    };
  }
  // The grip: drag to resize, double-click to reset; it listens on the document (pointer and mouse both), so a
  // drag never depends on pointer capture or on the pointer staying over a 12 px strip.
  (() => {
    const grip = $('#grip');
    if (!grip) return;
    let on = false;
    let startX = 0;
    let startW = 0;
    let via = null; // 'pointer' or 'mouse': a pointer drag ignores the mouse events the browser also sends
    const begin = (x) => { on = true; startX = x; startW = rightWidth(); grip.classList.add('drag'); document.body.classList.add('dragging'); };
    const move = (x) => {
      if (!on) return;
      G.gripMoves = (G.gripMoves || 0) + 1;
      L.rw = rightWidth(startW + (startX - x));
      applyLayout();
      const room = rightRoom();
      grip.classList.toggle('limit', L.rw <= room.min || L.rw >= room.max);
    };
    const stop = () => { if (!on) return; on = false; via = null; grip.classList.remove('drag', 'limit'); document.body.classList.remove('dragging'); saveLayout(); probe(); };
    grip.addEventListener('pointerdown', (ev) => { if (ev.button !== 0) return; ev.preventDefault(); via = 'pointer'; begin(ev.clientX); });
    grip.addEventListener('mousedown', (ev) => { if (ev.button !== 0 || on) return; ev.preventDefault(); via = 'mouse'; begin(ev.clientX); });
    document.addEventListener('pointermove', (ev) => { if (via === 'pointer') move(ev.clientX); });
    document.addEventListener('mousemove', (ev) => { if (via === 'mouse') move(ev.clientX); });
    document.addEventListener('pointerup', () => { if (via === 'pointer') stop(); });
    document.addEventListener('mouseup', () => { if (via === 'mouse') stop(); });
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    grip.addEventListener('dblclick', () => { L.rw = null; saveLayout(); applyLayout(); });
  })();
  window.addEventListener('resize', () => {
    forget();
    if (G.model && G.state) applyLayout();
  });
  if (PROBE) {
    let queued = false;
    document.addEventListener('scroll', () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; probe(); }); }, true);
  }

  // ------------------------------------------------------------------ side colours (plan 6a Task 9)
  // The colours are a vault setting: the model carries them, `POST /api/settings/side-colours` writes them, and
  // the server tells every GM window (`side-colours`). When a save fails the page paints the choice anyway and
  // keeps it in this browser with a quiet note; `sideKept` holds that choice. Its key names the vault's campaign
  // and the session's state (`rs:sideColours:<campaign>:<stateId>`, final review O10): the run sheet's one port
  // serves every vault, and one vault's kept colours must never paint another's.
  const SIDEKEY = 'rs:sideColours';
  let keptKey = null;
  const sideKeyNow = () => (G.model && G.stateId ? `${SIDEKEY}:${G.model.campaign || ''}:${G.stateId}` : null);
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const SIDE_WORDS = { pc: 'Party', ally: 'Ally', foe: 'Foe', neutral: 'Neutral' };
  function readChoice(raw) {
    if (!raw || typeof raw !== 'object' || !(raw.preset === 'own' || SIDE_PRESETS[raw.preset])) return null;
    const own = {};
    for (const n of SIDE_NAMES) if (raw.own && HEX6.test(String(raw.own[n]))) own[n] = String(raw.own[n]).toLowerCase();
    return { preset: raw.preset, own };
  }
  // `sideTrying` is a choice being saved (painted at once); `sideKept` is one the vault could not take:
  // { choice, base, why }, `base` being the model's colours when the save failed. It is kept in this browser, and
  // it holds only while the vault still says what it said then: a vault that changed since wins.
  let sideTrying = null;
  let sideKept = null;
  let saveSeq = 0;
  const baseOf = (colours) => JSON.stringify(colours || null);
  // The choice kept for this vault and session, read once their key is known (and again when it changes): it holds
  // only while the vault still says what it said when the save failed.
  function loadKept() {
    const key = sideKeyNow();
    if (key === keptKey) return;
    keptKey = key;
    sideKept = null;
    if (!key) return;
    try {
      const k = JSON.parse(localStorage.getItem(key));
      const choice = k && readChoice(k.choice);
      if (choice && typeof k.base === 'string') sideKept = { choice, base: k.base, why: String(k.why || 'the vault could not be reached') };
    } catch (e) { /* no storage, or nothing kept */ }
    if (sideKept && sideKept.base !== baseOf(G.model.sideColours)) dropKept();
  }
  function dropKept() {
    sideKept = null;
    try { if (keptKey) localStorage.removeItem(keptKey); } catch (e) { /* no storage */ }
  }
  // the kept choice counts only once a model has arrived to compare with
  const sideChoice = () => sideTrying || (sideKept && G.model ? sideKept.choice : null) || readChoice(G.model && G.model.sideColours) || { preset: 'pens', own: {} };
  const darkNow = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && Boolean(window.matchMedia) && matchMedia('(prefers-color-scheme: dark)').matches);
  const swatchHTML = (choice) => `<span class="sws" aria-hidden="true">${swatches(choice, darkNow() ? 'dark' : 'light').map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
  function menuHTML() {
    const opt = (value, label, choice) => `<label class="copt"><input type="radio" name="scp" value="${value}"> ${swatchHTML(choice)} <span>${label}</span></label>`;
    const own = sideChoice();
    return `${opt('pens', 'Pens', { preset: 'pens' })}${opt('colour_blind', 'Colour-blind safe', { preset: 'colour_blind' })}${opt('own', 'My own', { preset: 'own', own: own.own })}`
      + `<div class="cown">${SIDE_NAMES.map((n) => `<label>${SIDE_WORDS[n]} <input type="color" data-scown="${n}" aria-label="${SIDE_WORDS[n]} colour"></label>`).join('')}</div>`
      + '<p class="muted cnote">My own is one set of colours, used in light and dark.</p>';
  }
  function applySides() {
    const choice = sideChoice();
    let el = document.getElementById('sideVars');
    if (!el) { el = document.createElement('style'); el.id = 'sideVars'; document.head.appendChild(el); }
    el.textContent = sideCss(choice);
    const btn = document.getElementById('coloursBtn');
    if (btn) {
      const kept = Boolean(sideKept && G.model && !sideTrying);
      const title = kept ? `Showing your choice, not the vault's (not saved: ${sideKept.why})` : 'The colours of the sides in a fight';
      btn.innerHTML = `Colours${kept ? ' <span class="keptmark" aria-hidden="true">●</span>' : ''}`;
      btn.title = title;
      if (kept) btn.setAttribute('aria-label', `Colours. ${title}`); else btn.removeAttribute('aria-label');
    }
    const menu = document.getElementById('coloursMenu');
    if (!menu) return;
    if (!menu.dataset.built) { menu.innerHTML = menuHTML(); menu.dataset.built = '1'; }
    const own = swatches({ preset: 'own', own: choice.own }, 'light');
    menu.querySelectorAll('input[name="scp"]').forEach((r) => { r.checked = r.value === choice.preset; });
    menu.querySelectorAll('input[data-scown]').forEach((p) => { p.value = own[SIDE_NAMES.indexOf(p.dataset.scown)]; });
    menu.querySelectorAll('.copt').forEach((l) => {
      const v = l.querySelector('input').value;
      l.querySelector('.sws').outerHTML = swatchHTML(v === 'own' ? { preset: 'own', own: choice.own } : { preset: v });
    });
  }
  // Each save has a number: only the latest one's answer repaints or settles the kept choice (two quick changes
  // can answer out of order).
  async function saveSides(choice) {
    const mine = ++saveSeq;
    sideTrying = choice; // painted at once, kept only if the vault cannot take it
    applySides();
    let why = null;
    try {
      const res = await fetch('/api/settings/side-colours', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: choice.preset, own: choice.own }) });
      let body = null;
      try { body = await res.json(); } catch (e) { /* not JSON */ }
      if (res.ok) {
        if (mine !== saveSeq) return;
        const got = readChoice(body && body.sideColours);
        if (got && G.model) G.model.sideColours = got;
        sideTrying = null;
        dropKept();
        applySides();
        if (body && body.note) note(String(body.note), { id: `sc:${body.note}` });
        return;
      }
      why = (body && body.error) || `the server answered ${res.status}`;
    } catch (e) { why = `the server did not answer (${e.message})`; }
    if (mine !== saveSeq) return;
    sideTrying = null;
    loadKept();
    sideKept = { choice, base: baseOf(G.model && G.model.sideColours), why };
    try { if (keptKey) localStorage.setItem(keptKey, JSON.stringify(sideKept)); } catch (e) { /* no storage */ }
    applySides();
    note(`The colours could not be saved to the vault: ${why}. They stay as you chose on this browser.`, { kind: 'bad', id: `sc:${why}` });
  }
  // the machine's light or dark scheme can flip while the page is open: redraw the swatches
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', () => applySides());
  }
  const menuEl = () => document.getElementById('coloursMenu');
  function menuOpen(on) {
    const m = menuEl(); const b = document.getElementById('coloursBtn');
    if (!m || !b) return;
    m.hidden = !on;
    b.setAttribute('aria-expanded', String(on));
  }
  const menuIsOpen = () => { const m = menuEl(); return Boolean(m) && !m.hidden; };
  // Any press outside the menu closes it, and the press goes on to do what it says (no preventDefault here).
  document.addEventListener('mousedown', (ev) => {
    if (menuIsOpen() && !ev.target.closest('#coloursMenu, #coloursBtn')) menuOpen(false);
  }, true);
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t || !t.closest || !t.closest('#coloursMenu')) return;
    const cur = sideChoice();
    if (t.name === 'scp') { saveSides({ preset: t.value, own: cur.own }); return; }
    if (t.dataset.scown) {
      const held = swatches({ preset: 'own', own: cur.own }, 'light');
      const own = Object.fromEntries(SIDE_NAMES.map((n, i) => [n, n === t.dataset.scown ? t.value.toLowerCase() : held[i]]));
      saveSides({ preset: 'own', own });
    }
  });

  document.addEventListener('click', (ev) => {
    for (const part of parts) if (part.click && part.click(ev)) return;
    const t = ev.target.closest('button,a[data-note],a[data-go],[data-go],a[data-pgroup],a[data-pane]');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (t.id === 'playersBtn' || t.id === 'playersBtn2') { openPlayers(); return; }
    if (t.id === 'railFold' || t.id === 'railOpen' || t.id === 'paneFold' || t.id === 'paneOpen') { foldClick(t.id); return; }
    if (t.id === 'pvToggle' || t.id === 'fPvShow') {
      L.pv = t.id === 'fPvShow' ? true : !L.pv;
      saveLayout();
      update();
      if (L.pv && G.pane) paneTop();
      probe();
      return;
    }
    if (d.pane) { G.ui.pane = d.pane; update(); paneTop(); probe(); return; }
    if (d.pgroup) { touch(d.pgroup); update(); return; }
    if (t.id === 'coloursBtn') { menuOpen(!menuIsOpen()); return; }
    if (t.id === 'closeDrawer') { closeDrawer(); return; }
    if (t.id === 'warnBtn') { openWarnings(); return; }
    if (t.id === 'endBtn') { goTo('end'); return; }
    if (d.dismiss) { G.notes = G.notes.filter((n) => n.id !== d.dismiss); renderNotes(); return; }
    if (d.note && t.tagName === 'A') { openNote(d.note); return; }
    if (d.go) { goTo(d.go); if (d.go.startsWith('beat:')) { G.ui.focus = d.go.slice(5); jotLabel(); } return; }
    if (d.arm) {
      const id = d.arm;
      if (d.unjot) armed(id, () => act({ type: 'unjot', jot: d.unjot }));
      else if (d.unbring) armed(id, () => act({ type: 'unbring', beat: d.beat, note: d.unbring, title: titleOfKey(d.beat) }));
      else if (d.unimpro) armed(id, () => act({ type: 'unimprovise', key: d.unimpro }));
      else if (d.unplace) armed(id, () => act({ type: 'unplace', key: d.unplace }));
      else if (d.unshow) unshow(id, d.group, d.unshow);
      return;
    }
    if (d.showbeat !== undefined) {
      const b = beatOfKey(d.showbeat);
      if (!b || !d.group) return;
      const spot = d.spot ? (b.spots || []).find((x) => x.key === d.spot) : null;
      const people = (b.who || []).map((w) => w.note).filter((p) => showablePerson(p));
      const place = (spot ? spot.note : b.place) || undefined;
      touch(d.group);
      act({ type: 'showBeat', group: d.group, people, place });
      return;
    }
    if (d.placeoff) { act({ type: 'placeOff', group: d.placeoff, on: !panelOf(d.placeoff).placeOff }); return; }
    if (d.show) { touch(d.group); act({ type: 'show', group: d.group, note: d.show, on: true }); return; }
    if (d.dshow || d.mapshow) {
      const p = d.dshow || d.mapshow;
      touch(d.group);
      if (showablePerson(p)) act({ type: 'show', group: d.group, note: p, on: true });
      else act({ type: 'backdrop', group: d.group, note: panelOf(d.group).backdrop === p ? null : p });
      return;
    }
    if (d.unback) { act({ type: 'backdrop', group: d.unback, note: null }); return; }
    if (d.movepick) { moveGroup(d.moveg, { note: d.movepick }); return; }
    if (d.movenew !== undefined) { moveGroup(d.moveg, { name: d.movenew }); return; }
    if (d.move) { const to = JSON.parse(d.to); G.ui.focus = to.beat; touch(to.spot || to.beat); act({ type: 'move', pc: d.move, to }); return; }
    if (d.all) { const to = JSON.parse(d.all); G.ui.focus = to.beat; touch(to.spot || to.beat); act({ type: 'moveAll', pcs: pcs().map((p) => p.note), to }); return; }
    if (d.off) { act({ type: 'move', pc: d.off, to: 'off' }); return; }
    if (d.pt) {
      const b = beatOfKey(d.beat);
      const p = b && b.points.find((x) => x.key === d.pt);
      const cur = G.state.points[d.pt] && G.state.points[d.pt].mark;
      G.ui.focus = d.beat;
      act({ type: 'mark', point: d.pt, mark: RS.cyclePoint(cur), beat: d.beat, beatTitle: b ? b.title : '', text: p ? p.text : '' });
      return;
    }
    if (d.hand) {
      const x = (G.model.handouts || []).find((h) => h.key === d.hand);
      act({ type: 'handOver', handout: d.hand, on: !G.state.handouts[d.hand], text: x ? (x.text || stem(x.note) || x.name) : '', name: x ? RS.handoutName(x) : '', note: x ? x.note : null });
      return;
    }
    if (d.fire) { G.ui.focus = d.fire; act({ type: 'fire', beat: d.fire, on: !G.state.fired[d.fire], title: titleOfKey(d.fire) }); return; }
    if (d.stop) {
      const on = G.state.stopped && G.state.stopped.beat === d.stop;
      act(on ? { type: 'stop' } : { type: 'stop', beat: d.stop, title: titleOfKey(d.stop) });
      return;
    }
    if (d.unmask) {
      const um = unmaskOf(d.unmask);
      if (!um) return;
      const on = isUnmasked(D(), d.unmask);
      act({ type: 'unmask', note: d.unmask, on: !on, name: um.name, was: nameOf(d.unmask), beat: d.beat || null, title: d.beat ? titleOfKey(d.beat) : undefined });
      return;
    }
    if (d.bringin) { bring(d.beat, d.bringin); return; }
    if (d.pick) { bring(d.beat, d.pick); return; }
    if (d.attach) {
      const sel = document.querySelector(`[data-orphan="${CSS.escape(d.attach)}"]`);
      if (!sel || !sel.value) { if (sel) sel.focus(); return; }
      act({ type: 'attach', from: d.attach, to: sel.value });
      return;
    }
    if (t.id === 'addBeat') { addBeat(); return; }
    if (t.id === 'longRest') { act({ type: 'longRest', on: !G.state.end.longRest }); return; }
    if (t.id === 'copyRecord') { copyRecord(); }
  });

  function addBeat() {
    const el = $('#newBeat');
    const title = el ? el.value.trim() : '';
    if (!title) { if (el) el.focus(); return; }
    el.value = '';
    const seqBefore = G.seq;
    act({ type: 'improvise', title });
    const key = `i-${G.clientId}-${seqBefore + 1}`;
    G.ui.focus = key;
    goTo(`beat:${key}`);
  }

  async function copyRecord() {
    try {
      const r = await getJson('/api/record');
      G.ui.record = r.text || '';
    } catch (e) { G.ui.copyMsg = `The record could not be read (${e.message}).`; update(); return; }
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(G.ui.record); ok = true; } } catch (e) { ok = false; }
    G.ui.copyMsg = ok ? 'Copied.' : 'Copy failed: select the text below.';
    update();
  }

  document.addEventListener('toggle', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLDetailsElement)) return;
    if (el.dataset.ra) mem.set(`ra:${el.dataset.ra}`, el.open ? null : 'closed');
    if (el.dataset.fold) mem.set(`fold:${el.dataset.fold}`, el.open ? '1' : null);
  }, true);

  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const d = t.dataset || {};
    // a box that takes words; a list, a tick box or a button lets J through (PRENTICE's PR review 2, D2)
    const typing = t.tagName === 'TEXTAREA' || t.isContentEditable
      || (t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(t.type || ''));
    if (ev.key === 'Escape' && t.closest && t.closest('.movebox')) {
      const input = t.closest('.movebox').querySelector('input[data-movebox]');
      if (input && ((G.ui.moveHits || {})[input.dataset.movebox] || []).length) {
        closeMoveLists();
        input.focus();
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === 'Escape') { if (menuIsOpen()) { menuOpen(false); const b = document.getElementById('coloursBtn'); if (b) b.focus(); ev.preventDefault(); return; } if ($('#drawer').classList.contains('open')) { closeDrawer(); ev.preventDefault(); } return; }
    // the hit location list (GURPS, Task 25) is picked by its letters (J for Jaw): J stays in it
    const picking = t.matches && t.matches('select[data-fhlocsel]');
    if (!typing && !picking && (ev.key === 'j' || ev.key === 'J') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); $('#hjot').focus(); return; }
    // a letter on a closed status list never picks a status by the browser's type-ahead: a status is chosen, not typed
    if (t.matches && t.matches('select[data-fstatus]') && ev.key.length === 1 && ev.key !== ' ' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); return; }
    if (ev.key === 'Enter' && t.tagName === 'A' && d.note) { openNote(d.note); return; }
    if (ev.key === 'Enter' && t.tagName === 'A' && (d.go || d.pane)) { ev.preventDefault(); t.click(); return; }
    if (ev.key !== 'Enter' || ev.isComposing) return;
    if (d.jot !== undefined) { const v = t.value; t.value = ''; jot(d.jot, v); return; }
    if (t.id === 'hjot') { const fb = focusBeat(D()); const v = t.value; t.value = ''; jot(fb ? fb.key : null, v); return; }
    if (d.bring !== undefined) {
      const hits = RS.castSearch(G.model.cast || [], t.value);
      if (!hits.length) { t.setCustomValidity('No one in the vault by that name'); t.reportValidity(); return; }
      t.value = '';
      bring(d.bring, hits[0].note);
      return;
    }
    if (t.id === 'newBeat') { ev.preventDefault(); addBeat(); }
    if (d.moveg !== undefined && t.tagName === 'INPUT') {
      ev.preventDefault();
      const top = placeChoices(t.value)[0];
      if (top && !top.isNew) { moveGroup(d.moveg, { note: top.note }); return; }
      if (t.value.trim()) { t.setCustomValidity(NO_PLACE); t.reportValidity(); }
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.setCustomValidity) t.setCustomValidity('');
    if (t.dataset && t.dataset.moveg !== undefined && t.tagName === 'INPUT') {
      const id = t.dataset.movebox;
      G.ui.moveHits = G.ui.moveHits || {};
      G.ui.moveHits[id] = placeChoices(t.value);
      const box = document.querySelector(`[data-mhits="${CSS.escape(id)}"]`);
      if (box) box.innerHTML = moveHitsHTML(t.dataset.moveg, G.ui.moveHits[id]);
      placeMoveList(box);
    }
    if (t.dataset && t.dataset.bring !== undefined) {
      const beat = t.dataset.bring;
      G.ui.hits[beat] = RS.castSearch(G.model.cast || [], t.value);
      const box = document.querySelector(`[data-hits="${CSS.escape(beat)}"]`);
      if (box) box.innerHTML = hitsHTML(beat, G.ui.hits[beat]);
    }
  });

  // A note session-play filed mid-session is found at once: focusing the search reads the model again.
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!t.dataset || t.dataset.bring === undefined || Date.now() - G.modelAt < 3000) return;
    G.modelAt = Date.now();
    getJson('/api/model').then((m) => {
      G.model = m.model;
      G.tableLog = m.tableLog;
      G.tableLogOnFirst = !!m.tableLogOnFirst;
      // a name typed while the model was on its way is searched again in the new cast
      const box = document.activeElement;
      if (box && box.dataset && box.dataset.bring !== undefined && box.value) {
        const beat = box.dataset.bring;
        G.ui.hits[beat] = RS.castSearch(G.model.cast || [], box.value);
        const hits = document.querySelector(`[data-hits="${CSS.escape(beat)}"]`);
        if (hits) hits.innerHTML = hitsHTML(beat, G.ui.hits[beat]);
      }
    }).catch(() => { /* the model in hand serves */ });
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    const d = t.dataset || {};
    // the browser's change for an end-panel box a redraw removes, just sent by `update`: not twice
    if (drawing && t.matches && t.matches(COMMIT_ON_CHANGE) && d.sent !== undefined && d.sent === t.value) return;
    if (d.loot) {
      const b = beatOfKey(d.beat);
      const tr = b && b.treasure.find((x) => x.key === d.loot);
      act({ type: 'loot', item: d.loot, to: t.value || null, text: tr ? tr.text : '', note: tr ? tr.item : null, beat: d.beat, beatTitle: b ? b.title : '' });
      return;
    }
    if (d.where) {
      const v = t.value.trim();
      act({ type: 'endSet', where: { [d.where]: v === d.default ? '' : v } });
      return;
    }
    if (d.vhp || d.vkey) {
      const at = d.vkey ? d.vkey.lastIndexOf('|') : -1;
      const row = d.vhp || d.vkey.slice(0, at);
      const field = d.vhp ? 'hp' : d.vkey.slice(at + 1);
      // a typed minus sign (U+2212) is the number's minus
      const v = t.value.trim().replace(/\u2212/g, '-');
      const n = Number(v);
      const value = v === '' ? undefined : (Number.isFinite(n) ? n : v);
      const key = `${row}|${field}`;
      const why = RS.endFigureProblem(G.model, row, field, value);
      if (why) {
        const now = D().vitals.find((x) => x.rowId === row);
        G.ui.badVital[key] = { text: t.value, why, saved: now ? now[field] : undefined };
        update();
        return;
      }
      delete G.ui.badVital[key];
      act({ type: 'endSet', vitals: { [row]: { [field]: value } } });
      return;
    }
    if (d.vcond) { act({ type: 'endSet', vitals: { [d.vcond]: { conditions: t.value.trim() } } }); return; }
    if (t.id === 'advance') act({ type: 'endSet', advancement: t.value });
  });

  // A header that wraps on a narrower window is taller: the jump offset follows it.
  window.addEventListener('resize', measureTop);

  // A tab closed while clicks are still unsent (the server not answering) would lose them: the browser asks first.
  window.addEventListener('beforeunload', (ev) => {
    if (!G.pending.length) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  // ------------------------------------------------------------------ the probe (tests only)
  function probe() {
    // not before the first draw: a probe written between the model and the state said "Saved" with no beats
    if (!PROBE || !G.model || !G.state || !document.body) return;
    const beats = document.querySelectorAll('#sheet .beat').length;
    const rail = document.querySelectorAll('#rail [data-railbeat]').length;
    const out = {
      beats, rail, saved: ($('#saved') || {}).textContent || '', errors: probeErrors.slice(),
      notes: G.notes.map((n) => n.text), rev: G.rev, heardRev: G.heardRev, pending: G.pending.length, answered: G.answered.length,
      stateId: G.stateId, clientId: G.clientId,
      marked: document.querySelectorAll('#sheet .ptb.landed[data-pt]').length,
      jots: Array.from(document.querySelectorAll('#sheet ul.jots li > span:not(.tm)'), (el) => el.textContent),
      requests: { ...requests }, view: G.view, focusGroup: G.state ? focusedGroup() : null,
    };
    // one part's probe throwing must not freeze the rest: its message goes to dataset.probeError (tests only)
    for (const part of parts) {
      if (!part.probe) continue;
      try { Object.assign(out, part.probe()); } catch (e) { document.body.dataset.probeError = String((e && e.stack) || e).slice(0, 600); }
    }
    document.body.dataset.probe = JSON.stringify(out);
  }

  // ------------------------------------------------------------------ the seam
  // One dispatch path (`reduce`, a redraw, the queued write) and one render. Parts plug in here.
  window.RunSheetPage = {
    dispatch: act,
    // the id the next dispatch will carry, for actions whose rows are named after it (fightStart, fightJoin)
    nextId: () => `${G.clientId}-${G.seq + 1}`,
    model: () => G.model,
    state: () => G.state,
    derived: () => D(),
    ui: G.ui,
    render: update,
    drawing: () => drawing,
    // a press of the main button is held (its redraws wait for the release): the one press state parts read
    pressing: () => press.on,
    focusTo,
    parts,
    // helpers the parts share with the page
    esc, armBtn, armed, link, face, nameOf, getJson, focusedGroup, groups, groupLabel, note, probe, cueHTML, unmaskOf, isUnmasked,
    // the fight's layout (plan 6a Task 10)
    layout: L, rightRoom, rightWidth, orderMin: () => G.om, paneTop, layoutProbe,
    OTHER_STATUS_PLACEHOLDER, SIDE_PRESETS, sideCss, swatches,
  };

  // ------------------------------------------------------------------ start
  async function start() {
    try {
      takeModel(await getJson('/api/model'));
      const st = await getJson('/api/state');
      G.stateId = st.stateId;
      G.state = st.state;
      G.rev = st.rev;
      G.savedRev = st.rev;
    } catch (e) {
      $('#sheet').innerHTML = `<section class="s"><h2>The run sheet could not start</h2><p class="warn">${esc(e.message)}</p><p class="muted">Reload the page once the server is running.</p></section>`;
      if (PROBE) { probeErrors.push(String(e.message)); document.body.dataset.probe = JSON.stringify({ beats: 0, rail: 0, saved: '', errors: probeErrors.slice(), notes: [] }); }
      return;
    }
    if (PROBE && params.get('stateId')) G.stateId = params.get('stateId');
    loadKept();
    applySides();
    render();
    listen();
    loadView();
  }
  start();
}());
