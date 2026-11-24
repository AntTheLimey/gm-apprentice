'use strict';
// The run sheet's fight arithmetic, as pure helpers. UMD like state.js: `module.exports` under node,
// `window.RunSheetFightMath` in a page, where coc-math.js loads first. No DOM, no fetch, no clock, no dice: dice live
// in lib/dice and the page asks the server. Nothing here changes its input; every function returns something new.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./coc-math'));
  else root.RunSheetFightMath = factory(root.RunSheetCocMath);
}(typeof self !== 'undefined' ? self : this, function (CM) {
  // Status names only, no rules text (§3). Exhaustion is a value 0-6, Bloodied is worked out and never
  // stored, and a typed status is free text, so none of the three is in the list.
  const DND_STATUSES = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Down', 'Stable'];
  const EXHAUSTION_MAX = 6;

  // The reducer's part of D&D's rules (step 6b Task 1): what a fight started with no `rules` (one saved before 6b)
  // runs by. systems/dnd.js describes D&D with a copy of it, so the page and the reducer share one source. The
  // last four are GURPS's tables, null here.
  const DND_FIGHT_RULES = {
    initiative: 'roll', initDecimals: 0, orderFixed: false, hpFloor: 0, autoOut: true, marks: [], tiredAt: null,
    prompts: { majorWoundAt: null, insanityAt: null }, firearmBonus: null, pools: [],
    wounding: null, consequences: null, defences: null, manoeuvres: null,
  };
  // shared by every fight that has none of its own, so nothing may change it
  Object.freeze(DND_FIGHT_RULES.marks); Object.freeze(DND_FIGHT_RULES.prompts); Object.freeze(DND_FIGHT_RULES.pools);
  Object.freeze(DND_FIGHT_RULES);
  // A fight's rules: its own (`f.rules`, from fightStart), else D&D's.
  const rulesOf = (f) => (f && f.rules && typeof f.rules === 'object' ? f.rules : DND_FIGHT_RULES);

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ---- the HP box ----

  // A fight's pools beyond HP (`rules.pools`: MP and SAN for CoC, FP for GURPS), each with its entry-box letter.
  const poolsOf = (rules) => (Array.isArray(rulesOf({ rules }).pools) ? rulesOf({ rules }).pools : []).filter((p) => p && typeof p.key === 'string');
  const poolOf = (rules, key) => poolsOf(rules).find((p) => p.key === key) || null;

  // `-37` and a bare `37` are damage, `+8` heals, everywhere. A pool's letter first (`m-4`, `s+1`, `f-8`, a bare
  // `f8` a loss) is that pool's, and only in a system that has it. `t5` sets temp HP, D&D's only: a system with
  // pools of its own has none. Integers 0-9999 only. `rules` is the fight's (rulesOf).
  //
  // A system with a wounding table (GURPS) also takes a hit (Task 12): damage, then its type and place in any order
  // (`9 imp vitals`, `9 imp v`, `9i` to the torso, `7 pi+ left arm`), or dice the server rolls (`2d+1 imp vitals`,
  // and a bare `2d+1` raw injury). A hit is `{ pool: 'hp', kind: 'damage', n, hit: { type, location, side } }`, with
  // `dice` (and `n` null) for dice. A place needs a type; a type alone is to the torso. A bare number stays raw.
  function parseEntry(text, rules = DND_FIGHT_RULES) {
    // CoC's dice first: a bare `d6` would otherwise read as a pool letter and a number
    const coc = parseCocDice(text, rules);
    if (coc) return coc;
    const m = /^\s*([a-z])?\s*([+-])?\s*(\d+)\s*$/i.exec(String(text === null || text === undefined ? '' : text));
    if (!m) return parseHit(text, rules);
    const n = Number(m[3]);
    if (n > 9999) return null;
    const letter = (m[1] || '').toLowerCase();
    const kind = m[2] === '+' ? 'heal' : 'damage';
    if (!letter) return { pool: 'hp', kind, n };
    if (letter === 't') return m[2] || poolsOf(rules).length ? null : { pool: 'temp', kind: 'temp', n };
    const pool = poolsOf(rules).find((p) => p.prefix === letter);
    return pool ? { pool: pool.key, kind, n } : null;
  }

  // A hit's words, read against the wounding table (`rules.wounding`): { amount, dice, n, type, location, side, rest }
  // where `rest` holds the words that are none of them. `amount` is the damage as typed (`9`, `-9`, `2d+1`), or '';
  // first, or, when none leads, last (Task 25 fix round 1).
  // Dice are recognised here, never rolled or added: the server's reader (lib/dice `parseDamage`) is the one that
  // reads them. A die is `NdS`, `dS`, `d%`, or `Nd` (a count alone); terms join with + or -, any order, and the first may carry a leading + or -. A bare `d`
  // is not dice. test/run-sheet-fight-math.test.js holds this pattern and the server's reader to one list of cases.
  const DICE_TERM = /(?:\d+d(?:\d+|%)?|d(?:\d+|%)|\d+)/i.source;
  const DICE = new RegExp(`^[+-]?${DICE_TERM}(?:[+-]${DICE_TERM})*`, 'i');
  function hitWords(text, rules) {
    const w = rulesOf({ rules }).wounding;
    const out = { amount: '', dice: null, n: null, type: null, location: null, side: null, rest: [] };
    let t = String(text === null || text === undefined ? '' : text).trim();
    const chain = DICE.exec(t);
    const a = chain && /d/i.test(chain[0]) ? chain : /^-?\d+/.exec(t);
    if (a) {
      out.amount = a[0];
      t = t.slice(a[0].length);
      const bare = a[0].replace(/^[+-]/, '');
      if (/d/i.test(bare)) out.dice = bare.toLowerCase(); else out.n = Number(bare);
    }
    if (!w) { out.rest = t.trim() ? t.trim().split(/\s+/) : []; return out; }
    const words = t.trim() ? t.trim().toLowerCase().split(/\s+/) : [];
    // with none leading, the damage may come last (`cr jaw 3`: a place picked, then the damage typed after it)
    if (!out.amount && words.length > 1) {
      const end = words[words.length - 1];
      const dice = DICE.exec(end);
      const whole = dice && dice[0] === end && /d/.test(end) ? end : /^-?\d+$/.test(end) ? end : null;
      if (whole) {
        words.pop();
        out.amount = whole;
        const bare = whole.replace(/^[+-]/, '');
        if (/d/.test(bare)) out.dice = bare; else out.n = Number(bare);
      }
    }
    const typeOf = (x) => (w.types[x] !== undefined ? x : (w.typeWords || {})[x] || null);
    const placeOf = (x) => (w.locations[x] ? x : (w.locationWords || {})[x] || null);
    // the place that starts at word i: two words (`neck vein`, `hand joint`) before one; { place, len } or null
    const placeAt = (i) => {
      const two = i + 1 < words.length ? placeOf(`${words[i]} ${words[i + 1]}`) : null;
      if (two) return { place: two, len: 2 };
      const one = i < words.length ? placeOf(words[i]) : null;
      return one ? { place: one, len: 1 } : null;
    };
    for (let i = 0; i < words.length; i++) {
      const x = words[i];
      const next = placeAt(i + 1);
      if (!out.side && (w.sides || []).includes(x) && next && w.locations[next.place].sided) { out.side = x; continue; }
      const here = placeAt(i);
      // a word that is both (`t`: toxic or the torso) is the type until there is one
      if (!out.type && typeOf(x) && !(here && here.len === 2)) { out.type = typeOf(x); continue; }
      if (!out.location && here) { out.location = here.place; i += here.len - 1; continue; }
      out.rest.push(x);
    }
    if (out.side && !out.location) { out.rest.unshift(out.side); out.side = null; }
    return out;
  }
  // The words back in the box's order: amount, type, side, place, then anything else typed.
  const hitText = (h) => [h.amount, h.type, h.side, h.location, ...(h.rest || [])].filter(Boolean).join(' ');

  // The type a hit's words name when it cannot target the place they name (the table's `targets`: cr at the eye), else
  // null: the page says why it refuses the entry.
  function cannotTarget(text, rules) {
    const w = rulesOf({ rules }).wounding;
    if (!w) return null;
    const h = hitWords(text, rules);
    const loc = h.location && w.locations[h.location];
    return h.type && loc && Array.isArray(loc.targets) && !loc.targets.includes(h.type) ? h.type : null;
  }

  function parseHit(text, rules) {
    if (!rulesOf({ rules }).wounding) return null;
    const h = hitWords(text, rules);
    if (!h.amount || h.rest.length || (h.location && !h.type)) return null;
    if (cannotTarget(text, rules)) return null;
    // a leading plus on dice is the server's reading of a hit; with no type it would be healing's sign, so it is no hit
    if (h.dice && h.amount[0] === '+' && !h.type) return null;
    if (h.n !== null && h.n > 9999) return null;
    const hit = h.type ? { type: h.type, location: h.location || 'torso', side: h.side } : null;
    if (h.dice) return { pool: 'hp', kind: 'damage', n: null, dice: h.dice, hit };
    // a bare number was the raw entry above; here it has a type
    return hit ? { pool: 'hp', kind: 'damage', n: h.n, hit } : null;
  }

  // CoC's damage dice (Task 17): `1D8`, `1D6+1`, `1D3-1`, `1D8+DB`, a leading minus the damage sign, spaces ignored. DB
  // is the attacker's, put in by coc-math's damageRoll before the server sees the dice; one DB at most, added.
  // { pool: 'hp', kind: 'damage', n: null, dice, db }. The dice are the DICE pattern's (the one the server agrees with).
  function parseCocDice(text, rules) {
    if (!rulesOf({ rules }).coc) return null;
    const t = String(text === null || text === undefined ? '' : text).replace(/\s+/g, '').replace(/\u2212/g, '-').replace(/^-/, '');
    if (t[0] === '+') return null;
    const parts = t.split(/\+db(?=[+-]|$)/i);
    if (parts.length > 2) return null;
    const dice = parts.join('');
    const chain = DICE.exec(dice);
    // a die with no sides is GURPS's (`2d+1`), never CoC's
    if (!chain || chain[0] !== dice || !/d/i.test(dice) || /d(?![\d%])/i.test(dice)) return null;
    return { pool: 'hp', kind: 'damage', n: null, dice: dice.toLowerCase(), db: parts.length === 2 };
  }

  // The type chips in their order for a row: the one last used first, then the rest as the table lists them.
  const chipOrder = (all, last) => (last && all.includes(last) ? [last, ...all.filter((x) => x !== last)] : all.slice());

  // A pool after an entry: a loss stops at the pool's floor (a number, or `floorTimes` its max), a gain at its cap
  // or its max. A row with no figure in the pool answers null.
  function afterPool(row, pool, e) {
    const cur = row && pool ? row[pool.key] : null;
    if (!isNum(cur)) return null;
    const max = row[pool.max];
    if (e.kind === 'heal') {
      // the lower of the pool's cap and the row's own max (SAN: 99, and a row's lower max, 99 less its Mythos)
      const top = isNum(pool.cap) && isNum(max) ? Math.min(pool.cap, max) : isNum(pool.cap) ? pool.cap : (isNum(max) ? max : null);
      return top === null ? cur + e.n : Math.max(cur, Math.min(top, cur + e.n));
    }
    const floor = isNum(pool.floor) ? pool.floor : (isNum(pool.floorTimes) && isNum(max) ? pool.floorTimes * max : null);
    return floor === null ? cur - e.n : Math.min(cur, Math.max(floor, cur - e.n));
  }

  // Half (one-shot) halves first, then resisted (sticky) halves again, each rounding down.
  function damageTaken(n, { half = false, resisted = false } = {}) {
    let d = n;
    if (half) d = Math.floor(d / 2);
    if (resisted) d = Math.floor(d / 2);
    return d;
  }

  // Temp HP takes damage first; HP stops at the rules' floor (D&D's 0), or goes on down when the floor is null.
  // Rules with no `hpFloor` at all floor at 0: only an explicit null (GURPS) means none.
  function afterDamage({ hp, temp }, d, rules = DND_FIGHT_RULES) {
    const t = temp || 0;
    const soak = Math.min(t, d);
    // a row with no HP still loses the temp HP it was given
    if (hp === null || hp === undefined) return { hp: null, temp: t - soak };
    const given = rulesOf({ rules }).hpFloor;
    const floor = given === undefined ? 0 : given;
    const left = hp - (d - soak);
    return { hp: isNum(floor) ? Math.max(floor, left) : left, temp: t - soak };
  }

  // Healing stops at max (a row with no max just adds).
  function afterHeal({ hp, max }, n) {
    if (hp === null || hp === undefined) return null;
    const up = hp + n;
    return isNum(max) ? Math.min(max, up) : up;
  }

  // Over 0 and at most half of max; a row with no max or no HP is never Bloodied, nor is the Lair row.
  function isBloodied(row) {
    return Boolean(row) && row.kind !== 'lair' && Boolean(row.max) && isNum(row.hp) && row.hp > 0 && row.hp <= row.max / 2;
  }

  // The word a system gives a row at half HP or less: '' (CoC, GURPS) for none, else its word, D&D's when it gives none.
  const bloodiedWord = (words) => (words && words.bloodied === '' ? '' : (words && words.bloodied) || 'Bloodied');
  // D&D's end-of-night rest button, the one copy: dnd.js's words and a model with no rules both read it
  const DND_LONG_REST = 'Long rest: everyone to full';
  // and D&D's line for a row with numbers and no stat block
  const DND_NO_BLOCK = 'No stat block in the vault.';

  // ---- thresholds ----

  // `N HP or less` wins over the word Bloodied: `Bloodied (91 HP or less)` is 91.
  function thresholdOf(text) {
    const s = String(text === null || text === undefined ? '' : text);
    const m = /(\d+)\s*HP or less/i.exec(s);
    if (m) return { hp: Number(m[1]) };
    if (/\bBloodied\b/.test(s)) return { bloodied: true };
    return null;
  }

  // Lit while a row that can light it is above 0, not Out, and at or under the line.
  function isLit(threshold, row) {
    if (!threshold || !row || row.kind !== 'foe') return false;
    if (!row.in || row.out || !isNum(row.hp) || row.hp <= 0) return false;
    if (!(threshold.foes || []).includes(row.note)) return false;
    return threshold.hp !== null && threshold.hp !== undefined ? row.hp <= threshold.hp : isBloodied(row);
  }

  // ---- order and turns ----

  // A CoC row's combat skill for a DEX tie (KR p102): coc-math's, the one copy (Task 16).
  const { combatOf } = CM;
  // A row's initiative worked out from its stats: CoC's DEX (plus `firearmBonus` while `gun` is on), GURPS's Basic
  // Speed. Null in D&D (it is rolled) and for a row whose stat is blank.
  function initOf(r, rules = DND_FIGHT_RULES) {
    const ru = rulesOf({ rules });
    if (!r) return null;
    if (ru.initiative === 'dex') return isNum(r.dex) ? r.dex + (r.gun && isNum(ru.firearmBonus) ? ru.firearmBonus : 0) : null;
    if (ru.initiative === 'speed') return isNum(r.speed) ? r.speed : null;
    return null;
  }
  // The figure that breaks a tie: CoC's combat skill (KR p102), GURPS's DX (B363); none for D&D.
  const tieFigureOf = (ru) => (ru.initiative === 'dex' ? combatOf : ru.initiative === 'speed' ? (r) => (isNum(r.dx) ? r.dx : null) : null);
  // The tie figure each row sorts by, decided for its whole tie group (rows ticked alike with an equal initiative;
  // the Lair row aside), never pair by pair, so the order is transitive (coordinator's ruling, fix round 2): when
  // every row of the group has the figure, each sorts by its own; when any lacks it, none does, and the group
  // goes PCs first. Row index -> figure.
  function tieFigures(rows, ru, ini) {
    const out = new Map();
    const by = tieFigureOf(ru);
    if (!by) return out;
    const groups = new Map();
    rows.forEach((r, i) => {
      if (r.kind === 'lair') return;
      const k = `${r.in ? 1 : 0}|${ini(r)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    for (const idx of groups.values()) {
      const vals = idx.map((i) => by(rows[i]));
      if (vals.every(isNum)) idx.forEach((i, j) => out.set(i, vals[j]));
    }
    return out;
  }

  // Ticked first; initiative high to low with an empty box last; at a tie the Lair row after the others,
  // then the system's tie figure where the whole tie group has it (tieFigures), then the higher modifier (D&D),
  // then PCs. Stable: equal rows keep their order. `rules` is the fight's (rulesOf).
  function sortRows(rows, rules = DND_FIGHT_RULES) {
    const ru = rulesOf({ rules });
    const ini = (r) => (isNum(r.ini) ? r.ini : -Infinity);
    const figs = tieFigures(rows, ru, ini);
    return rows.map((r, i) => ({ r, i })).sort((a, b) => {
      const x = a.r;
      const y = b.r;
      if (!x.in !== !y.in) return x.in ? -1 : 1;
      const dx = ini(x);
      const dy = ini(y);
      if (dx !== dy) return dx > dy ? -1 : 1;
      if ((x.kind === 'lair') !== (y.kind === 'lair')) return x.kind === 'lair' ? 1 : -1;
      const fx = figs.has(a.i) ? figs.get(a.i) : null;
      const fy = figs.has(b.i) ? figs.get(b.i) : null;
      if (fx !== null && fy !== null && fx !== fy) return fy - fx;
      const mx = x.mod || 0;
      const my = y.mod || 0;
      if (mx !== my) return my - mx;
      if ((x.kind === 'pc') !== (y.kind === 'pc')) return x.kind === 'pc' ? -1 : 1;
      return a.i - b.i;
    }).map((o) => o.r);
  }

  // ---- marks (GURPS) ----

  // The marks a row's HP lights (`rules.marks`, names and numbers from the system): `chips`, the plain marks by
  // name (Reeling by `part` of max HP, 0 or less by `atMost`), and `deepest`, the deepest minus-HP line passed
  // ({ times, name }, by `times` max HP) or null. Nothing for a system with no marks.
  function marksOf(row, rules = DND_FIGHT_RULES) {
    const marks = rulesOf({ rules }).marks;
    const out = { chips: [], deepest: null };
    if (!row || !isNum(row.hp) || !Array.isArray(marks)) return out;
    const max = isNum(row.max) && row.max > 0 ? row.max : null;
    for (const m of marks) {
      if (!m) continue;
      if (isNum(m.part)) { if (max !== null && row.hp * m.part < max) out.chips.push(m.name); } else if (isNum(m.atMost)) {
        if (row.hp <= m.atMost) out.chips.push(m.name);
      } else if (isNum(m.times) && max !== null && row.hp <= -m.times * max && (!out.deepest || m.times > out.deepest.times)) {
        out.deepest = { times: m.times, name: m.name };
      }
    }
    return out;
  }
  // Whether a row's FP lights the system's Tired (`rules.tiredAt`, by `part` of max FP).
  function tiredOf(row, rules = DND_FIGHT_RULES) {
    const t = rulesOf({ rules }).tiredAt;
    if (!t || !isNum(t.part) || !row || !isNum(row.fp) || !isNum(row.fpMax) || row.fpMax <= 0) return false;
    return row.fp * t.part < row.fpMax;
  }

  const live = (r) => Boolean(r) && r.in && !r.out;
  // The Lair row has a turn only while one of its owners is live.
  const takesTurn = (r, rows) => live(r) && (r.kind !== 'lair' || !(r.of || []).length || r.of.some((id) => live(rows.find((x) => x.id === id))));

  // The next live row after the turn's row (the Lair row counts while an owner is live); `wrapped` when it passed the end.
  // With no turn row (or one that is gone) it starts from the top.
  function nextLive(rows, turnId) {
    const n = rows.length;
    let i = rows.findIndex((r) => r.id === turnId);
    let wrapped = false;
    for (let step = 0; step < n; step++) {
      i += 1;
      if (i >= n) { i = 0; wrapped = true; }
      if (takesTurn(rows[i], rows)) return { row: rows[i], wrapped };
    }
    return { row: null, wrapped };
  }

  // ---- sides (plan 6a) ----

  // A row's side is its kind plus a neutral flag: a neutral is `kind: 'foe', neutral: true`, so it is
  // everything a foe is (Out at 0 HP, unseen, numbered, a foe's keys on the players' screen) except a foe
  // the panel picks or the vitals hold. The panel's switch is three direct buttons in this order: ally, which
  // shows a seen row's name and HP to the players, is last, so it is never the stray middle click (final review P-A3).
  const SIDES = ['foe', 'neutral', 'ally'];
  const isSide = (v) => SIDES.includes(v);
  // A note's side as the GM has it now, before any row's own (final review O9: the one chain, for the rows a
  // fight starts, the beats' Who's here and the players' screen): the side set tonight (`sides`), then one carried
  // from an earlier session's Table Log (`carried`), then the reader's (`readerAlly`). `set` is true for the first
  // two: the GM's own word. A stored value that is no side is passed over.
  function noteSide(sides, carried, note, readerAlly) {
    const own = (o) => (o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, note) && isSide(o[note]) ? o[note] : null);
    const set = own(sides) || own(carried);
    return set ? { side: set, set: true } : { side: readerAlly ? 'ally' : 'foe', set: false };
  }
  function sideOfRow(r) {
    if (!r || (r.kind !== 'foe' && r.kind !== 'ally')) return null;
    return r.kind === 'ally' ? 'ally' : (r.neutral ? 'neutral' : 'foe');
  }
  // A foe the panel may pick: never a neutral.
  const isFoe = (r) => Boolean(r) && r.kind === 'foe' && !r.neutral;
  // An ally from the GM's own words starts seen; one the reader infers (affiliation, relationships, a bare
  // Quick Reference "ally") starts unseen. A foe made before allyBy existed (no key at all) is 5b's shape,
  // where every ally was the Plan's.
  const GM_WORDS = new Set(['plan', 'stats']);
  const byGm = (foe) => foe.allyBy === undefined || GM_WORDS.has(foe.allyBy);

  // Whose panel the fight view shows (decision 22): the pinned one; else the current row; on a PC's turn
  // the last foe to act, or the next foe due; before the start, the first foe.
  function actingRow(fight, peekId) {
    const rows = (fight && fight.rows) || [];
    const byId = (id) => (id ? rows.find((r) => r.id === id) || null : null);
    const picked = byId(peekId);
    if (picked) return { row: picked, why: 'picked' };
    const cur = byId(fight && fight.turn);
    if (!cur) {
      const first = rows.find((r) => isFoe(r) && r.in);
      return first ? { row: first, why: 'first-foe' } : { row: null, why: null };
    }
    if (cur.kind !== 'pc') return { row: cur, why: 'acting' };
    const last = byId(fight.lastFoe);
    if (last) return { row: last, why: 'last-foe' };
    const at = rows.indexOf(cur);
    const next = rows.slice(at).concat(rows.slice(0, at)).find((r) => isFoe(r) && live(r));
    return next ? { row: next, why: 'next-foe' } : { row: null, why: null };
  }

  // ---- names ----

  // What the GM sees: the unmasked name when there is one, then the copy number once there are two.
  // How many rows share a row's name run, for gmName's copy number: a note's rows (not PCs), or, for a counted line
  // with no note ("Foam-covered guards ×4"), the note-less rows of that name that carry a copy number. A "+ New" row
  // has its number in its name and no copy, so it counts alone.
  function copiesOf(rows, row) {
    if (row.note) return rows.filter((x) => x.note === row.note && x.kind !== 'pc').length;
    if (!row.copy) return 1;
    return rows.filter((x) => !x.note && x.copy && x.kind === row.kind && x.name === row.name).length;
  }

  function gmName(row, unmaskOf, copies) {
    if (row.kind === 'lair') return 'Lair action';
    const base = (unmaskOf && row.note && unmaskOf(row.note)) || row.name;
    return copies > 1 && row.copy ? `${base} ${row.copy}` : base;
  }

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const ARTICLE = /^(?:a|an|the)\s+/i;

  // The number a foe row gets, by word, fixed when first ticked in: a row that has one keeps it; a ticked
  // row without one takes the next after the highest. An unticked row with no number gets none, nor does a
  // row already seen (shown before the fight): it takes a number only if it goes back to unseen.
  // Foes are numbered by the word they show, article dropped: `a guard` and `the guard` both show `Guard N`,
  // so they share one run of numbers. A kept number already taken in its run (two runs that met) takes the
  // next free one instead.
  const unseenKey = (word) => String(word || '').trim().replace(ARTICLE, '').toLowerCase();
  function unseenNumbers(rows, wordOf) {
    const out = new Map();
    const top = new Map();
    const used = new Map();
    const fresh = [];
    for (const r of rows) {
      // a foe's, and an ally's: one the reader inferred starts unseen (plan 6a fix round 1 / review M4)
      if (r.kind !== 'foe' && r.kind !== 'ally') continue;
      const w = unseenKey(wordOf(r));
      if (!used.has(w)) used.set(w, new Set());
      const kept = r.unseenN !== null && r.unseenN !== undefined;
      if (kept && !used.get(w).has(r.unseenN)) {
        out.set(r.id, r.unseenN);
        used.get(w).add(r.unseenN);
        top.set(w, Math.max(top.get(w) || 0, r.unseenN));
      } else if (kept || (r.in && !r.seen)) fresh.push([r, w]);
    }
    for (const [r, w] of fresh) {
      const n = (top.get(w) || 0) + 1;
      top.set(w, n);
      out.set(r.id, n);
    }
    return out;
  }

  // The word an unseen foe shows: `Brother 1` once two share a word (a leading a/an/the dropped), else the
  // word as written, capitalised. Rows that are unticked and unnumbered do not count towards the numbering.
  function unseenLabels(rows, wordOf) {
    const numbers = unseenNumbers(rows, wordOf);
    // every numbered row with the word counts, whatever its side now: a copy switched to ally never
    // renumbers the others (plan 6a fix round 1 / review M3)
    const members = new Map();
    for (const r of rows) {
      if (r.kind === 'pc' || r.kind === 'lair') continue;
      if (!numbers.has(r.id) && (r.unseenN === null || r.unseenN === undefined)) continue;
      const w = unseenKey(wordOf(r));
      members.set(w, (members.get(w) || 0) + 1);
    }
    const labels = new Map();
    for (const r of rows) {
      if (r.kind !== 'foe') continue;
      const word = String(wordOf(r) || '').trim();
      labels.set(r.id, numbers.has(r.id) && members.get(unseenKey(word)) >= 2 ? `${cap(word.replace(ARTICLE, ''))} ${numbers.get(r.id)}` : cap(word));
    }
    return labels;
  }

  // ---- building rows ----

  const groupOfBeat = (beat, spotKey) => {
    const spots = beat.spots || [];
    return spotKey && spots.length > 1 && spots.some((s) => s.key === spotKey) ? spotKey : beat.key;
  };
  const stripCopy = (name) => String(name || '').replace(/\s+\d+$/, '');

  function blankRow(over) {
    return {
      id: null, kind: 'foe', note: null, foeKey: null, type: null, name: '', copy: null, in: true, group: null,
      ini: null, mod: 0, ac: null, hp: null, max: null, temp: 0, conds: [], exhaustion: 0, conc: false,
      ds: { s: 0, f: 0 }, out: false, seen: false, seenTick: null, seenFrom: null, neutral: false, sideFrom: null, half: false, resisted: false,
      lrMax: 0, lr: 0, laMax: 0, la: 0, recharge: [], lair: false, of: [], unseenN: null, word: null,
      start: { hp: null, max: null, conds: [], exhaustion: 0, conc: false }, at: null, hpAt: null, typed: false,
      // the systems' figures (step 6b), null where a system has none: the pools, the stats, CoC's combat figures
      // (`combat` is worked out on read, combatOf), what a figure was worked out from (`from`), the fields the GM
      // typed (`typedKeys`), the marks lit, the deepest minus-HP line passed, Tired, the CoC firearm, and whether a
      // GURPS row holds its place in the fixed order (`fixed`) or waits for placeHeld (`held`)
      fp: null, fpMax: null, mp: null, mpMax: null, san: null, sanMax: null, luck: null, er: null, erMax: null,
      dex: null, st: null, ht: null, dx: null, speed: null, dodge: null, parry: null, block: null, dr: null, faceOpen: false, drByLocation: null,
      // CoC's CON and INT, for Task 18's cards; its Major Wound box (it stays ticked), the round Dying was set (its
      // reminders start the round after), and a bout of madness ({ left, of, from }: rounds left, its length, the round it started; `bout`)
      con: null, int: null, majorWound: false, dyingRound: null,
      armour: null, fighting: null, firearms: null, combat: null, db: null, build: null, attacks: 1, defended: 0, bout: null,
      // CoC's melee (Task 16): the row's melee defences this round (reset at the round's start) and its outnumbered
      // switch (off: never outnumbered)
      meleeDefences: 0, outnumberedOff: false,
      // CoC's firearms (Task 19): the guns its block or sheet lists, a declared aim ({ round }), the attack it loses
      // for diving for cover ({ attacks, on }: `on` once its next turn has started), and a slow weapon's counter
      // (a list, one per slow gun: { gun, weapon, left, of }: its index, its name, rounds until it is ready again)
      guns: null, aiming: null, lostAttack: null, reload: null,
      // and whether it casts (GURPS: its FP shows as ✦FP, Task 10)
      // GURPS's last hit (its working, Task 12) and the places crippled
      // Set by a manoeuvre pick, absent until one: `manFrom` holds the Aim and Evaluate counts from before this turn's
      // pick, `manTurn` the round and row turn of the pick's log line, `manLine` that line's text
      from: {}, typedKeys: {}, marks: [], deepest: 0, tired: false, gun: false, fixed: false, held: false, caster: false, hit: null, crippled: [], ...over,
    };
  }

  // A vitals figure's conditions text (`Down, Prone, Exhaustion 2, Concentrating`) as statuses and a level.
  // Concentration starts empty in a new fight, so it is dropped.
  function readConditions(text) {
    const conds = [];
    let exhaustion = 0;
    for (const part of String(text || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
      const m = /^Exhaustion\s+(\d+)$/i.exec(part);
      if (m) exhaustion = Math.min(EXHAUSTION_MAX, Number(m[1]));
      else if (!/^Concentrating$/i.test(part) && !conds.includes(part)) conds.push(part);
    }
    return { conds, exhaustion };
  }

  // The pools a row's start keeps, by their row names, when the row holds them (a D&D row's start is as before).
  const POOL_FIELDS = ['fp', 'mp', 'san', 'luck', 'er'];
  function withStart(row) {
    const pools = {};
    for (const k of POOL_FIELDS) if (isNum(row[k])) pools[k] = row[k];
    return { ...row, start: { hp: row.hp, max: row.max, conds: row.conds.slice(), exhaustion: row.exhaustion, conc: row.conc, ...pools } };
  }

  // A number the reader gave, or null; armour's `none` is 0 (CoC armour is a number on the row).
  const armourOf = (v) => (isNum(v) ? v : (/^\s*none\s*$/i.test(String(v == null ? '' : v)) ? 0 : num(String(v == null ? '' : v).replace(/^\s*(\d+).*$/, '$1'))));
  // A start figure clamped to its max, as HP is.
  const startAt = (start, max) => (num(start) !== null ? (num(max) !== null ? Math.min(num(start), num(max)) : num(start)) : num(max));

  // The system's own fields on a foe's row, from the reader's names (systems/*.js foeRow): the pools at their start,
  // the stats, and initiative from DEX or Speed where the rules work it out (D&D: none, and the block's modifier).
  function foeSystemFields(foe) {
    const out = {
      fpMax: num(foe.fpMax !== undefined ? foe.fpMax : foe.fp), mpMax: num(foe.mpMax !== undefined ? foe.mpMax : foe.mp),
      sanMax: num(foe.sanMax !== undefined ? foe.sanMax : foe.san), erMax: num(foe.erMax !== undefined ? foe.erMax : foe.er),
      dex: num(foe.dex), st: num(foe.st), ht: num(foe.ht), dx: num(foe.dx), speed: num(foe.speed), dodge: num(foe.dodge),
      con: num(foe.con), int: num(foe.int),
      parry: num(foe.parry), block: num(foe.block), dr: foe.dr === undefined ? null : foe.dr, faceOpen: foe.faceOpen === true, armour: armourOf(foe.armour),
      fighting: foe.fighting === undefined ? null : foe.fighting, firearms: foe.firearms === undefined ? null : foe.firearms,
      db: foe.db === undefined ? null : foe.db, build: num(foe.build), caster: foe.caster === true,
      // a block's attacks figure (CoC); a row with none keeps 1
      ...(num(foe.attacks) !== null ? { attacks: num(foe.attacks) } : {}),
      guns: gunsIn(foe.guns),
      from: foe.from && typeof foe.from === 'object' ? { ...foe.from } : {},
    };
    out.fp = startAt(foe.fpStart, out.fpMax);
    out.mp = out.mpMax;
    out.san = num(foe.san);
    out.er = startAt(foe.erStart, out.erMax);
    return out;
  }
  // A row's pools set from the night's vitals (state.js vitalRows: mp, san, luck, fp, er), each one the row holds and
  // the vitals give a number for; a figure set above its max starts at the max, as HP's start is held to it.
  function startPools(sys, v) {
    for (const k of POOL_FIELDS) {
      if (sys[k] === null || sys[k] === undefined || num(v[k]) === null) continue;
      const max = num(sys[`${k}Max`]);
      sys[k] = max !== null ? Math.min(num(v[k]), max) : num(v[k]);
    }
  }
  // A PC's, from its sheet's flat numbers (`hpNow`/`hpMax` are HP's, as today).
  function pcSystemFields(pc) {
    const pair = (now, max) => ({ now: num(now) !== null ? num(now) : num(max), max: num(max) });
    const fp = pair(pc.fpNow, pc.fpMax);
    const mp = pair(pc.mpNow, pc.mpMax);
    const san = pair(pc.sanNow, pc.sanMax);
    const er = pair(pc.erNow, pc.erMax);
    return {
      fp: fp.now, fpMax: fp.max, mp: mp.now, mpMax: mp.max, san: san.now, sanMax: san.max, er: er.now, erMax: er.max,
      luck: num(pc.luck), dex: num(pc.dex), st: num(pc.st), ht: num(pc.ht), dx: num(pc.dx), speed: num(pc.speed),
      con: num(pc.con), int: num(pc.int),
      dodge: num(pc.dodge), parry: num(pc.parry), block: num(pc.block), dr: pc.dr === undefined ? null : pc.dr,
      drByLocation: pc.drByLocation && typeof pc.drByLocation === 'object' ? { ...pc.drByLocation } : null,
      fighting: pc.fighting === undefined ? null : pc.fighting, firearms: pc.firearms === undefined ? null : pc.firearms,
      caster: pc.caster === true, build: num(pc.build), db: pc.db === undefined ? null : pc.db,
      ...(num(pc.attacks) !== null ? { attacks: num(pc.attacks) } : {}),
      guns: gunsIn(pc.guns),
    };
  }
  // CoC's firearms as the reader gave them (Task 19): { name, skill, damage, malfunction, reload, impales }, copied;
  // null with none.
  function gunsIn(list) {
    if (!Array.isArray(list)) return null;
    const out = list.filter((g) => g && typeof g === 'object' && typeof g.name === 'string').map((g) => ({
      name: g.name, skill: num(g.skill), damage: typeof g.damage === 'string' && g.damage ? g.damage : null,
      malfunction: num(g.malfunction), reload: num(g.reload), impales: typeof g.impales === 'boolean' ? g.impales : null,
    }));
    return out.length ? out : null;
  }
  // Initiative where the system works it out, and no D&D modifier then.
  const withInit = (ctx, row) => (ctx.rules.initiative === 'roll' ? row : { ...row, ini: initOf(row, ctx.rules), mod: 0 });

  const castOf = (model, note) => (model.cast || []).find((c) => c.note === note) || null;
  const typeOf = (model, foe) => {
    const c = castOf(model, foe.note);
    return (c && c.type) || (model.notes && model.notes[foe.note] && model.notes[foe.note].type) || (foe.ally ? 'npc' : 'creature');
  };
  // The word an unseen foe goes by: its note's `unseen_as`, else the withheld person word. Stored on the row
  // so `reduce` can number unseen foes when they are first ticked in, with no model.
  const wordOf = (model, note) => {
    const c = castOf(model, note);
    const n = model.notes && model.notes[note];
    return (c && c.unseenAs) || (n && n.unseenAs) || (model.withheldWords && model.withheldWords.person) || '';
  };
  const baseName = (model, foe) => {
    const c = castOf(model, foe.note);
    return c && c.name ? c.name : stripCopy(foe.name);
  };

  // One foe or ally fight row. A PC or ally starts from the vitals figure (Review H1), a named NPC from its
  // last fight, a creature from its note. Temp HP, concentration and death saves always start empty.
  //
  // Its side (plan 6a): the side the GM set tonight, then one carried from an earlier session's Table Log
  // (both "you set it"), then the reader's, then foe. It starts seen when it is an ally from the GM's own
  // words or a side the GM set, when it was shown before, or when the model's `seenFrom` holds it; the row
  // carries `seenFrom` for the seen button's title, and `sideFrom` for its side's.
  function foeRowFrom(ctx, foe, over) {
    const type = typeOf(ctx.model, foe);
    const start = startingSide(ctx, foe);
    const ally = start.side === 'ally';
    // a block that says it starts hurt (`HP 10 (currently 4)`) starts there, unless a carried or last-fight figure speaks
    // (never above the block's own HP: `HP 10 (currently 12)` starts at 10; with no HP figure it is taken as written)
    let hp = num(foe.hpStart) !== null ? (num(foe.hp) !== null ? Math.min(num(foe.hpStart), num(foe.hp)) : num(foe.hpStart)) : num(foe.hp);
    let max = num(foe.hp);
    const sys = foeSystemFields(foe);
    let conds = [];
    let exhaustion = 0;
    let out = false;
    if (ally) {
      const v = ctx.vitals.get(over.copy > 1 ? `${foe.note}#${over.copy}` : foe.note);
      if (v) {
        const read = readConditions(v.conditions);
        max = num(v.max) !== null ? num(v.max) : max;
        hp = num(v.hp) !== null ? num(v.hp) : (num(foe.hpNow) !== null ? num(foe.hpNow) : hp);
        conds = read.conds;
        exhaustion = read.exhaustion;
        // the pools as the night's vitals hold them (a carried figure, an earlier fight's, the end panel's), as HP
        startPools(sys, v);
      } else {
        if (num(foe.hpNow) !== null) hp = num(foe.hpNow);
        // a carried MP, SAN or FP (the reader's `mpNow`, `sanNow`, `fpNow`)
        startPools(sys, { mp: foe.mpNow, san: foe.sanNow, fp: foe.fpNow });
      }
    } else if (type === 'npc') {
      const last = ctx.lastFightRow(foe.note);
      if (last) {
        hp = num(last.hp);
        max = num(last.max) !== null ? num(last.max) : max;
        conds = (last.conds || []).slice();
        exhaustion = last.exhaustion || 0;
        // at 0 a D&D foe is Out; nobody is Out by themselves in CoC or GURPS
        out = hp === 0 && ctx.rules.autoOut !== false;
        // the pools the last fight left, as its HP
        for (const k of POOL_FIELDS) if (isNum(last[k])) sys[k] = last[k];
      }
    }
    const at = foe.rechargeAt || {};
    const seenFrom = typeof ctx.seenFrom[foe.note] === 'string' && ctx.seenFrom[foe.note] ? ctx.seenFrom[foe.note] : null;
    const shown = Boolean(ctx.state.shownEver && ctx.state.shownEver[foe.note]);
    // seen in an ended fight: a foe starts seen (name only); an inferred ally does not (re-review)
    const seenBefore = Boolean(ctx.state.seenEver && ctx.state.seenEver[foe.note]) && !(ally && !start.byGm);
    return withStart(withInit(ctx, blankRow({
      ...sys,
      kind: ally ? 'ally' : 'foe', neutral: start.side === 'neutral', sideFrom: start.why, seenFrom,
      note: foe.note, foeKey: foe.key, type, name: baseName(ctx.model, foe),
      group: ctx.foeGroup, mod: num(foe.init) || 0, ac: num(foe.ac), hp, max, conds, exhaustion, out,
      seen: (ally && start.byGm) || shown || seenBefore || Boolean(seenFrom),
      lrMax: foe.legendaryResistance || 0, lr: foe.legendaryResistance || 0,
      laMax: foe.legendaryActions || 0, la: foe.legendaryActions || 0,
      recharge: (foe.recharge || []).map((name) => ({ name, at: isNum(at[name]) ? at[name] : 6, ready: true, rolled: null })),
      // every row the GM can switch keeps its unseen word: an ally may be unseen, or become a foe
      lair: Boolean(foe.lair), word: wordOf(ctx.model, foe.note), ...over,
    })));
  }

  // { side, why, byGm } for a foe object: why is "you set it" for a side the GM set, else the reader's
  // allyFrom (null for a plain foe). A stored value that is no side is passed over.
  function startingSide(ctx, foe) {
    const n = noteSide(ctx.sides, ctx.sidesCarried, foe.note, foe.ally);
    if (n.set) return { side: n.side, why: 'you set it', byGm: true };
    if (n.side === 'ally') return { side: 'ally', why: foe.allyFrom || null, byGm: byGm(foe) };
    return { side: 'foe', why: null, byGm: false };
  }

  function pcRowFrom(ctx, pc, group, on) {
    const v = ctx.vitals.get(pc.note);
    const read = readConditions(v && v.conditions);
    const max = v && num(v.max) !== null ? num(v.max) : num(pc.hpMax);
    const hp = v && num(v.hp) !== null ? num(v.hp) : (num(pc.hpNow) !== null ? num(pc.hpNow) : max);
    const sys = pcSystemFields(pc);
    if (v) startPools(sys, v);
    return withStart(withInit(ctx, blankRow({
      ...sys,
      kind: 'pc', note: pc.note, type: 'pc', name: pc.name, in: on, group, mod: num(pc.init) || 0, ac: num(pc.ac),
      hp, max, conds: read.conds, exhaustion: read.exhaustion, seen: true,
    })));
  }

  const lairRow = (owners, group) => blankRow({
    kind: 'lair', name: 'Lair action', in: true, group, ini: 20, mod: -99, of: owners.map((r) => r.id), seen: true,
  });

  // Shared set-up for the two builders.
  function contextOf({ model, derived, state, positions }) {
    const st = state || {};
    const beats = (derived && derived.beats) || model.beats || [];
    const vitals = new Map(((derived && derived.vitals) || []).map((v) => [v.rowId, v]));
    const byKey = new Map(beats.map((b) => [b.key, b]));
    const groupOf = (note) => {
      if (positions && Object.prototype.hasOwnProperty.call(positions, note)) return positions[note];
      const p = st.positions && st.positions[note];
      if (!p) return null;
      if (p.off) return 'off';
      const b = byKey.get(p.beat);
      return b ? groupOfBeat(b, p.spot) : p.beat;
    };
    const inBeat = (note, beat) => {
      const g = groupOf(note);
      return g !== null && g !== undefined && (g === beat.key || (beat.spots || []).some((s) => s.key === g));
    };
    const lastFightRow = (note) => {
      const fights = st.fights || [];
      for (let i = fights.length - 1; i >= 0; i--) {
        const r = (fights[i].rows || []).find((x) => x.note === note);
        if (r) return r;
      }
      return null;
    };
    // the sides and seen the rows start from: the state's and the model's, as `reduce` never sees the model
    const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    const rules = rulesOf({ rules: model.rules && model.rules.fight });
    return { model, rules, state: st, beats, byKey, vitals, groupOf, inBeat, lastFightRow, foeGroup: null,
      sides: obj(st.sides), sidesCarried: obj(model.sidesCarried), seenFrom: obj(model.seenFrom) };
  }

  // The threshold lines a beat holds, each with the notes that can light it (decision 20). `foeRows` are the
  // beat's fight rows.
  function thresholdsOf(beat, foeRows) {
    const out = [];
    const bosses = foeRows.filter((r) => r.kind === 'foe');
    // `cond` is what sets the line off; `text` is what the Log says (an If-row also says its `then`)
    const lines = (beat.points || []).map((p) => ({ key: p.key, cond: p.text, text: p.text }))
      .concat((beat.ifs || []).map((p) => ({ key: p.key, cond: p.text || p.do, then: p.text ? '' : p.then, text: p.text || [p.do, p.then].filter(Boolean).join(': ') })));
    for (const l of lines) {
      const t = thresholdOf(l.cond);
      if (!t) continue;
      // an HP line can only be crossed by a foe whose max is over it
      const can = t.hp !== undefined ? bosses.filter((r) => isNum(r.max) && r.max > t.hp) : bosses;
      // the foe Do names, else the foe Then names, else the biggest (Review L4: an HP line too)
      // whole names only: a Rat is not named by "Pirate"
      const names = (text, name) => Boolean(name) && new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text);
      const naming = (s) => can.filter((r) => {
        const text = String(s || '');
        const stem = String(r.note || '').split('/').pop().replace(/\.md$/, '');
        return names(text, String(r.name || '')) || names(text, stem);
      });
      let pick = naming(l.cond);
      if (!pick.length) pick = naming(l.then);
      if (!pick.length) {
        const top = can.reduce((m, r) => (isNum(r.max) && r.max > m ? r.max : m), 0);
        pick = top ? can.filter((r) => r.max === top).slice(0, 1) : [];
      }
      const foes = pick.map((r) => r.note);
      out.push({ key: l.key, beat: beat.key, text: String(l.text), hp: t.hp === undefined ? null : t.hp, bloodied: t.hp === undefined, foes: [...new Set(foes)] });
    }
    return out;
  }

  // Number rows `<idBase>-r<n>`. The ids come from the action's own id, so a re-applied action makes the same rows.
  const ider = (idBase) => { let n = 0; return () => `${idBase}-r${++n}`; };

  // The foes a beat gives a fight: its own, the allies brought in (derive already holds those), and anyone
  // else brought in who has a fight row (Review M7). `on` says whether each is ticked: someone an arrivals
  // cue names (`Arriving, start of round 3`) joins benched, for the GM to tick in when they arrive.
  //
  // A place beat (plan 6a Task 7) fights as v8's did: its people's creatures ticked in, everyone else benched
  // (derive marks those `benched`), and a person with no stats gets a blank row through foeRowFrom, carrying
  // its note, name and side (decision 7, review P5). A Plan beat's statless people get none, as in 5b.
  function beatFoes(ctx, beat) {
    const own = beat.foes || [];
    const arriving = new Set((beat.arrivals || []).flatMap((a) => a.people || []));
    const rows = own.map((f) => ({ foe: f, on: !arriving.has(f.note) && !f.benched }));
    const have = new Set(own.map((f) => f.note));
    if (beat.placeBeat) {
      for (const w of beat.who || []) {
        if (!w.note || w.brought || have.has(w.note)) continue;
        const c = castOf(ctx.model, w.note);
        if (!c || c.foe) continue;
        have.add(w.note);
        rows.push({ foe: { key: `${beat.key}.foe.${w.note}`, note: c.note, name: c.name, ally: Boolean(c.ally), allyFrom: c.allyFrom || null, allyBy: c.allyBy }, on: c.type === 'creature' });
      }
    }
    for (const b of (ctx.state.brought && ctx.state.brought[beat.key]) || []) {
      if (have.has(b.note)) continue;
      const c = castOf(ctx.model, b.note);
      if (!c || !c.foe) continue;
      have.add(b.note);
      rows.push({ foe: c.foe, on: startingSide(ctx, c.foe).side === 'ally' || Boolean(beat.impro) });
    }
    return rows;
  }

  // Number the copies of each note, after the highest already taken (`taken`: note -> highest copy).
  function numberCopies(foes, taken) {
    const seen = new Map(taken);
    return foes.map((x) => {
      const copy = (seen.get(x.foe.note) || 0) + 1;
      seen.set(x.foe.note, copy);
      return copy;
    });
  }

  // The rows for a new fight on a beat (decision 13). `groups` is the page's focused group(s), used when no
  // PC stands in the beat (a contingency, an improvised beat); `positions` maps a PC note to its group id
  // and defaults to the state's positions. `at` is Fight here's place (a beat's or a hub spot's key): a
  // place beat is always one.
  function rowsForFight({ model, derived, state, beatKey, groups, idBase, positions, at }) {
    const ctx = contextOf({ model, derived, state, positions });
    const beat = ctx.byKey.get(beatKey) || null;
    const id = ider(idBase);
    const pcs = model.pcs || [];
    // Fight here at a place (plan 6a Task 7, review P4; final review P4.7): only the PCs who stand there are
    // ticked. When none does, nobody is, and the fight is the place's: its groups are the place alone, so the
    // GM's eye reads it by the place and the focused group is offered on the Add line.
    const placeAt = at || (beat && beat.placeBeat ? beatKey : null);
    const placeFight = Boolean(placeAt);
    let here = !beat ? [] : placeAt && placeAt !== beat.key ? pcs.filter((p) => ctx.groupOf(p.note) === placeAt) : pcs.filter((p) => ctx.inBeat(p.note, beat));
    if (!here.length && groups && groups.length && !placeFight) here = pcs.filter((p) => groups.includes(ctx.groupOf(p.note)));
    const rows = pcs.map((p) => {
      const on = here.length ? here.some((h) => h.note === p.note) : !placeFight;
      return { ...pcRowFrom(ctx, p, ctx.groupOf(p.note), on), id: id() };
    });
    // the fight's groups: every group holding a ticked PC (proof M2: a beat where no PC stands ticks them all)
    const placed = (g) => g !== null && g !== undefined && g !== 'off';
    const held = [...new Set(rows.filter((r) => r.in && placed(r.group)).map((r) => r.group))];
    const fightGroups = held.length ? held : placeFight ? [placeAt] : (groups && groups.length ? groups.slice() : [beatKey]);
    ctx.foeGroup = fightGroups[0];
    const foes = beat ? beatFoes(ctx, beat) : [];
    const copies = numberCopies(foes, new Map());
    const foeRows = foes.map((x, i) => ({ ...foeRowFrom(ctx, x.foe, { copy: copies[i], in: x.on }), id: id() }));
    rows.push(...foeRows);
    const owners = rows.filter((r) => r.lair && r.in);
    if (owners.length) rows.push({ ...lairRow(owners, fightGroups[0]), id: id() });
    return { rows, groups: fightGroups, thresholds: beat ? thresholdsOf(beat, foeRows) : [] };
  }

  // Add to a running fight (decision 14). `add` is one of { cast, count }, { group } or { beat }. Answers the
  // new rows, the ids of existing rows to tick in, the groups and thresholds the fight does not have yet, and
  // `refused` (a sentence) when nothing can be added. A new Lair row is only made when the fight has none.
  function joinRows({ model, derived, state, fight, add, idBase, positions }) {
    const ctx = contextOf({ model, derived, state, positions });
    const id = ider(idBase);
    const have = fight.rows || [];
    const out = { rows: [], tick: [], groups: [], thresholds: [], refused: null };
    ctx.foeGroup = (fight.groups || [])[0] || null;
    const tickIn = (r) => { if (!r.in && !out.tick.includes(r.id)) out.tick.push(r.id); };
    const lairIfNew = () => {
      if (have.some((r) => r.kind === 'lair')) return;
      const owners = have.concat(out.rows).filter((r) => r.lair && (r.in || out.tick.includes(r.id) || out.rows.includes(r)));
      if (owners.length) out.rows.push({ ...lairRow(owners, ctx.foeGroup), id: id() });
    };
    const addGroup = (g) => { if (g && !(fight.groups || []).includes(g) && !out.groups.includes(g)) out.groups.push(g); };

    // A name nobody in the cast has (the GM chose "+ New"): `count` blank rows, built as every page-built row
    // is, so each starts an unseen foe with no note. `Name 1 … Name N`, or the bare name for one; a second
    // add of the same name goes on from the highest number there.
    if (add && typeof add.name === 'string') {
      const name = add.name.replace(/\s+/g, ' ').trim();
      if (!name) { out.refused = 'Type a name to add.'; return out; }
      const n = Math.max(1, Math.min(20, Math.floor(add.count) || 1));
      let top = 0;
      for (const r of have) {
        if (r.note || r.kind !== 'foe') continue;
        if (r.name === name) top = Math.max(top, 1);
        else if (r.name.startsWith(`${name} `) && /^\d+$/.test(r.name.slice(name.length + 1))) top = Math.max(top, Number(r.name.slice(name.length + 1)));
      }
      const foe = { key: null, note: null, name, ally: false, ac: null, hp: null, init: null };
      for (let i = 1; i <= n; i++) {
        const label = top === 0 && n === 1 ? name : `${name} ${top + i}`;
        out.rows.push({ ...foeRowFrom(ctx, foe, { copy: null, in: true, name: label, foeKey: null }), id: id() });
      }
      return out;
    }

    if (add && add.cast) {
      const c = castOf(model, add.cast);
      if (!c) { out.refused = 'That note is not in the cast.'; return out; }
      if (c.type === 'pc') {
        const r = have.find((x) => x.note === c.note);
        if (r) tickIn(r);
        else {
          const p = (model.pcs || []).find((x) => x.note === c.note) || { note: c.note, name: c.name };
          out.rows.push({ ...pcRowFrom(ctx, p, ctx.groupOf(c.note), true), id: id() });
        }
        return out;
      }
      const n = Math.max(1, Math.min(20, Math.floor(add.count) || 1));
      const mine = have.filter((x) => x.note === c.note);
      const benched = mine.filter((x) => !x.in);
      // a benched arrival ticked in may be the first lair owner able to act: its Lair row comes with it
      if (benched.length) { benched.slice(0, n).forEach(tickIn); lairIfNew(); return out; }
      if (c.type === 'npc' && mine.length) { out.refused = `${c.name} is already in this fight.`; return out; }
      const foe = c.foe || { key: `cast.${c.note}`, note: c.note, name: c.name, ally: false, ac: null, hp: null, init: null };
      const top = mine.reduce((m, x) => Math.max(m, x.copy || 0), 0);
      for (let i = 1; i <= n; i++) out.rows.push({ ...foeRowFrom(ctx, foe, { copy: top + i, in: true }), id: id() });
      lairIfNew();
      return out;
    }

    // A group or a beat: its PCs and the beat's foes and allies.
    let beat = null;
    let pcsIn = [];
    if (add && add.group) {
      beat = ctx.beats.find((b) => b.key === add.group || (b.spots || []).some((s) => s.key === add.group)) || null;
      pcsIn = (model.pcs || []).filter((p) => ctx.groupOf(p.note) === add.group);
      addGroup(add.group);
    } else if (add && add.beat) {
      beat = ctx.byKey.get(add.beat) || null;
      pcsIn = beat ? (model.pcs || []).filter((p) => ctx.inBeat(p.note, beat)) : [];
      const gs = [...new Set(pcsIn.map((p) => ctx.groupOf(p.note)))];
      (gs.length ? gs : [add.beat]).forEach(addGroup);
    } else { out.refused = 'Nothing to add.'; return out; }
    for (const p of pcsIn) {
      const r = have.find((x) => x.note === p.note);
      if (r) tickIn(r);
      else out.rows.push({ ...pcRowFrom(ctx, p, ctx.groupOf(p.note), true), id: id() });
    }
    if (beat) {
      const taken = new Map();
      for (const r of have) if (r.note) taken.set(r.note, Math.max(taken.get(r.note) || 0, r.copy || 0));
      // A named NPC already in the fight from another beat is the same person: ticked in if benched, never a
      // second row (the rule Add by name keeps). A beat listing a note twice still makes both.
      const foes = beatFoes(ctx, beat).filter((x) => !have.some((r) => r.foeKey === x.foe.key)).filter((x) => {
        const mine = typeOf(ctx.model, x.foe) === 'npc' ? have.filter((r) => r.note === x.foe.note) : [];
        if (!mine.length) return true;
        if (x.on) mine.filter((r) => !r.in).slice(0, 1).forEach(tickIn);
        return false;
      });
      const copies = numberCopies(foes, taken);
      const built = foes.map((x, i) => ({ ...foeRowFrom(ctx, x.foe, { copy: copies[i], in: x.on }), id: id() }));
      out.rows.push(...built);
      const notes = new Set(beatFoes(ctx, beat).map((x) => x.foe.note));
      const known = new Set((fight.thresholds || []).map((t) => t.key));
      out.thresholds = thresholdsOf(beat, have.concat(built).filter((r) => notes.has(r.note))).filter((t) => !known.has(t.key));
      lairIfNew();
    }
    return out;
  }


  // ---- adding anyone by name (plan 6a Task 6) ----

  const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
  // Edit distance (insert, delete, change one letter), two rows of memory.
  function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // The cast names a typed name nearly is: within two edits of a name or alias (fewer for a short one, so two
  // letters are not near everything), then anyone sharing the surname (the last word of two or more). Nearest first.
  // A name as matching reads it: case, accents and spacing blind, and a leading "the" dropped (plan 6a Task 7:
  // "club" finds The Club). `sameName` is the one test for "the same name", for people and places alike.
  const nameKey = (s) => fold(s).replace(/\s+/g, ' ').trim().replace(/^the /, '');
  const sameName = (a, b) => Boolean(nameKey(a)) && nameKey(a) === nameKey(b);
  function nearCast(cast, query) {
    const q = nameKey(query);
    if (q.length < 3) return [];
    const most = Math.min(2, Math.floor(q.length / 3));
    const words = q.split(' ');
    const out = [];
    (cast || []).forEach((c, i) => {
      let rank = null;
      for (const t of [c.name, ...(c.aliases || []), ...(c.gmAliases || [])].map(nameKey).filter(Boolean)) {
        const d = editDistance(q, t);
        if (d <= most && (rank === null || d < rank)) rank = d;
      }
      if (rank === null && words.length >= 2) {
        const theirs = fold(c.name).replace(/\s+/g, ' ').trim().split(' ');
        if (theirs.length >= 2 && theirs[theirs.length - 1] === words[words.length - 1]) rank = 10;
      }
      if (rank !== null) out.push({ c, i, rank });
    });
    return out.sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.c);
  }
  // What the Add box lists as the GM types: near names first, then the search's hits, then the one explicit
  // way to make a blank row, "+ New: Name (no note)". `search` is state.js's castSearch (this file never
  // loads it). Nothing typed lists nothing. Move them lists places the same way (plan 6a Task 7): `cast` is
  // then the known places and `newLabel` words the last choice ("+ New place: Name").
  function addChoices(cast, query, search, limit = 8, newLabel = (t) => `+ New: ${t} (no note)`) {
    const text = String(query == null ? '' : query).replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const near = nearCast(cast, text);
    const seen = new Set(near.map((c) => c.note));
    const hits = near.concat(((typeof search === 'function' ? search(cast, text) : []) || []).filter((c) => !seen.has(c.note))).slice(0, limit);
    return hits.map((c) => ({ note: c.note, name: c.name, type: c.type }))
      .concat({ note: null, name: text, type: null, isNew: true, label: newLabel(text) });
  }

  // A row's group: its note plus its name without a trailing number (v8's groupOf). A PC or the Lair row has none.
  const groupKey = (r) => `${r.note || ''}|${String(r.name || '').replace(/\s+\d+$/, '')}`;
  const groupMates = (rows, r) => (r && r.kind !== 'pc' && r.kind !== 'lair' ? rows.filter((x) => x.kind !== 'pc' && x.kind !== 'lair' && groupKey(x) === groupKey(r)) : []);

  // One insert (plan 6a "latest entry wins"): the row goes above the first row it beats, at the place the
  // sort would give it; the rest keep the order they have. A tie goes after the rows already there. "Beats" is
  // the whole sort's word (the row and the rest, the row last), so a tie group's rule (tieFigures) holds here too.
  function placeRow(rows, id, rules = DND_FIGHT_RULES) {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return rows;
    const row = rows[i];
    const rest = rows.filter((_, k) => k !== i);
    const sorted = sortRows(rest.concat(row), rules);
    const after = new Set(sorted.slice(sorted.indexOf(row) + 1));
    let at = rest.findIndex((x) => after.has(x));
    if (at < 0) at = rest.length;
    return rest.slice(0, at).concat(row, rest.slice(at));
  }

  // A row an add made is untouched until the GM types into it, its HP or a status moves, it has a turn, or a
  // line of the fight's log names it (`typed`, `turned`, `logged`).
  // `forCopy` is Same for all's question: a line naming the row (its own copy line, a roster) or a turn it has had
  // changes none of its numbers, so neither blocks a copy; typed numbers, HP, temp HP, statuses, Out and death saves do.
  // The figures a copy itself gave (`copied`) are not a touch, so a second copy may overwrite the first.
  // For a copy, typing is asked field by field (`typedKeys`, copyFields), not of the row (Task 23, D3): a row with a
  // typed initiative still takes the HP, and a row at full HP is not hurt, whatever its max came from.
  function untouched(r, forCopy) {
    const st = r.start || {};
    const nul = (a) => (a === undefined || a === null ? null : a);
    const c = r.copied || {};
    const hpOk = nul(r.hp) === nul(st.hp) || (c.hp !== undefined && nul(r.hp) === nul(c.hp)) || (forCopy && isNum(r.max) && r.hp === r.max);
    const maxOk = forCopy || nul(r.max) === nul(st.max) || (c.max !== undefined && nul(r.max) === nul(c.max));
    return (forCopy || !r.typed) && (forCopy || (!r.turned && !r.logged)) && hpOk && maxOk && !r.temp && !r.out
      && !(r.conds || []).length && !r.exhaustion && !r.conc && !(r.ds && (r.ds.s || r.ds.f));
  }
  // A worked-out figure's `from` key (the one copy; fight.js reads it): a figure the GM types clears it, and Same for all
  // (Task 23, D3) never copies a source's worked-out figure itself, only its inputs, so the copy works it out again.
  const FROM_KEY = { max: 'hp', fpMax: 'fp', mpMax: 'mp', speed: 'speed', dodge: 'dodge' };
  // The stat keys Same for all copies for D&D (the one copy; fight.js's statKeysOf gives them for a D&D fight).
  const SAME_KEYS = ['max', 'ac', 'mod'];
  const holds = (v) => isNum(v) || (typeof v === 'string' && v.trim() !== '');
  // Whether a row holds anything Same for all could copy (else its button is disabled: "Type a number first").
  // D&D's modifier of 0 is a blank row's own, never a number typed: alone it is nothing to copy.
  const copyHolds = (src, keys = SAME_KEYS) => keys.some((k) => holds(src[k]) && !(k === 'mod' && src[k] === 0));
  // What a copy takes from the source: each field the source holds, the copy has not typed and does not hold already
  // (`fields`), and its HP to the source's max (`hp`) when its max is not typed and the HP differs.
  function copyFields(src, x, keys = SAME_KEYS) {
    const typed = (x.typedKeys && typeof x.typedKeys === 'object') ? x.typedKeys : {};
    const from = (src.from && typeof src.from === 'object') ? src.from : {};
    const derived = (k) => Boolean(FROM_KEY[k] && from[FROM_KEY[k]]);
    const fields = keys.filter((k) => holds(src[k]) && !typed[k] && !derived(k) && x[k] !== src[k]);
    const hp = isNum(src.max) && !typed.max && !derived('max') && x.hp !== src.max;
    return { fields, hp };
  }
  // The copies Same for all will give something to: the source's group mates, not hurt or given a status, that take a
  // field. The button's number.
  function sameForAllTakers(rows, src, keys = SAME_KEYS) {
    return groupMates(rows, src).filter((x) => x !== src && untouched(x, true)).filter((x) => { const c = copyFields(src, x, keys); return c.fields.length > 0 || c.hp; });
  }
  const sameForAllCount = (rows, src, keys = SAME_KEYS) => sameForAllTakers(rows, src, keys).length;
  // Whether the join's rows can still be taken back: there are some, and none has been touched.
  function undoable(fight, join) {
    const mine = ((fight && fight.rows) || []).filter((r) => join != null && r.joinId === join);
    return mine.length > 0 && mine.every((r) => untouched(r, false));
  }

  // The groups a fight takes in (proof M2): the ones it was given or added, and every group (`{ key, pcs }`,
  // show.js's groupsOf) where a PC ticked into it now stands.
  function fightGroupKeys(fight, groups) {
    const out = (fight && Array.isArray(fight.groups) ? fight.groups : []).slice();
    const ticked = new Set(((fight && fight.rows) || []).filter((r) => r && r.kind === 'pc' && r.in && r.note).map((r) => r.note));
    for (const g of groups || []) if (!out.includes(g.key) && (g.pcs || []).some((p) => ticked.has(p))) out.push(g.key);
    return out;
  }

  return {
    DND_STATUSES, EXHAUSTION_MAX, DND_FIGHT_RULES, rulesOf, fightGroupKeys,
    parseEntry, hitWords, hitText, cannotTarget, chipOrder, damageTaken, afterDamage, afterHeal, isBloodied, bloodiedWord, DND_LONG_REST, DND_NO_BLOCK, poolsOf, poolOf, afterPool,
    combatOf, initOf, marksOf, tiredOf,
    thresholdOf, isLit, sortRows, takesTurn, nextLive, actingRow,
    gmName, copiesOf, lairRow, unseenKey, unseenNumbers, unseenLabels, rowsForFight, joinRows, blankRow,
    addChoices, sameName, groupKey, groupMates, placeRow, undoable, untouched, copyHolds, copyFields, sameForAllTakers, sameForAllCount, FROM_KEY, SAME_KEYS,
    SIDES, isSide, noteSide, sideOfRow, isFoe,
  };
}));
