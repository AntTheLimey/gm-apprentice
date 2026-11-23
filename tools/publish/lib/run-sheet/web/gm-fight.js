'use strict';
// The GM page's fight view (spec §6.4, §6.5; plan 5b Task 10): one `RunSheetPage.parts` entry, loaded after
// gm.js. Every change is an action through the page's one `dispatch` (fight.js reduces it, here and on the
// server); rows are built with fight-math's `rowsForFight`/`joinRows` and travel in the action, so `reduce`
// never sees the model. Rolls come from the server's `/api/roll`: no dice here.
//
// While a fight runs (and is not paused) it takes the middle column, `#side`: the turn order, one line per
// row, in its own scroll box under a toolbar that stays put, with the acting creature's panel under it (beside
// it once the middle is wide enough: gm.js's layout). The right pane, `#sheet`, holds only the fight's beat cut
// (`pane`). Paused, the beats come back with a strip of the order kept at the top. After End fight, a box above
// the beat lists every status still on.
//
// UI-only choices (a pinned panel, the area ticks, the Start question) live here and are lost on reload.
(function () {
  const RP = window.RunSheetPage;
  const FM = window.RunSheetFightMath;
  const RS = window.RunSheetState;
  const Fight = window.RunSheetFight;
  if (!RP || !FM || !RS || !Fight) return;
  const { esc } = RP;
  const $ = (s) => document.querySelector(s);
  const first = (n) => String(n || '').split(' ')[0];
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const sign = (n) => (isNum(n) ? (n >= 0 ? `+${n}` : String(n)) : '+0');
  const attr = (k, v) => `[${k}="${CSS.escape(v)}"]`;
  const PT = { '': '', landed: '✓', missed: '✗', overtaken: '⊘' };
  // the panel boxes' figures: every key setStat takes (fight.js STAT_FIELDS) but max HP and max FP, which are the
  // row's own boxes; each panel box is `data-fs-<key>`
  const PANEL_KEYS = Object.keys(Fight.STAT_FIELDS).filter((k) => k !== 'hp' && k !== 'fp');
  // D&D's, for a model with no words of its own
  const INVALID = 'Type -37 or 37 (damage), +8 (healing) or t5 (temp HP)';

  const ui = {
    fightId: null, peek: null, peekTurn: null,
    area: false, sel: {}, ahalf: {}, spend: {}, areaDmg: '',
    ask: null, asked: {}, other: {}, addHits: [], addText: '', addCount: '1', mine: null,
    // a stat box holding words that are not a number (review F5): { words, was }, kept through redraws
    // while the state's number is still the one it was marked against
    bad: {},
    // a damage box holding words not yet applied (final review P4.1): row id -> the words, kept through redraws
    pending: {},
    // an entry the row cannot take (a pool it has no figure in: GURPS's e-3 with no Energy Reserve, f-3 with no FP): row id -> { words, why }, kept in
    // the box with the reason on the row's second line until the box changes
    refused: {},
    // the PCs whose spells fold is open (GURPS, Task 10): note -> true
    spellsOpen: {},
    // the hit chips' memory (GURPS, Task 12): row id -> { type, location } last sent, listed first; the page's only,
    // for the night (never the vault or the Table Log)
    lastHit: {},
  };

  const model = () => RP.model();
  const state = () => RP.state();
  // the system's description says whether it fights (systems/index.js: null runs as D&D)
  const allowed = () => { const m = model(); return Boolean(m && m.rules && m.rules.fights); };
  // What the system's description says the page draws (model.rules): its words, toggles, row numbers and panel
  // boxes. A model with none draws D&D's row, as before 6b.
  const rules = () => { const m = model(); return (m && m.rules) || {}; };
  const words = () => rules().words || {};
  // the fallback is D&D's toggles as systems/dnd.js describeAs sets them (dnd.js:135-138), for a model with none
  const toggles = () => rules().toggles || { half: true, resisted: true, temp: true, deathSaves: true, concentration: true, exhaustion: true, counters: true };
  const rowNumbers = () => rules().rowNumbers || ['ini', 'hp', 'max', 'ac'];
  // the system's wounding table (GURPS's, Task 12): a hit typed as damage, type and place; null where there is none
  const wounding = () => (rules().fight || rules()).wounding || null;
  const rolled = () => !rules().initiative || rules().initiative === 'roll';
  // the panel's boxes the page can draw ({ key, label } items; D&D's list names its counters, drawn as before)
  const panelBoxes = () => (rules().panelBoxes || []).filter((b) => b && typeof b === 'object' && STAT[boxStat(b.key)]);
  // the pools a row shows: with a max box on the row (GURPS's FP), or as a read-out (CoC's MP and SAN)
  const poolsShown = () => {
    const rn = rowNumbers();
    const all = FM.poolsOf(rules().fight || rules());
    return { boxed: all.filter((p) => rn.includes(p.max)), read: all.filter((p) => !rn.includes(p.max) && rn.includes(p.key)) };
  };
  // A figure worked out from others carries its tag ("from ST"): the row's field to the `from` key it is marked by.
  const FROM_OF = { max: 'hp', fpMax: 'fp', mpMax: 'mp', ini: 'speed', speed: 'speed' };
  const fromTag = (r, field) => { const k = FROM_OF[field] || field; return r.from && r.from[k] ? ` (${r.from[k]})` : ''; };
  const shownFigure = (v) => (isNum(v) ? String(v) : typeof v === 'string' ? v : '');
  const pcName = (note) => { const p = (model().pcs || []).find((x) => x.note === note); return p ? p.name : RP.nameOf(note); };

  // Every fight action names the running fight (Review M3).
  function F(a) {
    const f = state().fight;
    if (!f) return;
    RP.dispatch({ fight: f.id, ...a });
  }
  // Unmaskings carried from an earlier session: `reduce` has no model, so the action brings them.
  const carried = (d) => Object.fromEntries(d.unmaskedNow.filter((u) => u.carried).map((u) => [u.note, u.name]));

  async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let out = null;
    try { out = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error((out && out.error) || `${url}: ${res.status}`);
    return out;
  }
  // The server's dice (a die, 3d6 against a target, a d100, damage dice), at most 64 a request.
  async function roll(specs) {
    const out = [];
    for (let i = 0; i < specs.length; i += 64) {
      const r = await postJson('/api/roll', { rolls: specs.slice(i, i + 64) });
      out.push(...r.results);
    }
    return out;
  }
  const rollFailed = (e) => RP.note(`The dice could not be rolled: ${e.message}.`, { kind: 'bad', id: `roll:${e.message}` });

  // ------------------------------------------------------------------ starting, adding
  // `here` is Fight here's: { at, place }, the beat's or hub spot's key and the place note (a place beat is one
  // by itself).
  function startFight(key, here = null) {
    const d = RP.derived();
    const b = d.beats.find((x) => x.key === key);
    if (!b || state().fight) return;
    const id = RP.nextId();
    // a contingency has no PCs of its own: the focused group fights it (decision 13). Fight here ticks only the
    // PCs at the place, and nobody when none stands there (final review P4.7): the focused group is on Add.
    const focus = RP.focusedGroup();
    const groups = b.contingency ? [focus].filter(Boolean) : undefined;
    const at = here ? here.at : b.placeBeat ? key : null;
    const built = FM.rowsForFight({ model: model(), derived: d, state: state(), beatKey: key, groups, idBase: id, ...(at ? { at } : {}) });
    // Fight here puts the place behind the focused group's panel until End fight (P3); a typed place by its key.
    // PCs who stand there already have it behind theirs.
    const nobody = !built.rows.some((r) => r.kind === 'pc' && r.in);
    const backdrop = at && focus && nobody ? { group: focus, place: here ? here.place : b.place || b.key } : undefined;
    RP.ui.focus = key;
    ui.mine = id;
    RP.ui.pane = 'cut';
    RP.dispatch({ type: 'fightStart', beat: key, title: b.title, groups: built.groups, rows: built.rows, thresholds: built.thresholds, carried: carried(d), rules: model().rules.fight, ...(backdrop ? { backdrop } : {}) });
    // the pane opens at its top, whatever the run sheet's scroll was (review F3)
    RP.paneTop();
  }
  // Fight here at a place (plan 6a Task 7): its place beat first (the reader's key, so a second Fight here
  // finds it again), then the fight. Nobody moves.
  // A place the Plan has a beat (or hub spot) for fights on that beat, with its planned foes, as its own Fight
  // does (review I1). The place beat's "Improvised beat." line is not written: "Fight starts at…" says it (M4).
  function fightHere(note) {
    const key = (model().placeKeys || {})[note];
    if (!key || state().fight) return;
    // the beat or spot where a PC of the focused group stands now, else the first unvisited (final review O2)
    const plan = RS.planTarget(model(), state(), note, groupPcs(RP.focusedGroup()));
    if (plan) { startFight(plan.beat, { at: plan.spot || plan.beat, place: note }); return; }
    if (!RP.derived().beats.some((b) => b.key === key)) RP.dispatch({ type: 'improvise', key, title: RP.nameOf(note), place: note, quiet: true });
    startFight(key);
  }

  function addTo(add, label) {
    const s = state();
    const f = s.fight;
    if (!f) return;
    const d = RP.derived();
    const id = RP.nextId();
    const j = FM.joinRows({ model: model(), derived: d, state: s, fight: f, add, idBase: id });
    if (j.refused) { RP.note(j.refused, { id: `refused:${id}` }); return; }
    if (!j.rows.length && !j.tick.length && !j.groups.length) return;
    RP.dispatch({ type: 'fightJoin', fight: f.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: label || '', carried: carried(d), planned: Boolean(add.group || add.beat) });
  }
  // The Add box's way in: a cast note (`note`), or a typed name nobody has (`name`: a blank row, no note).
  function addByName(note, name) {
    const n = Math.max(1, Math.min(20, Math.floor(Number(ui.addCount)) || 1));
    ui.addText = '';
    ui.addHits = [];
    ui.addCount = '1';
    // the redraw keeps a focused box's words: empty it first, so the next name is typed afresh
    const box = $('#fAddName');
    if (box) box.value = '';
    const count = $('#fAddCount');
    if (count) count.value = '1';
    if (note) addTo({ cast: note, count: n });
    else addTo({ name, count: n }, `${name}${n > 1 ? ` ×${n}` : ''}`);
  }
  // What Add and Enter take: the top hit, when the cast has one. A blank row is only ever the explicit "+ New".
  function addTop(text) {
    const top = FM.addChoices(model().cast || [], text, RS.castSearch)[0];
    if (top && !top.isNew) { addByName(top.note); return true; }
    return false;
  }
  const NO_ONE = 'No one in the vault by that name: choose "+ New" to add them with no note';
  const groupPcs = (key) => ((RP.groups().find((g) => g.key === key) || {}).pcs || []);
  const groupWho = (key) => groupPcs(key).map((p) => first(pcName(p))).join(', ');

  // ------------------------------------------------------------------ turns
  const missingInit = (f) => f.rows.filter((r) => r.kind === 'pc' && r.in && !isNum(r.ini));

  // Start (the first Next) asks once per fight about ticked PCs with no initiative; the GM can still start.
  function next(force) {
    const f = state().fight;
    if (!f) return;
    if (!f.started && !force && missingInit(f).length && !ui.asked[f.id]) {
      ui.asked[f.id] = true;
      ui.ask = f.id;
      RP.render();
      return;
    }
    ui.ask = null;
    const wasTurn = f.turn;
    const wasRound = f.round;
    const wasStarted = f.started;
    RP.dispatch({ type: 'fightNext', fight: f.id, from: f.turn, round: f.round });
    const g = state().fight;
    // a lone foe keeps the turn into the next round: that is a new turn too, and rolls its recharges
    if (!g || (g.turn === wasTurn && g.round === wasRound)) return;
    keepTurnInView();
    if (!wasStarted) scrollToCut();
    rechargeRolls(g);
  }

  // Decision 4: when a turn this page moved starts, one d6 for each spent recharge of the row now acting.
  async function rechargeRolls(g) {
    const r = g.rows.find((x) => x.id === g.turn);
    const spent = r ? (r.recharge || []).filter((x) => !x.ready && !(x.rolled && x.rolled.round === g.round)) : [];
    if (!spent.length) return;
    let res;
    try { res = await roll(spent.map(() => ({ sides: 6, mod: 0 }))); } catch (e) { rollFailed(e); return; }
    spent.forEach((x, i) => RP.dispatch({ type: 'rechargeRoll', fight: g.id, row: r.id, name: x.name, roll: res[i].die, round: g.round }));
  }

  // Roll: d20 + modifier for every ticked foe and ally with an empty box. Never a PC (§6.4).
  async function rollInit() {
    const f = state().fight;
    if (!f) return;
    const due = f.rows.filter((r) => r.in && (r.kind === 'foe' || r.kind === 'ally') && !isNum(r.ini));
    if (!due.length) return;
    let res;
    try { res = await roll(due.map((r) => ({ sides: 20, mod: Math.max(-99, Math.min(99, Math.trunc(r.mod || 0))) }))); } catch (e) { rollFailed(e); return; }
    const values = {};
    due.forEach((r, i) => { values[r.id] = res[i].total; });
    RP.dispatch({ type: 'rollInit', fight: f.id, values });
  }

  // ------------------------------------------------------------------ area damage
  const turnRow = (f) => (f ? f.rows.find((r) => r.id === f.turn) || null : null);
  // On a foe's turn, its ready recharges are offered, the first ticked (decision 21).
  function areaOffer(f) {
    const r = turnRow(f);
    if (!r || r.kind !== 'foe') return { row: null, names: [], chosen: null };
    const names = (r.recharge || []).filter((x) => x.ready).map((x) => x.name);
    const key = `${f.turn}|${f.round}`;
    const chosen = Object.prototype.hasOwnProperty.call(ui.spend, key) ? ui.spend[key] : (names[0] || null);
    return { row: r, names, chosen: names.includes(chosen) ? chosen : null, key };
  }
  function applyArea() {
    const f = state().fight;
    const box = $('#fAreaDmg');
    if (!f || !box) return;
    const v = box.value.trim();
    if (!/^\d{1,4}$/.test(v)) { box.setCustomValidity('Type the damage, a whole number'); box.reportValidity(); return; }
    const hits = f.rows.filter((r) => ui.sel[r.id] && r.in && r.kind !== 'lair').map((r) => ({ row: r.id, half: !!ui.ahalf[r.id] }));
    const offer = areaOffer(f);
    if (!hits.length) return;
    endArea();
    F({ type: 'area', hits, amount: Number(v), spend: offer.chosen ? { row: offer.row.id, name: offer.chosen } : null });
  }
  function endArea() { ui.area = false; ui.sel = {}; ui.ahalf = {}; ui.areaDmg = ''; }

  // ------------------------------------------------------------------ scrolling the beats
  const topH = () => ($('#top') ? $('#top').offsetHeight : 52);
  function scrollTo(el, above = 0) {
    if (!el) return;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - topH() - above - 8), behavior: 'instant' });
    RP.probe();
  }
  // Start and Resume bring the cut into view: the right pane to its top (review F3); on one column (a narrow
  // window) the page scrolls to it, and a cut already in view stays put.
  function scrollToCut() {
    if (RP.paneTop()) { RP.probe(); return; }
    const el = $('#fightCut');
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top >= topH() && top < window.innerHeight / 2) { RP.probe(); return; }
    scrollTo(el);
  }
  // Next keeps the turn in view: the order's own box scrolls (never the page) so the current row and the one
  // after it are inside it (review F8). A new round starts at the top.
  function keepTurnInView() {
    const ol = $('#side ol.to');
    const cur = ol && ol.querySelector('li.cur');
    if (!cur || ol.scrollHeight <= ol.clientHeight) return;
    let nx = cur.nextElementSibling;
    while (nx && (nx.classList.contains('bench') || nx.dataset.row2 !== undefined)) nx = nx.nextElementSibling;
    // a row's second line goes with it
    if (nx && nx.nextElementSibling && nx.nextElementSibling.dataset.row2 === nx.dataset.frow) nx = nx.nextElementSibling;
    const at = (el) => el.getBoundingClientRect().top - ol.getBoundingClientRect().top + ol.scrollTop;
    const top = at(cur);
    const end = nx || cur;
    const bottom = at(end) + end.offsetHeight;
    if (top < ol.scrollTop) ol.scrollTop = top;
    else if (bottom > ol.scrollTop + ol.clientHeight) ol.scrollTop = Math.min(top, bottom - ol.clientHeight);
    RP.probe();
  }
  function scrollToBeat(key) {
    const strip = $('#fightStrip');
    scrollTo(document.getElementById(`beat:${key}`), strip ? strip.offsetHeight : 0);
  }

  // ------------------------------------------------------------------ drawing: the order
  // The system's statuses (rules.statuses); Concentrating and Exhaustion only where its toggles have them.
  function statusSelect(r) {
    const conds = new Set(r.conds || []);
    const tg = toggles();
    const opts = (rules().statuses || FM.DND_STATUSES).filter((x) => !conds.has(x)).map((x) => `<option>${esc(x)}</option>`).join('');
    const ex = tg.exhaustion ? `<optgroup label="Exhaustion">${Array.from({ length: FM.EXHAUSTION_MAX }, (_, i) => i + 1).filter((n) => n !== r.exhaustion).map((n) => `<option>Exhaustion ${n}</option>`).join('')}</optgroup>` : '';
    const conc = tg.concentration && !r.conc ? '<option>Concentrating</option>' : '';
    return `<select data-fstatus="${esc(r.id)}" aria-label="Add a status to ${esc(r.gmName)}"><option value="">+ status</option>${opts}${conc}${ex}<option value="other">other…</option></select>`;
  }
  // A row's statuses share one strip that takes the row's leftover width; when they do not all fit, the row gets
  // a second line of its own that lists them by name (fitChips; final review, for the GM's eye: a boss read "+4").
  // So statuses never widen the order (review I1, v8's strip), and the acting panel lists them all too.
  const statusKey = (label) => (/^Exhaustion /.test(label) ? 'Exhaustion' : label);
  // The marks the fight sets (GURPS's Reeling and 0 or less, Tired) go in the same strip, never the minus-HP lines
  // (those are the panel's track and Task 13's cards).
  const marksOn = (r) => (r.marks || []).concat(r.tired && rules().tiredAt ? [rules().tiredAt.name || 'Tired'] : [],
    (r.crippled || []).map((p) => `crippled (${p})`));
  function chips(r, bloodied) {
    const one = (label) => `<button type="button" class="chip" data-fun="${esc(`${r.id}|${statusKey(label)}`)}" title="Remove ${esc(label)}">${esc(label)} ✕</button>`;
    const all = Fight.statusesOf(r);
    const bl = bloodied && words().bloodied !== '' ? (words().bloodied || 'Bloodied') : '';
    const marks = marksOn(r);
    const h = (bl ? `<span class="chip auto">${esc(bl)}</span>` : '') + marks.map((m) => `<span class="chip auto mark">${esc(m)}</span>`).join('') + all.map(one).join('');
    const names = (bl ? [bl] : []).concat(marks, all);
    // always there, empty or not, so a first status never moves the row's other items (or the order's width)
    return `<span class="chips"${names.length ? ` title="${esc(names.join(', '))}"` : ''}>${h}</span>`;
  }
  // Each strip shows its chips when they all fit; else none, and the row's second line lists every one.
  function fitChips() {
    document.querySelectorAll('#side ol.to > li[data-frow]').forEach((li) => {
      const strip = li.querySelector(':scope > .chips');
      let moved = '';
      if (strip) {
        const kids = Array.from(strip.children);
        kids.forEach((k) => { k.hidden = false; });
        if (kids.length && strip.scrollWidth > strip.clientWidth + 1) {
          moved = kids.map((k) => k.outerHTML).join('');
          kids.forEach((k) => { k.hidden = true; });
        }
      }
      li.dataset.l2st = moved;
      syncLine2(li);
    });
  }
  // A row's second line (final review): what a box needs said (a bad number, damage typed and not applied) and the
  // statuses the row has no room for. Only a row that has any gets one; it is not a row (no data-frow), so the order's
  // least width, the probe's rows and the keyboard pass it by.
  const PENDING = 'Enter applies';
  const STAT_NAMES = { fini: 'Initiative', fmax: 'Max HP', fac: 'AC' };
  // a box's name for its bad-number line: the row's own, the pool's for its max box, the panel box's label
  function statName(f) {
    if (STAT_NAMES[f]) return STAT_NAMES[f];
    if (f === 'ffpmax') { const p = poolsShown().boxed[0]; return `Max ${p ? p.label : ''}`; }
    const b = panelBoxes().find((x) => boxStat(x.key) === f);
    return b ? b.label : f;
  }
  function line2Html(id, li) {
    const out = [];
    for (const f of Object.keys(STAT)) {
      if (ui.bad[badKey(STAT[f].k, id)]) out.push(`<span class="badnum" role="status" data-badfor="${f}" title="${esc(statName(f))}">${BAD_NUMBER}</span>`);
    }
    if (ui.refused[id]) out.push(`<span class="badnum refnum" role="status">${esc(ui.refused[id].why)}</span>`);
    else if (ui.pending[id]) out.push(`<span class="pendnum" role="status" title="Damage or healing typed, not applied yet">${PENDING}</span>`);
    // the last hit's working (GURPS, Task 12): one line, clipped, all of it in the title
    const hit = (rowById(id) || {}).hit;
    if (hit && hit.line) out.push(`<span class="hitline" title="${esc(hit.line)}">${esc(hit.line)}</span>`);
    const st = (li && li.dataset.l2st) || '';
    if (st) out.push(`<span class="l2st">${st}</span>`);
    return out.join('');
  }
  const L2_CLASSES = /^(?:side-\w+|cur|bench|out)$/;
  function syncLine2(rowOrId) {
    const li = typeof rowOrId === 'string' ? document.querySelector(`#side ol.to > li[data-frow="${CSS.escape(rowOrId)}"]`) : rowOrId;
    if (!li) return;
    const id = li.dataset.frow;
    const html = line2Html(id, li);
    let l2 = li.nextElementSibling && li.nextElementSibling.dataset.row2 === id ? li.nextElementSibling : null;
    if (!html) { if (l2) l2.remove(); return; }
    if (!l2) { l2 = document.createElement('li'); l2.dataset.row2 = id; li.after(l2); }
    l2.className = ['row2', ...Array.from(li.classList).filter((c) => L2_CLASSES.test(c))].join(' ');
    if (l2.dataset.h !== html) { l2.innerHTML = html; l2.dataset.h = html; }
  }
  function counters(r, long) {
    const c = [];
    if (r.lrMax) c.push(`<button type="button" class="cnt ${r.lr ? '' : 'spent'}" data-flr="${esc(r.id)}" title="${r.lr ? 'Spend one Legendary Resistance' : 'None left. Click: back to full'}">${long ? 'Legendary Resistance' : 'LR'} ${r.lr}/${r.lrMax}</button>`);
    if (r.laMax && !long) c.push(`<button type="button" class="cnt ${r.la ? '' : 'spent'}" data-fla="${esc(`${r.id}|1`)}" ${r.la ? '' : 'disabled'} title="Spend one legendary action (they come back on its turn)">LA ${r.la}/${r.laMax}</button>`);
    if (r.laMax && long) c.push(`<span class="cnt">Legendary actions ${r.la}/${r.laMax}</span><button type="button" data-fla="${esc(`${r.id}|1`)}" ${r.la >= 1 ? '' : 'disabled'}>spend 1</button><button type="button" data-fla="${esc(`${r.id}|2`)}" ${r.la >= 2 ? '' : 'disabled'}>spend 2</button>`);
    for (const x of r.recharge || []) {
      const rolled = long && x.rolled ? ` (recharge roll ${x.rolled.roll})` : '';
      c.push(`<button type="button" class="cnt ${x.ready ? '' : 'spent'}" data-frch="${esc(`${r.id}|${x.name}`)}" title="${esc(x.name)}: ${x.ready ? 'ready. Click: spent' : 'spent. Click: ready again'}">${esc(x.name)} ${x.ready ? '✓' : '✗'}${rolled}</button>`);
    }
    return c.join('');
  }

  // A stat box: the state's number, or the words the GM typed that are not one, marked (review F5).
  const BAD_NUMBER = 'Not a number: kept as typed';
  const badKey = (k, id) => `${k}|${id}`;
  function statBox(k, r, value, rest) {
    const key = badKey(k, r.id);
    const bad = ui.bad[key];
    // a newer number (another window, Same for all) replaces the marked words
    if (bad && bad.was !== String(value)) delete ui.bad[key];
    if (!ui.bad[key]) return `<input ${k}="${esc(r.id)}" value="${esc(value)}" ${rest}>`;
    // its words ("Not a number: kept as typed") are on the row's second line, seen at every width (P4.2)
    return `<input ${k}="${esc(r.id)}" value="${esc(bad.words)}" aria-invalid="true" ${rest}>`;
  }

  // A row's pools: GURPS's FP now/[max] (a caster's `✦FP`, an Energy Reserve inside it: `11/14 +4`), CoC's
  // `MP 12 · SAN 55`. Only the pools the row holds a figure in.
  // One boxed pool is all a system has today (GURPS's FP, `data-ffpmax`); the Energy Reserve has no box (its max is
  // the sheet's), so a second boxed pool would still need its own attribute and STAT entry.
  const hasReserve = (r) => isNum(r.er) || isNum(r.erMax);
  function poolsHTML(r) {
    const { boxed, read } = poolsShown();
    let h = '';
    for (const p of boxed) {
      if (!isNum(r[p.key]) && !isNum(r[p.max])) continue;
      const fp = p.key === 'fp';
      // the reserve's words are the system's (its pool's label, rules.words)
      const erPool = FM.poolOf(rules().fight || rules(), 'er');
      const er = fp && erPool && hasReserve(r) ? `<span class="er" title="${esc(`${erPool.label} ${isNum(r.er) ? r.er : '?'}/${isNum(r.erMax) ? r.erMax : '?'}${words().reserveTitle ? `: ${words().reserveTitle}` : ''}`)}"> +${esc(isNum(r.er) ? r.er : '?')}</span>` : '';
      const titles = [fromTag(r, p.max) ? `Max ${p.label} ${r[p.max]}${fromTag(r, p.max)}` : '', fp && r.caster ? (words().casterTitle || '') : ''].filter(Boolean);
      const t = titles.length ? ` title="${esc(titles.join('. '))}"` : '';
      const label = fp && r.caster ? `\u2726${p.label}` : p.label;
      h += `<span class="hpv fpv${fp && r.caster ? ' cast' : ''}"${t}>${esc(label)} ${esc(isNum(r[p.key]) ? r[p.key] : '?')}/${statBox('data-ffpmax', r, isNum(r[p.max]) ? r[p.max] : '', `inputmode="numeric" autocomplete="off" aria-label="Maximum ${esc(p.label)} for ${esc(r.gmName)}"`)}${er}</span>`;
    }
    const ro = read.filter((p) => isNum(r[p.key])).map((p) => `${p.label} ${r[p.key]}`);
    if (ro.length) h += `<span class="pools">${esc(ro.join(' · '))}</span>`;
    return h;
  }

  const SIDE_TITLES = {
    foe: 'An enemy: the players see only what you show',
    neutral: 'Neither side: shown to players like a foe',
    ally: "On the party's side: the players see its name and HP",
  };
  // pc, ally, foe or neutral; a lair action has none
  const sideWord = (r) => (r.kind === 'pc' ? 'pc' : FM.sideOfRow(r));
  function rowHTML(r, f, view) {
    const cur = f.turn === r.id;
    const side = sideWord(r);
    const cls = [cur ? 'cur' : '', r.out ? 'out' : '', r.in ? '' : 'bench', ui.area && ui.sel[r.id] ? 'sel' : '', side ? `side-${side}` : ''].join(' ');
    // the name takes its side's colour; its title keeps the word and the reason, e.g. "Ferrante (neutral: you set it)"
    const name = `<span class="nm" data-fpeek="${esc(r.id)}" title="${esc(side ? `${r.gmName} (${side === 'pc' ? 'PC' : side}${r.sideFrom ? `: ${r.sideFrom}` : ''}). Show this one's panel` : "Show this one's panel")}">${esc(r.gmName)}</span>`;
    if (r.kind === 'lair') {
      const owners = (r.of || []).map((id) => view.rows.find((x) => x.id === id)).filter(Boolean).map((x) => x.gmName);
      return `<li class="${cls} lair" data-frow="${esc(r.id)}"><span class="tk"></span><span class="ini fixed">20</span>${name}<span class="tag">loses ties${owners.length ? ` · ${esc(owners.join(', '))}` : ''}</span></li>`;
    }
    const tick = ui.area
      ? `<input type="checkbox" data-fsel="${esc(r.id)}" ${ui.sel[r.id] ? 'checked' : ''} ${r.in ? '' : 'disabled'} aria-label="${esc(r.gmName)} is in the area">`
      : `<input type="checkbox" data-ftick="${esc(r.id)}" ${r.in ? 'checked' : ''} aria-label="${esc(r.gmName)} is in this fight" title="In this fight">`;
    const tg = toggles();
    const w = words();
    const rn = rowNumbers();
    const tags = [];
    // a row with an HP figure, typed or worked out, is complete (D3d)
    if (!isNum(r.hp)) tags.push('no numbers');
    if (r.temp && tg.temp) tags.push(`+${r.temp} temp`);
    if (r.gone) tags.push('not in the party now');
    let h = `<li class="${cls}" data-frow="${esc(r.id)}"><span class="tk">${tick}</span>`;
    // rolled (D&D): the PC's called-out roll or the foe's modifier; worked out (CoC's DEX, GURPS's Basic Speed): its word
    const iniHint = rolled() ? (r.kind === 'pc' ? 'roll' : sign(r.mod)) : (w.initBox || w.initiative || '');
    const iniTitle = rolled() || !isNum(r.ini) ? '' : ` title="${esc(`${w.initiative || 'Initiative'} ${r.ini}${fromTag(r, 'ini')}`)}"`;
    h += statBox('data-fini', r, isNum(r.ini) ? r.ini : '', `class="ini" placeholder="${esc(iniHint)}" inputmode="${initPlaces() ? 'decimal' : 'numeric'}" autocomplete="off" aria-label="Initiative for ${esc(r.gmName)}"${iniTitle}`);
    h += `${name}${tags.length ? `<span class="tag">${esc(tags.join(' · '))}</span>` : ''}`;
    if (r.kind === 'foe') h += `<button type="button" class="tg ${r.seen ? 'on' : ''}" data-fseen="${esc(r.id)}" aria-pressed="${!!r.seen}" title="${r.seen ? 'The players see its name. Click: back to its unseen word' : 'The players see its unseen word. Click: they have seen it'}">${r.seen ? 'seen' : 'unseen'}</button>`;
    if (!r.in) return `${h}</li>`;
    if (isNum(r.hp)) {
      const half = ui.area ? !!ui.ahalf[r.id] : r.half;
      // damage typed and left unapplied keeps its words and its mark, "Enter applies" (final review P4.1)
      // as does an entry the row refused (e-3 with no Energy Reserve), its reason on the second line
      const pend = ui.pending[r.id] || (ui.refused[r.id] && ui.refused[r.id].words);
      // a caster's box says how a spell is paid (GURPS's `✦ f-3`)
      const ph = (r.caster && w.casterPlaceholder) || w.entryPlaceholder || '-37/+8/t5';
      // with no ½ or Res beside it, the box is as wide as the system's placeholder, so all of it shows
      const wide = tg.half ? '' : ` style="width: calc(${ph.length}ch + 8px)" title="${esc(ph)}"`;
      h += `<input class="hpin${pend ? ' pending' : ''}" data-fhp="${esc(r.id)}" value="${esc(pend || '')}" placeholder="${esc(ph)}"${wide} autocomplete="off" aria-label="Damage or healing for ${esc(r.gmName)}">`;
      if (tg.half) h += `<button type="button" class="tg ${half ? 'on' : ''}" ${ui.area ? 'data-fahalf' : 'data-fhalf'}="${esc(r.id)}" aria-pressed="${!!half}" title="${ui.area ? 'Half for this area: a save' : 'Half: the next hit only (a save)'}">½</button>`;
      if (tg.resisted) h += `<button type="button" class="tg ${r.resisted ? 'on' : ''}" data-fres="${esc(r.id)}" aria-pressed="${!!r.resisted}" title="Resisted: every hit halved until turned off">Res</button>`;
    }
    const maxTitle = fromTag(r, 'max') ? ` title="${esc(`Max ${w.hp || 'HP'} ${r.max}${fromTag(r, 'max')}`)}"` : '';
    h += `<span class="hpv"${maxTitle}>${esc(isNum(r.hp) ? r.hp : '?')}/${statBox('data-fmax', r, isNum(r.max) ? r.max : '', `inputmode="numeric" autocomplete="off" aria-label="Maximum HP for ${esc(r.gmName)}"`)}</span>`;
    if (rn.includes('ac')) h += `<span class="acv">AC${statBox('data-fac', r, isNum(r.ac) ? r.ac : '', `inputmode="numeric" autocomplete="off" aria-label="AC for ${esc(r.gmName)}"`)}</span>`;
    h += poolsHTML(r);
    if (tg.gun) h += `<button type="button" class="tg ${r.gun ? 'on' : ''}" data-fgun="${esc(r.id)}" aria-pressed="${!!r.gun}" title="${esc(w.gunTitle || '')}">${esc(w.gun || 'gun')}</button>`;
    h += chips(r, view.bloodied.has(r.id));
    h += statusSelect(r);
    if (ui.other[r.id]) h += `<input class="other" data-fother="${esc(r.id)}" placeholder="${esc(RP.OTHER_STATUS_PLACEHOLDER)}" autocomplete="off" aria-label="A status for ${esc(r.gmName)}, typed">`;
    if (r.kind === 'foe') h += `<button type="button" class="tg ${r.out ? 'on' : ''}" data-fout="${esc(r.id)}" aria-pressed="${!!r.out}">${r.out ? 'Back in' : 'Out'}</button>`;
    if (tg.deathSaves && (r.kind === 'pc' || r.kind === 'ally') && (r.conds || []).includes('Down')) {
      const ds = r.ds || { s: 0, f: 0 };
      h += `<span class="ds">Saves <button type="button" data-fds="${esc(`${r.id}|s`)}" title="Death save successes (click: one more)">✓${ds.s}</button><button type="button" data-fds="${esc(`${r.id}|f`)}" title="Death save failures (click: one more)">✗${ds.f}</button></span>`;
    }
    if (tg.counters) h += counters(r, false);
    return `${h}</li>`;
  }

  // ------------------------------------------------------------------ drawing: the acting panel (§6.5)
  function foeInfo(r, d) {
    for (const b of d.beats) for (const fo of b.foes || []) if (fo.key === r.foeKey) return fo;
    for (const b of d.beats) for (const fo of b.foes || []) if (r.note && fo.note === r.note) return fo;
    const c = (model().cast || []).find((x) => x.note === r.note);
    return (c && c.foe) || null;
  }
  function actingOf(f) {
    if (ui.peekTurn !== f.turn) { ui.peek = null; ui.peekTurn = f.turn; }
    return FM.actingRow({ ...f, rows: f.view.rows }, ui.peek);
  }
  function actingHTML(d) {
    const f = d.fight;
    const { row: r, why } = actingOf(f);
    if (!r) return '<div class="act" id="acting"><p class="note">The acting creature\'s panel shows here once a foe is in the fight.</p></div>';
    const cur = f.view.rows.find((x) => x.id === f.turn);
    const whyText = {
      picked: 'picked',
      acting: 'acting now',
      'last-foe': `last foe to act · ${cur ? first(cur.gmName) : ''}'s turn`,
      'next-foe': `next foe to act · ${cur ? first(cur.gmName) : ''}'s turn`,
      'first-foe': 'first foe in the order',
    }[why] || '';
    const head = (title) => `<div class="ah"><span class="why">${esc(whyText)}</span><h3>${esc(title)}</h3>${r.note ? RP.link(r.note, 'note') : ''}</div>`;
    if (r.kind === 'lair') {
      const owners = (r.of || []).map((id) => f.view.rows.find((x) => x.id === id)).filter(Boolean);
      return `<div class="act" id="acting">${head('Lair action')}<p class="note">Initiative 20, losing ties.</p>${owners.map((o) => {
        const info = foeInfo(o, d);
        return `<div class="stats"><h4 class="lab">${esc(o.gmName)}'s lair</h4>${(info && info.lairActionsHtml) || '<p class="warn">The block names lair actions but lists none the sheet can find.</p>'}</div>`;
      }).join('') || '<p class="warn">No foe with lair actions is in the fight.</p>'}</div>`;
    }
    const w = words();
    const q = (v) => (isNum(v) ? v : '?');
    // the read-outs: HP (its tag when worked out), AC and the rolled initiative where the system has them, each pool,
    // and the boxes the system reads out (CoC's DEX; GURPS's Basic Speed and Dodge)
    const reads = [`HP ${q(r.hp)}/${q(r.max)}${r.temp ? ` +${r.temp}` : ''}${fromTag(r, 'max')}`];
    if (rowNumbers().includes('ac')) reads.push(`AC ${q(r.ac)}`);
    if (rolled()) reads.push(`Init ${isNum(r.ini) ? r.ini : '—'} (${sign(r.mod)})`);
    for (const p of FM.poolsOf(rules().fight || rules())) {
      if (isNum(r[p.key]) || isNum(r[p.max])) reads.push(`${p.label} ${q(r[p.key])}${p.max ? `/${q(r[p.max])}` : ''}${fromTag(r, p.max)}`);
    }
    for (const b of panelBoxes().filter((x) => x.readout)) reads.push(`${b.label} ${shownFigure(r[Fight.STAT_FIELDS[b.key][0]]) || '?'}${fromTag(r, b.key)}`);
    const nums = reads.map((x) => `<span>${esc(x)}</span>`);
    if (f.view.bloodied.has(r.id) && w.bloodied !== '') nums.push(`<span class="bl">${esc(w.bloodied || 'Bloodied')}</span>`);
    for (const m of marksOn(r)) nums.push(`<span class="mk">${esc(m)}</span>`);
    // every status, the ones the row's strip had no room for too; a click removes it, as on the row
    for (const x of Fight.statusesOf(r)) nums.push(`<button type="button" class="st" data-fun="${esc(`${r.id}|${statusKey(x)}`)}" title="Remove ${esc(x)}">${esc(x)} ✕</button>`);
    const ctr = counters(r, true);
    // offered while an untouched copy still differs from this row (a copy already made has nothing left to take)
    const keys = Fight.statKeysOf(FM.rulesOf(f));
    const left = FM.groupMates(f.view.rows, r).filter((x) => x !== r && FM.untouched(x, true) && (keys.some((k) => isNum(r[k]) && x[k] !== r[k]) || (isNum(r.max) && x.hp !== r.max))).length;
    if (left) {
      const all = FM.groupMates(f.view.rows, r).length;
      nums.push(`<button type="button" class="tg same" data-fsame="${esc(r.id)}" title="Copy these numbers (and the HP they give) to the others of this group nobody has typed into, hurt or given a status">Same for all ${all}</button>`);
    }
    // Three direct buttons, never a cycle: foe to neutral by one click must not pass through ally (an ally that
    // is seen shows its name and HP on the players' screen). Ally is last, each says what it does (P-A3).
    if (r.kind !== 'pc') {
      const now = FM.sideOfRow(r);
      nums.push(`<span class="sideSw" role="group" aria-label="Side"><span class="lab">Side:</span>${FM.SIDES.map((x) => `<button type="button" class="tg" data-fside="${x}" data-fsiderow="${esc(r.id)}" aria-pressed="${x === now}" title="${esc(SIDE_TITLES[x])}">${x}</button>`).join('')}</span>`);
    }
    let body = '';
    if (r.kind === 'pc') {
      body = '<p class="note">Players run their own sheets.</p>';
      // a caster PC's spells as the sheet writes them, folded (the acting panel is where the GM looks mid-cast)
      const pc = (model().pcs || []).find((x) => x.note === r.note);
      if (pc && pc.spellsHtml) body += `<details class="fold spells" data-fspells="${esc(pc.note)}" ${ui.spellsOpen[pc.note] ? 'open' : ''}><summary>Spells (from ${esc(first(pc.name))}'s sheet)</summary><div class="stats">${pc.spellsHtml}</div></details>`;
    }
    else {
      const info = foeInfo(r, d);
      // a row with no note (typed in the fight) has no vault to fill: its numbers are typed here (final review O4)
      const nonum = isNum(r.hp) ? '' : !r.note ? `${r.name}: no numbers yet: type them here`
        : ((info && info.prepNote) || `${r.name}: no numbers in the vault: type them here, or fill them in prep`);
      if (nonum) body += `<p class="warn">${esc(nonum)}</p>`;
      if (info && info.statsHtml) body += `<div class="stats">${info.statsHtml}</div>`;
      // D&D says when a row with numbers has no block; CoC and GURPS do not: a row with HP is complete (D3d)
      else if (!nonum && w.noBlock) body += `<p class="warn">${esc(w.noBlock)}</p>`;
    }
    return `<div class="act" id="acting">${head(r.gmName)}<div class="nums">${nums.join('')}</div>${ctr ? `<div class="nums ctr">${ctr}</div>` : ''}${boxesHTML(r)}${hitChipsHTML(r)}${trackHTML(r)}${body}</div>`;
  }
  // The hit chips (GURPS, Task 12): the damage types and places, the row's last used of each first. A tap writes its
  // word into the row's entry box for this entry only (the box empties after it), so nothing is ever a default.
  function hitChipsHTML(r) {
    const w = wounding();
    if (!w || !toggles().hitChips || !r.in || !isNum(r.hp)) return '';
    const last = ui.lastHit[r.id] || {};
    const now = boxHit(r.id);
    const chip = (kind, v, on) => `<button type="button" class="hchip" data-fh${kind}="${esc(`${r.id}|${v}`)}" aria-pressed="${on}">${esc(v)}</button>`;
    const types = FM.chipOrder(w.typeChips || Object.keys(w.types), last.type).map((v) => chip('type', v, now.type === v));
    const places = FM.chipOrder(w.locationChips || Object.keys(w.locations), last.location).map((v) => chip('loc', v, now.location === v));
    return `<div class="hitchips" data-fhits="${esc(r.id)}"><div class="hrow" role="group" aria-label="Damage type">${types.join('')}</div><div class="hrow" role="group" aria-label="Hit location">${places.join('')}</div></div>`;
  }
  // The hit words in a row's entry box now (its box, else the words kept for it).
  function boxHit(id) {
    const box = document.querySelector(attr('data-fhp', id));
    const v = box ? box.value : (ui.pending[id] || (ui.refused[id] && ui.refused[id].words) || '');
    return FM.hitWords(v, rules().fight || rules());
  }
  // The chips' pressed state follows the box's words.
  function syncHitChips(id) {
    const now = boxHit(id);
    document.querySelectorAll(`#acting .hitchips${attr('data-fhits', id)} .hchip`).forEach((b) => {
      const [, v] = split(b.dataset.fhtype || b.dataset.fhloc);
      b.setAttribute('aria-pressed', String(b.dataset.fhtype ? now.type === v : now.location === v));
    });
  }
  // A chip tapped: its word into (or, tapped again, out of) the box's words, the GM's damage kept; the caret after
  // the damage, so what is typed next is the damage.
  function tapHitChip(id, kind, v) {
    const box = document.querySelector(attr('data-fhp', id));
    if (!box) return;
    const h = FM.hitWords(box.value, rules().fight || rules());
    if (kind === 'type') h.type = h.type === v ? null : v;
    else {
      h.location = h.location === v ? null : v;
      const loc = h.location && wounding().locations[h.location];
      if (!loc || !loc.sided) h.side = null;
    }
    const tail = FM.hitText({ ...h, amount: '' });
    box.value = h.amount ? `${h.amount}${tail ? ` ${tail}` : ''}` : (tail ? ` ${tail}` : '');
    markPending(box);
    box.focus();
    const at = h.amount.length;
    box.setSelectionRange(at, at);
    syncHitChips(id);
  }
  // The panel's boxes (rules.panelBoxes, in Tab order), each a typed figure for setStat; a worked-out one keeps its tag.
  function boxesHTML(r) {
    const list = panelBoxes();
    if (!list.length) return '';
    return `<div class="pboxes">${list.map((b) => {
      const st = STAT[boxStat(b.key)];
      const v = shownFigure(r[Fight.STAT_FIELDS[b.key][0]]);
      const mode = st.words ? 'text' : st.decimal ? 'decimal' : 'numeric';
      const t = fromTag(r, b.key);
      const box = `<label class="pb"${t ? ` title="${esc(`${b.label}${t}`)}"` : ''}><span class="lab">${esc(b.label)}</span>${statBox(st.k, r, v, `class="pbox" inputmode="${mode}" autocomplete="off" aria-label="${esc(b.label)} for ${esc(r.gmName)}"`)}${t ? `<span class="from">${esc(t.trim())}</span>` : ''}</label>`;
      // a foe has one DR; its face may be bare (GURPS, Task 12): the toggle sits beside it
      const w = words();
      const face = b.key === 'dr' && wounding() && r.kind !== 'pc' && w.faceOpen
        ? `<button type="button" class="tg faceopen ${r.faceOpen ? 'on' : ''}" data-fface="${esc(r.id)}" aria-pressed="${!!r.faceOpen}" title="${esc(w.faceOpenTitle || '')}">${esc(w.faceOpen)}</button>` : '';
      return box + face;
    }).join('')}</div>`;
  }
  // GURPS's mark track: every mark the system names, the passed ones lit, the deepest minus-HP line passed marked.
  function trackHTML(r) {
    const marks = (rules().marks || []).filter((m) => m && m.name);
    if (!marks.length) return '';
    const on = new Set(r.marks || []);
    const deepest = isNum(r.deepest) ? r.deepest : 0;
    return `<ol class="mtrack" aria-label="Marks">${marks.map((m) => {
      const lit = on.has(m.name) || (isNum(m.times) && deepest >= m.times);
      const deep = isNum(m.times) && deepest === m.times;
      return `<li class="${[lit ? 'lit' : '', deep ? 'deep' : ''].join(' ').trim()}" data-mark="${esc(m.key || m.name)}">${esc(m.name)}</li>`;
    }).join('')}</ol>`;
  }

  // ------------------------------------------------------------------ drawing: the right column
  function sideHTML(d) {
    const f = d.fight;
    const view = f.view;
    let h = '<div class="fview"><div class="fo" id="fOrder"><div class="fotop">';
    h += `<div class="fh"><b>${f.started ? `Round ${esc(f.round)}` : 'Setting up'}</b>`
      // a system that works the order out (CoC's DEX, GURPS's Basic Speed) has nothing to roll
      + (rolled() ? '<button type="button" id="fRoll" title="Roll d20 + modifier for every ticked foe and ally with no number yet (never a PC)">Roll</button>' : '')
      + '<button type="button" id="fSort" title="Sort once by initiative; whose turn it is stays">Sort</button>'
      + `<button type="button" id="fNext" class="primary">${f.started ? 'Next ▸' : 'Start ▸'}</button><span class="sp"></span>`
      + `<button type="button" id="fArea" class="${ui.area ? 'on' : ''}" aria-pressed="${ui.area}" title="Tick several rows, type the damage once">Area</button>`
      + '<button type="button" id="fPause" title="Play the beat on (a bargain, a parley); every number is kept">Pause</button>'
      + `${RP.armBtn('fightEnd', 'End fight', 'id="fEnd"', 'End the fight: two clicks. Every status is kept')}`
      + `${RP.layout.pv ? '' : '<button type="button" id="fPvShow" title="Bring the players\' screen preview back">Players\' screen ▸</button>'}</div>`;
    const missing = ui.ask === f.id && !f.started ? missingInit(view) : [];
    if (missing.length) h += `<div class="fask">No initiative yet for ${esc(missing.map((r) => r.gmName).join(', '))}. Start anyway? <button type="button" id="fStartAnyway" class="primary">Start anyway</button> <button type="button" id="fAskNo">Not yet</button></div>`;
    // every group holding a ticked PC is in (proof M2); Add offers only the rest
    const inFight = FM.fightGroupKeys(f, RP.groups());
    // a group nobody stands in any more (its people joined another) goes once someone is in (PRENTICE's review 2)
    const someone = inFight.filter((g) => groupWho(g));
    h += `<div class="fin"><span class="muted">In this fight:</span> ${(someone.length ? someone : inFight).map((g) => `<span class="gchip">${esc(groupWho(g) || '—')} · ${esc(RP.groupLabel(g, d))}</span>`).join(' ')}</div>`;
    const others = RP.groups().filter((g) => !inFight.includes(g.key));
    h += `<div class="fadd"><span class="muted">Add:</span> ${others.map((g) => `<button type="button" data-faddgroup="${esc(g.key)}">+ ${esc(groupWho(g.key))} at ${esc(RP.groupLabel(g.key, d))}</button>`).join(' ')}`
      + contingencyAdds(f, d)
      + `<span class="addname"><input id="fAddName" value="${esc(ui.addText)}" placeholder="anyone, by name" autocomplete="off" aria-label="Add anyone in the cast to the fight"><span class="fhits" id="fHits">${hitsHTML()}</span></span>`
      + `<input id="fAddCount" type="number" min="1" max="20" value="${esc(ui.addCount)}" aria-label="How many"><button type="button" id="fAddGo">Add</button></div>`;
    h += joinsHTML(f);
    if (ui.area) {
      const n = f.rows.filter((r) => ui.sel[r.id] && r.in).length;
      const offer = areaOffer(f);
      h += `<div class="areabar"><b>Area</b> <span>${n} ticked</span> · ½ on each row that saved <input id="fAreaDmg" value="${esc(ui.areaDmg)}" placeholder="damage" inputmode="numeric" autocomplete="off" aria-label="Area damage">`
        + offer.names.map((x) => `<label class="spend"><input type="checkbox" data-fspend="${esc(x)}" ${offer.chosen === x ? 'checked' : ''}> spend ${esc(x)}</label>`).join('')
        + `<button type="button" id="fAreaGo" class="primary" ${n ? '' : 'disabled'}>Apply</button><button type="button" id="fAreaDone">Done</button></div>`;
    }
    h += `</div><ol class="to" data-keepscroll="order">${view.rows.map((r) => rowHTML(r, f, view)).join('')}</ol></div>`;
    h += `${actingHTML(d)}</div>`;
    return h;
  }
  // A contingency with people the fight does not hold yet: "+ If: …" brings them in (its foes, its allies).
  function contingencyAdds(f, d) {
    return d.beats.filter((b) => b.contingency && b.key !== f.beat).filter((b) => {
      const foes = b.foes || [];
      const people = (b.who || []).filter((w) => w.note);
      if (!foes.length && !people.length) return false;
      const haveFoe = (fo) => f.rows.some((r) => r.foeKey === fo.key);
      const havePerson = (w) => f.rows.some((r) => r.note === w.note);
      return !(foes.every(haveFoe) && people.every(havePerson));
    }).map((b) => {
      const t = b.title.length > 34 ? `${b.title.slice(0, 33)}…` : b.title;
      return `<button type="button" data-faddbeat="${esc(b.key)}" title="Bring this contingency's people into the fight: ${esc(b.title)}">+ If: ${esc(t)}</button>`;
    }).join(' ');
  }
  // The Add list is a row of the Add line, in flow: it never lies over the order (final review P-A1, re-review). It
  // closes on Esc at once, and after any press outside the Add control once that press's click has landed: closing
  // moves the order back up, so it must not happen under the pointer mid-press. The typed words stay in the box.
  function closeAddList() {
    if (!ui.addHits.length) return false;
    ui.addHits = [];
    const box = $('#fHits');
    if (box) box.innerHTML = '';
    return true;
  }
  // The count box and the Add button are the Add control's own: a press on them keeps the list (type a name, set
  // the count, then pick "+ New").
  const ADD_PARTS = '.addname, #fAddCount, #fAddGo';
  let closeOwed = false;
  const closeIfOwed = () => { if (!closeOwed) return; closeOwed = false; closeAddList(); };
  document.addEventListener('pointerdown', (ev) => {
    if (ui.addHits.length && !(ev.target.closest && ev.target.closest(ADD_PARTS))) closeOwed = true;
  }, true);
  window.addEventListener('click', () => setTimeout(closeIfOwed, 0));
  // a PC's spells fold stays as the GM left it through redraws
  document.addEventListener('toggle', (ev) => {
    const el = ev.target;
    if (el instanceof HTMLDetailsElement && el.dataset.fspells !== undefined) {
      if (el.open) ui.spellsOpen[el.dataset.fspells] = true; else delete ui.spellsOpen[el.dataset.fspells];
    }
  }, true);
  // A box that still holds typed words opens its list again when it is pressed or tabbed back into, as the Move box
  // does (PRENTICE's PR review 2)
  function reopenAddList(t) {
    if (!t || t.id !== 'fAddName' || !t.value.trim() || ui.addHits.length) return;
    ui.addHits = FM.addChoices(model().cast || [], t.value, RS.castSearch);
    const box = $('#fHits');
    if (box) box.innerHTML = hitsHTML();
  }
  document.addEventListener('pointerdown', (ev) => { if (ev.target && ev.target.id === 'fAddName') reopenAddList(ev.target); }, true);
  document.addEventListener('focusin', (ev) => reopenAddList(ev.target));
  document.addEventListener('pointerup', () => { if (closeOwed) setTimeout(closeIfOwed, 0); }, true);
  document.addEventListener('pointercancel', closeIfOwed, true);
  function hitsHTML() {
    return ui.addHits.map((c) => (c.isNew
      ? `<button type="button" class="new" data-faddnew="${esc(c.name)}">${esc(c.label)}</button>`
      : `<button type="button" data-faddpick="${esc(c.note)}">${esc(c.name)}<span class="t">${esc(c.type)}</span></button>`)).join('');
  }
  // The fight's join lines that can still be taken back: an add nobody has touched (fight-math's `undoable`).
  function undoLines(f) {
    return (state().events || []).filter((e) => e.fight && e.join && FM.undoable(f, e.join)).slice(-3).reverse();
  }
  function joinsHTML(f) {
    const lines = undoLines(f);
    if (!lines.length) return '';
    return `<div class="fjoins">${lines.map((e) => `<span class="fj">${esc(e.text)} <button type="button" data-fundo="${esc(e.join)}" title="Takes back the rows this add made">Undo</button></span>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ drawing: the beats column
  function pointsHTML(b, lit) {
    return `<ul class="pts">${(b.points || []).map((p) => {
      const st = (state().points[p.key] && state().points[p.key].mark) || '';
      return `<li class="${st}"><button class="ptb ${st}" data-pt="${esc(p.key)}" data-beat="${esc(b.key)}" type="button" aria-label="Mark this point">${PT[st]}</button><span class="pt-t">${lit.has(p.key) ? '<b class="now">NOW</b> ' : ''}${p.textHtml || esc(p.text)}</span></li>`;
    }).join('')}</ul>`;
  }
  function cutHTML(d) {
    const f = d.fight;
    const b = d.beats.find((x) => x.key === f.beat);
    const acting = actingOf(f).row;
    const jots = `<div class="bbtns">${[['dropped', `${acting ? acting.gmName : 'Someone'} dropped.`], ['bargain', 'Bargain offered.'], ['contingency', 'Contingency fired.']]
      .map(([k, t]) => `<button type="button" data-fjot="${esc(t)}" title="Jot it to the fight's beat">Jot: ${esc(t)}</button>`).join('')}</div>`;
    if (!b) return `<div class="cut gone" id="fightCut"><h2>⚔ ${esc(f.title)}</h2><p class="warn">This fight's beat is no longer in the Plan</p>${jots}</div>`;
    const lit = f.view.lit;
    let h = `<div class="cut" id="fightCut"><h2>⚔ ${esc(b.title)} <a class="lk" data-pane="beat" title="The whole beat in this pane">full beat ↓</a></h2>`;
    if ((b.points || []).length) h += `<h4 class="lab">Points to land</h4>${pointsHTML(b, lit)}`;
    if ((b.who || []).length || (b.arrivals || []).length) {
      // an unmasked person goes by the unmasked name and play-as, as on the full beat
      h += `<h4 class="lab">Who's here</h4><div class="cwho">${(b.who || []).map((w) => {
        const um = w.note ? RP.unmaskOf(w.note) : null;
        const on = um && RP.isUnmasked(d, w.note);
        const name = on ? um.name : w.name;
        const pa = on && um.playAs ? esc(um.playAs) : (w.playAsHtml || esc(w.playAs || ''));
        return `<div>${w.note ? RP.face(w.note, 'face', d) : ''} <b>${w.note ? RP.link(w.note, name) : esc(name)}</b>${pa ? ` <span class="muted">${pa}</span>` : ''}</div>`;
      }).join('')}${(b.arrivals || []).map((a) => RP.cueHTML(b, a, new Set())).join('')}</div>`;
    }
    // a fight at a place moved nobody there (Part 6 call 4): say so, and who stands there
    if (b.placeBeat) {
      const there = (model().pcs || []).filter((p) => { const x = state().positions[p.note]; return x && x.beat === b.key; });
      h += `<p class="note">${b.newPlace ? 'A place typed tonight. ' : ''}Fight here moves nobody: ${there.length ? `${esc(there.map((p) => first(p.name)).join(', '))} ${there.length > 1 ? 'stand' : 'stands'} here` : 'no PC stands here'}.</p>`;
    }
    if ((b.ifs || []).length) {
      h += `<h4 class="lab">If they…</h4><div class="tw"><table class="ifs"><tbody>${b.ifs.map((r) => `<tr class="${lit.has(r.key) ? 'lit' : ''}"><td>${lit.has(r.key) ? '<b class="now">NOW</b> ' : ''}${r.doHtml || esc(r.do)}</td><td>${r.thenHtml || esc(r.then)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    return `${h}${jots}</div>`;
  }
  // Paused: a strip of the order (names, foes' HP) kept at the top of the beats, with Resume.
  function stripHTML(d) {
    const f = d.fight;
    const items = f.view.rows.filter((r) => r.in && r.kind !== 'lair').map((r) => {
      const hp = r.kind === 'foe' && isNum(r.hp) ? ` <span class="h">${r.hp}/${isNum(r.max) ? r.max : '?'}</span>` : '';
      return `<li class="${f.turn === r.id ? 'cur' : ''} ${r.out ? 'out' : ''}">${esc(r.gmName)}${hp}</li>`;
    }).join('');
    return `<div class="pstrip" id="fightStrip"><b>Fight paused</b><span class="muted">${f.started ? `round ${esc(f.round)}` : 'not started'}</span><ol>${items}</ol><button type="button" id="fResume" class="primary">Resume</button></div>`;
  }
  function afterHTML(d) {
    const a = d.afterFight;
    return `<div class="after" id="afterFight"><div class="ah"><b>After the fight${a.title ? ` at ${esc(a.title)}` : ''}</b><span class="note">Nothing ends because the fight did: clear what the rules end.</span><button type="button" id="fAfterAll">Clear all</button></div><ul>${a.rows.map((r) => `<li><b>${esc(r.name)}</b> ${r.statuses.map((st) => `<button type="button" class="chip" data-fafter="${esc(`${r.id}|${st}`)}" title="Clear ${esc(st)}">${esc(st)} ✕</button>`).join('')}</li>`).join('')}</ul></div>`;
  }
  const lastFight = () => { const fs = state().fights || []; return fs[fs.length - 1] || null; };

  // ------------------------------------------------------------------ the part
  const part = {
    // every focusable control the fight draws that has no id, so a redraw puts focus back on it (proof N1: a status
    // select pressed while a typed number committed lost focus to the page). Controls with an id (the Add box, the
    // count, Roll, Next, the area box…) are found by it.
    focusAttrs: ['data-fini', 'data-fhp', 'data-fmax', 'data-fac', 'data-ffpmax', 'data-fother', 'data-fstatus', 'data-ftick', 'data-fsel',
      'data-fseen', 'data-fhalf', 'data-fahalf', 'data-fres', 'data-fout', 'data-fgun', 'data-fds', 'data-flr', 'data-fla', 'data-frch',
      'data-fun', 'data-fsame', 'data-fside', 'data-fundo', 'data-faddgroup', 'data-faddbeat', 'data-faddpick', 'data-faddnew',
      'data-fspend', 'data-fafter', 'data-fjot', 'data-fight', 'data-fplace', ...PANEL_KEYS.map((k) => `data-fs-${k}`)],
    // Fight here on a place tile or a place's drawer (plan 6a Task 7); nothing while a fight runs
    placeButtons(note) {
      if (!allowed() || state().fight || !(model().placeKeys || {})[note]) return '';
      return `<button type="button" data-fplace="${esc(note)}" title="Fight here: the place's creatures are ticked in, its people benched; only PCs standing here are ticked, and nobody moves">Fight here</button>`;
    },
    beatButtons(b) {
      if (!allowed()) return '';
      const f = state().fight;
      if (!f) return `<button type="button" data-fight="${esc(b.key)}" title="Fight here: the beat's foes and allies, and the PCs standing here, are ticked in">Fight</button>`;
      if (f.beat === b.key) return '';
      return `<button type="button" data-faddbeat="${esc(b.key)}" title="Bring this beat's PCs, foes and allies into the fight">Add to the fight</button>`;
    },
    side() {
      const s = state();
      const f = s.fight;
      if (f && ui.fightId !== f.id) { ui.fightId = f.id; endArea(); ui.other = {}; ui.peek = null; }
      // another window's fight won the race (decision 1)
      if (ui.mine && f && f.id !== ui.mine && !(s.fights || []).some((x) => x.id === ui.mine)) {
        ui.mine = null;
        setTimeout(() => RP.note('A fight is already running; this page now shows it.', { id: `race:${f.id}` }), 0);
      }
      if (!f || f.paused) return null;
      return sideHTML(RP.derived());
    },
    // The right pane in a fight (plan 6a Task 10): the cut, under the fight's title; nothing paused or after.
    pane(d) {
      const f = state().fight;
      if (!f || f.paused) return null;
      const b = d.beats.find((x) => x.key === f.beat);
      return { title: b ? b.title : f.title, beat: f.beat, cut: cutHTML(d) };
    },
    sheetTop(d) {
      const f = state().fight;
      if (f) return f.paused ? stripHTML(d) : cutHTML(d);
      const last = lastFight();
      if (d.afterFight && !(last && d.beats.some((b) => b.key === last.beat))) return afterHTML(d);
      return '';
    },
    beforeBeat(b) {
      if (state().fight) return '';
      const last = lastFight();
      if (!last || last.beat !== b.key) return '';
      const d = RP.derived();
      return d.afterFight ? afterHTML(d) : '';
    },
    click(ev) { return onClick(ev); },
    // after every layout pass (gm.js applyLayout): the rows' status strips fit their room
    afterLayout() { fitChips(); },
    probe() {
      const d = RP.derived();
      const out = { fight: null, after: d.afterFight, layout: layout() };
      const f = d.fight;
      if (f) {
        const acting = $('#acting h3');
        out.fight = {
          id: f.id, groups: f.groups, turn: f.turn, round: f.round, started: f.started, paused: f.paused, area: ui.area,
          ask: Boolean($('.fask')), actingName: acting ? acting.textContent : null,
          actingStatuses: Array.from(document.querySelectorAll('#acting .nums .st'), (b) => b.textContent.replace(/ ✕$/, '')),
          rows: f.view.rows.map((r) => ({
            id: r.id, note: r.note, copy: r.copy, kind: r.kind, side: sideWord(r), name: r.gmName, in: r.in, ini: isNum(r.ini) ? r.ini : null, mod: r.mod,
            hp: r.hp, max: r.max, ac: r.ac, temp: r.temp, conds: r.conds, exhaustion: r.exhaustion, conc: r.conc, out: r.out, seen: r.seen,
            recharge: (r.recharge || []).map((x) => ({ name: x.name, ready: x.ready, rolled: x.rolled })),
            // the systems' figures (step 6b)
            fp: r.fp, fpMax: r.fpMax, mp: r.mp, mpMax: r.mpMax, san: r.san, sanMax: r.sanMax, dex: r.dex, st: r.st, ht: r.ht, dx: r.dx,
            speed: r.speed, fighting: r.fighting, marks: r.marks, deepest: r.deepest, tired: r.tired, gun: r.gun, from: r.from,
            er: r.er, erMax: r.erMax, caster: r.caster, dr: r.dr, faceOpen: r.faceOpen, hit: r.hit, crippled: r.crippled,
          })),
        };
      }
      return out;
    },
  };
  function layout() {
    const box = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
    const ol = box('#side ol.to');
    const act = box('#acting');
    const cut = box('#fightCut');
    const after = box('#afterFight');
    const r = (v) => (v == null ? null : Math.round(v));
    return {
      ...RP.layoutProbe(),
      orderBottom: r(ol && ol.bottom), orderRight: r(ol && ol.right), actingTop: r(act && act.top), actingLeft: r(act && act.left),
      cutTop: r(cut && cut.top), afterTop: r(after && after.top),
      wide: document.documentElement.scrollWidth > window.innerWidth,
      rows: Array.from(document.querySelectorAll('#side ol.to > li[data-frow]'), (li) => ({
        id: li.dataset.frow, name: (li.querySelector('.nm') || {}).textContent, h: Math.round(li.getBoundingClientRect().height),
        over: li.scrollWidth > li.clientWidth + 1, nameCut: (() => { const n = li.querySelector('.nm'); return Boolean(n) && n.scrollWidth > n.clientWidth + 1; })(),
        statuses: Boolean(li.querySelector('.chip')),
        line2: (() => { const l = li.nextElementSibling; return l && l.dataset.row2 === li.dataset.frow ? l.textContent : null; })(),
      })),
    };
  }

  // ------------------------------------------------------------------ events
  const rowById = (id) => { const f = state().fight; return f ? f.rows.find((r) => r.id === id) || null : null; };
  const split = (v) => { const i = String(v).indexOf('|'); return [v.slice(0, i), v.slice(i + 1)]; };

  function onClick(ev) {
    const t = ev.target.closest('button, input[type="checkbox"], [data-fpeek]');
    if (!t || t.disabled) return false;
    const d = t.dataset;
    const f = state().fight;
    if (d.fight) { startFight(d.fight); return true; }
    if (d.fplace) { fightHere(d.fplace); return true; }
    if (d.faddbeat) { addTo({ beat: d.faddbeat }); return true; }
    if (d.fafter) { const [row, st] = split(d.fafter); const lf = lastFight(); if (lf) RP.dispatch({ type: 'afterClear', fight: lf.id, row, status: st }); return true; }
    if (t.id === 'fAfterAll') { const lf = lastFight(); if (lf) RP.dispatch({ type: 'afterClearAll', fight: lf.id }); return true; }
    if (!f) return false;
    if (t.id === 'fRoll') { rollInit(); return true; }
    if (t.id === 'fSort') { F({ type: 'fightSort' }); return true; }
    if (t.id === 'fNext') { next(false); return true; }
    if (t.id === 'fStartAnyway') { next(true); return true; }
    if (t.id === 'fAskNo') { ui.ask = null; RP.render(); return true; }
    if (t.id === 'fArea') { if (ui.area) endArea(); else ui.area = true; RP.render(); return true; }
    if (t.id === 'fAreaDone') { endArea(); RP.render(); return true; }
    if (t.id === 'fAreaGo') { applyArea(); return true; }
    if (t.id === 'fPause') { RP.ui.focus = f.beat; F({ type: 'fightPause', on: true }); scrollToBeat(f.beat); return true; }
    if (t.id === 'fResume') { RP.ui.pane = 'cut'; F({ type: 'fightPause', on: false }); scrollToCut(); return true; }
    if (t.id === 'fEnd') {
      RP.armed('fightEnd', () => {
        RP.ui.pane = 'cut';
        F({ type: 'fightEnd' });
        scrollTo($('#afterFight'));
      });
      return true;
    }
    if (t.id === 'fAddGo') {
      const box = $('#fAddName');
      const text = (box || {}).value || '';
      if (text.trim() && !addTop(text) && box) { box.setCustomValidity(NO_ONE); box.reportValidity(); }
      return true;
    }
    if (d.faddpick) { addByName(d.faddpick); return true; }
    if (d.faddnew) { addByName(null, d.faddnew); return true; }
    if (d.fundo) { F({ type: 'undoAdd', join: d.fundo }); return true; }
    if (d.fsame) { F({ type: 'sameForAll', row: d.fsame }); return true; }
    if (d.faddcast) { addTo({ cast: d.faddcast, count: 1 }); return true; }
    if (d.faddgroup) { addTo({ group: d.faddgroup }, `${groupWho(d.faddgroup)} at ${RP.groupLabel(d.faddgroup)}`); return true; }
    if (d.fspend !== undefined) {
      const offer = areaOffer(f);
      ui.spend[offer.key] = t.checked ? d.fspend : null;
      RP.render();
      return true;
    }
    if (d.fjot) { RP.dispatch({ type: 'jot', beat: f.beat, text: d.fjot, title: f.title }); return true; }
    if (d.fpeek) { ui.peek = ui.peek === d.fpeek ? null : d.fpeek; RP.render(); return true; }
    if (d.fhtype || d.fhloc) { const [rid, v] = split(d.fhtype || d.fhloc); tapHitChip(rid, d.fhtype ? 'type' : 'location', v); return true; }
    if (d.fface) { const x = rowById(d.fface); if (x) F({ type: 'faceOpen', row: x.id, on: !x.faceOpen }); return true; }
    const id = d.ftick || d.fsel || d.fahalf || d.fhalf || d.fres || d.fseen || d.fout || d.flr;
    const r = rowById(id || '');
    if (d.ftick && r) { F({ type: 'fightTick', row: r.id, in: t.checked }); return true; }
    if (d.fsel && r) { ui.sel[r.id] = t.checked; RP.render(); return true; }
    if (d.fahalf && r) { ui.ahalf[r.id] = !ui.ahalf[r.id]; RP.render(); return true; }
    if (d.fhalf && r) { F({ type: 'half', row: r.id, on: !r.half }); return true; }
    if (d.fres && r) { F({ type: 'resisted', row: r.id, on: !r.resisted }); return true; }
    if (d.fside && d.fsiderow) { const x = rowById(d.fsiderow); if (x && FM.isSide(d.fside)) F({ type: 'setSide', row: x.id, side: d.fside }); return true; }
    if (d.fseen && r) { F({ type: 'seen', row: r.id, on: !r.seen }); return true; }
    if (d.fgun) { const x = rowById(d.fgun); if (x) F({ type: 'firearm', row: x.id, on: !x.gun }); return true; }
    if (d.fout && r) { F({ type: 'out', row: r.id, on: !r.out }); return true; }
    if (d.flr && r) { F({ type: 'counter', row: r.id, kind: 'lr', value: r.lr > 0 ? r.lr - 1 : r.lrMax }); return true; }
    if (d.fla) { const [rid, n] = split(d.fla); const x = rowById(rid); if (x) F({ type: 'counter', row: x.id, kind: 'la', value: x.la - Number(n) }); return true; }
    if (d.frch) {
      const [rid, name] = split(d.frch);
      const x = rowById(rid);
      const rc = x && (x.recharge || []).find((y) => y.name === name);
      if (rc) F({ type: 'recharge', row: x.id, name, ready: !rc.ready });
      return true;
    }
    if (d.fds) {
      const [rid, k] = split(d.fds);
      const x = rowById(rid);
      const ds = (x && x.ds) || { s: 0, f: 0 };
      if (x) F({ type: 'deathSave', row: x.id, [k]: ((ds[k] || 0) + 1) % 4 });
      return true;
    }
    if (d.fun) {
      const [rid, st] = split(d.fun);
      if (st === 'Exhaustion') F({ type: 'exhaustion', row: rid, level: 0 });
      else if (st === 'Concentrating') F({ type: 'concentrating', row: rid, on: false });
      else F({ type: 'status', row: rid, remove: st });
      return true;
    }
    return false;
  }

  // The stat boxes: which key each is, and what it takes. An empty box clears the number. The row's: initiative (with
  // the system's decimals: GURPS's 5.25), max HP, AC, and a pool's max (GURPS's FP); the panel's (rules.panelBoxes),
  // one per figure setStat takes (`stat`), each `data-fs-<key>`: a number, Speed with two places, Build signed, DR and
  // DB words or a number.
  const STAT = {
    fini: { k: 'data-fini', ok: /^-?\d{1,3}$/ },
    fmax: { k: 'data-fmax', ok: /^\d{1,4}$/ },
    fac: { k: 'data-fac', ok: /^\d{1,4}$/ },
    // the one boxed pool's max (GURPS's FP); a second boxed pool needs its own entry (see poolsHTML)
    ffpmax: { k: 'data-ffpmax', ok: /^\d{1,4}$/, stat: 'fp' },
  };
  const PANEL_OK = { speed: /^\d{1,2}(?:\.\d{1,2})?$/, build: /^[+-]?\d{1,2}$/, db: /^\S.{0,39}$/, dr: /^\S.{0,39}$/ };
  // `data-fs-dex` is `dataset.fsDex`
  function boxStat(key) { return `fs${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`; }
  for (const key of PANEL_KEYS) {
    STAT[boxStat(key)] = { k: `data-fs-${key}`, ok: PANEL_OK[key] || /^\d{1,3}$/, stat: key, panel: true, words: key === 'db' || key === 'dr', decimal: key === 'speed' };
  }
  const initPlaces = () => { const n = rules().initDecimals; return isNum(n) && n > 0 ? Math.floor(n) : 0; };
  // initiative takes the system's decimals (GURPS's 5.25), never more
  const okOf = (f) => (f === 'fini' && initPlaces() ? new RegExp(`^-?\\d{1,3}(?:\\.\\d{1,${initPlaces()}})?$`) : STAT[f].ok);
  const FIELD = { fini: 'ini', fmax: 'max', fac: 'ac' };
  const fieldOf = (f) => FIELD[f] || Fight.STAT_FIELDS[STAT[f].stat][0];
  const shown = (r, f) => shownFigure(r[fieldOf(f)]);
  const statOf = (t) => { const d = (t && t.dataset) || {}; for (const f of Object.keys(STAT)) if (d[f] !== undefined) return f; return null; };

  // Words that are not a number mark the box and stay in it; the state is unchanged, and focus is never
  // taken back (review F5: reportValidity put it back, and whatever was typed next went into the bad box).
  function markBad(t, f, on) {
    const key = badKey(STAT[f].k, t.dataset[f]);
    const r = rowById(t.dataset[f]);
    if (on && r) ui.bad[key] = { words: t.value, was: shown(r, f) }; else delete ui.bad[key];
    if (on) t.setAttribute('aria-invalid', 'true'); else t.removeAttribute('aria-invalid');
    syncLine2(t.dataset[f]);
  }
  // An entry the row cannot take: its words stay in the box, the reason on the row's second line, selected so what
  // the GM types next replaces it (Task 10's path; Task 12's hit words a system cannot read too).
  function refuse(t, why) {
    ui.refused[t.dataset.fhp] = { words: t.value, why };
    markPending(t);
    t.select();
  }

  // Damage typed into a row's box and not applied (P4.1): marked until Enter applies it or the box is emptied.
  // Never applied on leaving the box: a slip would hurt a row.
  function markPending(t) {
    const id = t.dataset.fhp;
    const v = t.value;
    // a refused entry stays refused while its words are in the box; any change clears the reason
    if (ui.refused[id] && ui.refused[id].words !== v) delete ui.refused[id];
    if (v.trim() && !ui.refused[id]) ui.pending[id] = v; else delete ui.pending[id];
    t.classList.toggle('pending', Boolean(v.trim()));
    syncLine2(id);
  }

  // A stat box sends its number, when it changed: initiative, max HP, AC, or a figure setStat takes. False for words
  // that are not one.
  function commitStat(t) {
    const f = statOf(t);
    const r = f && rowById(t.dataset[f]);
    if (!r) return true;
    const v = t.value.trim();
    if (v !== '' && !okOf(f).test(v)) { markBad(t, f, true); return false; }
    markBad(t, f, false);
    if (STAT[f].stat) {
      // a figure for setStat: a number where it is one (`+1` is 1), else the words (DR's `2 (face 0)`, DB's `+1D4`)
      const value = v === '' ? null : /^[+-]?\d+(?:\.\d+)?$/.test(v) ? Number(v) : v;
      if (shownFigure(value) !== shown(r, f)) F({ type: 'setStat', row: r.id, key: STAT[f].stat, value });
      return true;
    }
    const n = v === '' ? null : Number(v);
    if (f === 'fini' && n !== (isNum(r.ini) ? r.ini : null)) F({ type: 'setInit', row: r.id, ini: n });
    if (f === 'fmax' && n !== r.max) F({ type: 'setMax', row: r.id, max: n });
    if (f === 'fac' && n !== r.ac) F({ type: 'setAc', row: r.id, ac: n });
    return true;
  }

  // Where Tab goes from a stat box, by row id and field, found in the order as it stands before the commit,
  // so a row the commit re-places (an initiative after Start) never moves the target:
  // - an initiative box walks down the initiative column (spec §6.4 C2, as in 5b);
  // - max HP goes to the same row's AC (GURPS: its max FP), and that to the next row's max HP (review F4);
  // - a panel box goes to the next box of the panel, in the system's order (rules.panelBoxes).
  // Shift reverses each. Past either end: null, and Tab leaves the boxes as it does anywhere.
  function tabTarget(t, f, back) {
    const id = t.dataset[f];
    const col = (k) => Array.from(document.querySelectorAll(`[${k}]`), (b) => b.getAttribute(k));
    if (f === 'fini') {
      const ids = col('data-fini');
      const to = ids[ids.indexOf(id) + (back ? -1 : 1)];
      return to === undefined ? null : attr('data-fini', to);
    }
    if (STAT[f].panel) {
      const boxes = Array.from(document.querySelectorAll('#acting .pbox'));
      const to = boxes[boxes.indexOf(t) + (back ? -1 : 1)];
      const tf = to && statOf(to);
      return tf ? attr(STAT[tf].k, id) : null;
    }
    // max HP's partner on the row: AC (D&D) or the pool's max (GURPS's FP)
    const pair = (rid) => ['data-fac', 'data-ffpmax'].find((k) => document.querySelector(attr(k, rid)));
    const rows = col('data-fmax');
    const i = rows.indexOf(id);
    if (f === 'fmax') {
      if (!back) { const k = pair(id); return k ? attr(k, id) : null; }
      if (i <= 0) return null;
      const k = pair(rows[i - 1]);
      return attr(k || 'data-fmax', rows[i - 1]);
    }
    if (back) return attr('data-fmax', id);
    return i >= 0 && i + 1 < rows.length ? attr('data-fmax', rows[i + 1]) : null;
  }

  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const d = (t && t.dataset) || {};
    if (ev.isComposing) return;
    if (ev.key === 'Escape' && t.closest && t.closest(ADD_PARTS) && closeAddList()) {
      const box = $('#fAddName');
      if (box) box.focus();
      ev.preventDefault();
      return;
    }
    // Esc empties a damage or healing box that was typed in and not applied (PRENTICE's PR review 2, D3)
    if (ev.key === 'Escape' && d.fhp !== undefined) {
      ev.preventDefault();
      t.setCustomValidity('');
      t.value = '';
      markPending(t);
      return;
    }
    const f = statOf(t);
    // Esc takes back what was typed (final review P-A4): the box holds its saved number again, selected, nothing
    // is sent, and focus stays
    if (f && ev.key === 'Escape') {
      const r = rowById(t.dataset[f]);
      if (!r) return;
      ev.preventDefault();
      markBad(t, f, false);
      t.value = shown(r, f);
      t.dataset.committed = t.value;
      t.select();
      return;
    }
    if (f && (ev.key === 'Enter' || ev.key === 'Tab')) {
      const to = ev.key === 'Tab' ? tabTarget(t, f, ev.shiftKey) : null;
      if (ev.key === 'Enter' || to) ev.preventDefault();
      // committed here: the browser's `change` when focus leaves sends nothing and redraws nothing again
      t.dataset.committed = t.value;
      commitStat(t);
      if (to) RP.focusTo(to);
      return;
    }
    if (ev.key !== 'Enter') return;
    if (d.fhp !== undefined) {
      ev.preventDefault();
      const e = FM.parseEntry(t.value, FM.rulesOf(state().fight));
      // a system that reads hits (GURPS) keeps words it cannot read in the box, its reason on the row's second line
      if (!e && wounding()) { refuse(t, words().entryInvalid || INVALID); return; }
      if (!e) { t.setCustomValidity(words().entryInvalid || INVALID); t.reportValidity(); return; }
      // the GM picks the pool: an entry into a pool the row has no figure in (e-3 with no Energy Reserve, f-3 with no
      // FP) is refused, never paid from another pool instead
      const row = rowById(d.fhp);
      const pool = e.pool !== 'hp' && e.pool !== 'temp' ? FM.poolOf(FM.rulesOf(state().fight), e.pool) : null;
      if (pool && row && !isNum(row[pool.key])) {
        const w = words();
        const own = { er: w.noReserve, fp: w.noFp }[pool.key];
        refuse(t, own || `No ${pool.label || pool.key} on this row`);
        return;
      }
      const entry = t.value;
      t.value = '';
      markPending(t);
      if (e.hit) ui.lastHit[d.fhp] = { type: e.hit.type, location: e.hit.location };
      if (!e.dice) { F({ type: 'hp', row: d.fhp, entry }); return; }
      // dice are the server's: the hit goes with the roll (the reducer never rolls)
      const f = state().fight;
      roll([{ damage: e.dice, ...(e.hit ? { type: e.hit.type } : {}) }]).then(([res]) => {
        const now = state().fight;
        if (now && f && now.id === f.id) RP.dispatch({ fight: f.id, type: 'hp', row: d.fhp, entry, rolled: res.total });
      }, (err) => {
        rollFailed(err);
        // the words go back in the box, as typed
        ui.pending[d.fhp] = entry;
        RP.render();
      });
      return;
    }
    if (d.fother !== undefined) {
      ev.preventDefault();
      const v = t.value.trim();
      if (!v) return;
      ui.other[d.fother] = false;
      t.value = '';
      F({ type: 'status', row: d.fother, add: v });
      return;
    }
    if (t.id === 'fAddName') {
      ev.preventDefault();
      if (!t.value.trim()) return;
      if (!addTop(t.value)) { t.setCustomValidity(NO_ONE); t.reportValidity(); }
      return;
    }
    if (t.id === 'fAreaDmg') { ev.preventDefault(); applyArea(); }
  });
  // A box already committed (by Tab or Enter) and not typed in since sends nothing more.
  const committed = (t) => t.dataset.committed !== undefined && t.dataset.committed === t.value;

  // Every number box selects what it holds when it is clicked or tabbed into, so a typed 3 replaces the 1
  // (or the 21) instead of making 13 (or 291). A focus handler alone is undone by the press's own caret
  // (review F6), so a box this press focused selects again on the release.
  // A press on a box that already has focus selects too, unless the press dragged out a selection of its own.
  const NUMBER_BOX = '[data-fini], [data-fmax], [data-fac], [data-ffpmax], #acting .pbox, #fAddCount';
  let pressed = null;
  document.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest && ev.target.closest(NUMBER_BOX);
    pressed = b ? { b, x: ev.clientX, y: ev.clientY } : null;
  }, true);
  document.addEventListener('pointerup', (ev) => {
    const b = ev.target.closest && ev.target.closest(NUMBER_BOX);
    const was = pressed;
    pressed = null;
    if (!b || !was || was.b !== b || document.activeElement !== b) return;
    const dragged = Math.abs(ev.clientX - was.x) > 3 || Math.abs(ev.clientY - was.y) > 3;
    const own = typeof b.selectionStart === 'number' && b.selectionStart !== b.selectionEnd;
    if (dragged && own) return;
    b.select();
    selectAfter = b;
  }, true);
  // A release inside a selection puts the caret where it landed once the click is done, after every handler here,
  // so 41 typed into a 21 that Esc left selected made 2411 (PRENTICE's review 2, D1): select again after it.
  // A key pressed before that comes round selects first, so the number is replaced whatever the timing.
  let selectAfter = null;
  let armed = null;
  document.addEventListener('mouseup', () => {
    const b = selectAfter;
    selectAfter = null;
    if (!b) return;
    armed = b;
    setTimeout(() => { if (armed === b) { armed = null; if (document.activeElement === b) b.select(); } }, 0);
  }, true);
  document.addEventListener('keydown', () => {
    const b = armed;
    armed = null;
    if (b && document.activeElement === b) b.select();
  }, true);
  document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches(NUMBER_BOX)) ev.target.select(); });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.setCustomValidity) t.setCustomValidity('');
    const f = statOf(t);
    if (f) {
      delete t.dataset.committed;
      // a marked box keeps its words through a redraw while they are worked on
      const key = badKey(STAT[f].k, t.dataset[f]);
      if (ui.bad[key]) ui.bad[key].words = t.value;
    }
    if (t.dataset && t.dataset.fhp !== undefined) { markPending(t); syncHitChips(t.dataset.fhp); }
    if (t.id === 'fAddName') {
      ui.addText = t.value;
      ui.addHits = FM.addChoices(model().cast || [], t.value, RS.castSearch);
      const box = $('#fHits');
      if (box) box.innerHTML = hitsHTML();
    }
    if (t.id === 'fAddCount') ui.addCount = t.value;
    if (t.id === 'fAreaDmg') ui.areaDmg = t.value;
  });

  // A redraw from another window puts a half-typed number back into a new box, which then fires no `change`
  // when it is left: leaving it commits what it holds (the same number again sends nothing). Never on the
  // redraw itself, so a max half typed (4 of 45) never cuts the HP to it.
  document.addEventListener('focusout', (ev) => {
    const t = ev.target;
    const d = (t && t.dataset) || {};
    if (!statOf(t)) return;
    // after the redraw that may be under way: a box it replaced is gone, and its words are in the new one
    setTimeout(() => {
      if (!t.isConnected || document.activeElement === t || committed(t)) return;
      commitStat(t);
    }, 0);
  });

  // A box the redraw removes fires change in the middle of the redraw. When the redraw drew it again, its
  // half-typed words are in the new box (sent when it is left, never on the redraw). When it is gone for good
  // (another window unticked the row), its number is sent from the old box, and focus that fell to nothing
  // goes to the same box on the next row that has one, else to Next.
  function afterDraw(t) {
    const f = statOf(t);
    const id = t.dataset[f];
    const k = STAT[f].k;
    setTimeout(() => {
      if (document.querySelector(attr(k, id))) return;
      commitStat(t);
      const a = document.activeElement;
      if (a && a !== document.body) return;
      const fi = state().fight;
      const ids = fi ? fi.rows.map((r) => r.id) : [];
      const i = ids.indexOf(id);
      const near = ids.slice(i + 1).concat(ids.slice(0, Math.max(0, i)).reverse());
      const to = near.find((x) => document.querySelector(attr(k, x)));
      if (to) RP.focusTo(attr(k, to));
      else { const nx = $('#fNext'); if (nx) nx.focus(); }
    }, 0);
  }

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    const d = t.dataset || {};
    if (statOf(t)) {
      if (committed(t)) return;
      if (RP.drawing()) { afterDraw(t); return; }
      commitStat(t);
      return;
    }
    if (d.fstatus !== undefined) {
      const v = t.value;
      t.value = '';
      const m = /^Exhaustion (\d)$/.exec(v);
      if (!v) return;
      if (v === 'other') {
        ui.other[d.fstatus] = true;
        RP.render();
        const box = document.querySelector(attr('data-fother', d.fstatus));
        if (box) box.focus();
      } else if (m) F({ type: 'exhaustion', row: d.fstatus, level: Number(m[1]) });
      else if (v === 'Concentrating') F({ type: 'concentrating', row: d.fstatus, on: true });
      else F({ type: 'status', row: d.fstatus, add: v });
    }
  });

  RP.parts.push(part);
}());
