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
  // The most a typed amount or a temporary hit point total can be.
  var MOST = 9999;
  // What a condition may be, wherever one is read: on the page, on the party board, and by
  // flush before it writes a name into the note (lib/flush/dnd-writeback.js uses this very
  // function). A saved record can be sent by anyone, so a name is a short piece of plain
  // text: a string, trimmed, one of each whatever its capitals (the first spelling kept),
  // and never one that could leave its table cell or turn into markup there.
  var MOST_CONDITIONS = 20, LONGEST_CONDITION = 60;
  var NOT_A_NAME = /[|,\[\]<>`\\\u0000-\u001f\u007f\u2028\u2029]/;
  function fitConditions(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (c) {
      var name = typeof c === 'string' ? c.trim() : '';
      if (!name || name.length > LONGEST_CONDITION || NOT_A_NAME.test(name)) return;
      var k = ' ' + name.toLowerCase();
      if (seen[k] || out.length >= MOST_CONDITIONS) return;
      seen[k] = true;
      out.push(name);
    });
    return out;
  }

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
    // A cell the note wrote in words is not live: the page holds no number for it.
    out.temp = data.tempLive === false ? 0 : clamp(int(s.temp, d.temp || 0), 0, MOST);
    out.exhaustion = data.exhaustionLive === false ? 0 : clamp(int(s.exhaustion, d.exhaustion || 0), 0, 6);
    out.inspiration = typeof s.inspiration === 'boolean' ? s.inspiration : !!d.inspiration;
    out.concentrating = s.concentrating === true;
    out.conditions = fitConditions(Array.isArray(s.conditions) ? s.conditions : d.conditions);
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

  // What a number field holds: null when nothing was typed, so an empty field is never a 0.
  function typed(value) {
    if (value == null || String(value).trim() === '') return null;
    return Math.min(amount(value), MOST);
  }

  // What damage did, in a sentence. A part that took nothing is left out.
  function tookText(n, fromTemp, fromHp) {
    if (!fromTemp) return 'Took ' + n + '.';
    if (!fromHp) return 'Took ' + fromTemp + ' from temporary hit points.';
    return 'Took ' + n + ': ' + fromTemp + ' from temporary hit points, ' + fromHp + ' from hit points.';
  }

  function setTemp(state, n) { var s = copy(state); s.temp = Math.min(amount(n), MOST); return s; }

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

  // Labels of the spent things a rest would bring back, in sheet order. A long
  // rest also clears death saves, so marked ones are named.
  function comesBack(state, data, rest) {
    return (data.tracks || []).filter(function (t) {
      if (!state.used[t.key] || t.rest === 'none') return false;
      if (rest === 'long') return true;
      return t.rest === 'short' || t.rest === 'short1';
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

  // The standard conditions the drawer offers. lib/templates/dnd/live-data.js holds the
  // same list for the build; test/dnd-live-conditions.test.js keeps the two equal.
  var CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

  var api = { fit: fit, fitConditions: fitConditions, typed: typed, tookText: tookText, damage: damage, heal: heal, setTemp: setTemp, setUsed: setUsed, toggleMark: toggleMark,
    filledMarks: filledMarks, shortRest: shortRest, longRest: longRest, comesBack: comesBack, leftAlone: leftAlone,
    statusBits: statusBits, CONDITIONS: CONDITIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.__dndLive = api;


  // --- DOM part (browser only) ---
  // It reads taps and paints. Every decision is in the functions above, and the
  // page is always drawn from the state, never read back from the DOM.
  if (typeof document === 'undefined') return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(cls, text, act, arg) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.setAttribute('data-act', act);
    if (arg != null) b.setAttribute('data-arg', arg);
    return b;
  }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

  document.addEventListener('DOMContentLoaded', function () {
    var island = document.getElementById('dnd-live-data');
    if (!island || !root.__liveState) return;
    var data;
    try { data = JSON.parse(island.textContent); } catch (e) { return; }
    if (!data || !data.campaignId || !data.tracks) return;

    var store = root.__liveState.createStore({ campaignId: data.campaignId, pcSlug: data.pcSlug });
    var trackOf = {};
    data.tracks.forEach(function (t) { trackOf[t.key] = t; });
    var hitDice = data.tracks.filter(isHitDie);
    var hasDeath = !!(trackOf['ds:s'] || trackOf['ds:f']);
    // Temporary hit points and exhaustion the note wrote in words stay as written.
    var tempLive = data.tempLive !== false;
    var exhaustionLive = !!data.exhaustionLive;

    var vitals = document.querySelector('[data-live="vitals"]');
    var hpTile = (vitals && data.hpMax != null) ? vitals.querySelector('[data-live="hp"]') : null;
    var chipRow = vitals ? vitals.querySelector('[data-live="chips"]') : null;

    var state = fit(store.readCache(), data);
    var undo = null;        // the state before the last rest, until the next change
    var open = null;        // the open drawer: { name, key, update }
    var opener = null;      // what opened it, to hand focus back
    var fields = {};        // the open drawer's number inputs
    var condChip = null, inspChip = null, concChip = null;
    var hpBar = null, deathRow = null, drawerBox = null, saidBox = null, saidText = null, undoBtn = null;

    // A track's name in a sentence. A slot row's label is only its level.
    function nameOf(t) { return t.key.indexOf('slot:') === 0 ? t.label + ' spell slots' : t.label; }
    function left(t) { return t.max - state.used[t.key]; }
    // The tracks a rest would bring back, asked of comesBack one track at a time.
    function backFrom(rest) {
      return data.tracks.filter(function (t) { return comesBack(state, { tracks: [t] }, rest).length > 0; });
    }
    function conditionAt(name) {
      for (var i = 0; i < state.conditions.length; i++) if (same(state.conditions[i], name)) return i;
      return -1;
    }

    // ---- the fixed pieces of the strip, built once ----
    function markGroup(key, cls) {
      var t = trackOf[key];
      var g = el('span', 'dnd5e-marks dnd5e-live' + (cls ? ' ' + cls : ''));
      g.setAttribute('data-live', key);
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', t.label);
      for (var i = 0; i < t.max; i++) { var m = el('button', 'dnd5e-mark'); m.type = 'button'; g.appendChild(m); }
      return g;
    }

    function buildHp() {
      hpTile.setAttribute('role', 'button');
      hpTile.setAttribute('tabindex', '0');
      var line = hpTile.querySelector('.dnd5e-hp-line') || hpTile;
      // The build draws temporary hit points last on the line; a note with none gets the same place.
      if (tempLive && !line.querySelector('.dnd5e-temp')) line.appendChild(el('span', 'dnd5e-temp'));
      var hint = el('span', 'dnd5e-tap', 'tap to change');
      hint.setAttribute('aria-hidden', 'true');
      line.appendChild(hint);
      var bar = el('span', 'dnd5e-bar');
      bar.setAttribute('aria-hidden', 'true');
      hpBar = el('span', 'dnd5e-bar-fill');
      bar.appendChild(hpBar);
      hpTile.appendChild(bar);
    }

    function buildChips() {
      // What the note wrote that the page cannot hold as a yes or a number stays as written.
      var built = Array.prototype.slice.call(chipRow.children);
      var keep = [];
      var hadInspiration = built.length && built[0].classList.contains('is-on');
      if (hadInspiration && !data.inspirationLive) keep.push(built[0]);
      if (!exhaustionLive && built.length > (hadInspiration ? 2 : 1)) keep.push(built[built.length - 1]);
      empty(chipRow);
      chipRow.classList.remove('is-quiet');

      if (data.inspirationLive) { inspChip = button('dnd5e-chip', 'Heroic Inspiration', 'inspiration'); chipRow.appendChild(inspChip); }
      concChip = button('dnd5e-chip', 'Concentrating', 'concentrating');
      chipRow.appendChild(concChip);
      condChip = button('dnd5e-chip', '', 'open', 'cond');
      chipRow.appendChild(condChip);
      keep.forEach(function (k) { k.classList.remove('is-quiet'); chipRow.appendChild(k); });
      var rest = el('span', 'dnd5e-rest');
      rest.appendChild(button('dnd5e-btn', 'Short rest', 'open', 'short'));
      rest.appendChild(button('dnd5e-btn', 'Long rest', 'open', 'long'));
      chipRow.appendChild(rest);
    }

    function buildStrip() {
      if (!vitals) return;
      if (hpTile) buildHp();
      if (hpTile && hasDeath) {
        deathRow = el('div', 'dnd5e-death');
        deathRow.hidden = true;
        deathRow.appendChild(el('span', '', 'At 0 hit points'));
        [['ds:s', 'Saved', ''], ['ds:f', 'Failed', 'is-fail']].forEach(function (d) {
          if (!trackOf[d[0]]) return;
          var row = el('span', 'dnd5e-frow');
          row.appendChild(el('span', '', d[1]));
          row.appendChild(markGroup(d[0], d[2]));
          deathRow.appendChild(row);
        });
        vitals.insertBefore(deathRow, chipRow || null);
      }
      if (chipRow) buildChips();
      drawerBox = el('div', 'dnd5e-drawer');
      drawerBox.hidden = true;
      drawerBox.setAttribute('role', 'group');
      vitals.appendChild(drawerBox);
      // The message line is in the page from the start and never hidden from a screen
      // reader, so its first message is announced; while empty it only takes no room.
      saidBox = el('div', 'dnd5e-said is-empty');
      saidText = el('span', 'dnd5e-said-text');
      saidText.setAttribute('role', 'status');
      undoBtn = button('dnd5e-btn is-quiet', 'Undo', 'undo');
      undoBtn.hidden = true;
      saidBox.appendChild(saidText);
      saidBox.appendChild(undoBtn);
      vitals.appendChild(saidBox);
    }

    // ---- drawers: one place in the strip for every question the sheet asks ----
    // Each builder draws what does not change and returns a function that fills in
    // what follows the state. A drawer is built once per opening and only updated
    // after that, so a field keeps its focus and what was typed in it.
    function title(text) {
      var h = el('h4', 'dnd5e-drawer-title', text);
      drawerBox.appendChild(h);
      drawerBox.setAttribute('aria-label', text);
      return h;
    }
    function row() { var r = el('div', 'dnd5e-frow'); drawerBox.appendChild(r); return r; }
    function numberField(name) {
      var input = el('input', 'dnd5e-field');
      input.type = 'number';
      input.min = '0';
      input.max = String(MOST);
      input.setAttribute('inputmode', 'numeric');
      input.placeholder = '0';
      input.name = 'dnd5e-' + name.replace(/[^a-z0-9]+/gi, '-');
      fields[name] = input;
      return input;
    }
    function read(name) { return fields[name] ? Math.min(amount(fields[name].value), MOST) : 0; }

    var DRAWERS = {
      hp: function () {
        title('Hit points');
        var r = row();
        var input = numberField('amt');
        input.setAttribute('aria-label', 'Amount');
        r.appendChild(input);
        r.appendChild(button('dnd5e-btn is-damage', 'Damage', 'damage'));
        r.appendChild(button('dnd5e-btn is-heal', 'Heal', 'heal'));
        if (tempLive) r.appendChild(button('dnd5e-btn', 'Temporary', 'temp'));
        r.appendChild(button('dnd5e-btn is-quiet', 'Close', 'close'));
        drawerBox.appendChild(el('p', '', tempLive
          ? 'Damage comes off temporary hit points first. Temporary sets them to the number you type; type 0 to clear them. An empty box does nothing.'
          : 'Your temporary hit points are as the note has them. Take them off yourself before you enter damage.'));
        return function () {};
      },
      pool: function (key) {
        var t = trackOf[key];
        var h = title('');
        var r = row();
        var input = numberField('amt');
        input.setAttribute('aria-label', 'Amount');
        r.appendChild(input);
        r.appendChild(button('dnd5e-btn', 'Spend', 'spend'));
        r.appendChild(button('dnd5e-btn is-quiet', 'Put back', 'putback'));
        r.appendChild(button('dnd5e-btn is-quiet', 'Close', 'close'));
        return function () {
          h.textContent = t.label + ': ' + left(t) + ' of ' + t.max + ' left';
          drawerBox.setAttribute('aria-label', h.textContent);
        };
      },
      cond: function () {
        title('Conditions');
        var chips = el('div', 'dnd5e-chips');
        CONDITIONS.forEach(function (n) { chips.appendChild(button('dnd5e-chip', n, 'cond', n)); });
        drawerBox.appendChild(chips);
        var r = row(), count = null;
        if (exhaustionLive) {
          r.appendChild(el('span', '', 'Exhaustion'));
          var step = el('span', 'dnd5e-stepper');
          var less = button('dnd5e-btn is-quiet', '−', 'exhaustion', '-1');
          less.setAttribute('aria-label', 'Less exhaustion');
          var more = button('dnd5e-btn is-quiet', '+', 'exhaustion', '1');
          more.setAttribute('aria-label', 'More exhaustion');
          count = el('span', 'dnd5e-num');
          step.appendChild(less);
          step.appendChild(count);
          step.appendChild(more);
          r.appendChild(step);
        }
        r.appendChild(button('dnd5e-btn is-quiet dnd5e-end', 'Done', 'close'));
        return function () {
          // A condition of the GM's own gets a chip, so it can be seen and turned off;
          // it stays listed while the drawer is open, so a slip can be taken back.
          state.conditions.forEach(function (c) {
            var listed = false;
            each(chips.children, function (chip) { if (same(chip.getAttribute('data-arg'), c)) listed = true; });
            if (!listed) chips.appendChild(button('dnd5e-chip', c, 'cond', c));
          });
          each(chips.children, function (chip) {
            var on = conditionAt(chip.getAttribute('data-arg')) !== -1;
            chip.classList.toggle('is-on', on);
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          if (count) count.textContent = state.exhaustion;
        };
      },
      short: function () {
        title('Short rest');
        var r = row(), asks = [];
        function ask(name) {
          var l = el('label', 'dnd5e-ask'), words = el('span');
          l.appendChild(words);
          l.appendChild(numberField(name));
          r.appendChild(l);
          return words;
        }
        hitDice.forEach(function (t) { asks.push({ track: t, words: ask('dice:' + t.key) }); });
        if (state.hp != null) ask('amt').textContent = 'Hit points you rolled';
        var back = el('p');
        drawerBox.appendChild(back);
        r = row();
        r.appendChild(button('dnd5e-btn', 'Take the short rest', 'shortrest'));
        r.appendChild(button('dnd5e-btn is-quiet', 'Cancel', 'close'));
        return function () {
          asks.forEach(function (a) {
            a.words.textContent = a.track.label + ' spent (' + left(a.track) + ' left)';
            fields['dice:' + a.track.key].max = String(left(a.track));
          });
          var names = backFrom('short').map(function (t) { return t.rest === 'short1' ? 'one ' + nameOf(t) + ' use' : nameOf(t); });
          back.textContent = (names.length ? 'Comes back: ' + names.join(', ') + '.' : 'Nothing else comes back on a short rest right now.')
            + (hitDice.length && state.hp != null ? ' Roll your own dice and add your Constitution modifier for each.' : '');
        };
      },
      long: function () {
        title('Long rest');
        var list = el('div');
        drawerBox.appendChild(list);
        drawerBox.appendChild(el('p', '', 'Left alone: ' + leftAlone(data).concat(['your conditions', 'Heroic Inspiration']).join(', ') + '.'));
        var r = row();
        r.appendChild(button('dnd5e-btn', 'Take the long rest', 'longrest'));
        r.appendChild(button('dnd5e-btn is-quiet', 'Cancel', 'close'));
        return function () {
          var lines = [], death = false;
          if (state.hp != null) lines.push('Hit points to ' + data.hpMax);
          backFrom('long').forEach(function (t) { if (t.rest === 'reset') death = true; else lines.push(nameOf(t)); });
          if (death) lines.push('Death saves cleared');
          if (state.temp) lines.push('Temporary hit points end');
          if (exhaustionLive && state.exhaustion) lines.push('Exhaustion drops to ' + (state.exhaustion - 1));
          if (state.concentrating) lines.push('Concentration ends');
          empty(list);
          if (!lines.length) { list.appendChild(el('p', '', 'Nothing is spent: there is nothing to bring back.')); return; }
          var ul = el('ul');
          lines.forEach(function (l) { ul.appendChild(el('li', '', l)); });
          list.appendChild(ul);
        };
      },
    };

    // `refocus` hands focus back to what opened the drawer even when focus was elsewhere.
    function drawer(name, key, from, refocus) {
      if (!drawerBox) return;
      var back = (refocus || drawerBox.contains(document.activeElement)) ? opener : null;
      fields = {};
      empty(drawerBox);
      if (!name || (name === 'pool' && !trackOf[key])) {
        open = null;
        opener = null;
        drawerBox.hidden = true;
        if (back && document.contains(back)) back.focus();
      } else {
        open = { name: name, key: key || null, update: null };
        opener = from || null;
        if (!undo) say('');
        drawerBox.hidden = false;
        open.update = DRAWERS[name](open.key);
        open.update();
        for (var first in fields) { fields[first].focus(); break; }
      }
      paintOpen();
    }
    function toggleDrawer(name, key, from) {
      if (open && open.name === name && open.key === (key || null)) drawer(null);
      else drawer(name, key, from);
    }

    // ---- painting ----
    function paintTracks() {
      each(document.querySelectorAll('[data-live]'), function (node) {
        var t = trackOf[node.getAttribute('data-live')];
        if (!t) return;
        var used = state.used[t.key];
        if (node.classList.contains('dnd5e-marks')) {
          var filled = filledMarks(t, used);
          var made = t.fill === 'made';
          if (t.key === 'ds:f') node.classList.add('is-fail');
          each(node.querySelectorAll('.dnd5e-mark'), function (mark, i) {
            var spent = i >= filled;
            mark.classList.toggle('is-spent', spent);
            mark.setAttribute('aria-label', made ? (spent ? 'Not made' : 'Made') : (spent ? 'Spent' : 'Available'));
          });
        } else if (node.classList.contains('dnd5e-count')) {
          var num = node.querySelector('.dnd5e-num');
          if (num) num.textContent = t.max - used;
          node.setAttribute('aria-label', t.label + ': ' + (t.max - used) + ' of ' + t.max + ' left. Change');
        }
      });
    }

    function paintHp() {
      if (!hpTile) return;
      var line = hpTile.querySelector('.dnd5e-hp-line') || hpTile;
      var num = line.querySelector('.dnd5e-num');
      if (num) num.textContent = state.hp;
      if (tempLive) {
        var temp = line.querySelector('.dnd5e-temp');
        temp.textContent = '+ ' + state.temp + ' temp';
        temp.hidden = !state.temp;
      }
      hpBar.style.width = (data.hpMax > 0 ? Math.round(state.hp / data.hpMax * 100) : 0) + '%';
      hpTile.setAttribute('aria-label', 'Change hit points: ' + state.hp + ' of ' + data.hpMax
        + (state.temp ? ', ' + state.temp + ' temporary' : ''));
    }

    function paintChips() {
      if (!condChip) return;
      if (inspChip) {
        inspChip.classList.toggle('is-on', state.inspiration);
        inspChip.setAttribute('aria-pressed', state.inspiration ? 'true' : 'false');
      }
      concChip.classList.toggle('is-on', state.concentrating);
      concChip.setAttribute('aria-pressed', state.concentrating ? 'true' : 'false');
      var bits = state.conditions.slice();
      if (exhaustionLive && state.exhaustion) bits.push('Exhaustion ' + state.exhaustion);
      condChip.textContent = bits.length ? bits.join(', ') : 'No conditions';
      condChip.classList.toggle('is-bad', bits.length > 0);
    }

    // Which control the open drawer belongs to, and what it shows of the state.
    function paintOpen() {
      if (!drawerBox) return;
      each(vitals.querySelectorAll('[data-act="open"]'), function (b) {
        b.setAttribute('aria-expanded', open && open.name === b.getAttribute('data-arg') ? 'true' : 'false');
      });
      if (hpTile) hpTile.setAttribute('aria-expanded', open && open.name === 'hp' ? 'true' : 'false');
      if (open && open.update) open.update();
    }

    function paint() {
      paintTracks();
      paintHp();
      paintChips();
      if (deathRow) deathRow.hidden = state.hp !== 0;
      paintOpen();
      if (undoBtn) undoBtn.hidden = !undo;
    }

    // The line holds what the last tap did, and nothing once that is no longer the last tap.
    function say(message) {
      if (!saidBox) return;
      saidBox.classList.toggle('is-empty', !message);
      saidText.textContent = message || '';
    }

    // Every change goes through here. `undoTo` is the state a rest can be undone to;
    // any other change withdraws the offer.
    function commit(next, message, undoTo) {
      undo = undoTo || null;
      state = next;
      store.save(state);
      paint();
      say(message);
    }

    // ---- what a tap does ----
    function change(edit) { var s = copy(state); edit(s); return s; }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    var ACT = {
      open: function (arg, from) { toggleDrawer(arg, null, from); },
      close: function () { drawer(null); },
      inspiration: function () { commit(change(function (s) { s.inspiration = !s.inspiration; })); },
      concentrating: function () { commit(change(function (s) { s.concentrating = !s.concentrating; })); },
      damage: function () {
        var n = read('amt');
        if (!n) return;
        var r = damage(state, n);
        var msg = tookText(n, r.fromTemp, r.fromHp);
        if (r.state.hp === 0) msg += hasDeath ? ' You are at 0: mark your death saves above.' : ' You are at 0 hit points.';
        drawer(null);
        commit(r.state, msg);
      },
      heal: function () {
        var n = read('amt');
        if (!n) return;
        var r = heal(state, n, data);
        drawer(null);
        commit(r.state, 'Regained ' + plural(r.gained, 'hit point', 'hit points') + '.' + (r.clearedDeath ? ' Death saves cleared.' : ''));
      },
      temp: function () {
        // Nothing typed is not a 0: the button sits beside Close, and nothing here can be undone.
        var n = tempLive && fields.amt ? typed(fields.amt.value) : null;
        if (n === null) return;
        drawer(null);
        commit(setTemp(state, n), n ? plural(n, 'temporary hit point', 'temporary hit points') + '.' : 'Temporary hit points cleared.');
      },
      spend: function () { pool(1); },
      putback: function () { pool(-1); },
      cond: function (name) {
        commit(change(function (s) {
          var at = conditionAt(name);
          if (at === -1) s.conditions.push(name); else s.conditions.splice(at, 1);
        }));
      },
      exhaustion: function (step) {
        if (!exhaustionLive) return;
        commit(change(function (s) { s.exhaustion = clamp(s.exhaustion + Number(step), 0, 6); }));
      },
      shortrest: function () {
        var before = state, dice = {}, spent = 0;
        hitDice.forEach(function (t) { dice[t.key] = read('dice:' + t.key); });
        var next = shortRest(state, data, dice, read('amt'));
        hitDice.forEach(function (t) { spent += next.used[t.key] - before.used[t.key]; });
        var bits = [];
        if (hitDice.length) bits.push(plural(spent, 'hit die', 'hit dice') + ' spent');
        if (next.hp != null) bits.push(plural(next.hp - before.hp, 'hit point', 'hit points') + ' regained');
        drawer(null);
        commit(next, 'Short rest taken' + (bits.length ? ': ' + bits.join(', ') : '') + '.', before);
      },
      longrest: function () {
        var before = state;
        drawer(null);
        commit(longRest(state, data), 'Long rest taken.', before);
      },
      undo: function () {
        if (!undo) return;
        var back = undo;
        drawer(null);
        commit(back, 'Undone. Everything is as it was before the rest.');
      },
    };
    function pool(direction) {
      var t = open && trackOf[open.key], n = read('amt');
      if (!t || !n) return;
      var was = state.used[t.key];
      var next = setUsed(state, t, was + direction * n);
      var now = t.max - next.used[t.key];
      drawer(null);
      commit(next, direction > 0 ? t.label + ': spent ' + (next.used[t.key] - was) + ', ' + now + ' left.' : t.label + ': ' + now + ' left.');
    }

    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var act = target.closest('[data-act]');
      if (act && vitals && vitals.contains(act) && ACT[act.getAttribute('data-act')]) {
        ACT[act.getAttribute('data-act')](act.getAttribute('data-arg'), act);
        return;
      }
      var hook = target.closest('[data-live]');
      if (!hook) return;
      var t = trackOf[hook.getAttribute('data-live')];
      var mark = target.closest('.dnd5e-mark');
      if (t && mark && hook.contains(mark)) { commit(toggleMark(state, t, !mark.classList.contains('is-spent'))); return; }
      if (t && hook.classList.contains('dnd5e-count')) { toggleDrawer('pool', t.key, hook); return; }
      if (hook === hpTile && !target.closest('a')) toggleDrawer('hp', null, hpTile);
    });
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        // Only when the key was pressed on the sheet: the site's search and menus have their own Escape.
        var at = document.activeElement;
        if (open && (!at || at === document.body || at === opener || (vitals && vitals.contains(at)))) drawer(null, null, null, true);
        return;
      }
      if (!hpTile || e.target !== hpTile) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleDrawer('hp', null, hpTile); }
    });

    buildStrip();
    document.documentElement.classList.add('dnd-live-active');
    paint();
    store.hydrate(function (remote) {
      state = fit(remote, data);
      undo = null;
      paint();
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
