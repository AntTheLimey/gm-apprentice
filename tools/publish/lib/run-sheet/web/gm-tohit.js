'use strict';
// The GURPS to-hit calculator on the GM page (step 6b Task 24, D7, D8, D8b-D8d): the player site's own calculator
// (/tohit/gurps-tohit.js, its mountIn) in a dialog at the note drawer's 560 px, in its narrow layout. One To-hit
// button opens it: on the fight's toolbar and in a PC's acting panel (gm-fight.js draws those), and on the PCs
// section's bar outside a fight. "Start from" is each PC with an attack on the sheet, then a typed skill (level,
// melee or ranged, an optional name).
//
// It opens on the row whose panel is showing: a PC's weapons, or for anyone else a typed skill, filled from what was
// typed for that row or its counted group tonight. The row's manoeuvre, shock, aim and evaluate counts and Prone are
// the calculator's starting state (`initial`), which it cleans as it cleans its own memory; the GM changes any of
// them there, and nothing goes back to the row. A PC's setup is remembered under the calculator's own key,
// `tohit-calc:gm-table:<campaign>:<pc>`; a typed skill's calculator remembers nothing, and its level, type and name
// live in this page and the tab's sessionStorage only, never the run sheet's state or the Table Log. Nothing of it
// reaches the players' screen. Not gated by player_site.features.tohit_calculator (D7).
(function () {
  const RP = window.RunSheetPage;
  const TH = window.__gurpsTohit;
  const FM = window.RunSheetFightMath;
  if (!RP || !TH || typeof TH.mountIn !== 'function') return;
  const { esc } = RP;
  const $ = (s) => document.querySelector(s);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const TITLE = "The GURPS to-hit calculator, as the player site's sheets have it";
  const ENCUMBRANCE = 'Uses the level written on the sheet: it does not count encumbrance.';
  const TYPED = 'typed';
  // the run sheet's manoeuvre keys (systems/gurps.js chips) to the calculator's own (js/gurps-tohit.js MANEUVERS)
  const MAN = { attack: 'attack', 'all-out attack': 'aod', 'move and attack': 'move' };

  const available = () => { const m = RP.model(); return Boolean(m && m.rules && m.rules.id === 'gurps-4e'); };

  // ---- what a typed skill remembers: by row and by counted group, for the night ----
  const memKey = () => `rs-tohit:${(RP.state() || {}).stateId || ''}`;
  let typedMem = null;
  function mem() {
    if (typedMem) return typedMem;
    typedMem = { rows: {}, groups: {} };
    try {
      const got = JSON.parse(window.sessionStorage.getItem(memKey()) || 'null');
      if (got && typeof got === 'object') for (const k of ['rows', 'groups']) if (got[k] && typeof got[k] === 'object') typedMem[k] = got[k];
    } catch (e) { /* nothing kept */ }
    return typedMem;
  }
  const cleanTyped = (t) => (t && typeof t === 'object' && /^\d{1,2}$/.test(String(t.level)) ? { level: String(t.level), type: t.type === 'ranged' ? 'ranged' : 'melee', name: typeof t.name === 'string' ? t.name.slice(0, 60) : '' } : null);
  function remember(row, typed) {
    if (!row) return;
    const m = mem();
    m.rows[row.id] = typed;
    if (FM && FM.groupKey) m.groups[FM.groupKey(row)] = typed;
    try { window.sessionStorage.setItem(memKey(), JSON.stringify(m)); } catch (e) { /* kept in the page only */ }
  }
  function recalled(row) {
    if (!row) return null;
    const m = mem();
    return cleanTyped(m.rows[row.id]) || (FM && FM.groupKey ? cleanTyped(m.groups[FM.groupKey(row)]) : null);
  }

  // ---- the row the dialog opens for, and what it starts with ----
  const rowOf = (id) => { const f = (RP.state() || {}).fight; return f && id ? (f.rows || []).find((r) => r.id === id) || null : null; };
  // The calculator's starting state from the row: every field the row owns, its neutral value too, so what an
  // earlier open left in the calculator's memory (a shock since cleared, a manoeuvre since changed) never stays.
  // Its manoeuvre (Attack when it has none the calculator offers), shock, Aim and Evaluate counts, and Prone or
  // standing. A count the turn's attack pick reset is the one it had before the pick (fight.js manFrom).
  function initialOf(r, data) {
    if (!r) return {};
    const count = (v) => (isNum(v) && v > 0 ? Math.floor(v) : 0);
    const counts = r.manoeuvre && r.manoeuvre !== 'aim' && r.manoeuvre !== 'evaluate' ? (r.manFrom || {}) : r;
    const posture = data && data.rules && data.rules.posture;
    const prone = (r.conds || []).includes('Prone') && posture && isNum(posture.prone);
    return {
      man: MAN[r.manoeuvre] || 'attack',
      shock: isNum(r.shock) && r.shock > 0 ? -r.shock : 0,
      aim: count(counts.aim),
      evaluate: count(counts.evaluate),
      posture: prone ? posture.prone : 0,
    };
  }

  // ---- the dialog ----
  const ui = { open: false, opener: null, row: null, from: null, pcs: [], typed: { level: '', type: 'melee', name: '' }, ticket: 0, said: '', mounted: null };
  const dlg = () => $('#tohitDlg');

  function frame() {
    const opts = ui.pcs.map((p) => `<option value="${esc(p.note)}">${esc(p.name)}</option>`).join('');
    return `<div class="thd-top"><label class="thd-lab" for="thFrom">Start from</label><select id="thFrom">${opts}<option value="${TYPED}">a typed skill</option></select>`
      + '<span class="sp"></span><button type="button" id="thClose">Close ✕</button></div>'
      + '<div class="thd-typed" id="thTyped" hidden>'
      + '<label>Level <input type="number" id="thLevel" min="1" max="99" step="1" inputmode="numeric" autocomplete="off"></label>'
      + '<label>Type <select id="thType"><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label>'
      + '<label>Name <input type="text" id="thName" placeholder="Typed skill" autocomplete="off" maxlength="60"></label>'
      + '<span class="thd-err" id="thErr" role="status" aria-live="polite"></span></div>'
      + `<p class="thd-enc note">${esc(ENCUMBRANCE)}</p>`
      + '<div class="thd-body"><p class="thd-empty note" id="thEmpty" hidden></p><div class="tohit" id="thBox"></div></div>';
  }

  async function open(rowId, opener) {
    const d = dlg();
    if (!d || !available()) return;
    ui.opener = opener;
    ui.row = rowOf(rowId);
    const t = ++ui.ticket;
    // open at once; the list of PCs fills it when it comes
    d.innerHTML = '<div class="thd-top"><span class="note" role="status">Loading…</span><span class="sp"></span><button type="button" id="thClose">Close ✕</button></div>';
    ui.open = true;
    if (!d.open) d.showModal();
    $('#thClose').focus();
    let pcs = [];
    try { pcs = (await RP.getJson('/api/tohit')).pcs || []; } catch (e) { pcs = []; }
    if (t !== ui.ticket || !ui.open) return;
    ui.pcs = pcs;
    const r = ui.row;
    const pcHere = r && r.kind === 'pc' && pcs.find((p) => p.note === r.note);
    ui.from = pcHere ? pcHere.note : r ? TYPED : (pcs[0] ? pcs[0].note : TYPED);
    ui.typed = (r && r.kind !== 'pc' && recalled(r)) || { level: '', type: 'melee', name: '' };
    d.innerHTML = frame();
    $('#thFrom').value = ui.from;
    $('#thLevel').value = ui.typed.level;
    $('#thType').value = ui.typed.type;
    $('#thName').value = ui.typed.name;
    draw();
    $('#thFrom').focus();
    RP.probe();
  }

  // The calculator for the choice in hand: the row's state is laid on its own PC's calculator, or on the typed skill
  // opened for it; another PC starts from its own memory alone.
  async function draw() {
    const t = ++ui.ticket;
    const box = $('#thBox');
    const empty = $('#thEmpty');
    const typedOn = ui.from === TYPED;
    $('#thTyped').hidden = !typedOn;
    const say = (text) => { box.textContent = ''; box.classList.remove('th-narrow'); empty.textContent = text; empty.hidden = !text; ui.mounted = null; RP.probe(); };
    let data;
    let key = null;
    try {
      if (typedOn) {
        const level = ui.typed.level.trim();
        $('#thErr').textContent = '';
        if (!level) { say("Type the skill's level."); return; }
        if (!/^\d{1,2}$/.test(level) || Number(level) < 1) { $('#thErr').textContent = 'A whole number from 1 to 99'; say(''); return; }
        const res = await fetch('/api/tohit/typed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: Number(level), type: ui.typed.type, name: ui.typed.name }) });
        const body = await res.json();
        if (!res.ok) { if (t === ui.ticket) { $('#thErr').textContent = body.error || 'Not a level the calculator takes'; say(''); } return; }
        data = body.data;
      } else {
        data = (await RP.getJson(`/api/tohit?pc=${encodeURIComponent(ui.from)}`)).data;
        key = `tohit-calc:gm-table:${data.campaign || ''}:${data.pc}`;
      }
    } catch (e) {
      if (t === ui.ticket) say(`The calculator could not be opened (${e.message}).`);
      return;
    }
    if (t !== ui.ticket || !ui.open) return;
    const own = ui.row && (typedOn ? ui.row.kind !== 'pc' : ui.row.note === ui.from);
    const initial = own ? initialOf(rowOf(ui.row.id) || ui.row, data) : undefined;
    empty.hidden = true;
    const drew = TH.mountIn(box, data, { storageKey: key, narrow: true, ...(initial ? { initial } : {}) });
    ui.mounted = drew ? (initial ? 'row' : 'plain') : null;
    if (!drew) say('Nothing on that sheet the calculator can use.');
    RP.probe();
  }

  function close() {
    const d = dlg();
    if (d && d.open) d.close();
  }
  function closed() {
    ui.open = false;
    ui.ticket++;
    const back = ui.opener && document.querySelector(ui.opener);
    if (back) back.focus();
    RP.probe();
  }

  // The dialog's own boxes, in order: what Tab walks (a box in a closed group of the calculator is not drawn).
  const shown = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
  function focusables() {
    const d = dlg();
    return Array.from(d.querySelectorAll('button, select, input, summary, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && !el.closest('[hidden]') && shown(el));
  }

  function wire() {
    const d = dlg();
    if (!d) return;
    d.addEventListener('close', closed);
    d.addEventListener('click', (ev) => {
      // a click on the backdrop, outside the dialog's box, closes it (a click in a margin inside it is the dialog's too)
      if (ev.target === d) {
        const r = d.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) { close(); return; }
      }
      if (ev.target.closest('#thClose')) { close(); return; }
      RP.probe();
    });
    // the calculator answers a change on the box itself, before it gets here: the probe then reads the new answer
    d.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.id === 'thFrom') { ui.from = t.value; draw(); return; }
      if (t.id === 'thType' || t.id === 'thName') { typedChanged(); return; }
      RP.probe();
    });
    d.addEventListener('input', (ev) => { if (ev.target.id === 'thLevel') typedChanged(); else RP.probe(); });
    // the page's own keys (J to jot, Tab through the fight's panel) stay out of the dialog; Tab wraps inside it
    d.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const at = list.indexOf(document.activeElement);
      if (ev.shiftKey && at <= 0) { ev.preventDefault(); list[list.length - 1].focus(); } else if (!ev.shiftKey && at === list.length - 1) { ev.preventDefault(); list[0].focus(); }
    });
  }
  function typedChanged() {
    ui.typed = { level: $('#thLevel').value, type: $('#thType').value === 'ranged' ? 'ranged' : 'melee', name: $('#thName').value };
    const keep = cleanTyped(ui.typed);
    if (keep && Number(keep.level) >= 1 && ui.row && ui.row.kind !== 'pc') remember(ui.row, keep);
    draw();
  }

  const part = {
    // the PCs section's bar, outside a fight (a paused one too: its toolbar is not on screen)
    sectionButtons(id) {
      if (id !== 'pcs' || !available()) return '';
      const f = (RP.state() || {}).fight;
      if (f && !f.paused) return '';
      return `<button type="button" id="pcsToHit" data-tohit="" title="${esc(TITLE)}">To-hit</button>`;
    },
    click(ev) {
      const t = ev.target.closest('[data-tohit]');
      if (!t || t.disabled || t.closest('#tohitDlg')) return false;
      const sel = t.id ? `#${CSS.escape(t.id)}` : `[data-tohit="${CSS.escape(t.dataset.tohit)}"]`;
      open(t.dataset.tohit || null, sel);
      return true;
    },
    probe() {
      const box = $('#thBox');
      return {
        tohit: ui.open ? {
          open: Boolean(dlg() && dlg().open), from: ui.from, row: ui.row ? ui.row.id : null, typed: ui.typed, mounted: ui.mounted,
          roll: box && $('#th-roll') ? $('#th-roll').textContent : null, narrow: Boolean(box && box.classList.contains('th-narrow')),
        } : null,
      };
    },
  };
  window.RunSheetToHit = { available, title: TITLE };
  RP.parts.push(part);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
}());
