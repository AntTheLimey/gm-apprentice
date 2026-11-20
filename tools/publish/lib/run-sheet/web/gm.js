'use strict';
// The run sheet's GM page (spec §6.3): a thin DOM layer over `RunSheetState` (web/state.js, loaded
// first). The page keeps one { model, state, rev, stateId } and every click is an action: `reduce`,
// a redraw, then a PUT. The server owns `rev`; the page never re-sends its whole state on its own.
//
// Saving (plan decision 16): one PUT in flight; actions taken meanwhile go together in the next PUT,
// built on the rev the last one returned. Each action carries an id `<clientId>-<n>`, so `reduce`
// never applies one twice. A 409 'stale' reloads the server's state and re-applies every pending
// action in order; a 409 'session' reloads and drops them. A network failure shows "Not connected"
// until the server answers again; then the page rebases its pending actions on the server's state.
// An answered action is kept (`G.sent`) until a `saved` event says its rev is on disk: a server that
// stops inside its one-second write wait loses nothing, because the page sends those actions again.
//
// Fights, dice, the players' screen and Show are step 5b: absent here, not disabled.
(function () {
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
  const randomId = () => {
    const a = new Uint8Array(4);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  };

  // ------------------------------------------------------------------ the one page state
  const G = {
    model: null, session: null, stateId: null, tableLog: null, serverId: null,
    state: null, rev: 0,
    pending: [], sent: [], inflight: false, clientId: randomId(), seq: 0, switching: false,
    down: false, putFailing: false, saveFailed: false, putRev: 0, savedRev: 0,
    retry: null, resyncTimer: null, notes: [], drafts: {},
    ui: { focus: null, armed: null, record: '', copyMsg: '', hits: {} },
    modelAt: 0,
  };

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
    G.serverId = m.serverId;
    G.modelAt = Date.now();
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

  function rebase(serverState, rev) {
    let s = serverState;
    for (const p of G.sent.concat(G.pending)) s = RS.reduce(s, p.a, p.at);
    G.state = s;
    G.rev = rev;
  }

  // Every change: reduce, redraw, send.
  function act(a) {
    if (G.switching) return; // the sheet is changing session: nothing is done to the old one
    a.id = `${G.clientId}-${++G.seq}`;
    const at = new Date().toISOString();
    G.state = RS.reduce(G.state, a, at);
    G.pending.push({ a, at });
    update();
    pump();
  }

  async function pump() {
    if (G.inflight || !G.pending.length || G.down || G.retry || G.switching) return;
    G.inflight = true;
    const sent = G.pending.length;
    indicator();
    let res;
    try {
      res = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId: G.stateId, serverId: G.serverId, base: G.rev, state: G.state, clientId: G.clientId }),
      });
    } catch (e) {
      G.inflight = false;
      lost();
      return;
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    G.inflight = false;
    if (res.ok && body && typeof body.rev === 'number') {
      G.rev = body.rev;
      G.putRev = body.rev;
      // answered, not yet on disk: kept until a `saved` event reaches this rev
      for (const p of G.pending.splice(0, sent)) G.sent.push({ ...p, rev: body.rev });
      if (G.savedRev >= body.rev) G.sent = [];
      G.putFailing = false;
      indicator();
      pump();
      return;
    }
    if (res.status === 409 && body) { await conflict(body); return; }
    G.putFailing = true;
    indicator();
    G.retry = setTimeout(() => { G.retry = null; pump(); }, 2000);
  }

  async function conflict(body) {
    if (body.reason === 'session') {
      const was = G.session ? G.session.label : 'another session';
      G.pending = [];
      G.sent = [];
      // No action until the new session's model and state are both in: one taken meanwhile would be
      // made against the old sheet and lost.
      G.switching = true;
      try {
        const m = await getJson('/api/model');
        const st = await getJson('/api/state');
        takeModel(m);
        G.stateId = st.stateId;
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
      if (st.serverId && st.serverId !== G.serverId) serverRestarted(st.serverId);
      rebase(st.state, st.rev);
    } catch (e) { lost(); return; }
    note('Another window changed the sheet; reloaded.', { id: `stale:${G.rev}` });
    update();
    pump();
  }

  // A new server (a restart): what the old one answered but had not yet written goes again, ahead of
  // anything still waiting. Its revs are the new server's from here on.
  function serverRestarted(serverId) {
    G.pending = G.sent.map(({ a, at }) => ({ a, at })).concat(G.pending);
    G.sent = [];
    G.serverId = serverId;
    G.putRev = 0;
    G.savedRev = 0;
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
    if (st.serverId && st.serverId !== G.serverId) serverRestarted(st.serverId);
    rebase(st.state, st.rev);
    G.down = false;
    update();
    pump();
  }

  // Another window saved: take its state when nothing of ours is waiting (else the next PUT's 409 does it).
  async function refresh() {
    if (G.inflight || G.pending.length) return;
    try {
      const st = await getJson('/api/state');
      if (G.inflight || G.pending.length || st.stateId !== G.stateId) return;
      // an answer older than the state shown (two refreshes crossed) never rolls the view back
      if (st.serverId === G.serverId && st.rev < G.rev) return;
      G.state = st.state;
      G.rev = st.rev;
      update();
    } catch (e) { lost(); }
  }

  // The server has `rev` on disk: what it answered up to there is safe.
  function saved(rev) {
    G.savedRev = Math.max(G.savedRev, rev);
    G.sent = G.sent.filter((p) => p.rev > G.savedRev);
  }

  function listen() {
    let es;
    try { es = new EventSource('/api/events'); } catch (e) { return; }
    const data = (ev) => { try { return JSON.parse(ev.data); } catch (e) { return {}; } };
    es.addEventListener('hello', (ev) => {
      const d = data(ev);
      const restarted = G.serverId && d.serverId && d.serverId !== G.serverId;
      if (!restarted && typeof d.savedRev === 'number') saved(d.savedRev);
      if (d.status) takeStatus(d.status);
      if (G.down || restarted) { if (G.resyncTimer) { clearTimeout(G.resyncTimer); G.resyncTimer = null; } resync(); }
      indicator();
    });
    es.addEventListener('saved', (ev) => { saved(data(ev).rev || 0); G.saveFailed = false; indicator(); });
    es.addEventListener('save-failed', () => { G.saveFailed = true; indicator(); });
    es.addEventListener('state', (ev) => { const d = data(ev); if (d.clientId !== G.clientId) refresh(); });
    es.addEventListener('record-kept', (ev) => { const d = data(ev); if (d.path) note(keptText(d.path), { id: `kept:${d.path}` }); });
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
  const noteInfo = (p) => (G.model.notes && G.model.notes[p]) || null;
  const castOf = (p) => (G.model.cast || []).find((c) => c.note === p) || null;
  const pcOf = (p) => (G.model.pcs || []).find((x) => x.note === p) || null;
  const nameOf = (p) => { const pc = pcOf(p); if (pc) return pc.name; const c = castOf(p); if (c) return c.name; const n = noteInfo(p); return n ? n.name : stem(p); };
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

  // The beat the header jot writes to: the one last worked on, else where the first placed PC stands.
  function focusBeat(d) {
    const keys = new Set(d.beats.map((b) => b.key));
    if (G.ui.focus && keys.has(G.ui.focus)) return d.beats.find((b) => b.key === G.ui.focus);
    for (const p of pcs()) { const x = posOf(p.note); if (x && x.beat && keys.has(x.beat)) return d.beats.find((b) => b.key === x.beat); }
    return null;
  }

  // ------------------------------------------------------------------ drawing
  function focusKey(el) {
    for (const a of ['data-jot', 'data-bring', 'data-vhp', 'data-vcond', 'data-where', 'data-orphan', 'data-pt', 'data-hand', 'data-stop', 'data-fire']) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${CSS.escape(v)}"]`;
    }
    return el.id ? `#${CSS.escape(el.id)}` : null;
  }
  // An end-panel box saves on `change`, which a redraw would swallow: the box is replaced, its words put
  // back, and leaving it then fires nothing. So a box whose words differ from the saved ones commits first.
  const COMMIT_ON_CHANGE = '#sheet [data-where], #sheet [data-vhp], #sheet [data-vcond], #sheet #advance';
  let committing = false;
  let renders = 0;

  // Every change: redraw, then put focus, caret and half-typed words back.
  function update() {
    const a = document.activeElement;
    if (!committing && a && a.matches && a.matches(COMMIT_ON_CHANGE) && a.value.trim() !== a.defaultValue.trim()) {
      const before = renders;
      committing = true;
      try { a.dispatchEvent(new Event('change', { bubbles: true })); } finally { committing = false; }
      if (renders !== before) return; // the change's action redrew
    }
    const sel = a && a !== document.body && a.getAttribute ? focusKey(a) : null;
    const caret = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    G.drafts = {};
    document.querySelectorAll('#sheet input[data-jot], #sheet input[data-bring], #newBeat').forEach((el) => { if (el.value) G.drafts[focusKey(el)] = el.value; });
    // the box being typed in keeps its words too (an end-panel box changes the state only on blur)
    const typing = sel && a.closest && a.closest('#sheet') && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? a.value : null;
    render();
    if (typing !== null) { const el = document.querySelector(sel); if (el) el.value = typing; }
    for (const [k, v] of Object.entries(G.drafts)) { const el = k && document.querySelector(k); if (el && !el.value) el.value = v; }
    if (sel) {
      const el = document.querySelector(sel);
      if (el) { el.focus({ preventScroll: true }); if (caret && el.setSelectionRange) try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text box */ } }
    }
  }

  function render() {
    if (!G.model || !G.state) return;
    renders++;
    const d = D();
    const m = G.model;
    $('#ttl').textContent = [m.campaign, G.session && G.session.label].filter(Boolean).join(' · ') || 'Run sheet';
    document.title = `${(G.session && G.session.label) || 'Run sheet'} · ${m.campaign || 'run sheet'}`;
    $('#sub').textContent = m.system || '';
    jotLabel(d);
    const w = (m.warnings || []).length;
    $('#warnBtn').textContent = w ? `${w} prep note${w === 1 ? '' : 's'}` : 'No prep notes';
    renderNotes();
    $('#rail').innerHTML = railHTML(d);
    $('#sheet').innerHTML = sheetHTML(d);
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
    root.querySelectorAll('a[data-note]:not([href]), a[data-go]:not([href])').forEach((a) => { a.tabIndex = 0; a.setAttribute('role', 'link'); });
  }

  const RAIL_TOP = [['handover', 'Hand over'], ['pcs', 'The PCs'], ['run', 'The run']];
  const RAIL_END = [['people', 'People'], ['places', 'Places and maps'], ['threads', 'Threads'], ['long', 'If you run long'], ['end', 'End of the night'], ['prep', "Prep's working"]];
  function railHTML(d) {
    const faces = (list) => (list.length ? `<span class="fc">${list.map((p) => face(p.note)).join('')}</span>` : '');
    const beats = d.beats.filter((b) => !b.contingency).concat(d.beats.filter((b) => b.contingency));
    const off = pcs().filter((p) => { const x = posOf(p.note); return x && x.off; });
    const unplaced = pcs().filter((p) => !posOf(p.note));
    let h = '<div class="hd">Run sheet</div>';
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

  const sec = (id, title, body) => `<section class="s" id="${id}"><h2>${title}</h2>${body}</section>`;
  const BRIEF_LABELS = { overview: 'Overview', world: 'World', stops: 'Good places to stop' };

  function sheetHTML(d) {
    const m = G.model;
    let h = '';
    if (d.orphans.length) h += changedHTML(d);
    if (!G.tableLog) h += '<div class="nolog"><b>No Table Log note yet:</b> start it with <code>gma table</code> to have the record written. The sheet keeps what you do meanwhile.</div>';
    const brief = Object.keys(m.brief || {}).filter((k) => !k.endsWith('Html') && m.brief[`${k}Html`]);
    if (brief.length) h += sec('brief', 'Brief', brief.map((k) => `<h4 class="lab">${esc(BRIEF_LABELS[k] || k)}</h4>${m.brief[`${k}Html`]}`).join(''));
    h += sec('handover', 'Hand over', handoverHTML(d));
    h += sec('pcs', 'The PCs', pcsHTML());
    h += sec('run', 'The run', (d.beats.length ? d.beats.filter((b) => !b.contingency).concat(d.beats.filter((b) => b.contingency)).map((b) => beatHTML(b, d)).join('') : '<p class="muted">This Plan has no beats the sheet can read: its prep is below, under Prep\'s working.</p>')
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
        return `Vitals for ${esc(nameOf(o.note))}${o.copy > 1 ? ` ${o.copy}` : ''}: ${esc([hp, v.conditions].filter(Boolean).join(', '))} (no longer on the end panel)`;
      }
      return `Beat "${esc(o.text || o.key)}": ${esc([].concat(o.value).map((v) => String(v).replace(/^stood: (.*)$/, (x, p) => `${nameOf(p)} stood there`)).join(', '))}`;
    };
    return `<div class="changed" id="changed"><b>Changed since play started:</b> marks kept against things the Plan no longer has. They go into the record as they are; attach one to what it became.<ul>${d.orphans.map((o) => {
      const opts = options(o.kind);
      return `<li>${what(o)} ${opts.length ? `<select data-orphan="${esc(o.key)}" aria-label="Attach to"><option value="">attach to…</option>${opts.map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select> <button type="button" data-attach="${esc(o.key)}">Attach</button>` : ''}</li>`;
    }).join('')}</ul></div>`;
  }

  function handoverHTML() {
    const list = G.model.handouts || [];
    if (!list.length) return '<p class="muted">Nothing to hand over.</p>';
    return `<ul class="pts">${list.map((x) => {
      const on = !!G.state.handouts[x.key];
      return `<li class="${on ? 'landed' : ''}"><button class="ptb ${on ? 'landed' : ''}" data-hand="${esc(x.key)}" type="button" aria-pressed="${on}" title="${on ? 'Handed over. Click: not handed over' : 'Click: handed over'}">${on ? '✓' : ''}</button><span>${x.nameHtml || esc(x.name)}${x.scene ? ` <span class="muted">(${esc(x.scene)})</span>` : ''} ${x.textHtml || ''}${on ? ' <span class="note">handed over</span>' : ''}</span></li>`;
    }).join('')}</ul>`;
  }

  function pcsHTML() {
    if (!pcs().length) return '<p class="muted">No party given: start the sheet with <code>gma table</code> to have the PCs on it.</p>';
    return `<div class="tw"><table><thead><tr><th>PC</th><th>This session</th></tr></thead><tbody>${pcs().map((p) => `<tr><td style="white-space:nowrap">${face(p.note)} ${link(p.note, p.name)}<div class="note">${esc(p.player || '')}${p.role ? ` · ${esc(p.role)}` : ''} · AC ${esc(p.ac ?? '?')} · HP ${esc(p.hpNow ?? '?')}/${esc(p.hpMax ?? '?')} · Init ${p.init == null ? '?' : (p.init >= 0 ? '+' : '') + esc(p.init)}</div></td>
      <td>${p.moment ? `<b>Moment:</b> ${esc(p.moment)}<br>` : ''}${p.touch ? `<span class="muted">Touchpoint:</span> ${esc(p.touch)}<br>` : ''}${p.arc ? `<span class="muted">Arc:</span> ${esc(p.arc)}` : ''}${p.thread ? `<br><span class="muted">Thread:</span> ${esc(p.thread)}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const PT = { '': '', landed: '✓', missed: '✗', overtaken: '⊘' };
  const PT_TITLE = { '': 'Not marked. Click: landed ✓', landed: 'Landed ✓. Click: tried and missed ✗', missed: 'Tried and missed ✗. Click: overtaken ⊘', overtaken: 'Overtaken ⊘. Click: clear' };

  function beatHTML(b, d) {
    const lbl = b.contingency ? 'If triggered' : b.impro ? 'Improvised' : (b.place ? esc(nameOf(b.place)) : esc(b.placeText || ''));
    const here = pcsAtBeat(b.key);
    let h = `<div class="beat ${here.length ? 'here' : ''}" id="beat:${esc(b.key)}" data-beat="${esc(b.key)}"><div class="bh"><span class="lbl">${lbl}</span><h3>${esc(b.title)}</h3>${b.sceneNote ? link(b.sceneNote, 'scene note') : ''}</div>`;
    // 1 Here: faces per standing place; a hub gets one row per spot
    if (!b.contingency && pcs().length) {
      const hub = (b.spots || []).length > 1;
      const strip = (spot, label) => {
        const to = JSON.stringify({ beat: b.key, spot: spot ? spot.key : null, title: b.title });
        const at = pcsAtSpot(b.key, spot && spot.key, hub);
        return `<div class="here-strip">${label ? `<span class="sl">${label}</span>` : 'Here:'} ${pcs().map((p) => `<button class="pcb ${at.includes(p) ? 'on' : ''}" data-move="${esc(p.note)}" data-to="${esc(to)}" type="button" title="Put ${esc(p.name)} here" aria-pressed="${at.includes(p)}">${face(p.note)}${esc(first(p.name))}</button>`).join('')} <button data-all="${esc(to)}" type="button">Everyone</button></div>`;
      };
      h += hub ? b.spots.map((s) => strip(s, s.note ? link(s.note, s.name) : esc(s.name))).join('') : strip(null, '');
    }
    // The beat's buttons
    const btns = [];
    if (b.contingency) btns.push(`<button data-fire="${esc(b.key)}" class="${G.state.fired[b.key] ? 'fired' : ''}" type="button" aria-pressed="${!!G.state.fired[b.key]}">${G.state.fired[b.key] ? 'Fired ✓' : 'It fired'}</button>`);
    const stopped = G.state.stopped && G.state.stopped.beat === b.key;
    btns.push(`<button data-stop="${esc(b.key)}" class="${stopped ? 'on' : ''}" type="button" aria-pressed="${stopped}">${stopped ? 'Stopped here ✓' : 'Stopped here'}</button>`);
    if (b.impro) btns.push(armBtn(`unimpro:${b.key}`, 'Remove this beat', `data-unimpro="${esc(b.key)}"`));
    h += `<div class="bbtns">${btns.join('')}</div>`;
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

  // A two-click button: the first click arms it (3 s), the second does it.
  function armBtn(id, label, attrs, title = '') {
    const armed = G.ui.armed && G.ui.armed.id === id && Date.now() - G.ui.armed.at <= 3000;
    const cls = /class="([^"]*)"/.exec(attrs);
    const rest = attrs.replace(/\s*class="[^"]*"/, '');
    return `<button type="button" ${rest} data-arm="${esc(id)}" class="${cls ? cls[1] : ''} ${armed ? 'arm' : ''}" title="${esc(title || label)}">${armed ? 'Sure? click again' : esc(label)}</button>`;
  }

  function whoHTML(b, d) {
    const inWho = new Set((b.who || []).map((w) => w.note).filter(Boolean));
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
      if (w.brought) btns.push(armBtn(`unbring:${b.key}|${p}`, 'Remove', `data-unbring="${esc(p)}" data-beat="${esc(b.key)}"`, `Take ${shown} off this beat`));
      return `<div class="who">${p ? face(p, 'av', d) : '<span class="av"></span>'}<div><div class="wn"><b>${p ? link(p, shown) : esc(shown)}</b>${tags.join(' ')} ${btns.join(' ')}</div>${pa ? `<div class="pa">${pa}</div>` : ''}${wants ? `<div class="wa">${wants}</div>` : ''}${foe ? `<div class="note">${esc(foe.prepNote)}</div>` : ''}</div></div>`;
    }).join('');
    if (!(b.who || []).length) h += '<p class="muted">Nobody listed.</p>';
    for (const a of b.arrivals || []) {
      const people = (a.people || []).filter((p) => !inWho.has(p));
      h += `<div class="cue"><b>${esc(a.when)}:</b> <span>${a.textHtml || esc(a.text)}</span>${people.map((p) => `<button type="button" data-bringin="${esc(p)}" data-beat="${esc(b.key)}">Bring in ${esc(nameOf(p))}</button>`).join('')}</div>`;
    }
    const hits = G.ui.hits[b.key] || [];
    h += `<div class="bring"><input data-bring="${esc(b.key)}" placeholder="Bring anyone in: type a name" aria-label="Bring someone into ${esc(b.title)}" autocomplete="off"><div class="hits" data-hits="${esc(b.key)}">${hitsHTML(b.key, hits)}</div></div>`;
    return h;
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
    const tile = (p) => { const pic = portraitOf(p); return `<div class="place"><div class="im">${pic ? `<img src="${esc(picUrl(pic))}" alt="">` : 'no picture yet'}</div><div class="cap">${link(p)}</div></div>`; };
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
  function endHTML(d) {
    let h = '<p class="note">Prefilled from the sheet. Change anything after rests: only a row you change, or a long rest, goes into the record.</p>';
    if (pcs().length) {
      h += `<h4 class="lab">Where everyone ended</h4><table class="where"><tbody>${d.whereEnded.map((w) => `<tr><td style="width:12rem">${face(w.pc)} ${esc(w.name)}</td><td><input data-where="${esc(w.pc)}" value="${esc(w.text || whereText(w))}" data-default="${esc(whereText(w))}" aria-label="Where ${esc(w.name)} ended"></td></tr>`).join('')}</tbody></table>`;
    }
    if (d.vitals.length) {
      h += `<h4 class="lab">Vitals</h4><div class="tw"><table class="vt"><thead><tr><th>Who</th><th>HP</th><th>Max</th><th>Conditions</th><th></th></tr></thead><tbody>${d.vitals.map((v) => {
        const recorded = v.set || v.rest;
        return `<tr><td>${esc(v.name)}${v.ally ? ' <span class="note">ally</span>' : ''}</td><td><input data-vhp="${esc(v.rowId)}" value="${esc(v.hp ?? '')}" inputmode="numeric" aria-label="${esc(v.name)} HP now"></td><td>${esc(v.max ?? '?')}</td><td><input class="c" data-vcond="${esc(v.rowId)}" value="${esc(v.conditions || '')}" placeholder="conditions that carry" aria-label="${esc(v.name)} conditions"></td><td>${recorded ? '<span class="rec">recorded</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
      h += `<p><button id="longRest" type="button" class="${G.state.end.longRest ? 'on' : ''}" aria-pressed="${!!G.state.end.longRest}">${G.state.end.longRest ? 'Long rest taken ✓ (click to undo)' : 'Long rest: everyone to full'}</button></p>`;
    }
    h += `<h4 class="lab"><label for="advance">Advancement</label></h4><textarea id="advance" placeholder="One line each, e.g. level 6 for the dragon (milestone)">${esc(G.state.end.advancement || '')}</textarea>`;
    h += `<p><button id="copyRecord" class="primary" type="button">Copy the Table Log</button> <span class="note" id="copyMsg">${esc(G.ui.copyMsg)}</span></p>`;
    if (G.ui.record) h += `<pre class="notes" id="recordText">${esc(G.ui.record)}</pre>`;
    return h;
  }

  // ------------------------------------------------------------------ the drawer
  async function openNote(p) {
    let n;
    try { n = await getJson(`/api/note?path=${encodeURIComponent(p)}`); } catch (e) {
      showDrawer(`<div class="dh"><h2>${esc(stem(p))}</h2><button id="closeDrawer" type="button">Close ✕</button></div><p class="warn">That note could not be opened (${esc(e.message)}).</p>`);
      return;
    }
    showDrawer(`<div class="dh"><div><div class="ty">${esc(n.type)}${n.withheld ? ' · withheld from players' : ''}</div><h2>${esc(n.name)}</h2></div><button id="closeDrawer" type="button">Close ✕</button></div>${n.portrait ? `<img class="big" src="${esc(picUrl(n.portrait))}" alt="">` : ''}<div class="body">${n.html || ''}</div>`);
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
  const closeDrawer = () => $('#drawer').classList.remove('open');

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

  function goTo(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'start' });
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button,a[data-note],a[data-go],[data-go]');
    if (!t || t.disabled) return;
    const d = t.dataset;
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
      return;
    }
    if (d.move) { const to = JSON.parse(d.to); G.ui.focus = to.beat; act({ type: 'move', pc: d.move, to }); return; }
    if (d.all) { const to = JSON.parse(d.all); G.ui.focus = to.beat; act({ type: 'moveAll', pcs: pcs().map((p) => p.note), to }); return; }
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
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable;
    if (ev.key === 'Escape') { if ($('#drawer').classList.contains('open')) { closeDrawer(); ev.preventDefault(); } return; }
    if (!typing && (ev.key === 'j' || ev.key === 'J') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); $('#hjot').focus(); return; }
    if (ev.key === 'Enter' && t.tagName === 'A' && d.note) { openNote(d.note); return; }
    if (ev.key === 'Enter' && t.tagName === 'A' && d.go) { ev.preventDefault(); t.click(); return; }
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
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.setCustomValidity) t.setCustomValidity('');
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
    if (d.vhp) {
      const v = t.value.trim();
      const n = Number(v);
      act({ type: 'endSet', vitals: { [d.vhp]: { hp: v === '' ? undefined : (Number.isFinite(n) ? n : v) } } });
      return;
    }
    if (d.vcond) { act({ type: 'endSet', vitals: { [d.vcond]: { conditions: t.value.trim() } } }); return; }
    if (t.id === 'advance') act({ type: 'endSet', advancement: t.value });
  });

  // A tab closed while clicks are still unsent (the server not answering) would lose them: the browser asks first.
  // A header that wraps on a narrower window is taller: the jump offset follows it.
  window.addEventListener('resize', measureTop);

  window.addEventListener('beforeunload', (ev) => {
    if (!G.pending.length) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  // ------------------------------------------------------------------ the probe (tests only)
  function probe() {
    if (!PROBE || !G.model || !document.body) return;
    const beats = document.querySelectorAll('#sheet .beat').length;
    const rail = document.querySelectorAll('#rail [data-railbeat]').length;
    document.body.dataset.probe = JSON.stringify({
      beats, rail, saved: ($('#saved') || {}).textContent || '', errors: probeErrors.slice(),
      notes: G.notes.map((n) => n.text), rev: G.rev, pending: G.pending.length, stateId: G.stateId, clientId: G.clientId,
      marked: document.querySelectorAll('#sheet .ptb.landed[data-pt]').length,
      jots: Array.from(document.querySelectorAll('#sheet ul.jots li > span:not(.tm)'), (el) => el.textContent),
    });
  }
  window.RunSheetPage = { act, get state() { return G.state; }, get model() { return G.model; }, probe };

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
    render();
    listen();
    if (PROBE && params.get('walk')) {
      const s = document.createElement('script');
      s.src = '/web/probe.js';
      document.body.appendChild(s);
    }
  }
  start();
}());
