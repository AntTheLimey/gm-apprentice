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
  // GURPS's cards (Task 13): their lines, targets and offers, the reducer's own helpers
  const GMath = window.RunSheetGurpsMath || null;
  // CoC's melee (Task 16): the levels, the dice on an attack and the result line, the reducer's own helpers
  const CMath = window.RunSheetCocMath || null;
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
  // the entry box's refusal comes from the system (rules.words.entryInvalid); this is only for a model that has none
  const INVALID = 'Not a number the box takes';

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
    // GURPS's cards (Task 13): a card whose roll is out at the server (card id -> true), the row whose shock chip is
    // open for a size, and the cards already brought into view once
    rolling: {}, shockPick: null, cardsSeen: new Set(),
    // GURPS's defences (Task 14): a defence whose roll is out at the server ("row|dodge" -> true), and the row whose
    // used Block was tapped once, so the next tap rolls it again
    defRolling: {}, blockAsk: null, aodAsk: null,
    // CoC's melee (Task 16), the page's only until the exchange is sent: the stepper's dice for an attack on a row
    // (row id -> net, bonus above 0; none means the row's own: outnumbered, Prone), cleared when the turn moves; the
    // open exchange ({ fight, turn, target, attacker, response, dice, net, why, byHand, attack, defence, rolling })
    mdice: {}, melee: null, meleeTurn: null,
    // CoC's damage box (Task 17): the one an exchange opened ({ fight, n, by, on, mode, entry, offer, rolling }), the
    // last exchange seen (so one closed stays closed), the exchange this page sent (its box takes focus), the row to
    // focus after the draw; and, page memory for the night, each attacker's and group's last entry and each weapon's
    // impaling toggle (off unless tapped)
    dmg: null, dmgSeen: null, dmgMine: null, dmgFocus: null, dmgClear: null, lastDmg: {}, impale: {},
    // CoC's Shoot strip (Task 19), the page's only until the shot is sent: the open strip ({ fight, turn, shooter,
    // target, range, chips: { key: true }, gun, mal (the malfunction box's words), dive: { passed } | null, diveAsk,
    // diveRolling, rolling, last: the last shot's line }), and the chips last used by shooter and target this turn
    shot: null, shotMem: {},
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
  // the system's consequences table (GURPS's, Task 13): what a hit and a turn owe, as cards; null where there is none
  const consequences = () => (GMath ? (rules().fight || rules()).consequences || null : null);
  // the system's defences table (GURPS's, Task 14): each defence as it stands this turn; null where there is none
  const defences = () => (GMath && typeof GMath.liveDefences === 'function' ? (rules().fight || rules()).defences || null : null);
  // CoC's melee numbers (rules.coc, Task 16); null where there are none
  const cocRules = () => (CMath ? (rules().fight || rules()).coc || null : null);
  // The cards' kit (Task 13's cards, CoC's too from Task 18): the system's table and its line helpers (gurps-math's or
  // coc-math's); nextLine, pending and offerOf are gurps-math's for both. Null where there are no cards (D&D).
  const cardKit = () => {
    const G = consequences();
    if (G) return { C: G, M: GMath, coc: false };
    const c = cocRules();
    return c && c.cards && GMath && typeof CMath.lineText === 'function' ? { C: c.cards, M: CMath, coc: true } : null;
  };
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
    const g = state().fight;
    if (g && g.id === id) pickBlank(g.rows.map((r) => r.id));
  }
  // A blank row reached (Task 23, D3a): Add with blank rows, or Fight bringing them in, picks the first for the panel
  // and puts the cursor in that panel's first empty box, in view. Only where the panel has boxes (CoC, GURPS): D&D's
  // blank row is typed on its row, as before.
  const noNumbers = (r) => Boolean(r) && r.kind !== 'pc' && r.kind !== 'lair' && !isNum(r.hp);
  function pickBlank(ids) {
    const f = state().fight;
    if (!f || !panelBoxes().length) return;
    const r = ids.map(rowById).find(noNumbers);
    if (!r) return;
    pickRow(r.id);
  }
  function pickRow(id) {
    const f = state().fight;
    ui.peek = id;
    ui.peekTurn = f ? f.turn : null;
    RP.render();
    const boxes = Array.from(document.querySelectorAll('#acting .pbox'));
    const b = boxes.find((x) => x.value.trim() === '') || boxes[0];
    const k = b && statOf(b);
    const el = k ? RP.focusTo(attr(STAT[k].k, b.dataset[k])) : null;
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    pickBlank(j.rows.map((r) => r.id));
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
    if (!state().fight) return;
    // a number held in a box is placed before Start sorts (D3c)
    placeHeld();
    const f = state().fight;
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
  // GURPS's shock (Task 13), CoC's bout of madness (Task 18) and a card waiting, on the row's strip
  const CARD_WAITING = 'card waiting';
  const owedChips = (r) => {
    if (!cardKit()) return [];
    const bout = CMath && typeof CMath.boutText === 'function' && cocRules() ? CMath.boutText(r.bout) : '';
    return [].concat(consequences() && isNum(r.shock) && r.shock > 0 ? [`Shock \u2212${r.shock}`] : [], bout ? [bout] : [], (r.cards || []).length ? [CARD_WAITING] : []);
  };
  function chips(r, bloodied) {
    const one = (label) => `<button type="button" class="chip" data-fun="${esc(`${r.id}|${statusKey(label)}`)}" title="Remove ${esc(label)}">${esc(label)} ✕</button>`;
    const all = Fight.statusesOf(r);
    const bl = bloodied ? FM.bloodiedWord(words()) : '';
    const marks = marksOn(r);
    const owe = owedChips(r);
    const h = (bl ? `<span class="chip auto">${esc(bl)}</span>` : '') + marks.map((m) => `<span class="chip auto mark">${esc(m)}</span>`).join('')
      + owe.map((m) => `<span class="chip auto owe">${esc(m)}</span>`).join('') + all.map(one).join('');
    const names = (bl ? [bl] : []).concat(marks, owe, all);
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
  const statNames = () => ({ fini: titled(words().initiative) || 'Initiative', fmax: `Max ${words().hp || 'HP'}`, fac: words().ac || 'AC' });
  const titled = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');
  // a box's name for its bad-number line: the row's own, the pool's for its max box, the panel box's label
  function statName(f) {
    if (statNames()[f]) return statNames()[f];
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
    else if (ui.pending[id] && !(ui.dmg && ui.dmg.on === id)) out.push(`<span class="pendnum" role="status" title="Damage or healing typed, not applied yet">${PENDING}</span>`);
    // the last hit's working (GURPS, Task 12): one line, clipped, all of it in the title
    const hit = (rowById(id) || {}).hit;
    if (hit && hit.line) out.push(`<span class="hitline" title="${esc(hit.line)}">${esc(hit.line)}</span>`);
    out.push(defRollLine2(id));
    out.push(meleeLine2(id));
    out.push(dmgLine2(id));
    const st = (li && li.dataset.l2st) || '';
    if (st) out.push(`<span class="l2st">${st}</span>`);
    return out.join('');
  }
  // A row's last defence roll (GURPS, Task 30): "Parry 10: rolled 9, made it by 1", the words saying made or failed and
  // the colour only as well. Information only: nothing waits on it; the row's turn or its next roll replaces it.
  function defRollLine2(id) {
    const r = rowById(id);
    const x = r && r.defRoll;
    if (!x || !defences() || !r.in || r.out || r.kind === 'pc' || r.kind === 'lair') return '';
    const t = GMath.defRollText(x);
    return `<span class="defres ${GMath.defRollMade(x) ? 'made' : 'failed'}" role="status" title="${esc(`${t}. Its last defence, until its turn`)}">${esc(t)}</span>`;
  }
  const L2_CLASSES = /^(?:side-\w+|cur|bench|out)$/;
  function syncLine2(rowOrId) {
    const li = typeof rowOrId === 'string' ? document.querySelector(`#side ol.to > li[data-frow="${CSS.escape(rowOrId)}"]`) : rowOrId;
    if (!li) return;
    const id = li.dataset.frow;
    const html = line2Html(id, li);
    let l2 = li.nextElementSibling && li.nextElementSibling.dataset.row2 === id ? li.nextElementSibling : null;
    // the test probe reads the second lines: a change here refreshes it (probe() is nothing without ?probe=1)
    if (!html) { if (l2) { l2.remove(); RP.probe(); } return; }
    let changed = false;
    if (!l2) { l2 = document.createElement('li'); l2.dataset.row2 = id; li.after(l2); changed = true; }
    l2.className = ['row2', ...Array.from(li.classList).filter((c) => L2_CLASSES.test(c))].join(' ');
    if (l2.dataset.h !== html) { l2.innerHTML = html; l2.dataset.h = html; changed = true; }
    if (changed) RP.probe();
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
  // the reserve's figure is the one an entry spends, so it is what says a row has one (the refusal of e-3 asks the same)
  const hasReserve = (r) => isNum(r.er);
  function poolsHTML(r) {
    const { boxed, read } = poolsShown();
    let h = '';
    for (const p of boxed) {
      // a foe's or an ally's box is always drawn, so a blank row's walk is HP max then FP max (Task 23, D2); a PC's only
      // when its sheet holds the pool
      if (r.kind === 'pc' && !isNum(r[p.key]) && !isNum(r[p.max])) continue;
      const fp = p.key === 'fp';
      // the reserve's words are the system's (its pool's label, rules.words)
      const erPool = FM.poolOf(rules().fight || rules(), 'er');
      const er = fp && erPool && hasReserve(r) ? `<span class="er" title="${esc(`${erPool.label} ${r.er}/${isNum(r.erMax) ? r.erMax : '?'}${words().reserveTitle ? `: ${words().reserveTitle}` : ''}`)}"> +${esc(r.er)}</span>` : '';
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
      const dmgOn = Boolean(ui.dmg && ui.dmg.on === r.id);
      const pend = dmgOn ? ui.dmg.entry : ui.pending[r.id] || (ui.refused[r.id] && ui.refused[r.id].words);
      // a caster's box says how a spell is paid (GURPS's `✦ f-3`)
      const ph = (r.caster && w.casterPlaceholder) || w.entryPlaceholder || '-37/+8/t5';
      // with no ½ or Res beside it, the box is as wide as the system's placeholder, so all of it shows
      const wide = tg.half ? '' : ` style="width: calc(${ph.length}ch + 8px)"`;
      // its title: the words in it, whole (a narrow box clips a long place, Task 25), else what it takes
      const tip = String(pend || '').trim() || (tg.half ? '' : ph);
      h += `<input class="hpin${pend && !dmgOn ? ' pending' : ''}${dmgOn ? ' dmg' : ''}" data-fhp="${esc(r.id)}" data-tip="${esc(tg.half ? '' : ph)}" value="${esc(pend || '')}" placeholder="${esc(dmgOn ? DMG_PLACEHOLDER : ph)}"${wide}${tip ? ` title="${esc(tip)}"` : ''} autocomplete="off" aria-label="Damage or healing for ${esc(r.gmName)}">`;
      if (tg.half) h += `<button type="button" class="tg ${half ? 'on' : ''}" ${ui.area ? 'data-fahalf' : 'data-fhalf'}="${esc(r.id)}" aria-pressed="${!!half}" title="${ui.area ? 'Half for this area: a save' : 'Half: the next hit only (a save)'}">½</button>`;
      if (tg.resisted) h += `<button type="button" class="tg ${r.resisted ? 'on' : ''}" data-fres="${esc(r.id)}" aria-pressed="${!!r.resisted}" title="Resisted: every hit halved until turned off">Res</button>`;
    }
    const maxTitle = fromTag(r, 'max') ? ` title="${esc(`Max ${w.hp || 'HP'} ${r.max}${fromTag(r, 'max')}`)}"` : '';
    h += `<span class="hpv"${maxTitle}>${esc(isNum(r.hp) ? r.hp : '?')}/${statBox('data-fmax', r, isNum(r.max) ? r.max : '', `inputmode="numeric" autocomplete="off" aria-label="Maximum HP for ${esc(r.gmName)}"`)}</span>`;
    if (rn.includes('ac')) h += `<span class="acv">${esc(w.ac || 'AC')}${statBox('data-fac', r, isNum(r.ac) ? r.ac : '', `inputmode="numeric" autocomplete="off" aria-label="${esc(w.ac || 'AC')} for ${esc(r.gmName)}"`)}</span>`;
    h += poolsHTML(r);
    h += rowDefencesHTML(r);
    h += rowManoeuvreHTML(r, cur);
    h += rowMeleeHTML(r, view);
    h += rowAimHTML(r, cur);
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
    if (ui.peekTurn !== f.turn) { ui.peek = null; ui.aodAsk = null; ui.peekTurn = f.turn; }
    return FM.actingRow({ ...f, rows: f.view.rows }, ui.peek);
  }
  function actingHTML(d) {
    const f = d.fight;
    const { row: r, why } = actingOf(f);
    // the cards owed, every row's, at the top of the panel whichever row it shows (Task 13)
    const open = `<div class="act" id="acting">${cardsHTML(f)}`;
    if (!r) return `${open}<p class="note">The acting creature\'s panel shows here once a foe is in the fight.</p></div>`;
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
      return `${open}${head('Lair action')}<p class="note">Initiative 20, losing ties.</p>${owners.map((o) => {
        const info = foeInfo(o, d);
        return `<div class="stats"><h4 class="lab">${esc(o.gmName)}'s lair</h4>${(info && info.lairActionsHtml) || '<p class="warn">The block names lair actions but lists none the sheet can find.</p>'}</div>`;
      }).join('') || '<p class="warn">No foe with lair actions is in the fight.</p>'}</div>`;
    }
    const w = words();
    const q = (v) => (isNum(v) ? v : '?');
    // the read-outs: HP (its tag when worked out), AC and the rolled initiative where the system has them, each pool,
    // and the boxes the system reads out (CoC's DEX; GURPS's Basic Speed and Dodge)
    const reads = [`HP ${q(r.hp)}/${q(r.max)}${r.temp ? ` +${r.temp}` : ''}${fromTag(r, 'max')}`];
    if (rowNumbers().includes('ac')) reads.push(`${words().ac || 'AC'} ${q(r.ac)}`);
    if (rolled()) reads.push(`Init ${isNum(r.ini) ? r.ini : '—'} (${sign(r.mod)})`);
    for (const p of FM.poolsOf(rules().fight || rules())) {
      if (isNum(r[p.key]) || isNum(r[p.max])) reads.push(`${p.label} ${q(r[p.key])}${p.max ? `/${q(r[p.max])}` : ''}${fromTag(r, p.max)}`);
    }
    // a defence read out (GURPS's Dodge) is the figure as it stands, the row's readout's (Tired halves it here too)
    const D = defences();
    const live = D && r.kind !== 'lair' ? GMath.liveDefences(r, D) : null;
    const titles = [];
    for (const b of panelBoxes().filter((x) => x.readout)) {
      const d = live && live[b.key];
      const fig = d && d.base !== null ? (d.value === null ? '\u2013' : d.value) : shownFigure(r[Fight.STAT_FIELDS[b.key][0]]) || '?';
      reads.push(`${b.label} ${fig}${fromTag(r, b.key)}`);
      titles[reads.length - 1] = d && d.base !== null && d.causes.length ? d.title : '';
    }
    const nums = reads.map((x, i) => `<span${titles[i] ? ` title="${esc(titles[i])}"` : ''}>${esc(x)}</span>`);
    const blWord = f.view.bloodied.has(r.id) ? FM.bloodiedWord(w) : '';
    if (blWord) nums.push(`<span class="bl">${esc(blWord)}</span>`);
    for (const m of marksOn(r)) nums.push(`<span class="mk">${esc(m)}</span>`);
    nums.push(...shockHTML(r));
    // every status, the ones the row's strip had no room for too; a click removes it, as on the row
    for (const x of Fight.statusesOf(r)) nums.push(`<button type="button" class="st" data-fun="${esc(`${r.id}|${statusKey(x)}`)}" title="Remove ${esc(x)}">${esc(x)} ✕</button>`);
    const ctr = counters(r, true);
    nums.push(sameHTML(f, r));
    // Three direct buttons, never a cycle: foe to neutral by one click must not pass through ally (an ally that
    // is seen shows its name and HP on the players' screen). Ally is last, each says what it does (P-A3).
    if (r.kind !== 'pc') {
      const now = FM.sideOfRow(r);
      nums.push(`<span class="sideSw" role="group" aria-label="Side"><span class="lab">Side:</span>${FM.SIDES.map((x) => `<button type="button" class="tg" data-fside="${x}" data-fsiderow="${esc(r.id)}" aria-pressed="${x === now}" title="${esc(SIDE_TITLES[x])}">${x}</button>`).join('')}</span>`);
    }
    let body = '';
    if (r.kind === 'pc') {
      body = `<p class="note">Players run their own sheets. ${toHitButton('acToHit', r.id)}</p>`;
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
      else if (!nonum && (w.noBlock ?? FM.DND_NO_BLOCK)) body += `<p class="warn">${esc(w.noBlock ?? FM.DND_NO_BLOCK)}</p>`;
    }
    return `${open}${head(r.gmName)}<div class="nums">${nums.join('')}</div>${ctr ? `<div class="nums ctr">${ctr}</div>` : ''}${boxesHTML(r)}${panelManoeuvreHTML(r)}${panelDefencesHTML(r)}${hitChipsHTML(r)}${trackHTML(r)}${body}</div>`;
  }
  // Same for all (Task 23, D3): its number is how many of the group will take something (FM.sameForAllCount, field by
  // field); disabled, with its reason written beside it, while this row has nothing to copy or no copy can take it.
  function sameHTML(f, r) {
    if (r.kind === 'pc' || r.kind === 'lair' || !FM.groupMates(f.view.rows, r).some((x) => x !== r)) return '';
    const keys = Fight.statKeysOf(FM.rulesOf(f));
    if (!FM.copyHolds(r, keys)) {
      return `<span class="samebox"><button type="button" class="tg same" data-fsame="${esc(r.id)}" disabled title="Nothing to copy yet: type a number on this row first">Same for all</button><span class="samewhy">${SAME_FIRST}</span></span>`;
    }
    const n = FM.sameForAllCount(f.view.rows, r, keys);
    if (!n) {
      return `<span class="samebox"><button type="button" class="tg same" data-fsame="${esc(r.id)}" disabled title="Every copy holds these numbers already, typed its own, or is hurt or given a status">Same for all</button><span class="samewhy">${SAME_NONE}</span></span>`;
    }
    return `<button type="button" class="tg same" data-fsame="${esc(r.id)}" title="Copy these numbers (and the HP they give) to the others of this group nobody has typed into, hurt or given a status">Same for all ${n}</button>`;
  }
  const SAME_FIRST = 'Type a number first';
  const SAME_NONE = 'No copy can take these';
  // ---- GURPS's defences (Task 14): each as it stands this turn, and a tap rolls it; the GM can ignore all of it ----
  // A defence's button: "Parry 9" (the figure now), "Block used", "Block again?" once a used Block was tapped. `at` is
  // its attribute: `data-fdef` on the row, `data-fpdef` in the panel, each "row|defence".
  function defenceButton(r, d, at) {
    const key = `${r.id}|${d.key}`;
    const ask = d.key === 'block' && d.used && ui.blockAsk === r.id;
    const text = ask ? `${d.label} again?` : d.used ? `${d.label} used` : `${d.label} ${d.value === null ? '\u2013' : d.value}`;
    const off = d.value === null || ui.defRolling[key];
    const tail = d.value === null ? '' : ask ? '. Tap again: roll a second Block' : d.used ? '. Tap: asks before a second Block' : '. Tap: roll it';
    const cls = ['def', d.causes.length ? 'moved' : '', d.used ? 'used' : '', ask ? 'ask' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" ${at}="${esc(key)}" ${off ? 'disabled' : ''} title="${esc(`${d.title}${tail}`)}" aria-label="${esc(`${text} for ${r.gmName}`)}">${esc(text)}</button>`;
  }
  // ---- GURPS's manoeuvre chip (Task 15): the row's word (a tap shows its panel), the panel's one button per manoeuvre ----
  const chipsOf = () => { const D = defences(); return D && Array.isArray(D.chips) ? D.chips : null; };
  const counted = (r) => (r.manoeuvre === 'aim' && r.aim > 1 ? ` ${r.aim}` : r.manoeuvre === 'evaluate' && r.evaluate > 1 ? ` ${r.evaluate}` : '');
  function rowManoeuvreHTML(r, acting) {
    const cs = chipsOf();
    if (!cs || r.kind === 'lair' || !r.in || r.out) return '';
    const c = cs.find((x) => x.key === r.manoeuvre);
    if (!c && !acting) return '';
    const text = c ? `${c.short}${counted(r)}` : '+ manoeuvre';
    const full = c ? `${c.name}${r.aodDefence ? ` (${r.aodDefence})` : ''}${counted(r)}` : '';
    return `<button type="button" class="tg man ${c ? 'on' : ''}" data-fmanrow="${esc(r.id)}" title="${esc(c ? `${full}. Tap: show its panel to change it` : "Manoeuvre: tap to choose it in the panel")}" aria-label="${esc(`Manoeuvre for ${r.gmName}: ${c ? full : 'none'}`)}">${esc(text)}</button>`;
  }
  function panelManoeuvreHTML(r) {
    const cs = chipsOf();
    const D = defences();
    if (!cs || r.kind === 'lair') return '';
    const on = (k) => r.manoeuvre === k;
    const off = state().fight.turn !== r.id ? ' disabled' : '';
    const btn = (c) => `<button type="button" class="tg ${on(c.key) ? 'on' : ''}"${off} data-fman="${esc(`${r.id}|${c.key}`)}" aria-pressed="${on(c.key)}" title="${esc(off ? 'Picked on its turn' : on(c.key) ? `${c.name}: tap to take it back` : c.name)}">${esc(c.name)}${on(c.key) ? esc(counted(r)) : ''}</button>`;
    const aod = on('all-out defence') || ui.aodAsk === r.id;
    const which = aod ? `<span class="lab">Which defence:</span>${GMath.DEFENCE_KEYS.map((k) => `<button type="button" class="tg ${on('all-out defence') && r.aodDefence === k ? 'on' : ''}" data-fmand="${esc(`${r.id}|${k}`)}" aria-pressed="${on('all-out defence') && r.aodDefence === k}"${off}${off ? ' title="Picked on its turn"' : ''}>${esc(D.names[k] || k)}</button>`).join('')}` : '';
    return `<div class="pman" role="group" aria-label="Manoeuvre"><span class="lab">Manoeuvre:</span>${cs.map(btn).join('')}${which}</div>`;
  }
  // A manoeuvre tapped: the pick again takes it back; All-Out Defence waits for its defence.
  function pickManoeuvre(rowId, key, defence) {
    const r = rowById(rowId);
    if (!r) return;
    const same = r.manoeuvre === key && (key !== 'all-out defence' || !defence || r.aodDefence === defence);
    ui.aodAsk = key === 'all-out defence' && !same && !defence ? rowId : null;
    if (key === 'all-out defence' && !defence && !same) { RP.render(); RP.focusTo(attr('data-fman', `${rowId}|${key}`)); return; }
    F({ type: 'manoeuvre', row: rowId, name: same ? null : key, ...(defence && !same ? { defence } : {}) });
    RP.focusTo(attr(defence ? 'data-fmand' : 'data-fman', defence ? `${rowId}|${defence}` : `${rowId}|${key}`));
  }
  // The row's readout: a foe's or an ally's defences that have a figure, each its own Defend button [H2]. A PC has none.
  function rowDefencesHTML(r) {
    const D = defences();
    if (!D || r.kind === 'pc' || r.kind === 'lair' || !r.in || r.out) return '';
    const live = GMath.liveDefences(r, D);
    const shown = GMath.DEFENCE_KEYS.map((k) => live[k]).filter((d) => d.base !== null);
    return shown.length ? `<span class="defs">${shown.map((d) => defenceButton(r, d, 'data-fdef')).join('')}</span>` : '';
  }
  // The panel's: every defence's button and the retreat toggle; a PC's sheet figures, for reference, with no button.
  function panelDefencesHTML(r) {
    const D = defences();
    if (!D || r.kind === 'lair') return '';
    const live = GMath.liveDefences(r, D);
    const all = GMath.DEFENCE_KEYS.map((k) => live[k]);
    if (r.kind === 'pc') {
      // "From the sheet" only for what the sheet holds; a figure worked out or typed in the fight says so instead
      const had = all.filter((d) => d.base !== null);
      const typed = (d) => Boolean(r.typedKeys && r.typedKeys[d.key]);
      const sheet = had.filter((d) => !d.from && !typed(d));
      const other = had.filter((d) => d.from || typed(d));
      if (!had.length) return '';
      // a sheet with several Parry lines shows them all (`Parry: Axe 13, Karate 12`)
      const words = (d) => (d.key === 'parry' && Array.isArray(r.parryLines) && r.parryLines.length > 1 ? `${d.label}: ${r.parryLines.join(', ')}` : `${d.label} ${d.base}`);
      return `<div class="pdefs pc">${sheet.length ? `<span class="lab">From the sheet:</span>${sheet.map((d) => `<span class="sheetdef">${esc(words(d))}</span>`).join('')}` : ''}`
        + `${other.map((d) => `<span class="pcdef">${esc(`${d.label} ${d.base} (${d.from || 'typed'})`)}</span>`).join('')}</div>`;
    }
    const rt = live.retreat;
    const retreat = `<button type="button" class="tg retreat ${rt.on ? 'on' : ''}" data-fretreat="${esc(r.id)}" aria-pressed="${rt.on}" ${rt.allowed ? '' : 'disabled'}`
      + ` title="${esc(rt.allowed ? 'Retreat: tap to turn on, until its turn' : `No retreat: ${rt.why}`)}">Retreat</button>`;
    return `<div class="pdefs" role="group" aria-label="Defend"><span class="lab">Defend:</span>${all.map((d) => defenceButton(r, d, 'data-fpdef')).join('')}${retreat}</div>`;
  }
  // A defence tapped: the server rolls it against the figure as it stands; the result is logged by the reducer. A
  // used Block asks once ("Block again?"), then the next tap rolls it. Focus stays on the button tapped.
  function defend(rowId, key, at) {
    const f = state().fight;
    const D = defences();
    const r = rowById(rowId);
    if (!f || !D || !r || r.kind === 'pc') return;
    const d = GMath.liveDefences(r, D)[key];
    const k = `${rowId}|${key}`;
    if (!d || d.value === null || ui.defRolling[k]) return;
    const sel = attr(at, k);
    if (d.used && ui.blockAsk !== rowId) { ui.blockAsk = rowId; RP.render(); RP.focusTo(sel); return; }
    const again = d.used;
    ui.blockAsk = null;
    ui.defRolling[k] = true;
    RP.render();
    roll([{ against: d.value }]).then(([res]) => {
      delete ui.defRolling[k];
      const now = state().fight;
      const x = now && now.id === f.id ? rowById(rowId) : null;
      // the figure moved while the roll was out (a status, another window): the roll is not sent, and the page says so
      const moved = x ? GMath.defenceMoved(GMath.liveDefences(x, D)[key], res && res.target) : null;
      if (moved) { RP.note(`${viewName(rowId) || x.name}: ${moved}.`, { kind: 'bad' }); RP.render(); RP.focusTo(sel); return; }
      if (x) {
        RP.dispatch({ fight: f.id, type: 'defendRolled', row: rowId, defence: key, result: res, ...(again ? { again: true } : {}) });
        RP.focusTo(sel);
      } else RP.render();
    }, (e) => { delete ui.defRolling[k]; rollFailed(e); RP.render(); });
  }
  // ---- CoC's melee on the target's row (Task 16): Dodge or Fight Back, the dice before the roll, the levels compared ----
  // The attacker: the row picked (its panel shown), else the one whose turn it is; a live row, or none.
  function attackerOf(rows, f) {
    const live = (r) => Boolean(r) && r.in && !r.out && r.kind !== 'lair';
    const picked = ui.peek ? rows.find((x) => x.id === ui.peek) : null;
    if (live(picked)) return picked;
    const cur = rows.find((x) => x.id === f.turn);
    return live(cur) ? cur : null;
  }
  // The dice on a melee attack on the row now: the GM's stepper, else the row's own (outnumbered, Prone).
  function diceNow(r, C) {
    const auto = CMath.attackDice(r, C, 'melee');
    const set = ui.mdice[r.id];
    const net = isNum(set) ? set : auto.net;
    return { net, why: net > 0 && auto.net > 0 ? auto.why : [], byHand: net !== auto.net };
  }
  const diceShort = (n) => (n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : '0');
  // A turn moved or the fight changed: the stepper's dice go, and an open exchange closes (nothing is logged).
  function syncMelee(f) {
    if (ui.meleeTurn !== `${f.id}:${f.turn}`) { ui.mdice = {}; ui.melee = null; ui.shot = null; ui.shotMem = {}; ui.meleeTurn = `${f.id}:${f.turn}`; }
    const live = (id) => { const x = rowById(id); return x && x.in && !x.out; };
    const sh = ui.shot;
    if (sh && (sh.fight !== f.id || !live(sh.target) || !live(sh.shooter))) ui.shot = null;
    else if (sh) proneSync(sh);
    const m = ui.melee;
    if (!m) return;
    if (m.fight !== f.id || !live(m.target) || !live(m.attacker)) ui.melee = null;
  }
  // The target's buttons: Dodge and Fight Back (an NPC's or creature's default first, marked; a PC's both, neither
  // marked), and the − / + stepper with the dice on the attack. None on the attacker's row, an Out row or a benched one.
  function rowMeleeHTML(r, view) {
    const C = cocRules();
    if (!C || r.kind === 'lair' || !r.in || r.out) return '';
    const f = state().fight;
    const A = attackerOf(view.rows, f);
    if (!A || A.id === r.id) return '';
    const m = ui.melee && ui.melee.target === r.id ? ui.melee : null;
    const dflt = r.kind === 'pc' ? null : (C.defaultResponse || 'fightBack');
    const order = dflt ? [dflt, ...CMath.RESPONSES.filter((k) => k !== dflt)] : CMath.RESPONSES.slice();
    const btn = (k) => {
      const on = Boolean(m && m.response === k);
      const title = `${A.gmName} attacks; ${r.gmName} ${CMath.RESPONSE_WORDS[k].toLowerCase()}${k === dflt ? ' (the usual for an NPC or creature)' : ''}`;
      return `<button type="button" class="tg mel${k === dflt ? ' dflt' : ''}${on ? ' on' : ''}" data-fmelee="${esc(`${r.id}|${k}`)}" aria-pressed="${on}"`
        + `${m && m.rolling ? ' disabled' : ''} title="${esc(title)}">${esc(CMath.RESPONSE_NAMES[k])}</button>`;
    };
    const d = m ? { net: m.net, why: m.why, byHand: m.byHand } : diceNow(r, C);
    const cap = isNum(C.maxDice) ? C.maxDice : 2;
    const words = CMath.diceText(d.net, d.why, d.byHand) || 'no bonus or penalty dice';
    const lock = m ? ' disabled' : '';
    const step = `<span class="mdice" role="group" aria-label="${esc(`Dice on a melee attack on ${r.gmName}`)}">`
      + `<button type="button" data-fmdice="${esc(`${r.id}|-1`)}"${d.net <= -cap ? ' disabled' : lock} aria-label="${esc(`One die less on an attack on ${r.gmName}`)}" title="A penalty die, or one bonus die less">\u2212</button>`
      + `<span class="mdn${d.net ? ' some' : ''}" title="${esc(`${words} on the next melee attack on ${r.gmName}`)}">${esc(diceShort(d.net))}</span>`
      + `<button type="button" data-fmdice="${esc(`${r.id}|1`)}"${d.net >= cap ? ' disabled' : lock} aria-label="${esc(`One die more on an attack on ${r.gmName}`)}" title="A bonus die, or one penalty die less">+</button></span>`;
    // Shoot (Task 19): the strip of chips opens on the second line; an attacker that can shoot only
    const shoot = C.firearm && CMath.canShoot(A)
      ? `<button type="button" class="tg mel shoot${ui.shot && ui.shot.target === r.id ? ' on' : ''}" data-fshoot="${esc(r.id)}" aria-pressed="${Boolean(ui.shot && ui.shot.target === r.id)}" title="${esc(`${A.gmName} shoots at ${r.gmName}`)}">Shoot</button>`
      : '';
    return `<span class="melee">${order.map(btn).join('')}${step}${shoot}</span>`;
  }
  // The acting row's aim (Task 19): declared on its turn, for a shot next round; none once it aims this round.
  function rowAimHTML(r, cur) {
    const C = cocRules();
    const f = state().fight;
    if (!C || !C.firearm || !cur || !f.started || r.kind === 'lair' || !r.in || r.out || !CMath.canShoot(r)) return '';
    if (r.aiming && r.aiming.round === f.round) return '';
    return `<button type="button" class="tg mel" data-faim="${esc(r.id)}" title="Aimed">aim</button>`;
  }
  // The row's second line: its outnumbered and Prone notes, and the exchange while one is open on it.
  function meleeLine2(id) {
    const C = cocRules();
    const r = rowById(id);
    if (!C || !r || !r.in || r.out || r.kind === 'lair') return '';
    const out = [];
    if (ui.melee && ui.melee.target === id) out.push(exchangeHTML(ui.melee));
    if (ui.shot && ui.shot.target === id) out.push(shotHTML(ui.shot));
    // the firearm marks (Task 19): the attack a dive lost, a slow weapon's counter, a declared aim (tapped: it moved)
    if (r.lostAttack) out.push(`<span class="mnote lost${r.lostAttack.on ? ' now' : ''}">${esc(CMath.lostText(r.lostAttack))}</span>`);
    // each slow gun's counter, a tap when the GM says it is ready now
    for (const c of Array.isArray(r.reload) ? r.reload : []) out.push(`<button type="button" class="tg mout" data-freload="${esc(`${id}|${c.gun}`)}" title="Tap: ready now">${esc(CMath.reloadText(c, r))}</button>`);
    if (r.aiming) out.push(`<button type="button" class="tg mout on" data-faimoff="${esc(id)}" aria-pressed="true" title="Aimed: tap if it moves">aiming</button>`);
    const n = CMath.rowNotes(r, C);
    if (n.outnumbered) {
      const off = Boolean(r.outnumberedOff);
      out.push(`<span class="mnote">${esc(n.outnumbered)}</span><button type="button" class="tg mout${off ? ' on' : ''}" data-fmout="${esc(id)}" aria-pressed="${off}"`
        + ' title="Tap if this one is never outnumbered">never outnumbered</button>');
    }
    if (n.prone) out.push(`<span class="mnote">${esc(n.prone)}</span>`);
    return out.join('');
  }
  const viewRow = (id) => { const f = RP.derived().fight; return (f && f.view && f.view.rows.find((x) => x.id === id)) || rowById(id); };
  // The exchange: who attacks with which dice, each side's roll or the PC's level buttons, the Build hint, and ✕.
  function exchangeHTML(m) {
    const A = viewRow(m.attacker);
    const D = viewRow(m.target);
    if (!A || !D) return '';
    const name = (x) => x.gmName || x.name;
    const dt = CMath.diceText(m.net, m.why, m.byHand);
    const side = (part, row, res) => {
      if (row.kind === 'pc') {
        return `<span class="mlv" role="group" aria-label="${esc(`${name(row)}'s level`)}">${CMath.TAP_LEVELS.map((l) => `<button type="button" class="tg${res && res.level === l ? ' on' : ''}"`
          + ` data-fmlvl="${esc(`${m.target}|${part}|${l}`)}" aria-pressed="${Boolean(res && res.level === l)}">${esc(CMath.levelName(l))}</button>`).join('')}</span>`;
      }
      return `<b class="mres">${m.rolling ? 'rolling\u2026' : res ? esc(CMath.sideText(res)) : ''}</b>`;
    };
    const builds = [A, D].map((x) => `${name(x)} ${isNum(x.build) ? x.build : '?'}`).join(', ');
    return `<span class="mx" role="group" aria-label="Melee exchange"><span>${esc(`${name(A)}${dt ? `, ${dt}` : ''}:`)}</span>${side('attack', A, m.attack)}`
      + `<span>${esc(`\u00b7 ${name(D)} ${CMath.RESPONSE_WORDS[m.response]}:`)}</span>${side('defence', D, m.defence)}`
      + `<span class="mhint" title="${esc(`Build: ${builds}`)}">${esc(words().buildHint || '')}</span>`
      + `<button type="button" class="tg mback" data-fmx="${esc(m.target)}" title="Back out: nothing is logged" aria-label="Back out of this exchange">\u2715</button></span>`;
  }
  // A response tapped on the target's row: the exchange opens with the stepper's dice; the server rolls each NPC's or
  // creature's side (the attacker's Fighting with the dice, the defender's Dodge or Fighting), and a PC's side waits
  // for the GM's tap. With every side in, the exchange is sent.
  function meleeStart(rowId, response) {
    const f = state().fight;
    const C = cocRules();
    const D = rowById(rowId);
    const A = f && attackerOf(f.rows, f);
    if (!f || !C || !D || !A || A.id === D.id || !CMath.RESPONSES.includes(response)) return;
    if (ui.melee && ui.melee.rolling) return;
    const sel = attr('data-fmelee', `${rowId}|${response}`);
    // an NPC side needs its figure: said, nothing opens
    const lacking = [[A, 'attack'], [D, response]].filter(([x, p]) => x.kind !== 'pc' && CMath.skillOf(x, p) === null);
    if (lacking.length) {
      for (const [x, p] of lacking) RP.note(`${viewName(x.id) || x.name} has no ${CMath.skillName(p)}: type it in its panel.`, { kind: 'bad', id: `melee:${x.id}:${p}` });
      RP.focusTo(sel);
      return;
    }
    const d = diceNow(D, C);
    const dice = CMath.diceOfNet(d.net, C);
    const own = CMath.attackDice(D, C, 'melee');
    const m = { fight: f.id, turn: f.turn, target: rowId, attacker: A.id, response, dice, net: d.net, why: d.why, byHand: d.byHand, auto: own, attack: null, defence: null, rolling: false };
    const asks = [];
    if (A.kind !== 'pc') asks.push(['attack', { d100: { target: CMath.skillOf(A, 'attack'), ...dice } }]);
    if (D.kind !== 'pc') asks.push(['defence', { d100: { target: CMath.skillOf(D, response) } }]);
    m.rolling = asks.length > 0;
    ui.melee = m;
    RP.render();
    RP.focusTo(sel);
    if (!asks.length) return;
    roll(asks.map((x) => x[1])).then((results) => {
      if (ui.melee !== m) return;
      m.rolling = false;
      // a figure that moved while the dice were out: the roll is not sent, and the page says so
      const now = { attack: rowById(m.attacker), defence: rowById(m.target) };
      for (let i = 0; i < asks.length; i++) {
        const part = asks[i][0];
        const x = now[part];
        const want = x ? CMath.skillOf(x, part === 'attack' ? 'attack' : response) : null;
        if (!results[i] || want !== results[i].target) {
          ui.melee = null;
          RP.note(`${viewName(m[part === 'attack' ? 'attacker' : 'target']) || ''}: its ${CMath.skillName(part === 'attack' ? 'attack' : response)} changed while the dice were out: tap ${CMath.RESPONSE_NAMES[response]} again.`, { kind: 'bad' });
          RP.render();
          RP.focusTo(sel);
          return;
        }
        m[part] = results[i];
      }
      meleeSend(m);
    }, (e) => { if (ui.melee === m) ui.melee = null; rollFailed(e); RP.render(); RP.focusTo(sel); });
  }
  // A PC's level tapped (a tap again on the same level takes it back while the other side waits).
  function meleeTap(target, part, level) {
    const m = ui.melee;
    if (!m || m.target !== target || m.rolling || !CMath.isLevel(level)) return;
    const row = rowById(part === 'attack' ? m.attacker : m.target);
    if (!row || row.kind !== 'pc') return;
    m[part] = m[part] && m[part].level === level ? null : { level };
    if (!meleeSend(m)) { RP.render(); RP.focusTo(attr('data-fmlvl', `${target}|${part}|${level}`)); }
  }
  // Both sides in: the exchange goes to the reducer, which compares and logs it; the stepper clears. True when sent.
  function meleeSend(m) {
    if (!m.attack || !m.defence) { RP.render(); return false; }
    ui.melee = null;
    delete ui.mdice[m.target];
    // the damage box this exchange opens takes focus here (the reducer counts exchanges in `meleeN`)
    const f = state().fight;
    ui.dmgMine = `${m.fight}:${(f && isNum(f.meleeN) ? f.meleeN : 0) + 1}`;
    RP.dispatch({ fight: m.fight, type: 'melee', attacker: m.attacker, defender: m.target, response: m.response, dice: m.dice, auto: m.auto, attack: m.attack, defence: m.defence });
    RP.focusTo(attr('data-fmelee', `${m.target}|${m.response}`));
    return true;
  }
  // The stepper: one die more or less, within the cap; the row's own again once it matches them.
  function meleeDice(rowId, delta) {
    const C = cocRules();
    const r = rowById(rowId);
    if (!C || !r || (ui.melee && ui.melee.target === rowId)) return;
    const cap = isNum(C.maxDice) ? C.maxDice : 2;
    const net = Math.max(-cap, Math.min(cap, diceNow(r, C).net + delta));
    if (net === CMath.attackDice(r, C, 'melee').net) delete ui.mdice[rowId]; else ui.mdice[rowId] = net;
    RP.render();
    RP.focusTo(attr('data-fmdice', `${rowId}|${delta}`));
  }
  // ---- CoC's Shoot strip (Task 19): the range, the chips, the dive, the malfunction number, then Roll or a PC's tap ----
  // The chips a strip sends: the range past regular, the chips on (the aimed chip only while the shooter's aim counts),
  // and the passed dive. A passed dive stays on this shooter's later shots at the target this round: the target is in
  // cover until it moves (KR p113).
  function shotChips(sh) {
    const f = state().fight;
    const out = sh.range && sh.range !== 'regular' ? [sh.range] : [];
    for (const [k, on] of Object.entries(sh.chips)) if (on && (k !== 'aim' || CMath.aimReady(rowById(sh.shooter), f && f.round))) out.push(k);
    if (sh.dive && sh.dive.passed) out.push('dive');
    return out;
  }
  const gunOfShot = (sh) => { const g = CMath.gunsOf(rowById(sh.shooter)); return sh.gun === null ? null : g[sh.gun] || null; };
  // The strip's state kept for the turn by shooter and target: its chips, gun, malfunction words, the dive (so a strip
  // closed and opened again offers no second dive) and the Prone statuses last read.
  const rememberShot = (sh) => {
    ui.shotMem[`${sh.shooter}|${sh.target}`] = { range: sh.range, chips: { ...sh.chips }, gun: sh.gun, mal: sh.mal, dive: sh.dive, seen: { ...sh.seen } };
  };
  // The Prone chips follow the statuses: a status that changed since the strip last read it sets its chip again.
  function proneSync(sh) {
    const C = cocRules();
    const seen = { proneTarget: CMath.proneOn(rowById(sh.target), C), proneShooter: CMath.proneOn(rowById(sh.shooter), C) };
    let moved = false;
    for (const k of Object.keys(seen)) if (!sh.seen || sh.seen[k] !== seen[k]) { sh.chips[k] = seen[k]; moved = true; }
    sh.seen = seen;
    if (moved) rememberShot(sh);
  }
  function shotHTML(sh) {
    const C = cocRules();
    const F = C && C.firearm;
    const A = viewRow(sh.shooter);
    const D = viewRow(sh.target);
    if (!F || !A || !D) return '';
    const f = state().fight;
    const name = (x) => x.gmName || x.name;
    const SA = rowById(sh.shooter);
    const SD = rowById(sh.target);
    const guns = CMath.gunsOf(SA);
    const gun = gunOfShot(sh);
    const skill = CMath.shotSkill(SA, gun);
    const d = CMath.shotDice(shotChips(sh), SA, SD, C);
    const pc = SA.kind === 'pc';
    const t = sh.target;
    const lock = sh.rolling || sh.diveRolling ? ' disabled' : '';
    const tg = (data, on, label, title, dis) => `<button type="button" class="tg${on ? ' on' : ''}" ${data} aria-pressed="${Boolean(on)}"${dis || lock}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
    const head = (w) => `<span class="sxh">${esc(w)}:</span>`;
    const build = SD && isNum(SD.build) ? SD.build : null;
    const chip = (c) => {
      if (c.key === 'aim' && !CMath.aimReady(SA, f.round)) return tg(`data-fshc="${esc(`${t}|${c.key}`)}"`, false, c.short, 'Aimed: declare the aim on its turn first', ' disabled');
      return tg(`data-fshc="${esc(`${t}|${c.key}`)}"`, sh.chips[c.key] && (c.key !== 'aim' || CMath.aimReady(SA, f.round)), c.short, c.label);
    };
    const group = (g) => F.chips.filter((c) => (c.group || '') === g);
    let h = `<span class="sx" role="group" aria-label="${esc(`${name(A)} shoots at ${name(D)}`)}"><span>${esc(`${name(A)} shoots${gun ? `, ${gun.name}` : ''}${pc ? '' : `, Firearms ${isNum(skill) ? skill : '?'}`}:`)}</span>`;
    if (guns.length > 1) h += guns.map((g, i) => tg(`data-fshgun="${esc(`${t}|${i}`)}"`, sh.gun === i, g.name, 'The weapon')).join('');
    h += `<span class="sxg">${head('range')}${F.ranges.map((r) => tg(`data-fshr="${esc(`${t}|${r.key}`)}"`, (sh.range || 'regular') === r.key, r.short, r.label)).join('')}</span>`;
    // the target's size: one note when its Build decides it, else the two chips
    const size = build === null ? group('target').filter((c) => c.size).map(chip).join('')
      : `<span class="mnote">${esc(`${build >= F.size.large ? 'large' : build <= F.size.small ? 'small' : 'size'} (Build ${build})`)}</span>`;
    h += `<span class="sxg">${head('target')}${size}${group('target').filter((c) => !c.size).map(chip).join('')}</span>`;
    h += `<span class="sxg">${head('shooter')}${group('shooter').map(chip).join('')}</span>`;
    h += `<span class="sxg">${group('').map(chip).join('')}</span>`;
    // the dive: the target's answer, rolled for an NPC, a tap for a PC; once a turn
    if (sh.dive) h += `<span class="mnote">${esc(`dived: ${sh.dive.passed ? 'passed, +1 penalty die' : 'failed'}`)}</span>`;
    else if (sh.diveAsk) h += `<span class="mlv" role="group" aria-label="${esc(`${name(D)}'s Dodge to dive`)}">${['passed', 'failed'].map((k) => `<button type="button" class="tg" data-fshdv="${esc(`${t}|${k}`)}">${k === 'passed' ? 'Dive passed' : 'Dive failed'}</button>`).join('')}</span>`;
    else h += `<button type="button" class="tg" data-fshdive="${esc(t)}"${lock} title="Dive for cover">${sh.diveRolling ? 'rolling…' : 'Dive'}</button>`;
    // the malfunction number: an NPC's roll only (a PC's player checks their own)
    if (!pc) h += `<label class="mlab">malf <input class="malf" data-fshmal="${esc(t)}" value="${esc(sh.mal == null ? '' : sh.mal)}" inputmode="numeric" autocomplete="off" size="3" aria-label="Malfunction number" placeholder="—"></label>`;
    h += `<span class="mnote">${esc(`${CMath.levelName(d.difficulty)}${CMath.shotDiceText(d) ? `, ${CMath.shotDiceText(d)}` : ''}`)}</span>`;
    if (pc) {
      h += `<span class="mlv" role="group" aria-label="${esc(`${name(A)}'s level`)}">${CMath.TAP_LEVELS.map((l) => `<button type="button" class="tg" data-fshlvl="${esc(`${t}|${l}`)}"${lock}>${esc(CMath.levelName(l))}</button>`).join('')}</span>`;
    } else h += `<button type="button" class="offer" data-fshroll="${esc(t)}"${lock}>${sh.rolling ? 'rolling…' : 'Roll'}</button>`;
    h += `<button type="button" class="tg mback" data-fshx="${esc(t)}" title="Close: nothing is logged" aria-label="Close the shot">✕</button>`;
    if (sh.last) h += `<b class="mres">${esc(sh.last)}</b>`;
    return `${h}</span>`;
  }
  // Shoot tapped on the target's row: the strip opens (again: it closes), with the chips last used on this target this
  // turn, else the aim and Prone from the rows, the first gun and its malfunction number.
  function shootStart(rowId) {
    const f = state().fight;
    const C = cocRules();
    const D = rowById(rowId);
    const A = f && attackerOf(f.rows, f);
    if (!f || !C || !C.firearm || !D || !A || A.id === D.id || !CMath.canShoot(A)) return;
    const sel = attr('data-fshoot', rowId);
    if (ui.shot && ui.shot.target === rowId) { if (!ui.shot.rolling) ui.shot = null; RP.render(); RP.focusTo(sel); return; }
    if (ui.shot && ui.shot.rolling) return;
    const mem = ui.shotMem[`${A.id}|${rowId}`];
    const guns = CMath.gunsOf(A);
    const chips = {};
    for (const k of CMath.shotChipsFrom(A, D, f.round, C)) chips[k] = true;
    const base = { fight: f.id, turn: f.turn, shooter: A.id, target: rowId, diveAsk: false, rolling: false, last: '' };
    ui.shot = mem
      ? { ...base, range: mem.range, chips: { ...mem.chips }, gun: mem.gun, mal: mem.mal, dive: mem.dive, seen: { ...mem.seen } }
      : { ...base, range: 'regular', chips, gun: guns.length ? 0 : null, mal: guns.length && isNum(guns[0].malfunction) ? String(guns[0].malfunction) : '', dive: null, seen: null };
    proneSync(ui.shot);
    rememberShot(ui.shot);
    RP.render();
    RP.focusTo(sel);
  }
  // A range, a chip or a gun tapped on the strip.
  function shotTap(rowId, what, key) {
    const sh = ui.shot;
    const C = cocRules();
    if (!sh || sh.target !== rowId || sh.rolling || !C || !C.firearm) return;
    let sel = null;
    if (what === 'range' && C.firearm.ranges.some((r) => r.key === key)) { sh.range = key; sel = attr('data-fshr', `${rowId}|${key}`); }
    if (what === 'chip' && C.firearm.chips.some((c) => c.key === key)) { sh.chips[key] = !sh.chips[key]; sel = attr('data-fshc', `${rowId}|${key}`); }
    if (what === 'gun') {
      const g = CMath.gunsOf(rowById(sh.shooter))[Number(key)];
      if (g) { sh.gun = Number(key); sh.mal = isNum(g.malfunction) ? String(g.malfunction) : ''; sel = attr('data-fshgun', `${rowId}|${key}`); }
    }
    rememberShot(sh);
    RP.render();
    if (sel) RP.focusTo(sel);
  }
  // Dive tapped: an NPC's Dodge is rolled by the server; a PC's waits for the GM's Passed or Failed tap. Either way the
  // dive goes to the reducer (the lost attack); a pass puts its die on this shooter's shots at the target this turn.
  function shotDive(rowId, tap) {
    const sh = ui.shot;
    const f = state().fight;
    const D = rowById(rowId);
    if (!sh || sh.target !== rowId || sh.rolling || sh.diveRolling || sh.dive || !D || !f) return;
    const sel = attr('data-fshdive', rowId);
    if (D.kind === 'pc') {
      if (!tap) { sh.diveAsk = true; RP.render(); RP.focusTo(attr('data-fshdv', `${rowId}|passed`)); return; }
      sh.dive = { passed: tap === 'passed' };
      sh.diveAsk = false;
      rememberShot(sh);
      F({ type: 'dive', row: rowId, result: { tap } });
      RP.focusTo(attr('data-fshoot', rowId));
      return;
    }
    if (!isNum(D.dodge)) { RP.note(`${viewName(rowId) || D.name} has no Dodge: type it in its panel.`, { kind: 'bad', id: `dive:${rowId}` }); RP.focusTo(sel); return; }
    sh.diveRolling = true;
    RP.render();
    roll([{ d100: { target: D.dodge } }]).then(([res]) => {
      if (ui.shot !== sh) return;
      sh.diveRolling = false;
      const now = rowById(rowId);
      if (!res || !now || now.dodge !== res.target) {
        RP.note(`${viewName(rowId) || ''}: its Dodge changed while the dice were out: tap Dive again.`, { kind: 'bad' });
        RP.render();
        RP.focusTo(sel);
        return;
      }
      sh.dive = { passed: CMath.RANK[res.level] >= 1 };
      rememberShot(sh);
      F({ type: 'dive', row: rowId, result: res });
      RP.focusTo(attr('data-fshroll', rowId));
    }, (e) => { if (ui.shot === sh) sh.diveRolling = false; rollFailed(e); RP.render(); RP.focusTo(sel); });
  }
  // Roll (an NPC shooter): the server's d100 against the gun's skill or Firearms, at the range's difficulty, with the
  // net dice; or a PC's level tapped. The shot goes to the reducer; the strip stays open with the line, for a next shot,
  // its aim spent.
  function shotFire(rowId, level) {
    const sh = ui.shot;
    const f = state().fight;
    const C = cocRules();
    if (!sh || sh.target !== rowId || sh.rolling || sh.diveRolling || !f || !C) return;
    const A = rowById(sh.shooter);
    const D = rowById(rowId);
    if (!A || !D) return;
    const sel = level ? attr('data-fshlvl', `${rowId}|${level}`) : attr('data-fshroll', rowId);
    const gun = gunOfShot(sh);
    // a PC's shot carries no malfunction number (its box is not drawn)
    const mal = A.kind === 'pc' ? CMath.malfunctionOf(null, gun) : CMath.malfunctionOf(sh.mal, gun);
    if (mal === undefined) { RP.note('Malfunction: type a number from 1 to 100 (00 is 100), or leave it empty.', { kind: 'bad', id: `shot:mal:${rowId}` }); RP.focusTo(attr('data-fshmal', rowId)); return; }
    const skill = CMath.shotSkill(A, gun);
    const chips = shotChips(sh);
    const d = CMath.shotDice(chips, A, D, C);
    const names = { shooter: viewName(A.id) || A.name, target: viewName(rowId) || D.name };
    const send = (extra, line, hit) => {
      if (hit) ui.dmgMine = `${f.id}:${(isNum(f.meleeN) ? f.meleeN : 0) + 1}`;
      sh.last = line;
      // the aim is spent by this shot: the next one from this strip is not aimed
      delete sh.chips.aim;
      rememberShot(sh);
      F({ type: 'shot', shooter: A.id, target: rowId, chips, gun: sh.gun, malfunction: A.kind === 'pc' ? null : sh.mal, ...extra });
      RP.focusTo(sel);
    };
    if (A.kind === 'pc') {
      if (!CMath.isLevel(level)) return;
      const hit = CMath.shotHits(level, d.difficulty);
      send({ level }, CMath.shotLine(names, { dice: d, level, hit, flag: '' }), hit);
      return;
    }
    if (!isNum(skill)) { RP.note(`${names.shooter} has no Firearms: type it in its panel.`, { kind: 'bad', id: `shot:skill:${A.id}` }); RP.focusTo(sel); return; }
    sh.rolling = true;
    RP.render();
    roll([{ d100: { target: skill, difficulty: d.difficulty, ...d.asked } }]).then(([res]) => {
      if (ui.shot !== sh) return;
      sh.rolling = false;
      const nowA = rowById(sh.shooter);
      const nowD = rowById(rowId);
      const d2 = nowA && nowD ? CMath.shotDice(chips, nowA, nowD, C) : null;
      const r = d2 && CMath.shotRoll(res, CMath.shotSkill(nowA, gunOfShot(sh)), d2);
      if (!r || d2.net !== d.net) {
        RP.note(`${names.shooter}: the shot's figure or dice changed while the dice were out: tap Roll again.`, { kind: 'bad' });
        RP.render();
        RP.focusTo(sel);
        return;
      }
      const flag = CMath.malfunctionFlag(r.kept, mal, C);
      const hit = flag !== 'malfunction' && CMath.shotHits(r.level, d.difficulty);
      const cite = C.firearm.malfunction && C.firearm.malfunction.cite;
      send({ result: res }, CMath.shotLine(names, { dice: d, skill, roll: r, hit, flag, malfunction: mal, cite }), hit);
    }, (e) => { if (ui.shot === sh) sh.rolling = false; rollFailed(e); RP.render(); RP.focusTo(sel); });
  }

  // ---- CoC's damage box (Task 17): on the row an exchange hit, the attacker's dice and DB, the Extreme maximum ----
  // A row's group for the remembered entry: an NPC's or creature's note (its group mates, the copies of one entry or
  // the same creature listed twice, share it), else its foe entry, else the row.
  const groupKeyOf = (r) => (r.kind !== 'pc' && (r.note || r.foeKey) ? `group:${r.note || r.foeKey}` : `row:${r.id}`);
  const remembered = (r) => (r ? ui.lastDmg[`row:${r.id}`] || ui.lastDmg[groupKeyOf(r)] || '' : '');
  function remember(r, entry) {
    if (!r) return;
    ui.lastDmg[`row:${r.id}`] = entry;
    ui.lastDmg[groupKeyOf(r)] = entry;
  }
  // the damage box's hint: the attacker's dice, or the total a player rolled (the box is as wide as the system's)
  const DMG_PLACEHOLDER = '1D6+DB or 7';
  const DB_TITLES = { full: 'Full DB', half: 'Half DB', none: 'No DB' };
  // A weapon's impaling toggle: by the attacker's group and the dice the box opened with (so a tap before or after
  // typing keeps it), off unless tapped.
  const weaponOf = (g) => { const e = FM.parseEntry(g.opened, rules().fight || rules()); return e && e.dice ? e.dice.toUpperCase() : ''; };
  const impaleKey = (g) => { const A = rowById(g.by); return `${A ? groupKeyOf(A) : g.by}|${weaponOf(g)}`; };
  // a shot's gun that never impales (Task 19: Regency's flintlocks) keeps it off; one that impales starts it on
  const impaleOn = (g) => {
    if (g.impales === false) return false;
    const k = impaleKey(g);
    return Object.prototype.hasOwnProperty.call(ui.impale, k) ? Boolean(ui.impale[k]) : g.impales === true;
  };
  // A new exchange that owes damage opens its box on the row hit, with the attacker's last entry (Enter alone
  // repeats it) and the DB setting its kind starts at (a shot's none); none owed, or the turn moved on, and it shuts.
  // A box whose exchange ended elsewhere (another window's Next, a new exchange) after the GM typed in it stays,
  // marked over, so the words are not taken as damage typed cold; Enter says so, and ✕ or Esc shuts it. A new exchange
  // says the words it replaced. A box holding only what it opened with (nothing typed, or typed and put back) just
  // shuts, and empties, so its remembered entry is never sent cold.
  // The fight is gone (another window ended it) while a damage box was open: words typed in it are said, never lost.
  // Runs before the redraw takes the box away, so its value is still there.
  function lostDmg() {
    const g = ui.dmg;
    if (!g) return;
    ui.dmg = null;
    const box = document.querySelector(attr('data-fhp', g.on));
    const words = (box ? box.value : g.entry || '').trim();
    if (words && words !== (g.opened || '').trim()) RP.note(`Not sent: ${words} (${g.name || 'a damage box'}): that fight has ended.`, { kind: 'bad', id: `dmg:ended:${g.on}` });
  }
  function syncDmg(f) {
    const m = cocRules() ? f.melee : null;
    const g = ui.dmg;
    if (g && m && g.fight === f.id && g.n === m.n) return;
    let keep = null;
    if (g && g.fight === f.id && !g.sent) {
      const box = document.querySelector(attr('data-fhp', g.on));
      // judged on whether the GM typed in it (its words differ from what the page put there), never on focus
      const typed = (box ? box.value : g.entry).trim() !== (g.opened || '').trim();
      if (g.stale || typed) { g.stale = true; g.rolling = false; keep = g; } else ui.dmgClear = g.on;
    }
    ui.dmg = keep;
    // none owed: this page's exchange missed (or none is open), so a later one from another window takes no focus
    if (!m) { ui.dmgMine = null; return; }
    const key = `${f.id}:${m.n}`;
    if (ui.dmgSeen === key) return;
    ui.dmgSeen = key;
    // a new exchange replaces a box marked over: its typed words are said, never dropped quietly
    if (keep && keep.entry.trim()) {
      const said = `Not sent: ${keep.entry.trim()} (${viewName(keep.on) || 'a damage box'}): that exchange is over.`;
      setTimeout(() => RP.note(said, { kind: 'bad', id: `dmg:dropped:${keep.on}:${keep.n}` }), 0);
    }
    // a shot's gun with one damage opens with it; one with a damage by range opens empty, its choices beside (Task 19)
    const choices = CMath.damageChoices(m.damage);
    const entry = choices.length > 1 ? '' : choices[0] || remembered(rowById(m.by));
    ui.dmg = { fight: f.id, n: m.n, by: m.by, on: m.on, name: viewName(m.on) || '', mode: CMath.dbModeOf(m.kind), entry, opened: entry, offer: Boolean(m.offer), rolling: false,
      ...(typeof m.impales === 'boolean' ? { impales: m.impales } : {}), choices };
    delete ui.pending[m.on];
    delete ui.refused[m.on];
    if (ui.dmgMine === key) ui.dmgFocus = m.on;
    ui.dmgMine = null;
  }
  // The box's line: whose damage and their DB, the DB setting, and on an Extreme hit the impaling toggle and its offer.
  function dmgLine2(id) {
    const g = ui.dmg;
    if (!g || g.on !== id) return '';
    const A = viewRow(g.by);
    if (!A) return '';
    const name = A.gmName || A.name;
    const shut = `<button type="button" class="tg dback" data-fdmgclose="${esc(id)}" aria-label="${esc(`Close ${name}'s damage box`)}" title="No damage: close">\u2715</button>`;
    if (g.stale) return `<span class="dmgbox" role="group" aria-label="${esc(`Damage from ${name}`)}"><span class="mnote">${esc(`${name}'s damage: that exchange is over, not applied: Esc or \u2715 to clear`)}</span>${shut}</span>`;
    const db = CMath.dbTerm(A.db);
    const modes = CMath.DB_MODES.map((k) => `<button type="button" class="tg dbm${g.mode === k ? ' on' : ''}" data-fdmgdb="${esc(`${id}|${k}`)}" aria-pressed="${g.mode === k}" title="${esc(DB_TITLES[k])}">${esc(k)}</button>`).join('');
    let h = `<span class="dmgbox" role="group" aria-label="${esc(`Damage from ${name}`)}"><span>${esc(`${name}'s damage, DB ${db === null ? String(A.db) : db || 'none'}:`)}</span>${modes}`;
    // a weapon's damage by range: each a tap that types it into the box, never picked for the GM (Task 19)
    if (g.choices && g.choices.length > 1) h += g.choices.map((c) => `<button type="button" class="tg" data-fdmgpick="${esc(`${id}|${c}`)}" title="${esc(`Type ${c} into the box`)}">${esc(c)}</button>`).join('');
    if (g.offer) {
      const imp = impaleOn(g);
      const never = g.impales === false;
      h += `<button type="button" class="tg imp${imp ? ' on' : ''}" data-fdmgimp="${esc(id)}" aria-pressed="${imp}"${never ? ' disabled' : ''} title="${never ? 'This weapon never impales' : 'Impaling weapon'}">impaling</button>`
        + `<button type="button" class="offer" data-fdmgx="${esc(id)}"${g.rolling ? ' disabled' : ''} title="Extreme hit: maximum">Extreme: max</button>`;
    }
    return `${h}${shut}</span>`;
  }
  // The attacker for dice typed cold into a row's box: the row whose panel shows, else the one whose turn it is.
  function coldAttacker(f, id) {
    const A = attackerOf(f.rows, f);
    return A && A.id !== id ? A.id : null;
  }
  // Why an entry's dice cannot go to the server (no attacker for its DB, a DB that is not dice or a number); '' when
  // they can.
  function dmgRefusal(spec, A) {
    if (!spec) return words().entryInvalid || INVALID;
    if (spec.error === 'attacker') return 'DB: whose? Tap the attacker\'s name first';
    if (spec.error === 'db') return `${viewName(A.id) || A.name}'s DB is not dice or a number: type it in its panel`;
    return '';
  }
  // Enter in a CoC row's box: dice rolled with the attacker's DB, or a bare number in a box an exchange opened (the
  // total as rolled). False for anything else, which goes the usual way (a bare number typed cold is raw).
  function cocEnter(t) {
    const id = t.dataset.fhp;
    const f = state().fight;
    if (!f) return false;
    const g = ui.dmg && ui.dmg.on === id && ui.dmg.fight === f.id ? ui.dmg : null;
    const entry = t.value.trim();
    const e = FM.parseEntry(entry, FM.rulesOf(f));
    if (!e || e.pool !== 'hp' || e.kind !== 'damage' || (!e.dice && !g)) return false;
    if (g && g.rolling) return true;
    // the exchange went stale in another window (its damage applied, the turn moved on): said, never sent
    if (g && (g.stale || !(f.melee && f.melee.n === g.n))) {
      RP.note(`${entry}: that exchange is over (the turn moved on), not applied: Esc or \u2715 to clear.`, { kind: 'bad', id: `dmg:over:${id}` });
      return true;
    }
    const by = g ? g.by : coldAttacker(f, id);
    if (!e.dice) {
      // `sent` goes up before the dispatch, not after: the reducer runs inside it and redraws at once, and syncDmg
      // would take the emptied box for words typed over a finished exchange. The check above has already seen the
      // exchange is the reducer's open one, so the hit is not turned away.
      g.sent = true;
      t.value = '';
      markPending(t);
      F({ type: 'hp', row: id, entry, by, exchange: g.n });
      RP.focusTo(attr('data-fhp', id));
      return true;
    }
    const A = by ? rowById(by) : null;
    const mode = g ? g.mode : 'full';
    const spec = CMath.damageRoll(e, A, mode);
    const why = dmgRefusal(spec, A);
    if (why) { refuse(t, why); return true; }
    remember(A, entry);
    sendDamage(t, { id, g, e, entry, by, mode, spec, asks: [{ damage: spec.notation, floor: 0 }] });
    return true;
  }
  // The Extreme offer, one tap: the box's dice at their maximum with the maximum DB, and with impaling on one more
  // roll of the weapon's dice (the server's maxRoll and roll). Rolling instead is Enter, as for any hit.
  function dmgExtreme(id) {
    const g = ui.dmg;
    const f = state().fight;
    const t = document.querySelector(attr('data-fhp', id));
    if (!f || !g || g.on !== id || !g.offer || g.rolling || g.stale || !t) return;
    const entry = t.value.trim();
    const e = FM.parseEntry(entry, FM.rulesOf(f));
    if (!e || !e.dice) { refuse(t, 'Extreme: type the weapon\'s dice first, like 1D6+DB'); return; }
    const A = rowById(g.by);
    const spec = CMath.damageRoll(e, A, g.mode);
    const why = dmgRefusal(spec, A);
    if (why) { refuse(t, why); return; }
    remember(A, entry);
    const impale = impaleOn(g);
    const asks = [{ damage: spec.notation, floor: 0, max: true }].concat(impale ? [{ damage: spec.weapon, floor: 0 }] : []);
    sendDamage(t, { id, g, e, entry, by: g.by, mode: g.mode, spec, asks, extreme: true });
  }
  // The dice out at the server, then the hit to the reducer. A DB that changed while they were out, an exchange that
  // ended, or a fight that ended: said, never applied; the words go back in the box.
  function sendDamage(t, x) {
    const f = state().fight;
    const { id, g } = x;
    t.value = '';
    markPending(t);
    if (g) g.rolling = true;
    const back = () => {
      if (g && ui.dmg === g) { g.rolling = false; g.entry = x.entry; } else ui.pending[id] = x.entry;
      RP.render();
      RP.focusTo(attr('data-fhp', id));
    };
    roll(x.asks).then((res) => {
      const now = state().fight;
      if (!now || !f || now.id !== f.id) { RP.note(`${x.entry} rolled ${res[0].total}, but that fight has ended: not applied.`, { kind: 'bad', id: `roll:late:${x.entry}` }); return; }
      const A = x.by ? rowById(x.by) : null;
      const spec = CMath.damageRoll(x.e, A, x.mode);
      if (!spec || spec.notation !== x.spec.notation) {
        RP.note(`${(A && viewName(A.id)) || 'The attacker'}'s DB changed while the dice were out: press Enter again.`, { kind: 'bad', id: `dmg:stale:${id}` });
        back();
        return;
      }
      if (g && !(now.melee && now.melee.n === g.n)) {
        // the box is still there: its words go back, with how to clear them. It shut or was replaced meanwhile: the
        // words are said and nothing is left to clear
        if (ui.dmg === g) {
          RP.note(`${x.entry}: that exchange is over (the turn moved on), not applied: Esc or \u2715 to clear.`, { kind: 'bad', id: `dmg:over:${id}` });
          back();
        } else {
          RP.note(`Not sent: ${x.entry} (${viewName(id) || 'a damage box'}): that exchange is over.`, { kind: 'bad', id: `dmg:over:${id}` });
          RP.render();
        }
        return;
      }
      // before the dispatch, for the reason cocEnter gives: its redraw runs syncDmg, and the exchange was checked just above
      if (g) { g.rolling = false; g.sent = true; }
      F({ type: 'hp', row: id, entry: x.entry, by: x.by, mode: x.mode, roll: res[0], ...(g ? { exchange: g.n } : {}), ...(x.extreme ? { extreme: true, ...(res[1] ? { extra: res[1] } : {}) } : {}) });
      RP.focusTo(attr('data-fhp', id));
    }, (err) => { rollFailed(err); back(); });
  }

  // ---- the cards (GURPS's, Task 13; CoC's, Task 18): prompts, one per hit, a turn's start and end, a round's end, a
  // SAN loss; nothing here decides an outcome ----
  function cardsHTML(f) {
    const K = cardKit();
    if (!K) return '';
    // newest first (Task 34): the card for the hit just typed leads the strip, in view; each names its row. A card's
    // id counts up through the fight (`k12`); one without a count keeps its place after the counted ones.
    const n = (c) => { const m = /^k(\d+)$/.exec(String(c.id)); return m ? Number(m[1]) : -1; };
    const all = [];
    for (const r of f.view.rows) for (const c of r.cards || []) all.push([r, c]);
    const out = all.map((x, i) => [x, i]).sort((a, b) => n(b[0][1]) - n(a[0][1]) || a[1] - b[1]).map(([[r, c]]) => cardHTML(r, c, K));
    return out.length ? `<div class="fcards">${out.join('')}</div>` : '';
  }
  // A card's buttons each carry `data-fcbtn` "row|card|line|take" (take: an offer, `out`, `dismiss`, `roll`, or a PC's
  // `passed` and `failed`).
  const cardBtn = (r, c, line, take) => `data-fcbtn="${esc([r.id, c.id, line, take].join('|'))}"`;
  const CARD_WHAT = { conscious: 'turn start', recover: 'turn end' };
  // The figure a card waits for before its Roll (GURPS's HT; an NPC's CON or INT in CoC): its key, or null. A PC's CoC
  // card never rolls, so it never asks.
  function cardWants(r, c, K, next) {
    if (K.coc) {
      const l = next >= 0 ? c.lines[next] : null;
      const k = l && r.kind !== 'pc' ? K.M.lineStat(l) : null;
      return k && !isNum(r[k]) ? k : null;
    }
    return !isNum(r.ht) && c.lines.some((l) => l.kind !== 'dead' && !l.noRoll) ? 'ht' : null;
  }
  const statLabel = (K, k) => (K.coc ? ((K.C.stats || {})[k] || k.toUpperCase()) : 'HT');
  function cardHTML(r, c, K) {
    const C = K.C;
    const next = GMath.nextLine(c, C);
    const want = cardWants(r, c, K, next);
    const what = c.what || CARD_WHAT[c.kind] || (c.kind === 'hit' ? 'hit' : '');
    const note = K.coc && C.notes && C.notes[c.kind] ? `<span class="cite">${esc(C.notes[c.kind])}</span>` : '';
    const standing = (c.standing || []).map((o) => `<button type="button" class="tg stand" ${cardBtn(r, c, '', o)}>${esc((GMath.offerOf(C, o) || {}).label || o)}</button>`).join('');
    let h = `<div class="fcard" data-fcard="${esc(c.id)}" data-fcrow="${esc(r.id)}"><div class="fch">`
      + `<button type="button" class="nm" data-fcardpick="${esc(r.id)}" title="Show ${esc(r.gmName)}'s panel">${esc(r.gmName)}</button>`
      + `<span class="what">${esc(what)}</span>${note}<span class="sp"></span>${standing}`
      + `<button type="button" class="tg" ${cardBtn(r, c, '', 'out')} title="Out of the fight now, whatever the rolls">Out</button>`
      + `<button type="button" class="x" ${cardBtn(r, c, '', 'dismiss')} title="Dismiss: nothing applied, nothing logged" aria-label="Dismiss this card">\u2715</button></div>`;
    if (want) {
      const lab = statLabel(K, want);
      h += `<label class="cht"><span class="lab">${esc(lab)}</span><input data-fcardstat="${esc(`${r.id}|${want}`)}" inputmode="numeric" autocomplete="off" placeholder="${esc(lab)}" aria-label="${esc(lab)} for ${esc(r.gmName)}"><span class="note">first, then Roll</span></label>`;
    }
    h += `<ol class="clines">${c.lines.map((l, i) => {
      const cls = [i === next ? 'next' : '', l.result || l.taken ? 'rolled' : ''].join(' ').trim();
      const res = l.result ? `<span class="res">${esc(K.M.resultText(l.result))}</span>` : '';
      // each offer, and a decline for the line (nothing applied, nothing logged)
      const offers = GMath.pending(l) ? l.offers.map((o) => `<button type="button" class="offer" ${cardBtn(r, c, i, o)}>${esc((GMath.offerOf(C, o) || {}).label || o)}</button>`).join('')
        + `<button type="button" class="decline" ${cardBtn(r, c, i, 'dismiss')} title="Decline: nothing applied, nothing logged" aria-label="Decline this line's offer">\u2715</button>` : '';
      const took = l.taken ? `<span class="took">${esc((GMath.offerOf(C, l.taken) || {}).label || l.taken)}</span>` : '';
      return `<li${cls ? ` class="${cls}"` : ''}><span class="lt">${esc(K.M.lineText(l, r, C))}</span>${res}${offers}${took}</li>`;
    }).join('')}</ol>`;
    if (next >= 0 && K.coc && r.kind === 'pc') {
      // a PC's roll is the player's: the GM taps what it was
      const wait = ui.rolling[c.id] ? 'disabled' : '';
      h += `<span class="taps" role="group" aria-label="The player's roll"><button type="button" class="primary pass" ${cardBtn(r, c, next, 'passed')} ${wait} title="The player's roll passed">Passed</button>`
        + `<button type="button" class="primary fail" ${cardBtn(r, c, next, 'failed')} ${wait} title="The player's roll failed">Failed</button></span>`;
    } else if (next >= 0) {
      const wait = want || ui.rolling[c.id];
      const tip = want ? `Type ${statLabel(K, want)} first` : K.coc ? 'Roll d100 against the next line' : 'Roll 3d6 against the next line';
      h += `<button type="button" class="primary roll" ${cardBtn(r, c, next, 'roll')} ${wait ? 'disabled' : ''} title="${esc(tip)}">Roll</button>`;
    }
    return `${h}</div>`;
  }
  // The server rolls the card's next line: GURPS's 3d6 against HT and its modifier, CoC's d100 against CON or INT; the
  // result goes on that line.
  function rollCard(rowId, cardId) {
    const f = state().fight;
    const K = cardKit();
    const r = rowById(rowId);
    const c = r && (r.cards || []).find((x) => x.id === cardId);
    if (!f || !K || !c || ui.rolling[cardId] || (K.coc && r.kind === 'pc')) return;
    const line = GMath.nextLine(c, K.C);
    const target = line < 0 ? null : K.M.lineTarget(c.lines[line], r);
    if (target === null) return;
    ui.rolling[cardId] = true;
    RP.render();
    roll([K.coc ? { d100: { target } } : { against: target }]).then(([res]) => {
      delete ui.rolling[cardId];
      const now = state().fight;
      if (now && now.id === f.id) {
        const mine = focusOnCard(rowId, cardId);
        RP.dispatch({ fight: f.id, type: 'cardRolled', row: rowId, card: cardId, line, result: res });
        if (mine) focusCard(rowId, cardId);
      } else RP.render();
    }, (e) => { delete ui.rolling[cardId]; rollFailed(e); RP.render(); });
  }
  // A PC's line answered by the GM's tap of the player's roll (CoC): the result goes on the line, as a roll's does.
  function tapCard(rowId, cardId, line, tap) {
    F({ type: 'cardRolled', row: rowId, card: cardId, line, result: { tap } });
    focusCard(rowId, cardId);
  }
  // An offer taken. A bout's offer (CoC's Temporary insanity) first has the server roll its rounds (the Keeper's 1D10).
  function takeCard(rowId, cardId, line, take) {
    const K = cardKit();
    const o = K && GMath.offerOf(K.C, take);
    const send = (more) => F({ type: 'card', row: rowId, card: cardId, ...(line === '' ? {} : { line: Number(line) }), take, ...(more || {}) });
    // an offer taken may settle the card and drop it: focus goes on, never to the page
    if (!o || !o.bout) { send(); focusCard(rowId, cardId); return; }
    const f = state().fight;
    if (!f || ui.rolling[cardId]) return;
    ui.rolling[cardId] = true;
    const who = viewName(rowId) || 'a character';
    RP.render();
    roll([{ sides: K.C.bout.sides }]).then(([res]) => {
      delete ui.rolling[cardId];
      const now = state().fight;
      if (now && now.id === f.id) { const mine = focusOnCard(rowId, cardId); send({ bout: res }); if (mine) focusCard(rowId, cardId); } else {
        RP.note(`Bout of madness for ${who} rolled ${res.total}, but that fight has ended: not applied.`, { kind: 'bad', id: `roll:late:bout:${cardId}` });
        RP.render();
      }
    }, (e) => { delete ui.rolling[cardId]; rollFailed(e); RP.render(); });
  }
  // A roll back from the server moves focus only when it is on the page or still in that card: a GM who went on to
  // another box during the round trip keeps it (Task 23).
  function focusOnCard(rowId, cardId) {
    const a = document.activeElement;
    if (!a || a === document.body) return true;
    const c = a.closest && a.closest('.fcard');
    return Boolean(c) && c.dataset.fcard === cardId && c.dataset.fcrow === rowId;
  }
  // After a roll, focus stays on the card: its Roll (or a PC's Passed) for the next line, else its first offer, else its
  // first control.
  function focusCard(rowId, cardId) {
    const el = document.querySelector(`#acting .fcard${attr('data-fcard', cardId)}${attr('data-fcrow', rowId)}`);
    const to = el && (el.querySelector('button.roll:not([disabled]), button.pass:not([disabled])') || el.querySelector('button.offer') || el.querySelector('[data-fcbtn]'));
    if (to) { RP.focusTo(attr('data-fcbtn', to.dataset.fcbtn)); return; }
    // the card settled and went: the row's entry box, else the panel's first box, else its first button; never the page
    const box = document.querySelector(attr('data-fhp', rowId));
    if (box) { RP.focusTo(attr('data-fhp', rowId)); return; }
    const next = document.querySelector('#acting .pbox, #acting button:not([disabled])');
    const a = next && Array.from(next.attributes).find((x) => x.name.startsWith('data-f'));
    if (a) RP.focusTo(attr(a.name, a.value));
    else if (next && next.id) RP.focusTo(`#${CSS.escape(next.id)}`);
  }
  // The panel's shock chip: its size, tapped open for −1 to the cap, or clear (a hit worked out on paper).
  function shockHTML(r) {
    const C = consequences();
    if (!C || r.kind === 'lair') return [];
    const on = isNum(r.shock) && r.shock > 0;
    const out = [`<button type="button" class="tg shock ${on ? 'on' : ''}" data-fshock="${esc(r.id)}" aria-expanded="${ui.shockPick === r.id}" title="Shock: tap to set its size">${on ? `Shock \u2212${r.shock}` : 'Shock'}</button>`];
    if (ui.shockPick === r.id) {
      const cap = C.shock && isNum(C.shock.cap) ? C.shock.cap : 4;
      const sizes = Array.from({ length: cap }, (_, i) => i + 1).map((n) => `<button type="button" data-fshockset="${esc(`${r.id}|${n}`)}" aria-pressed="${r.shock === n}">\u2212${n}</button>`);
      out.push(`<span class="shockset" role="group" aria-label="Shock">${sizes.join('')}<button type="button" data-fshockset="${esc(`${r.id}|0`)}">clear</button></span>`);
    }
    return out;
  }
  // A card new to this page is brought into view once (its row is seldom the one the panel shows).
  function showNewCards() {
    document.querySelectorAll('#acting .fcard').forEach((el) => {
      const k = `${el.dataset.fcrow}|${el.dataset.fcard}`;
      if (ui.cardsSeen.has(k)) return;
      ui.cardsSeen.add(k);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  // The hit chips (GURPS, Task 12): the damage types, the row's last used first; and the hit location list (Task 25),
  // every place in the one table, mildest penalty first, each labelled with the picked type's multiplier (a place the
  // type cannot hit turned off, saying so). A chip tap or a pick writes its word into the row's entry box for this
  // entry only (the box empties after it): the list shows Torso whenever the words name no place.
  function hitChipsHTML(r) {
    const w = wounding();
    if (!w || !toggles().hitChips || !r.in || !isNum(r.hp)) return '';
    const last = ui.lastHit[r.id] || {};
    const now = boxHit(r.id);
    const chip = (kind, v, on) => `<button type="button" class="hchip" data-fh${kind}="${esc(`${r.id}|${v}`)}" aria-pressed="${on}">${esc(v)}</button>`;
    const types = FM.chipOrder(w.typeChips || Object.keys(w.types), last.type).map((v) => chip('type', v, now.type === v));
    const at = now.location || 'torso';
    const opts = locationOrder(w).map((k) => {
      const o = locationOption(w, k, now.type);
      return `<option value="${esc(k)}"${k === at ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label)}</option>`;
    });
    return `<div class="hitchips" data-fhits="${esc(r.id)}"><div class="hrow" role="group" aria-label="Damage type">${types.join('')}</div>`
      + `<label class="hloc"><span class="lab">Hit location</span><select data-fhlocsel="${esc(r.id)}" aria-label="Hit location for ${esc(r.gmName)}">${opts.join('')}</select></label></div>`;
  }
  const locationOrder = (w) => w.locationOrder || Object.keys(w.locations);
  const locationOption = (w, k, type) => (GMath && typeof GMath.locationOption === 'function' ? GMath.locationOption(w, k, type) : { label: k, disabled: false });
  // The hit words in a row's entry box now (its box, else the words kept for it).
  function boxHit(id) {
    const box = document.querySelector(attr('data-fhp', id));
    const v = box ? box.value : (ui.pending[id] || (ui.refused[id] && ui.refused[id].words) || '');
    return FM.hitWords(v, rules().fight || rules());
  }
  // The chips' pressed state and the location list follow the box's words: the place they name (Torso for none), each
  // option relabelled for the type they name.
  function syncHitChips(id) {
    const now = boxHit(id);
    document.querySelectorAll(`#acting .hitchips${attr('data-fhits', id)} .hchip`).forEach((b) => {
      const [, v] = split(b.dataset.fhtype);
      b.setAttribute('aria-pressed', String(now.type === v));
    });
    const sel = document.querySelector(`#acting select${attr('data-fhlocsel', id)}`);
    const w = wounding();
    if (!sel || !w) return;
    for (const o of Array.from(sel.options)) {
      const opt = locationOption(w, o.value, now.type);
      if (o.textContent !== opt.label) o.textContent = opt.label;
      if (o.disabled !== opt.disabled) o.disabled = opt.disabled;
    }
    const at = now.location || 'torso';
    if (sel.value !== at) sel.value = at;
  }
  // A hit's words with one part changed: the type (a chip; tapped again, out) or the place (the list; Torso is no place
  // word), the GM's damage kept. Answers the caret's place, after the damage.
  function setHitWords(box, kind, v) {
    const h = FM.hitWords(box.value, rules().fight || rules());
    if (kind === 'type') h.type = h.type === v ? null : v;
    else {
      h.location = v && v !== 'torso' ? v : null;
      const loc = h.location && wounding().locations[h.location];
      if (!loc || !loc.sided) h.side = null;
    }
    const tail = FM.hitText({ ...h, amount: '' });
    box.value = h.amount ? `${h.amount}${tail ? ` ${tail}` : ''}` : (tail ? ` ${tail}` : '');
    // markPending syncs the chips and the list
    markPending(box);
    return h.amount.length;
  }
  // A type chip tapped: its word into (or out of) the box; the caret after the damage, so what is typed next is it.
  function tapHitChip(id, v) {
    const box = document.querySelector(attr('data-fhp', id));
    if (!box) return;
    const at = setHitWords(box, 'type', v);
    box.focus();
    box.setSelectionRange(at, at);
  }
  // A place picked from the list: its word into the box. Focus stays on the list, so the arrows go on through it.
  function pickLocation(id, v) {
    const box = document.querySelector(attr('data-fhp', id));
    if (!box) return;
    setHitWords(box, 'location', v);
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
  // The GURPS to-hit calculator's button (Task 24, gm-tohit.js opens it): `data-tohit` names the row it opens for.
  const TH = () => (window.RunSheetToHit && window.RunSheetToHit.available() ? window.RunSheetToHit : null);
  const toHitButton = (id, rowId) => (TH() ? `<button type="button" id="${id}" data-tohit="${esc(rowId || '')}" title="${esc(TH().title)}">To-hit</button>` : '');
  function sideHTML(d) {
    const f = d.fight;
    const view = f.view;
    syncMelee(f);
    syncDmg(f);
    // the toolbar's To-hit: the PC whose turn it is (the panel then shows a foe: FM.actingRow never gives the turn's
    // PC), else the row the panel shows
    const turnRow = f.view.rows.find((x) => x.id === f.turn);
    const shown = turnRow && turnRow.kind === 'pc' ? turnRow : actingOf(f).row;
    let h = '<div class="fview"><div class="fo" id="fOrder"><div class="fotop">';
    h += `<div class="fh"><b>${f.started ? `Round ${esc(f.round)}` : 'Setting up'}</b>`
      // a system that works the order out (CoC's DEX, GURPS's Basic Speed) has nothing to roll
      + (rolled() ? '<button type="button" id="fRoll" title="Roll d20 + modifier for every ticked foe and ally with no number yet (never a PC)">Roll</button>' : '')
      + '<button type="button" id="fSort" title="Sort once by initiative; whose turn it is stays">Sort</button>'
      + `<button type="button" id="fNext" class="primary">${f.started ? 'Next ▸' : 'Start ▸'}</button><span class="sp"></span>`
      + `<button type="button" id="fArea" class="${ui.area ? 'on' : ''}" aria-pressed="${ui.area}" title="Tick several rows, type the damage once">Area</button>`
      + toHitButton('fToHit', shown && shown.kind !== 'lair' ? shown.id : '')
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
      const was = Boolean(ui.spellsOpen[el.dataset.fspells]);
      if (el.open) ui.spellsOpen[el.dataset.fspells] = true; else delete ui.spellsOpen[el.dataset.fspells];
      // opened by the GM (not a redraw of an open one): its spells come into view, top and bottom where they fit
      if (el.open && !was) el.scrollIntoView({ block: el.offsetHeight < window.innerHeight - topH() ? 'nearest' : 'start' });
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
      'data-fspend', 'data-fafter', 'data-fjot', 'data-fight', 'data-fplace', 'data-fcbtn', 'data-fcardpick', 'data-fcardstat', 'data-fshock',
      'data-fshockset', 'data-fdef', 'data-fpdef', 'data-fretreat', 'data-fman', 'data-fmand', 'data-fmanrow',
      'data-fmelee', 'data-fmdice', 'data-fmlvl', 'data-fmx', 'data-fmout', 'data-fdmgdb', 'data-fdmgimp', 'data-fdmgx', 'data-fdmgclose',
      'data-fdmgpick', 'data-fshoot', 'data-fshr', 'data-fshc', 'data-fshgun', 'data-fshdive', 'data-fshdv', 'data-fshroll', 'data-fshlvl', 'data-fshx',
      'data-fshmal', 'data-faim', 'data-faimoff', 'data-freload', ...PANEL_KEYS.map((k) => `data-fs-${k}`)],
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
      if (!f) lostDmg();
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
    // Rows the order's least width is measured with as well as its own (gm.js orderMin, Task 34): a foe row with every
    // figure filled and the fight's longest name, once acting and once not, so the order's column is as wide from the
    // start as its rows can grow, and the split beside it holds still as they gain numbers. CoC and GURPS only (D&D's
    // rows keep today's measure).
    measureRows() {
      const d = RP.derived();
      const f = d && d.fight;
      if (!f || f.paused || !panelBoxes().length) return [];
      const longest = f.view.rows.reduce((a, r) => (String(r.gmName || '').length > a.length ? String(r.gmName) : a), '');
      // two-digit figures, as a hurt foe's are (`-13/11`, `Parry 13`); the initiative box is a fixed width
      const full = { ...FM.blankRow({ id: '\u2007measure', name: longest }), gmName: longest, kind: 'foe', in: true, seen: false,
        ini: initPlaces() ? 9.99 : 99, hp: -99, max: 99, temp: 0, fp: -9, fpMax: 99, mp: 99, mpMax: 99, san: 99, sanMax: 99,
        dodge: 99, parry: 99, block: 99, dex: 99, conds: [], cards: [] };
      return [rowHTML(full, { ...f, turn: full.id }, f.view), rowHTML(full, f, f.view)];
    },
    // after every layout pass (gm.js applyLayout): the rows' status strips fit their room
    afterLayout() {
      fitChips();
      showNewCards();
      // a damage box this page's exchange opened takes focus, after the redraw has put focus back where it was
      if (ui.dmgFocus) { const id = ui.dmgFocus; ui.dmgFocus = null; setTimeout(() => RP.focusTo(attr('data-fhp', id)), 0); }
      // an untouched box that shut keeps focus but not its remembered entry (the redraw puts typed words back)
      if (ui.dmgClear) {
        const id = ui.dmgClear;
        ui.dmgClear = null;
        setTimeout(() => { const b = document.querySelector(attr('data-fhp', id)); if (b && !(ui.dmg && ui.dmg.on === id)) { b.value = ''; markPending(b); } }, 0);
      }
    },
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
            id: r.id, note: r.note, copy: r.copy, kind: r.kind, side: sideWord(r), name: r.gmName, in: r.in, held: Boolean(r.held), ini: isNum(r.ini) ? r.ini : null, mod: r.mod,
            hp: r.hp, max: r.max, ac: r.ac, temp: r.temp, conds: r.conds, exhaustion: r.exhaustion, conc: r.conc, out: r.out, seen: r.seen,
            recharge: (r.recharge || []).map((x) => ({ name: x.name, ready: x.ready, rolled: x.rolled })),
            // the systems' figures (step 6b)
            fp: r.fp, fpMax: r.fpMax, mp: r.mp, mpMax: r.mpMax, san: r.san, sanMax: r.sanMax, dex: r.dex, st: r.st, ht: r.ht, dx: r.dx,
            speed: r.speed, fighting: r.fighting, marks: r.marks, deepest: r.deepest, tired: r.tired, gun: r.gun, from: r.from,
            er: r.er, erMax: r.erMax, caster: r.caster, dr: r.dr, faceOpen: r.faceOpen, hit: r.hit, crippled: r.crippled,
            shock: r.shock || 0, cards: r.cards || [],
            dodge: r.dodge, parry: r.parry, block: r.block, parries: r.parries || 0, blocks: r.blocks || 0, defended: r.defended || 0, retreat: Boolean(r.retreat),
            manoeuvre: r.manoeuvre || null, aodDefence: r.aodDefence || null, aim: r.aim || 0, evaluate: r.evaluate || 0,
            // CoC's melee (Task 16): the count, the switch, and what the row's buttons and stepper show
            meleeDefences: r.meleeDefences || 0, outnumberedOff: Boolean(r.outnumberedOff), attacks: r.attacks, build: r.build, db: r.db,
            meleeButtons: Array.from(document.querySelectorAll(`li[data-frow="${CSS.escape(r.id)}"] [data-fmelee]`), (b) => ({ text: b.textContent, dflt: b.classList.contains('dflt') })),
            meleeDice: (() => { const e = document.querySelector(`li[data-frow="${CSS.escape(r.id)}"] .mdn`); return e ? e.textContent : null; })(),
            // CoC's firearms (Task 19): the Shoot and aim buttons drawn, the marks
            shoot: Boolean(document.querySelector(`li[data-frow="${CSS.escape(r.id)}"] [data-fshoot]`)),
            aimButton: Boolean(document.querySelector(`li[data-frow="${CSS.escape(r.id)}"] [data-faim]`)),
            guns: (r.guns || []).map((g) => g.name), aiming: r.aiming || null, lostAttack: r.lostAttack || null, reload: r.reload || null,
          })),
          shot: ui.shot ? { shooter: ui.shot.shooter, target: ui.shot.target, range: ui.shot.range, chips: shotChips(ui.shot), gun: ui.shot.gun, mal: ui.shot.mal,
            dive: ui.shot.dive, rolling: ui.shot.rolling || Boolean(ui.shot.diveRolling), last: ui.shot.last } : null,
          melee: ui.melee ? { target: ui.melee.target, attacker: ui.melee.attacker, response: ui.melee.response, rolling: ui.melee.rolling, net: ui.melee.net } : null,
          dmg: ui.dmg ? { on: ui.dmg.on, by: ui.dmg.by, mode: ui.dmg.mode, entry: ui.dmg.entry, offer: ui.dmg.offer, rolling: ui.dmg.rolling, impale: impaleOn(ui.dmg), choices: ui.dmg.choices || [] } : null,
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
  // a row's name as the GM sees it now (unmasked, numbered)
  const viewName = (id) => { const f = RP.derived().fight; const v = f && f.view && f.view.rows.find((r) => r.id === id); return v ? v.gmName : null; };
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
    if (t.id === 'fSort') { placeHeld(); F({ type: 'fightSort' }); return true; }
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
    if (d.fpeek) {
      // a blank row's name picks it and puts the cursor in its panel's first empty box; a second click keeps both (D3a).
      // Any row's second click keeps it picked (Task 34): another row's name, or the turn moving on, moves the panel.
      if (panelBoxes().length && noNumbers(rowById(d.fpeek))) { pickRow(d.fpeek); return true; }
      ui.peek = d.fpeek;
      RP.render();
      return true;
    }
    if (d.fhtype) { const [rid, v] = split(d.fhtype); tapHitChip(rid, v); return true; }
    if (d.fcardpick) { ui.peek = d.fcardpick; RP.render(); return true; }
    if (d.fcbtn) {
      const parts = d.fcbtn.split('|');
      const take = parts.pop();
      const line = parts.pop();
      const card = parts.pop();
      const row = parts.join('|');
      if (take === 'roll') rollCard(row, card);
      else if (take === 'passed' || take === 'failed') tapCard(row, card, Number(line), take);
      else takeCard(row, card, line, take);
      return true;
    }
    if (d.fshock) { ui.shockPick = ui.shockPick === d.fshock ? null : d.fshock; RP.render(); return true; }
    if (d.fshockset) { const [rid, n] = split(d.fshockset); ui.shockPick = null; F({ type: 'setShock', row: rid, n: Number(n) }); return true; }
    if (d.fdef || d.fpdef) { const [rid, k] = split(d.fdef || d.fpdef); defend(rid, k, d.fdef ? 'data-fdef' : 'data-fpdef'); return true; }
    if (d.fman) { const [rid, k] = split(d.fman); pickManoeuvre(rid, k, null); return true; }
    if (d.fmand) { const [rid, k] = split(d.fmand); pickManoeuvre(rid, 'all-out defence', k); return true; }
    if (d.fmanrow) { ui.peek = f.turn === d.fmanrow ? null : d.fmanrow; RP.render(); RP.focusTo(attr('data-fmanrow', d.fmanrow)); return true; }
    if (d.fretreat) { const x = rowById(d.fretreat); if (x) F({ type: 'retreat', row: x.id, on: !x.retreat }); return true; }
    if (d.fmelee) { const [rid, k] = split(d.fmelee); meleeStart(rid, k); return true; }
    if (d.fmdice) { const [rid, n] = split(d.fmdice); meleeDice(rid, Number(n)); return true; }
    if (d.fmlvl) { const parts = d.fmlvl.split('|'); const level = parts.pop(); const side = parts.pop(); meleeTap(parts.join('|'), side, level); return true; }
    if (d.fmx) { const m = ui.melee; ui.melee = null; RP.render(); if (m) RP.focusTo(attr('data-fmelee', `${m.target}|${m.response}`)); return true; }
    if (d.fdmgdb) { const [rid, k] = split(d.fdmgdb); if (ui.dmg && ui.dmg.on === rid && CMath.DB_MODES.includes(k)) ui.dmg.mode = k; RP.render(); RP.focusTo(attr('data-fhp', rid)); return true; }
    if (d.fdmgimp) { const g = ui.dmg; if (g && g.on === d.fdmgimp && g.impales !== false) { const k = impaleKey(g); ui.impale[k] = !impaleOn(g); } RP.render(); RP.focusTo(attr('data-fhp', d.fdmgimp)); return true; }
    if (d.fdmgpick) {
      const [rid, c] = split(d.fdmgpick);
      const g = ui.dmg;
      if (g && g.on === rid && !g.rolling && !g.stale) { g.entry = c; const b = document.querySelector(attr('data-fhp', rid)); if (b) { b.value = c; markPending(b); } }
      RP.render();
      RP.focusTo(attr('data-fhp', rid));
      return true;
    }
    if (d.fshoot) { shootStart(d.fshoot); return true; }
    if (d.fshr) { const [rid, k] = split(d.fshr); shotTap(rid, 'range', k); return true; }
    if (d.fshc) { const [rid, k] = split(d.fshc); shotTap(rid, 'chip', k); return true; }
    if (d.fshgun) { const [rid, k] = split(d.fshgun); shotTap(rid, 'gun', k); return true; }
    if (d.fshdive) { shotDive(d.fshdive, null); return true; }
    if (d.fshdv) { const [rid, k] = split(d.fshdv); shotDive(rid, k); return true; }
    if (d.fshroll) { shotFire(d.fshroll, null); return true; }
    if (d.fshlvl) { const [rid, l] = split(d.fshlvl); shotFire(rid, l); return true; }
    if (d.fshx) { if (ui.shot && !ui.shot.rolling) ui.shot = null; RP.render(); RP.focusTo(attr('data-fshoot', d.fshx)); return true; }
    if (d.freload) { const [rid, g] = split(d.freload); F({ type: 'reload', row: rid, gun: Number(g), clear: true }); return true; }
    if (d.faim) { F({ type: 'aim', row: d.faim, on: true }); return true; }
    if (d.faimoff) { F({ type: 'aim', row: d.faimoff, on: false }); return true; }
    if (d.fdmgx) { dmgExtreme(d.fdmgx); return true; }
    if (d.fdmgclose) { if (ui.dmg && ui.dmg.on === d.fdmgclose) ui.dmg = null; RP.render(); RP.focusTo(attr('data-fhp', d.fdmgclose)); return true; }
    if (d.fmout) { const x = rowById(d.fmout); if (x) F({ type: 'outnumbered', row: x.id, off: !x.outnumberedOff }); RP.focusTo(attr('data-fmout', d.fmout)); return true; }
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
  // Enter in a row's damage box (or on its hit location list): the entry applied, or refused with its reason.
  function enterBox(t) {
    const d = t.dataset;
    // CoC's damage (Task 17): dice with the attacker's DB, or the total as rolled in a box an exchange opened
    if (cocRules() && cocEnter(t)) return;
    const e = FM.parseEntry(t.value, FM.rulesOf(state().fight));
    // a system that reads hits (GURPS) keeps words it cannot read in the box, its reason on the row's second line
    if (!e && wounding()) { refuse(t, cannotHit(t.value) || words().entryInvalid || INVALID); return; }
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
      // the fight ended (or another began) while the dice were out: said, never applied to the wrong fight
      else RP.note(`${entry} rolled ${res.total}, but that fight has ended: not applied.`, { kind: 'bad', id: `roll:late:${entry}` });
    }, (err) => {
      rollFailed(err);
      // the words go back in the box, as typed
      ui.pending[d.fhp] = entry;
      RP.render();
    });
  }

  // Why a hit's words are refused when their type cannot target their place (Task 25): "cr cannot target the eye".
  function cannotHit(v) {
    const type = FM.cannotTarget(v, rules().fight || rules());
    if (!type) return null;
    const h = FM.hitWords(v, rules().fight || rules());
    const loc = wounding().locations[h.location] || {};
    return `${type} cannot target the ${String(loc.name || h.location).toLowerCase()}`;
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
    // the title keeps the words whole as they change (a narrow box clips a long place)
    const tip = v.trim() || t.dataset.tip || '';
    if (tip) t.title = tip; else t.removeAttribute('title');
    // a refused entry stays refused while its words are in the box; any change clears the reason
    if (ui.refused[id] && ui.refused[id].words !== v) delete ui.refused[id];
    // the damage box an exchange opened holds its entry as the box's own, never as damage left unapplied
    if (ui.dmg && ui.dmg.on === id) { ui.dmg.entry = v; delete ui.pending[id]; t.classList.remove('pending'); syncLine2(id); syncHitChips(id); return; }
    if (v.trim() && !ui.refused[id]) ui.pending[id] = v; else delete ui.pending[id];
    t.classList.toggle('pending', Boolean(v.trim()));
    syncLine2(id);
    // the hit chips and the location list follow the words (Esc empties the box: Torso again)
    syncHitChips(id);
  }

  // A stat box sends its number, when it changed: initiative, max HP, AC, or a figure setStat takes. False for words
  // that are not one.
  // The initiative column's and the panel's commits are sent held (Task 23, D3c): the number is set and the row stays
  // where it is while the GM types; placeHeld moves it once focus leaves them (`placeHeld` below).
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
      if (shownFigure(value) !== shown(r, f)) {
        if (STAT[f].panel) heldIn = HOLD;
        F({ type: 'setStat', row: r.id, key: STAT[f].stat, value, ...(STAT[f].panel ? { hold: true } : {}) });
      }
      return true;
    }
    const n = v === '' ? null : Number(v);
    if (f === 'fini' && n !== (isNum(r.ini) ? r.ini : null)) { heldIn = HOLD; F({ type: 'setInit', row: r.id, ini: n, hold: true }); }
    if (f === 'fmax' && n !== r.max) F({ type: 'setMax', row: r.id, max: n });
    if (f === 'fac' && n !== r.ac) F({ type: 'setAc', row: r.id, ac: n });
    return true;
  }

  // Where Tab goes from a stat box, by row id and field, found in the order as it stands before the commit (held
  // commits move no row until focus leaves, Task 23):
  // - an initiative box walks down the initiative column; in CoC and GURPS it passes a PC whose figure is the sheet's;
  // - a row's own boxes: max HP to the same row's AC (D&D) or max FP (GURPS), then the next row's max HP; CoC's max HP
  //   to the next row's (Task 23, D2);
  // - a panel box goes to the next box of the panel, in the system's order (rules.panelBoxes), then Same for all while
  //   it is enabled.
  // Shift reverses each. Past either end (D2): before Start, the Start button (`#fNext`); in a running fight, 'stay':
  // focus stays on the box, its number selected. Never Next, never a seen button.
  const STAY = 'stay';
  function tabTarget(t, f, back) {
    const id = t.dataset[f];
    const fight = state().fight;
    const pastEnd = () => (fight && fight.started ? STAY : '#fNext');
    const col = (k) => Array.from(document.querySelectorAll(`[${k}]`), (b) => b.getAttribute(k));
    if (f === 'fini') {
      const sheets = (rid) => { const r = rowById(rid); return !rolled() && Boolean(r) && r.kind === 'pc' && isNum(r.ini) && !(r.typedKeys && r.typedKeys.ini); };
      const ids = col('data-fini').filter((x) => x === id || !sheets(x));
      const to = ids[ids.indexOf(id) + (back ? -1 : 1)];
      return to === undefined ? pastEnd() : attr('data-fini', to);
    }
    if (STAT[f].panel) {
      const boxes = Array.from(document.querySelectorAll('#acting .pbox'));
      const to = boxes[boxes.indexOf(t) + (back ? -1 : 1)];
      const tf = to && statOf(to);
      if (tf) return attr(STAT[tf].k, id);
      const same = !back && document.querySelector('#acting [data-fsame]:not([disabled])');
      return same ? attr('data-fsame', same.dataset.fsame) : pastEnd();
    }
    // max HP's partner on the row: AC (D&D) or the pool's max (GURPS's FP); CoC's has none
    const pair = (rid) => ['data-fac', 'data-ffpmax'].find((k) => document.querySelector(attr(k, rid)));
    const rows = col('data-fmax');
    const i = rows.indexOf(id);
    const nextMax = () => (i >= 0 && i + 1 < rows.length ? attr('data-fmax', rows[i + 1]) : pastEnd());
    if (f === 'fmax') {
      if (!back) { const k = pair(id); return k ? attr(k, id) : nextMax(); }
      if (i <= 0) return pastEnd();
      const k = pair(rows[i - 1]);
      return attr(k || 'data-fmax', rows[i - 1]);
    }
    if (back) return attr('data-fmax', id);
    return nextMax();
  }
  // The place whose commits are held: the initiative column and the panel's boxes are one. The rows stay put while
  // focus is anywhere in it, so moving between the column and the panel places nothing (`heldIn` is set by the last
  // held commit); they are placed once focus is outside both.
  const HOLD_COLUMN = '[data-fini]';
  const HOLD_PANEL = '#acting .pbox';
  const HOLD = `${HOLD_COLUMN}, ${HOLD_PANEL}`;
  let heldIn = null;
  const inHold = (el) => Boolean(heldIn && el && el.matches && el.matches(heldIn));
  // Held rows placed (D3c): on Enter in those boxes, when focus leaves the zone by the keyboard, before Start and Sort,
  // and on the release of a press that took focus out of it (afterPress), never on the press.
  function placeHeld() {
    heldIn = null;
    const f = state().fight;
    if (f && f.rows.some((r) => r.held)) F({ type: 'placeHeld' });
  }
  // the release of a press (gm.js endHold), after its click has landed and its redraw has come
  part.afterPress = () => { if (!inHold(document.activeElement)) placeHeld(); };
  document.addEventListener('focusout', (ev) => {
    if (!inHold(ev.target)) return;
    // after the redraw that may be under way (it puts focus back into a box it drew again); a press's own leave waits
    // for its release (gm.js's press state, the one there is)
    setTimeout(() => { if (!RP.pressing() && !inHold(document.activeElement)) placeHeld(); }, 0);
  });

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
      if (ui.dmg && ui.dmg.on === d.fhp && ui.dmg.stale) { ui.dmg = null; t.value = ''; markPending(t); RP.render(); RP.focusTo(attr('data-fhp', d.fhp)); return; }
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
      ev.preventDefault();
      // committed here: the browser's `change` when focus leaves sends nothing and redraws nothing again
      t.dataset.committed = t.value;
      const self = attr(STAT[f].k, t.dataset[f]);
      if (ev.key === 'Enter' || to === STAY) {
        commitStat(t);
        // Enter places the held rows (D3c); Tab past the end in a running fight keeps them held (focus is still here)
        if (ev.key === 'Enter') placeHeld();
        RP.focusTo(self);
        return;
      }
      // the focus moves first and the redraw comes after it, so focus never falls to the page (D2)
      RP.focusTo(to);
      const fight = state().fight;
      commitStat(t);
      // Same for all chosen, then gone or disabled by the commit (nothing left to take): past the end instead
      const a = document.activeElement;
      if (to.startsWith('[data-fsame') && !(a && a.matches && a.matches('[data-fsame]:not([disabled])'))) {
        RP.focusTo(fight && fight.started ? self : '#fNext');
      }
      if (!inHold(document.activeElement)) placeHeld();
      return;
    }
    // Same for all reached by Tab from the panel's last box: Shift-Tab goes back to that box; Tab before Start goes on to
    // Start (D2)
    if (d.fsame !== undefined && ev.key === 'Tab') {
      const boxes = document.querySelectorAll('#acting .pbox');
      const last = boxes[boxes.length - 1];
      const fight = state().fight;
      if (ev.shiftKey && last) { ev.preventDefault(); RP.focusTo(attr(STAT[statOf(last)].k, last.dataset[statOf(last)])); return; }
      if (!ev.shiftKey && fight && !fight.started) { ev.preventDefault(); RP.focusTo('#fNext'); return; }
      return;
    }
    if (ev.key !== 'Enter') return;
    // a card's figure box (GURPS's HT, Task 13; an NPC's CON or INT in CoC, Task 18): the row's figure, as the panel's
    // box takes it
    if (d.fcardstat !== undefined) {
      ev.preventDefault();
      const cut = d.fcardstat.lastIndexOf('|');
      const rid = d.fcardstat.slice(0, cut);
      const key = d.fcardstat.slice(cut + 1);
      const v = t.value.trim();
      if (!/^\d{1,3}$/.test(v)) { t.setAttribute('aria-invalid', 'true'); return; }
      F({ type: 'setStat', row: rid, key, value: Number(v) });
      return;
    }
    // Enter on the hit location list (GURPS, Task 25) applies the row's box when it holds damage, as Enter in it does
    if (d.fhlocsel !== undefined) {
      const box = document.querySelector(attr('data-fhp', d.fhlocsel));
      if (box && FM.hitWords(box.value, rules().fight || rules()).amount) { ev.preventDefault(); enterBox(box); }
      return;
    }
    if (d.fhp !== undefined) {
      ev.preventDefault();
      enterBox(t);
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
  // End of the night's figures (`data-vhp`, `data-vkey`) are in the list too (Task 31).
  const NUMBER_BOX = '[data-fini], [data-fmax], [data-fac], [data-ffpmax], #acting .pbox, #fAddCount, [data-vhp], [data-vkey]';
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
  // A click into a damage box holding a picked type or place and no damage yet puts the caret before the words, so what
  // is typed next is the damage (Task 25): a click in a narrow box lands wherever it lands.
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.dataset || t.dataset.fhp === undefined || !wounding()) return;
    const v = t.value;
    // an entry the box reads (healing, a pool's `f-3`) or one that starts as one (`+`, a pool letter) is the GM's to edit
    if (FM.parseEntry(v, FM.rulesOf(state().fight)) || /^\s*(?:\+|[a-z]-?\d)/i.test(v)) return;
    const h = FM.hitWords(v, rules().fight || rules());
    if (h.amount || !v.trim() || t.selectionStart !== t.selectionEnd) return;
    if (!/^\s/.test(t.value)) t.value = ` ${t.value}`;
    t.setSelectionRange(0, 0);
  });

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
    if (t.dataset && t.dataset.fhp !== undefined) markPending(t);
    if (t.id === 'fAddName') {
      ui.addText = t.value;
      ui.addHits = FM.addChoices(model().cast || [], t.value, RS.castSearch);
      const box = $('#fHits');
      if (box) box.innerHTML = hitsHTML();
    }
    if (t.id === 'fAddCount') ui.addCount = t.value;
    if (t.id === 'fAreaDmg') ui.areaDmg = t.value;
    // the Shoot strip's malfunction number, kept through redraws (Task 19)
    if (t.dataset && t.dataset.fshmal !== undefined && ui.shot && ui.shot.target === t.dataset.fshmal) { ui.shot.mal = t.value; rememberShot(ui.shot); }
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
    if (d.fhlocsel !== undefined) { pickLocation(d.fhlocsel, t.value); return; }
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
