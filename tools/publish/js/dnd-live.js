/* D&D 5e live sheet: hit points, temporary hit points, death saves, hit dice,
   spell slots, feature uses, item charges, conditions, exhaustion, inspiration,
   and short and long rests, kept in the shared live-state store. Bookkeeping,
   not a rules engine: it resets counts and never works out a modifier or rolls
   a die. Pure helpers are exported for Node tests; the DOM part runs only in a
   browser. Mirrors js/coc-live.js. */
(function (root) {
  'use strict';

  function int(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : fallback;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function amount(n) { var x = Math.floor(Number(n)); return (isFinite(x) && x > 0) ? x : 0; }
  function copy(s) {
    var out = {}, k;
    for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    out.conditions = (s.conditions || []).slice();
    out.used = {};
    for (k in (s.used || {})) if (Object.prototype.hasOwnProperty.call(s.used, k)) out.used[k] = s.used[k];
    return out;
  }

  // A saved record fitted to what the page has now. The note's maxima always win:
  // a count above its maximum is cut to it, a key the page no longer has is
  // dropped, and a track the record never knew starts from the note.
  function fit(saved, data) {
    var s = (saved && typeof saved === 'object') ? saved : {};
    var d = data.defaults || {};
    var savedUsed = (s.used && typeof s.used === 'object') ? s.used : {};
    var out = { v: 1 };
    out.hp = data.hpMax == null ? null : clamp(int(s.hp, d.hp), 0, data.hpMax);
    out.temp = Math.max(0, int(s.temp, d.temp || 0));
    out.exhaustion = clamp(int(s.exhaustion, d.exhaustion || 0), 0, 6);
    out.inspiration = typeof s.inspiration === 'boolean' ? s.inspiration : !!d.inspiration;
    out.concentrating = s.concentrating === true;
    var conds = Array.isArray(s.conditions) ? s.conditions : (d.conditions || []);
    out.conditions = [];
    conds.forEach(function (c) {
      if (typeof c === 'string' && c.trim() && out.conditions.indexOf(c.trim()) === -1) out.conditions.push(c.trim());
    });
    out.used = {};
    (data.tracks || []).forEach(function (t) { out.used[t.key] = clamp(int(savedUsed[t.key], t.used), 0, t.max); });
    return out;
  }

  function clearDeath(s) {
    if ('ds:s' in s.used) s.used['ds:s'] = 0;
    if ('ds:f' in s.used) s.used['ds:f'] = 0;
  }

  // Temporary hit points absorb first; the rest comes off current, never below 0.
  function damage(state, n) {
    var s = copy(state), d = amount(n);
    var fromTemp = Math.min(s.temp, d);
    var before = s.hp;
    s.temp -= fromTemp;
    if (s.hp != null) s.hp = Math.max(0, s.hp - (d - fromTemp));
    return { state: s, fromTemp: fromTemp, fromHp: before == null ? 0 : before - s.hp };
  }

  function heal(state, n, data) {
    var s = copy(state), h = amount(n), before = s.hp;
    if (s.hp == null || !h) return { state: s, gained: 0, clearedDeath: false };
    s.hp = Math.min(data.hpMax, s.hp + h);
    var cleared = before === 0 && s.hp > 0;
    if (cleared) clearDeath(s);
    return { state: s, gained: s.hp - before, clearedDeath: cleared };
  }

  function setTemp(state, n) { var s = copy(state); s.temp = amount(n); return s; }

  function setUsed(state, track, n) {
    var s = copy(state);
    s.used[track.key] = clamp(int(Number(n), 0), 0, track.max);
    return s;
  }

  // Filled marks are what is left of a pool, or (death saves) what has been made.
  function filledMarks(track, used) { return track.fill === 'made' ? used : track.max - used; }

  // Tapping a filled mark of a pool spends one; tapping a hollow one takes it back.
  // Death saves run the other way: a hollow mark is one not yet made.
  function toggleMark(state, track, markIsFilled) {
    var up = track.fill === 'made' ? !markIsFilled : markIsFilled;
    return setUsed(state, track, (state.used[track.key] || 0) + (up ? 1 : -1));
  }

  function isHitDie(t) { return t.key.indexOf('hd:') === 0; }

  function shortRest(state, data, dice, healed) {
    var s = copy(state);
    (data.tracks || []).forEach(function (t) {
      if (isHitDie(t)) s.used[t.key] = clamp(s.used[t.key] + amount(dice && dice[t.key]), 0, t.max);
      else if (t.rest === 'short') s.used[t.key] = 0;
      else if (t.rest === 'short1') s.used[t.key] = Math.max(0, s.used[t.key] - 1);
    });
    return heal(s, healed, data).state;
  }

  function longRest(state, data) {
    var s = copy(state);
    (data.tracks || []).forEach(function (t) { if (t.rest !== 'none') s.used[t.key] = 0; });
    if (s.hp != null) s.hp = data.hpMax;
    s.temp = 0;
    s.exhaustion = Math.max(0, s.exhaustion - 1);
    s.concentrating = false;
    return s;
  }

  // Labels of the spent things a rest would bring back, in sheet order.
  function comesBack(state, data, rest) {
    return (data.tracks || []).filter(function (t) {
      if (!state.used[t.key] || t.rest === 'reset' || t.rest === 'none') return false;
      return rest === 'long' ? true : (t.rest === 'short' || t.rest === 'short1');
    }).map(function (t) { return t.label; });
  }
  function leftAlone(data) {
    return (data.tracks || []).filter(function (t) { return t.rest === 'none'; }).map(function (t) { return t.label; });
  }

  function statusBits(state) {
    var bits = [];
    if (state.hp === 0) bits.push({ text: 'Dying: ' + (state.used['ds:s'] || 0) + ' saved, ' + (state.used['ds:f'] || 0) + ' failed', kind: 'dying' });
    (state.conditions || []).forEach(function (c) { bits.push({ text: c, kind: 'bad' }); });
    if (state.exhaustion) bits.push({ text: 'Exhaustion ' + state.exhaustion, kind: 'bad' });
    if (state.concentrating) bits.push({ text: 'Concentrating', kind: 'conc' });
    if (state.inspiration) bits.push({ text: 'Inspired', kind: 'good' });
    return bits;
  }

  var api = { fit: fit, damage: damage, heal: heal, setTemp: setTemp, setUsed: setUsed, toggleMark: toggleMark,
    filledMarks: filledMarks, shortRest: shortRest, longRest: longRest, comesBack: comesBack, leftAlone: leftAlone,
    statusBits: statusBits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__dndLive = api;

  // --- DOM part (browser only): Task 4 ---
  if (typeof document === 'undefined') return;
})(typeof window !== 'undefined' ? window : globalThis);
