'use strict';
// The GM page's fight view (spec §6.4, §6.5; plan 5b Task 10): one `RunSheetPage.parts` entry, loaded after
// gm.js. Every change is an action through the page's one `dispatch` (fight.js reduces it, here and on the
// server); rows are built with fight-math's `rowsForFight`/`joinRows` and travel in the action, so `reduce`
// never sees the model. Rolls come from the server's `/api/roll`: no dice here.
//
// While a fight runs (and is not paused) it takes the right column, which moves to the left of the beats:
// the turn order, one line per row, with the acting creature's panel under it (its own column at 1600 px
// and wider), and the fight's beat cut at the top of the beats. Paused, the beats come back with a strip of
// the order kept at the top. After End fight, a box above the beat lists every status still on.
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
  const FIGHT_SYSTEMS = new Set(['dnd-5e-2024']); // decision 19: D&D only in 5b; null runs as D&D
  const INVALID = 'Type -37 or 37 (damage), +8 (healing) or t5 (temp HP)';

  const ui = {
    fightId: null, peek: null, peekTurn: null,
    area: false, sel: {}, ahalf: {}, spend: {}, areaDmg: '',
    ask: null, asked: {}, other: {}, addHits: [], addText: '', addCount: '1', mine: null,
  };

  const model = () => RP.model();
  const state = () => RP.state();
  const allowed = () => { const m = model(); return Boolean(m) && (m.system == null || FIGHT_SYSTEMS.has(m.system)); };
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
  // The server's dice: d`sides` + mod for each, at most 64 a request.
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
  function startFight(key) {
    const d = RP.derived();
    const b = d.beats.find((x) => x.key === key);
    if (!b || state().fight) return;
    const id = RP.nextId();
    // a contingency has no PCs of its own: the focused group fights it (decision 13)
    const groups = b.contingency ? [RP.focusedGroup()].filter(Boolean) : undefined;
    const built = FM.rowsForFight({ model: model(), derived: d, state: state(), beatKey: key, groups, idBase: id });
    RP.ui.focus = key;
    ui.mine = id;
    RP.dispatch({ type: 'fightStart', beat: key, title: b.title, groups: built.groups, rows: built.rows, thresholds: built.thresholds, carried: carried(d) });
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
    RP.dispatch({ type: 'fightJoin', fight: f.id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: label || '', carried: carried(d) });
  }
  function addByName(note) {
    const n = Math.max(1, Math.min(20, Math.floor(Number(ui.addCount)) || 1));
    ui.addText = '';
    ui.addHits = [];
    ui.addCount = '1';
    // the redraw keeps a focused box's words: empty it first, so the next name is typed afresh
    const box = $('#fAddName');
    if (box) box.value = '';
    addTo({ cast: note, count: n });
  }
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
    const wasStarted = f.started;
    RP.dispatch({ type: 'fightNext', fight: f.id, from: f.turn, round: f.round });
    const g = state().fight;
    if (!g || g.turn === wasTurn) return;
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
  // Start and Resume bring the cut into view; one already in view stays put.
  function scrollToCut() {
    const el = $('#fightCut');
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top >= topH() && top < window.innerHeight / 2) { RP.probe(); return; }
    scrollTo(el);
  }
  function scrollToBeat(key) {
    const strip = $('#fightStrip');
    scrollTo(document.getElementById(`beat:${key}`), strip ? strip.offsetHeight : 0);
  }

  // ------------------------------------------------------------------ drawing: the order
  function statusSelect(r) {
    const conds = new Set(r.conds || []);
    const opts = FM.DND_STATUSES.filter((x) => !conds.has(x)).map((x) => `<option>${esc(x)}</option>`).join('');
    const ex = Array.from({ length: FM.EXHAUSTION_MAX }, (_, i) => i + 1).filter((n) => n !== r.exhaustion).map((n) => `<option>Exhaustion ${n}</option>`).join('');
    return `<select data-fstatus="${esc(r.id)}" aria-label="Add a status to ${esc(r.gmName)}"><option value="">+ status</option>${opts}${r.conc ? '' : '<option>Concentrating</option>'}<optgroup label="Exhaustion">${ex}</optgroup><option value="other">other…</option></select>`;
  }
  function chips(r, bloodied) {
    const one = (label, key) => `<button type="button" class="chip" data-fun="${esc(`${r.id}|${key}`)}" title="Remove ${esc(label)}">${esc(label)} ✕</button>`;
    return (r.conds || []).map((c) => one(c, c)).join('')
      + (r.exhaustion ? one(`Exhaustion ${r.exhaustion}`, 'Exhaustion') : '')
      + (r.conc ? one('Concentrating', 'Concentrating') : '')
      + (bloodied ? '<span class="chip auto">Bloodied</span>' : '');
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

  function rowHTML(r, f, view) {
    const cur = f.turn === r.id;
    const cls = [cur ? 'cur' : '', r.out ? 'out' : '', r.in ? '' : 'bench', ui.area && ui.sel[r.id] ? 'sel' : ''].join(' ');
    const name = `<span class="nm" data-fpeek="${esc(r.id)}" title="Show this one's panel">${esc(r.gmName)}</span>`;
    if (r.kind === 'lair') {
      const owners = (r.of || []).map((id) => view.rows.find((x) => x.id === id)).filter(Boolean).map((x) => x.gmName);
      return `<li class="${cls} lair" data-frow="${esc(r.id)}"><span class="tk"></span><span class="ini fixed">20</span>${name}<span class="tag">loses ties${owners.length ? ` · ${esc(owners.join(', '))}` : ''}</span></li>`;
    }
    const tick = ui.area
      ? `<input type="checkbox" data-fsel="${esc(r.id)}" ${ui.sel[r.id] ? 'checked' : ''} ${r.in ? '' : 'disabled'} aria-label="${esc(r.gmName)} is in the area">`
      : `<input type="checkbox" data-ftick="${esc(r.id)}" ${r.in ? 'checked' : ''} aria-label="${esc(r.gmName)} is in this fight" title="In this fight">`;
    const tags = [];
    if (r.kind === 'pc') tags.push('PC');
    if (r.kind === 'ally') tags.push('ally');
    if (!isNum(r.hp)) tags.push('no numbers');
    if (r.temp) tags.push(`+${r.temp} temp`);
    if (r.gone) tags.push('not in the party now');
    let h = `<li class="${cls}" data-frow="${esc(r.id)}"><span class="tk">${tick}</span>`;
    h += `<input class="ini" data-fini="${esc(r.id)}" value="${esc(isNum(r.ini) ? r.ini : '')}" placeholder="${r.kind === 'pc' ? 'roll' : esc(sign(r.mod))}" inputmode="numeric" autocomplete="off" aria-label="Initiative for ${esc(r.gmName)}">`;
    h += `${name}${tags.length ? `<span class="tag">${esc(tags.join(' · '))}</span>` : ''}`;
    if (r.kind === 'foe') h += `<button type="button" class="tg ${r.seen ? 'on' : ''}" data-fseen="${esc(r.id)}" aria-pressed="${!!r.seen}" title="${r.seen ? 'The players see its name. Click: back to its unseen word' : 'The players see its unseen word. Click: they have seen it'}">${r.seen ? 'seen' : 'unseen'}</button>`;
    if (!r.in) return `${h}</li>`;
    if (isNum(r.hp)) {
      const half = ui.area ? !!ui.ahalf[r.id] : r.half;
      h += `<input class="hpin" data-fhp="${esc(r.id)}" placeholder="-37/+8/t5" autocomplete="off" aria-label="Damage or healing for ${esc(r.gmName)}">`;
      h += `<button type="button" class="tg ${half ? 'on' : ''}" ${ui.area ? 'data-fahalf' : 'data-fhalf'}="${esc(r.id)}" aria-pressed="${!!half}" title="${ui.area ? 'Half for this area: a save' : 'Half: the next hit only (a save)'}">½</button>`;
      h += `<button type="button" class="tg ${r.resisted ? 'on' : ''}" data-fres="${esc(r.id)}" aria-pressed="${!!r.resisted}" title="Resisted: every hit halved until turned off">Res</button>`;
    }
    h += `<span class="hpv">${esc(isNum(r.hp) ? r.hp : '?')}/<input data-fmax="${esc(r.id)}" value="${esc(isNum(r.max) ? r.max : '')}" inputmode="numeric" autocomplete="off" aria-label="Maximum HP for ${esc(r.gmName)}"></span>`;
    h += `<span class="acv">AC<input data-fac="${esc(r.id)}" value="${esc(isNum(r.ac) ? r.ac : '')}" inputmode="numeric" autocomplete="off" aria-label="AC for ${esc(r.gmName)}"></span>`;
    h += chips(r, view.bloodied.has(r.id));
    h += statusSelect(r);
    if (ui.other[r.id]) h += `<input class="other" data-fother="${esc(r.id)}" placeholder="${esc(RP.OTHER_STATUS_PLACEHOLDER)}" autocomplete="off" aria-label="A status for ${esc(r.gmName)}, typed">`;
    if (r.kind === 'foe') h += `<button type="button" class="tg ${r.out ? 'on' : ''}" data-fout="${esc(r.id)}" aria-pressed="${!!r.out}">${r.out ? 'Back in' : 'Out'}</button>`;
    if ((r.kind === 'pc' || r.kind === 'ally') && (r.conds || []).includes('Down')) {
      const ds = r.ds || { s: 0, f: 0 };
      h += `<span class="ds">Saves <button type="button" data-fds="${esc(`${r.id}|s`)}" title="Death save successes (click: one more)">✓${ds.s}</button><button type="button" data-fds="${esc(`${r.id}|f`)}" title="Death save failures (click: one more)">✗${ds.f}</button></span>`;
    }
    h += counters(r, false);
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
    const nums = [
      `HP ${isNum(r.hp) ? r.hp : '?'}/${isNum(r.max) ? r.max : '?'}${r.temp ? ` +${r.temp}` : ''}`,
      `AC ${isNum(r.ac) ? r.ac : '?'}`,
      `Init ${isNum(r.ini) ? r.ini : '—'} (${sign(r.mod)})`,
    ].map((x) => `<span>${esc(x)}</span>`);
    if (f.view.bloodied.has(r.id)) nums.push('<span class="bl">Bloodied</span>');
    for (const x of Fight.statusesOf(r)) nums.push(`<span class="st">${esc(x)}</span>`);
    const ctr = counters(r, true);
    let body = '';
    if (r.kind === 'pc') body = '<p class="note">Players run their own sheets.</p>';
    else {
      const info = foeInfo(r, d);
      const nonum = !isNum(r.hp) ? ((info && info.prepNote) || `${r.name}: no numbers in the vault: fill them in prep`) : '';
      if (nonum) body += `<p class="warn">${esc(nonum)}</p>`;
      if (info && info.statsHtml) body += `<div class="stats">${info.statsHtml}</div>`;
      else if (!nonum) body += '<p class="warn">No stat block in the vault.</p>';
    }
    return `<div class="act" id="acting">${head(r.gmName)}<div class="nums">${nums.join('')}</div>${ctr ? `<div class="nums ctr">${ctr}</div>` : ''}${body}</div>`;
  }

  // ------------------------------------------------------------------ drawing: the right column
  function sideHTML(d) {
    const f = d.fight;
    const view = f.view;
    let h = '<div class="fview"><div class="fo" id="fOrder">';
    h += `<div class="fh"><b>${f.started ? `Round ${esc(f.round)}` : 'Setting up'}</b>`
      + '<button type="button" id="fRoll" title="Roll d20 + modifier for every ticked foe and ally with no number yet (never a PC)">Roll</button>'
      + '<button type="button" id="fSort" title="Sort once by initiative; whose turn it is stays">Sort</button>'
      + `<button type="button" id="fNext" class="primary">${f.started ? 'Next ▸' : 'Start ▸'}</button><span class="sp"></span>`
      + `<button type="button" id="fArea" class="${ui.area ? 'on' : ''}" aria-pressed="${ui.area}" title="Tick several rows, type the damage once">Area</button>`
      + '<button type="button" id="fPause" title="Play the beat on (a bargain, a parley); every number is kept">Pause</button>'
      + `${RP.armBtn('fightEnd', 'End fight', 'id="fEnd"', 'End the fight: two clicks. Every status is kept')}</div>`;
    const missing = ui.ask === f.id && !f.started ? missingInit(view) : [];
    if (missing.length) h += `<div class="fask">No initiative yet for ${esc(missing.map((r) => r.gmName).join(', '))}. Start anyway? <button type="button" id="fStartAnyway" class="primary">Start anyway</button> <button type="button" id="fAskNo">Not yet</button></div>`;
    // every group holding a ticked PC is in (proof M2); Add offers only the rest
    const inFight = FM.fightGroupKeys(f, RP.groups());
    h += `<div class="fin"><span class="muted">In this fight:</span> ${inFight.map((g) => `<span class="gchip">${esc(groupWho(g) || '—')} · ${esc(RP.groupLabel(g, d))}</span>`).join(' ')}</div>`;
    const others = RP.groups().filter((g) => !inFight.includes(g.key));
    h += `<div class="fadd"><span class="muted">Add:</span> ${others.map((g) => `<button type="button" data-faddgroup="${esc(g.key)}">+ ${esc(groupWho(g.key))} at ${esc(RP.groupLabel(g.key, d))}</button>`).join(' ')}`
      + `<span class="addname"><input id="fAddName" value="${esc(ui.addText)}" placeholder="anyone, by name" autocomplete="off" aria-label="Add anyone in the cast to the fight"><span class="fhits" id="fHits">${hitsHTML()}</span></span>`
      + `<input id="fAddCount" type="number" min="1" max="20" value="${esc(ui.addCount)}" aria-label="How many"><button type="button" id="fAddGo">Add</button></div>`;
    if (ui.area) {
      const n = f.rows.filter((r) => ui.sel[r.id] && r.in).length;
      const offer = areaOffer(f);
      h += `<div class="areabar"><b>Area</b> <span>${n} ticked</span> · ½ on each row that saved <input id="fAreaDmg" value="${esc(ui.areaDmg)}" placeholder="damage" inputmode="numeric" autocomplete="off" aria-label="Area damage">`
        + offer.names.map((x) => `<label class="spend"><input type="checkbox" data-fspend="${esc(x)}" ${offer.chosen === x ? 'checked' : ''}> spend ${esc(x)}</label>`).join('')
        + `<button type="button" id="fAreaGo" class="primary" ${n ? '' : 'disabled'}>Apply</button><button type="button" id="fAreaDone">Done</button></div>`;
    }
    h += `<ol class="to">${view.rows.map((r) => rowHTML(r, f, view)).join('')}</ol></div>`;
    h += `${actingHTML(d)}</div>`;
    return h;
  }
  function hitsHTML() {
    return ui.addHits.map((c) => `<button type="button" data-faddpick="${esc(c.note)}">${esc(c.name)}<span class="t">${esc(c.type)}</span></button>`).join('');
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
    let h = `<div class="cut" id="fightCut"><h2>⚔ ${esc(b.title)} <a class="lk" data-go="beat:${esc(b.key)}">full beat ↓</a></h2>`;
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
    focusAttrs: ['data-fini', 'data-fhp', 'data-fmax', 'data-fac', 'data-fother'],
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
    probe() {
      const d = RP.derived();
      const out = { fight: null, after: d.afterFight, layout: layout() };
      const f = d.fight;
      if (f) {
        const acting = $('#acting h3');
        out.fight = {
          id: f.id, groups: f.groups, turn: f.turn, round: f.round, started: f.started, paused: f.paused, area: ui.area,
          ask: Boolean($('.fask')), actingName: acting ? acting.textContent : null,
          rows: f.view.rows.map((r) => ({
            id: r.id, note: r.note, copy: r.copy, kind: r.kind, name: r.gmName, in: r.in, ini: isNum(r.ini) ? r.ini : null, mod: r.mod,
            hp: r.hp, max: r.max, temp: r.temp, conds: r.conds, exhaustion: r.exhaustion, conc: r.conc, out: r.out, seen: r.seen,
            recharge: (r.recharge || []).map((x) => ({ name: x.name, ready: x.ready, rolled: x.rolled })),
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
      orderBottom: r(ol && ol.bottom), orderRight: r(ol && ol.right), actingTop: r(act && act.top), actingLeft: r(act && act.left),
      cutTop: r(cut && cut.top), afterTop: r(after && after.top),
      wide: document.documentElement.scrollWidth > window.innerWidth,
      rows: Array.from(document.querySelectorAll('#side ol.to > li'), (li) => ({
        id: li.dataset.frow, name: (li.querySelector('.nm') || {}).textContent, h: Math.round(li.getBoundingClientRect().height),
        over: li.scrollWidth > li.clientWidth + 1, nameCut: (() => { const n = li.querySelector('.nm'); return Boolean(n) && n.scrollWidth > n.clientWidth + 1; })(),
        statuses: Boolean(li.querySelector('.chip')),
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
    if (t.id === 'fResume') { F({ type: 'fightPause', on: false }); scrollToCut(); return true; }
    if (t.id === 'fEnd') {
      RP.armed('fightEnd', () => {
        F({ type: 'fightEnd' });
        scrollTo($('#afterFight'));
      });
      return true;
    }
    if (t.id === 'fAddGo') {
      const hits = RS.castSearch(model().cast || [], ($('#fAddName') || {}).value || '');
      if (hits.length) addByName(hits[0].note);
      return true;
    }
    if (d.faddpick) { addByName(d.faddpick); return true; }
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
    const id = d.ftick || d.fsel || d.fahalf || d.fhalf || d.fres || d.fseen || d.fout || d.flr;
    const r = rowById(id || '');
    if (d.ftick && r) { F({ type: 'fightTick', row: r.id, in: t.checked }); return true; }
    if (d.fsel && r) { ui.sel[r.id] = t.checked; RP.render(); return true; }
    if (d.fahalf && r) { ui.ahalf[r.id] = !ui.ahalf[r.id]; RP.render(); return true; }
    if (d.fhalf && r) { F({ type: 'half', row: r.id, on: !r.half }); return true; }
    if (d.fres && r) { F({ type: 'resisted', row: r.id, on: !r.resisted }); return true; }
    if (d.fseen && r) { F({ type: 'seen', row: r.id, on: !r.seen }); return true; }
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

  // An initiative box: a whole number, or empty. Unchanged sends nothing.
  function commitIni(t) {
    const r = rowById(t.dataset.fini);
    if (!r) return true;
    const v = t.value.trim();
    if (v !== '' && !/^-?\d{1,3}$/.test(v)) { t.setCustomValidity('A whole number'); t.reportValidity(); return false; }
    const n = v === '' ? null : Number(v);
    if (n !== (isNum(r.ini) ? r.ini : null)) F({ type: 'setInit', row: r.id, ini: n });
    return true;
  }

  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const d = (t && t.dataset) || {};
    if (ev.isComposing) return;
    if (d.fini !== undefined && (ev.key === 'Enter' || ev.key === 'Tab')) {
      ev.preventDefault();
      const id = d.fini;
      if (!commitIni(t)) return;
      if (ev.key === 'Tab') {
        // Tab walks the initiative boxes in row order (nothing has re-sorted)
        const boxes = Array.from(document.querySelectorAll('[data-fini]'));
        const i = boxes.findIndex((b) => b.dataset.fini === id);
        const nx = boxes[(i + (ev.shiftKey ? -1 : 1) + boxes.length) % boxes.length];
        if (nx) { nx.focus(); nx.select(); }
      }
      return;
    }
    if (ev.key !== 'Enter') return;
    if (d.fhp !== undefined) {
      ev.preventDefault();
      if (!FM.parseEntry(t.value)) { t.setCustomValidity(INVALID); t.reportValidity(); return; }
      const entry = t.value;
      t.value = '';
      F({ type: 'hp', row: d.fhp, entry });
      return;
    }
    if (d.fmax !== undefined || d.fac !== undefined) { ev.preventDefault(); commitNumber(t); return; }
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
      const hits = RS.castSearch(model().cast || [], t.value);
      if (!hits.length) { t.setCustomValidity('No one in the vault by that name'); t.reportValidity(); return; }
      addByName(hits[0].note);
      return;
    }
    if (t.id === 'fAreaDmg') { ev.preventDefault(); applyArea(); }
  });

  // Max HP and AC: whole numbers, or empty; sent on Enter or when the box is left.
  function commitNumber(t) {
    const d = t.dataset;
    const r = rowById(d.fmax || d.fac);
    if (!r) return;
    const v = t.value.trim();
    if (v !== '' && !/^\d{1,4}$/.test(v)) { t.setCustomValidity('A whole number'); t.reportValidity(); return; }
    const n = v === '' ? null : Number(v);
    if (d.fmax !== undefined && n !== r.max) F({ type: 'setMax', row: r.id, max: n });
    if (d.fac !== undefined && n !== r.ac) F({ type: 'setAc', row: r.id, ac: n });
  }

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.setCustomValidity) t.setCustomValidity('');
    if (t.id === 'fAddName') {
      ui.addText = t.value;
      ui.addHits = RS.castSearch(model().cast || [], t.value);
      const box = $('#fHits');
      if (box) box.innerHTML = hitsHTML();
    }
    if (t.id === 'fAddCount') ui.addCount = t.value;
    if (t.id === 'fAreaDmg') ui.areaDmg = t.value;
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    const d = t.dataset || {};
    if (d.fini !== undefined) { commitIni(t); return; }
    if (d.fmax !== undefined || d.fac !== undefined) { commitNumber(t); return; }
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
