'use strict';
// The run sheet's GURPS arithmetic, as pure helpers. UMD like fight-math.js: `module.exports` under node,
// `window.RunSheetGurpsMath` in a page, so the reader (systems/gurps.js), the reducer (fight.js) and the page share
// one copy. No DOM, no fetch, no require. The sums are the only rules here (names and numbers, GURPS Basic Set
// B15-B17, as skills/shared/scripts/gurps_calc.py does; a hit's injury reads its figures from the wounding table in
// systems/gurps.js, B377-381, B398, B420, B552); nothing in a comment or the UI prints them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetGurpsMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // Was `field` typed by the GM: `typed` is an object of truthy fields or a list of field names.
  const wasTyped = (typed, field) => (Array.isArray(typed) ? typed.includes(field) : !!(typed && typed[field]));

  // The figures worked out from a row's typed ST, HT and DX, in the row's own field names: `max` (HP from ST),
  // `fpMax` (FP from HT), `speed` (Basic Speed from DX and HT, to two decimals), each only when its inputs are
  // numbers and the figure was not typed itself. `from` marks each one for the row ("from ST").
  function deriveGurps(row, typed) {
    const r = row || {};
    const out = { from: {} };
    if (isNum(r.st) && !wasTyped(typed, 'max')) { out.max = r.st; out.from.hp = 'from ST'; }
    if (isNum(r.ht) && !wasTyped(typed, 'fpMax')) { out.fpMax = r.ht; out.from.fp = 'from HT'; }
    if (isNum(r.dx) && isNum(r.ht) && !wasTyped(typed, 'speed')) {
      out.speed = Math.round(((r.dx + r.ht) / 4) * 100) / 100;
      out.from.speed = 'from DX and HT';
    }
    // Dodge from Basic Speed (B17, B374), the worked-out Speed when there is one
    const speed = out.speed !== undefined ? out.speed : r.speed;
    if (isNum(speed) && !wasTyped(typed, 'dodge')) { out.dodge = Math.floor(speed + 3); out.from.dodge = 'from Speed'; }
    return out;
  }

  // A DR figure: a number, or the first whole number in the words typed for it (`2 (leather)`); null when none.
  const drFigure = (v) => { if (isNum(v)) return Math.max(0, Math.floor(v)); const m = /\d+/.exec(String(v == null ? '' : v)); return m ? Number(m[0]) : null; };
  const placeName = (location, side) => (side ? `${side} ${location}` : location);
  // The row's DR where the hit lands: a DR the GM typed in the fight first (armour put on mid-fight), then a PC's
  // sheet DR for the place (its side's first), then for the place it sits in (`as` or `drAs`: an eye's is the face's,
  // a hand joint's the hand's), else its torso's; else the row's one DR. `faceOpen` makes the face's places 0.
  function drAt(row, location, side, loc) {
    const typed = row.typedKeys && row.typedKeys.dr ? drFigure(row.dr) : null;
    if (row.faceOpen && loc.face) return { dr: 0, open: true };
    if (typed !== null) return { dr: typed, open: false };
    const by = row.drByLocation && typeof row.drByLocation === 'object' ? row.drByLocation : null;
    if (by) {
      const within = loc.drAs || loc.as || null;
      for (const k of [side ? placeName(location, side) : null, location, within && side ? placeName(within, side) : null, within, 'torso']) {
        if (k && isNum(by[k])) return { dr: by[k], open: false };
      }
    }
    const d = drFigure(row.dr);
    return { dr: d === null ? 0 : d, open: false };
  }
  const times = (x) => String(Math.round(x * 100) / 100);

  // What a type does at a place (Task 25), from the one hit-location table: { can, mult, note }. `can` false: the type
  // cannot target it (`targets`). `mult` the place's figure for the type (`by`, `all` but `except`, or the place it
  // sits in, `as`, plus `plus`), else the type's usual one; fatigue is 1 (no location effects). `note` says when the
  // place's own figure is left out for the type (the skull's for toxic).
  function woundingAt(wounding, location, type) {
    const w = wounding || {};
    const locs = w.locations || {};
    const loc = locs[location] || {};
    if (Array.isArray(loc.targets) && !loc.targets.includes(type)) return { can: false, mult: null, note: '' };
    if (type === 'fat') return { can: true, mult: 1, note: '' };
    const base = (loc.as && locs[loc.as]) || loc;
    const left = (base.except || []).includes(type);
    let mult = isNum((w.types || {})[type]) ? w.types[type] : 1;
    let note = '';
    if (isNum(base.all) && !left) mult = base.all;
    else if (base.by && isNum(base.by[type])) mult = base.by[type];
    else if (left) note = ` (${location}: as torso for ${type})`;
    if (isNum(loc.plus)) mult += loc.plus;
    return { can: true, mult, note };
  }
  const minusSign = (n) => (n < 0 ? `\u2212${Math.abs(n)}` : String(n));
  // A place in the location list (Task 25): its name and penalty, and with a type picked the multiplier the working will
  // use, or, for a type that cannot target it, that it is not for that type (disabled). { label, disabled }
  function locationOption(wounding, location, type) {
    const loc = ((wounding || {}).locations || {})[location] || {};
    const head = `${loc.name || location} ${minusSign(isNum(loc.penalty) ? loc.penalty : 0)}`;
    if (!type) return { label: head, disabled: false };
    const at = woundingAt(wounding, location, type);
    if (!at.can) return { label: `${head} \u00b7 not for ${type}`, disabled: true };
    return { label: `${head} \u00b7 \u00d7${times(at.mult)}`, disabled: false };
  }

  // What a male target takes at a place (`male` in the hit-location table), said and never applied: the run sheet
  // knows no row's sex. "groin, crushing: a male target takes double shock (max 8) and knockdown −5"; '' for none.
  const LONG = { cr: 'crushing', cut: 'cutting', imp: 'impaling', burn: 'burning', tbb: 'tight-beam burning', cor: 'corrosion', tox: 'toxic', 'pi-': 'piercing', pi: 'piercing', 'pi+': 'piercing', 'pi++': 'piercing' };
  function maleNote(place, type, male) {
    if (!male || !place) return '';
    const shock = (male.shockTypes || []).includes(type) && isNum(male.shock);
    const parts = [];
    if (shock) parts.push(`takes ${male.shock === 2 ? 'double' : `\u00d7${male.shock}`} shock${isNum(male.shockMax) ? ` (max ${male.shockMax})` : ''}`);
    if (isNum(male.knockdown)) parts.push(`${shock ? '' : 'has '}knockdown ${minusSign(male.knockdown)}`);
    if (!parts.length) return '';
    return `${place}${shock ? `, ${LONG[type] || type}` : ''}: a male target ${parts.join(' and ')}`;
  }

  // A hit's injury (Task 12). `hit` { n, type, location, side, dice }, `row` { dr, drByLocation, typedKeys, faceOpen,
  // max }, `wounding` the table in systems/gurps.js (B377-381, B398, B420, B552, MA137). Answers { injury, line,
  // location, side, type, place, crippled }; `line` is the working. A type that cannot target the place (the entry's
  // reader refuses it first) is worked out as a torso hit, and the line says so.
  function gurpsInjury(hit, row, wounding) {
    const w = wounding || {};
    const r = row || {};
    const location = w.locations && w.locations[hit.location] ? hit.location : 'torso';
    const loc = (w.locations && w.locations[location]) || {};
    const type = hit.type;
    const side = loc.sided && hit.side ? hit.side : null;
    const place = placeName(location, side);
    const n = isNum(hit.n) ? Math.max(0, Math.floor(hit.n)) : 0;
    const left = (except) => (loc.except || []).includes(except);
    const at = woundingAt(w, location, type);
    const mult = at.can ? at.mult : woundingAt(w, 'torso', type).mult;
    const note = at.can ? at.note : ` (${location}: as torso for ${type})`;
    // `fat` (B398)
    const extra = isNum(loc.dr) && !left(type) && type !== 'fat' ? loc.dr : 0;
    const drHere = drAt(r, location, side, loc);
    const dr = drHere.dr + extra;
    const drText = extra ? `${dr} (${location} +${extra})` : drHere.open ? `${dr} (face open)` : String(dr);
    const fat = type === 'fat';
    const head = `${hit.dice ? `${hit.dice} = ` : ''}${n} ${type}${fat ? ` ${place}` : ''} \u2212 DR ${drText}`;
    const through = n - dr;
    const out = { injury: 0, location, side, type, place, crippled: false };
    if (through <= 0) return { ...out, line: `${head} = 0` };
    // `fat` (B398)
    if (fat) return { ...out, injury: through, line: `${head} = ${through} (fatigue: no location effects)` };
    const raw = Math.floor(through * mult);
    let injury = Math.max(1, raw);
    let line = `${head} = ${through}${mult !== 1 || note ? ` \u00d7 ${times(mult)}${note} = ${raw}` : ''}`;
    if (injury !== raw) line += `, at least ${injury}`;
    // `cripple` and `cap` (B420, B552, MA137)
    const max = isNum(r.max) && r.max > 0 ? r.max : null;
    if (isNum(loc.cripple) && at.can && max !== null && injury * loc.cripple > max) {
      out.crippled = true;
      const cap = Math.floor(max / loc.cripple) + 1;
      if (loc.cap && injury > cap) { injury = cap; line += `, capped at ${cap} (${place})`; }
    }
    const male = at.can ? maleNote(location, type, loc.male) : '';
    if (male) line += ` (${male})`;
    return { ...out, injury, line };
  }

  // ---- what a hit and a turn owe (Task 13): prompts on one card, never an outcome ----
  // `C` is the system's consequences table (systems/gurps.js, B419-B423). A card is { kind, lines }; a line is
  // { kind, mod, times?, place?, result, offers, taken }: its target is the row's HT plus `mod` at the moment it is
  // rolled, `result` the server's roll (the reducer never rolls), `offers` what the GM may apply, `taken` what was.
  const line = (kind, mod, more) => ({ kind, mod, ...(more || {}), result: null, offers: [], taken: null });

  // The shock a hit's injury gives, by the row's max HP; 0 for none.
  function shockOf(injury, max, C) {
    const s = (C && C.shock) || {};
    if (!isNum(injury) || injury <= 0) return 0;
    let n = Math.floor(injury);
    const big = isNum(max) && isNum(s.bigHp) && isNum(s.per) && max >= s.bigHp;
    if (big) n = Math.floor((injury * s.per) / max);
    return isNum(s.cap) ? Math.min(s.cap, n) : n;
  }
  const majorWound = (injury, max, crippled, C) => Boolean(crippled) || (isNum(max) && max > 0 && isNum(C.major) && injury * C.major > max);

  // A hit's shock and its card's lines, in the order they settle: the death checks for each minus-HP line crossed
  // (or the one dead line), then the one knockdown roll. `row` is the row after the hit (hp, max); `hit` { injury,
  // before (HP before), location (null for raw injury), type, crippled }. No lines: a shock chip and no card.
  function cardForHit(row, hit, C) {
    const out = { shock: 0, lines: [] };
    const r = row || {};
    const h = hit || {};
    if (!C || !isNum(h.injury) || h.injury <= 0) return out;
    const max = isNum(r.max) && r.max > 0 ? r.max : null;
    out.shock = shockOf(h.injury, max, C);
    if (max !== null && isNum(h.before) && isNum(r.hp)) {
      const crossed = (n) => h.before > -n * max && r.hp <= -n * max;
      if (isNum(C.dead) && crossed(C.dead)) { out.lines.push({ ...line('dead', 0, { times: C.dead }), offers: ['dead'] }); return out; }
      for (const n of C.death || []) if (crossed(n)) out.lines.push(line('death', 0, { times: n }));
    }
    const k = C.knockdown || {};
    const place = h.location || null;
    const major = majorWound(h.injury, max, h.crippled, C);
    if (major || (place && (k.places || []).includes(place) && out.shock > 0)) {
      // crippling the spine knocks down and stuns outright (MA137): the offer, no roll
      if (h.crippled && place && (k.auto || []).includes(place)) {
        out.lines.push({ ...line('knockdown', 0, { place, auto: true, noRoll: true }), offers: ['stunned'] });
        return out;
      }
      const left = place && h.type && k.except && (k.except[place] || []).includes(h.type);
      const extra = place && h.type && k.extra && k.extra[place] && isNum(k.extra[place][h.type]) ? k.extra[place][h.type] : 0;
      const mod = (major && place && !left && k.major && isNum(k.major[place]) ? k.major[place] : 0) + extra;
      const male = maleNote(place, h.type, k.male && k.male[place]);
      out.lines.push(line('knockdown', mod, { ...(place ? { place } : {}), ...(male ? { note: male } : {}) }));
    }
    return out;
  }

  const has = (r, status) => Array.isArray(r.conds) && r.conds.includes(status);
  // A row's turn starts: HT to stay conscious (B419), its modifier from the row's HP and max HP. None for a row
  // Unconscious, Out or not in, or whose `manoeuvre` is 'do nothing' with `defended` false or 0 (Task 15's; one
  // missing asks).
  function cardsAtTurnStart(row, C) {
    const r = row || {};
    if (!C || !r.in || r.out || !isNum(r.hp) || r.hp > 0 || has(r, C.unconscious)) return [];
    if (r.manoeuvre === 'do nothing' && (r.defended === false || r.defended === 0)) return [];
    const max = isNum(r.max) && r.max > 0 ? r.max : null;
    const mod = max === null ? 0 : -Math.floor(-r.hp / max) || 0;
    return [{ kind: 'conscious', lines: [line('conscious', mod)] }];
  }
  // A row's turn ends while Stunned: HT to recover (B420).
  function cardsAtTurnEnd(row, C) {
    const r = row || {};
    if (!C || !r.in || r.out || !has(r, C.stunned)) return [];
    return [{ kind: 'recover', lines: [line('recover', 0)] }];
  }

  // A line's target: the row's HT plus its modifier; null with no HT (the card asks for it first) or no roll (dead).
  const lineTarget = (l, row) => (l && l.kind !== 'dead' && !l.noRoll && row && isNum(row.ht) ? row.ht + l.mod : null);
  // The row's figure a line rolls (the card's box asks for it when missing): HT, none for the dead line or one with
  // no roll (a crippled spine's knockdown).
  const lineStat = (l) => (l && l.kind !== 'dead' && !l.noRoll ? 'ht' : null);
  const minus = (n) => `−${Math.abs(n)}`;
  // a figure, a negative one with U+2212
  const fig = (n) => (n < 0 ? minus(n) : String(n));
  // A line's name: "Knockdown", "Death check (−1×HP)", "−5×HP"; `log` gives the log's lower case.
  function lineName(l, C, log) {
    const names = (C && C.lines) || {};
    if (l.kind === 'dead') return `${minus(l.times)}\u00d7HP`;
    const name = names[l.kind] || l.kind;
    return `${log && /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name}${l.kind === 'death' ? ` (${minus(l.times)}\u00d7HP)` : ''}`;
  }
  // A line's name and figures: "Knockdown: HT 10 −5 = 5", "Death check (−1×HP): HT 10", "−5×HP: dead"; `log` gives
  // the log's form ("knockdown, HT 10 −5 = 5").
  function lineText(l, row, C, log) {
    if (l.kind === 'dead') return `${lineName(l, C, log)}: ${((C && C.lines) || {}).dead || 'dead'}`;
    if (l.auto) return `${lineName(l, C, log)}${log ? ',' : ':'} automatic (${l.place} crippled)`;
    const ht = row && isNum(row.ht) ? row.ht : null;
    const mod = l.mod ? ` ${l.mod > 0 ? '+' : '\u2212'}${Math.abs(l.mod)}` : '';
    const figs = ht === null ? `HT ?${mod}` : `HT ${fig(ht)}${mod}${l.mod ? ` = ${fig(ht + l.mod)}` : ''}`;
    return `${lineName(l, C, log)}${log ? ',' : ':'} ${figs}${l.note ? ` (${l.note})` : ''}`;
  }
  const OUTCOMES = ['success', 'critical success', 'failure', 'critical failure'];
  const failed = (res) => res.outcome === 'failure' || res.outcome === 'critical failure';
  // "rolled 12, failed by 7"; a critical says so, and a critical success over the target says only that.
  function resultText(res) {
    const head = `rolled ${res.total}, `;
    if (failed(res)) return `${head}${res.outcome === 'critical failure' ? 'critical failure, ' : ''}failed by ${Math.max(1, res.total - res.target)}`;
    const by = res.target - res.total;
    if (res.outcome === 'critical success') return `${head}critical success${by >= 0 ? `, made it by ${by}` : ''}`;
    return `${head}made it by ${by}`;
  }
  // What a rolled line offers (B420, B423), by its margin. `mortal`: the row is Mortal wound already, or an earlier
  // line of this card offered or took it.
  function offersFor(l, res, C, mortal) {
    if (!failed(res)) return l.kind === 'recover' ? ['recover'] : [];
    const by = Math.max(1, res.total - res.target);
    if (l.kind === 'death') return !mortal && isNum(C.mortal) && by <= C.mortal ? ['mortal'] : ['dead'];
    if (l.kind === 'knockdown') return res.outcome === 'critical failure' || (isNum(C.knockdown && C.knockdown.out) && by >= C.knockdown.out) ? ['unconscious'] : ['stunned'];
    if (l.kind === 'conscious') return ['unconscious'];
    return [];
  }
  // A roll result as the server gives it, or null.
  function rollResult(res) {
    if (!res || typeof res !== 'object' || !isNum(res.total) || !isNum(res.target) || !OUTCOMES.includes(res.outcome)) return null;
    const dice = Array.isArray(res.dice) ? res.dice.filter(isNum).slice(0, 3) : [];
    return { dice, total: res.total, target: res.target, margin: res.target - res.total, outcome: res.outcome };
  }
  const offerOf = (C, o) => (C && C.offers && C.offers[o]) || null;
  const ending = (l, C) => (l.taken ? [l.taken] : l.offers).some((o) => { const x = offerOf(C, o); return Boolean(x && x.ends); });
  // The card's next line to roll: the first not rolled (a dead line has no roll, nor a line marked `noRoll`: CoC's
  // offers that need none, Task 18), unless a line before it offers or
  // took what ends the card (an Out, an Unconscious): then -1, as when every line is rolled.
  function nextLine(card, C) {
    const lines = (card && card.lines) || [];
    for (let i = 0; i < lines.length; i++) {
      if (ending(lines[i], C)) return -1;
      if (!lines[i].result && lines[i].kind !== 'dead' && !lines[i].noRoll) return i;
    }
    return -1;
  }
  // A line still offering something nobody took.
  const pending = (l) => !l.taken && l.offers.length > 0;
  // Settled: nothing to roll and nothing offered.
  const cardDone = (card, C) => nextLine(card, C) < 0 && !card.lines.some(pending);

  // ---- active defences (Task 14): each as it stands this turn, from the row's state and the system's table ----
  // `D` is the defences table in systems/gurps.js (B365-B366, B374-B377, B419, B420, B426, B551). The row's fields:
  // `dodge`, `parry`, `block` (the figures), `conds`, `marks`, `tired`, `manoeuvre` and `aodDefence` (Task 15's),
  // `retreat` (the toggle), `parries` and `blocks` (counted since the row's turn). Each defence is { key, label, base,
  // value, causes, none, used, from, title }: `value` null when there is no figure or no defence; `causes` name what
  // moved it ("reeling", "stunned −4"); `title` is "Dodge 8 → 4: reeling".
  const DEFENCE_KEYS = ['dodge', 'parry', 'block'];
  const signed = (n) => `${n < 0 ? '\u2212' : '+'}${Math.abs(n)}`;
  const lower = (x) => String(x).toLowerCase();
  // Whether the row may retreat now: { allowed, why } (why: what stops it, by name).
  function retreatOf(row, D) {
    const r = row || {};
    const conds = Array.isArray(r.conds) ? r.conds : [];
    const m = (D.manoeuvres || {})[r.manoeuvre] || {};
    const status = (D.noRetreat || []).find((x) => conds.includes(x));
    if (status) return { allowed: false, why: lower(status) };
    if (m.noRetreat) return { allowed: false, why: r.manoeuvre };
    return { allowed: true, why: null };
  }
  function liveDefences(row, D) {
    const r = row || {};
    const out = {};
    if (!D || typeof D !== 'object') return null;
    const conds = Array.isArray(r.conds) ? r.conds : [];
    const marks = Array.isArray(r.marks) ? r.marks : [];
    const man = (D.manoeuvres || {})[r.manoeuvre] || {};
    const ret = retreatOf(r, D);
    const retreating = Boolean(r.retreat) && ret.allowed;
    const counted = (k) => (isNum(r[k]) && r[k] > 0 ? Math.floor(r[k]) : 0);
    for (const key of DEFENCE_KEYS) {
      const label = (D.names && D.names[key]) || key;
      const base = isNum(r[key]) ? r[key] : null;
      const from = key === 'dodge' && r.from && r.from.dodge ? r.from.dodge : null;
      const d = { key, label, base, value: base, causes: [], none: false, used: false, from };
      if ((man.none || []).includes(key)) { d.none = true; d.value = null; d.causes.push(r.manoeuvre); }
      else if (base !== null) {
        let v = base;
        if (key === 'dodge') {
          const h = D.halve || {};
          for (const mk of h.marks || []) if (marks.includes(mk)) { v = Math.ceil(v / 2); d.causes.push(lower(mk)); }
          if (h.tired && r.tired) { v = Math.ceil(v / 2); d.causes.push(h.tired === true ? 'tired' : String(h.tired)); }
        }
        for (const [st, mod] of Object.entries(D.statuses || {})) if (conds.includes(st) && isNum(mod)) { v += mod; d.causes.push(`${lower(st)} ${signed(mod)}`); }
        if (isNum(man.chosen) && r.aodDefence === key) { v += man.chosen; d.causes.push(`${r.manoeuvre} ${signed(man.chosen)}`); }
        if (retreating && D.retreat && isNum(D.retreat[key])) { v += D.retreat[key]; d.causes.push(`retreat ${signed(D.retreat[key])}`); }
        if (key === 'parry' && isNum(D.repeatParry) && counted('parries') > 0) {
          const n = counted('parries');
          v += D.repeatParry * n;
          d.causes.push(`parry ${n + 1} ${signed(D.repeatParry * n)}`);
        }
        d.value = v;
      }
      if (key === 'block' && isNum(D.blocks) && counted('blocks') >= D.blocks) d.used = true;
      d.title = defenceTitle(d);
      out[key] = d;
    }
    out.retreat = { on: retreating, allowed: ret.allowed, why: ret.why };
    return out;
  }
  // "Dodge 8 → 4: reeling", "Parry 9 → none: move and attack", "Dodge 8 (from Speed)", "Block 8: used this turn".
  function defenceTitle(d) {
    const head = `${d.label} ${d.base === null ? '?' : d.base}${d.from ? ` (${d.from})` : ''}`;
    const moved = d.causes.length ? ` \u2192 ${d.value === null ? 'none' : d.value}: ${d.causes.join(', ')}` : '';
    return `${head}${moved}${d.used ? `${moved ? ';' : ':'} used this turn` : ''}`;
  }
  // The log's form: "Parry 9 → 5 (parry 2 −4)", "Dodge 8".
  const defenceText = (d) => `${d.label} ${d.base}${d.causes.length ? ` \u2192 ${d.value} (${d.causes.join(', ')})` : ''}`;
  // A roll that came back against a figure that has moved since it was asked (another window, a status): what the page
  // says, "Parry moved to 5: tap again", or null when the figure is still the roll's target.
  function defenceMoved(d, target) {
    if (d && d.value === target) return null;
    if (!d || d.value === null) return `${d ? d.label : 'That defence'}: none now`;
    return `${d.label} moved to ${d.value}: tap again`;
  }

  return {
    liveDefences, retreatOf, defenceText, defenceMoved, DEFENCE_KEYS,
    deriveGurps, gurpsInjury, woundingAt, locationOption, drFigure, shockOf, cardForHit, cardsAtTurnStart, cardsAtTurnEnd, lineTarget, lineStat, lineName, lineText, resultText,
    offersFor, rollResult, nextLine, cardDone, pending, offerOf,
  };
}));
