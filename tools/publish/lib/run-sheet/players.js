'use strict';
// The players' view (plan 5b §6.8, decisions 5-12): everything the players' window is ever sent, built on
// the server from the model and the state. It is a whitelist: each object below is made key by key, and a
// key not written here is a bug (the leak test checks keys). Nothing from the GM page passes through.
//
// Names come from the notes alone: a note's own `name`, the withheld word, or the note's unmasked name after
// Unmask. Never Plan text, never a file's stem (a disguised NPC's file may be named for who he really is),
// never words the state carries: a fight row's unseen word and whether it is a PC are the model's too
// (Review L1). A note the model does not hold, or of the wrong kind, is dropped.
//
// A row's side is the row's, as the GM has it now (plan 6a, review P1): the running fight's row, then the
// side the GM set (`state.sides`), then one carried from an earlier session, then the reader's. An ally goes
// up with its name and HP only once it is seen; an ally not seen, a foe and a neutral send exactly a foe's
// keys, so the players' screen never tells a neutral from a foe and the reader never puts a name there by
// itself (an ally it infers starts unseen). A withheld note still shows only its withheld word.
// The GM page is the trusted author of fight rows (`kind` and `seen` included); the server's Origin check
// on the actions route is the boundary (review M6).
// Pictures go out as opaque ids (`picId(path)`); the server maps an id back to a file.
//
// The one place the state's own words reach the players (plan 6a Task 7 / Global Constraints (typed place)):
// a place the GM typed tonight in Move them goes up as its plain name, the panel's caption, and as nothing
// else. A known place a group moves to, or that Fight here puts behind a panel, is a note like any other.

const FM = require('./web/fight-math');
const { statusesOf } = require('./web/fight');
const { groupsOf } = require('./web/show');

const PERSON = new Set(['npc', 'creature', 'pc']);
const GM_SUFFIX = /\s*\(GM\)\s*$/i;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const stemOf = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '');

function layoutOf(n) {
  if (n === 0) return 'none';
  if (n === 1) return 'n1';
  if (n === 2) return 'n2';
  if (n <= 4) return 'n4';
  if (n <= 6) return 'n6';
  if (n <= 8) return 'n8';
  return 'n9';
}

// forPlayers(model, state, { withheldWords, campaign, picId }) -> PlayersView
function forPlayers(model, state, { withheldWords, campaign, picId } = {}) {
  const st = state || {};
  const words = withheldWords || model.withheldWords || {};
  const personWord = String(words.person || '');
  const notes = model.notes || {};
  const cast = new Map((model.cast || []).map((c) => [c.note, c]));
  const picOf = (p) => (typeof p === 'string' && p && typeof picId === 'function' ? `/players/pic/${picId(p)}` : null);

  // A note as the model holds it: its own entry, else the cast's (a person brought in from outside the Plan).
  const infoOf = (note) => (typeof note === 'string' && has(notes, note) ? notes[note] : cast.get(note) || null);
  // Unmasked: the state's word when it has one, else an unmasking carried from an earlier session.
  const unmasked = (note, info) => {
    if (!info || !info.unmask) return false;
    const u = has(st.unmask, note) ? st.unmask[note] : null;
    return u ? Boolean(u.on) : Boolean(info.unmask.since);
  };

  // A person as the players may see them, or null when the note is not a person the model holds.
  // `known` is false when the name is the withheld word.
  function person(note) {
    const info = infoOf(note);
    if (!info || !PERSON.has(String(info.type || '').toLowerCase())) return null;
    if (unmasked(note, info)) return { name: String(info.unmask.name || personWord), pic: picOf(info.unmask.portrait), known: Boolean(info.unmask.name) };
    if (info.withheld) return { name: personWord, pic: null, known: false };
    if (!info.named) return { name: personWord, pic: picOf(info.portrait), known: false };
    return { name: info.name, pic: picOf(info.portrait), known: true };
  }

  // A showable map: one the player site publishes, never the GM half of a pair.
  const gmMaps = new Set((model.mapPairs || []).map((x) => x.gm));
  const showableMap = (note) => (model.showableMaps || []).includes(note) && !gmMaps.has(note) && !GM_SUFFIX.test(stemOf(note));
  // The night's place beats (plan 6a Task 7): a known place's note, or a place typed tonight, by beat key.
  const improvised = new Map((Array.isArray(st.improvised) ? st.improvised : []).filter((i) => i && typeof i === 'object' && typeof i.key === 'string').map((i) => [i.key, i]));
  // A place typed tonight: its plain name as the caption, no picture.
  function typedPlace(key) {
    const i = typeof key === 'string' ? improvised.get(key) : null;
    const name = i && i.newPlace === true && typeof i.title === 'string' ? i.title.replace(/\s+/g, ' ').trim() : '';
    return name ? { backdrop: null, caption: name } : null;
  }
  // A backdrop: a place, a place typed tonight, or a map that may be shown; null for anything else.
  function backdrop(note) {
    if (typeof note !== 'string' || !note) return null;
    const typed = typedPlace(note);
    if (typed) return typed;
    let info = null;
    if (showableMap(note)) info = (model.mapNotes || {})[note] || null;
    else {
      // a place the Plan names, else any place in the vault a group can be moved to (plan 6a Task 7)
      const n = has(notes, note) ? notes[note] : (has(model.placeNotes, note) ? model.placeNotes[note] : null);
      // a map reaches the screen only as a showable map: a GM half typed `location` is no place. A place need not
      // publish: a backdrop is only ever set by the GM's own act (Move them, Fight here, Show), and that act is
      // the reveal (Ant, Task 7 fix round 1); wrap-up then offers to publish it from the Table Log
      if (n && n.docType !== 'map' && String(n.type || '').toLowerCase() === 'location') info = n;
    }
    if (!info) return null;
    return { backdrop: picOf(info.portrait), caption: info.withheld || !info.named ? null : info.name };
  }

  // A PC's name: the first word of its note's own name, else of the party's.
  const pcs = new Map((model.pcs || []).map((p) => [p.note, p]));
  function pcName(note, fallback) {
    const info = infoOf(note);
    const p = pcs.get(note);
    return firstWord(info && info.named ? info.name : (p ? p.name : fallback));
  }
  function pcOut(note) {
    const p = pcs.get(note) || {};
    const info = infoOf(note);
    return { name: pcName(note, ''), pic: picOf((info && info.portrait) || p.portrait) };
  }

  const beats = new Map((model.beats || []).map((b) => [b.key, b]));
  // the notes the model makes allies: a beat's ally, or a cast entry's (one brought in); the last word on a
  // row whose own side cannot be read
  const allies = new Set((model.beats || []).flatMap((b) => (b.foes || []).filter((x) => x && x.ally).map((x) => x.note))
    .concat((model.cast || []).filter((c) => c.foe && c.foe.ally).map((c) => c.note)));
  const sideOf = (r) => FM.sideOfRow(r) || FM.noteSide(st.sides, model.sidesCarried, r.note, allies.has(r.note)).side;
  // A group's own place: its Plan beat's (or hub spot's) place, else its place beat's (plan 6a Task 7, review
  // P3): a known place's note, or the key of a place typed tonight.
  function placeOf(g) {
    const b = beats.get(g.beat);
    if (!b) {
      const i = improvised.get(g.beat);
      if (!i) return null;
      if (typeof i.place === 'string' && i.place) return i.place;
      return i.newPlace === true ? i.key : null;
    }
    const spot = g.spot ? (b.spots || []).find((x) => x.key === g.spot) : null;
    return (spot && spot.note) || b.place || null;
  }

  const order = orderOf();

  const groups = groupsOf(model, st);
  // every group holding a ticked PC shows the order, not only the groups the fight was started with (proof M2)
  const fightGroups = order ? FM.fightGroupKeys(st.fight, groups) : [];
  const panels = groups.map((g, i) => {
    const asked = (st.panels && st.panels[g.key]) || {};
    let back = { backdrop: null, caption: null };
    const own = () => (asked.placeOff ? null : backdrop(placeOf(g)));
    if (typeof asked.backdrop === 'string' && asked.backdrop) {
      const shown = backdrop(asked.backdrop);
      // a Shown place with no picture keeps the group's own place behind the panel, captioned as its own; the
      // place a fight is at (Fight here) and a place typed tonight have no picture to defer to: their name shows
      const fightAt = st.fight && st.fight.backdrop && st.fight.backdrop.group === g.key ? st.fight.backdrop.place : null;
      if (shown && shown.backdrop === null && !typedPlace(asked.backdrop) && asked.backdrop !== fightAt) back = own() || back;
      else back = shown || back;
    } else back = own() || back;
    const seenPeople = new Set();
    const people = [];
    for (const note of Array.isArray(asked.people) ? asked.people : []) {
      if (seenPeople.has(note)) continue;
      seenPeople.add(note);
      const p = person(note);
      if (p) people.push({ name: p.name, pic: p.pic });
    }
    const fighting = order && fightGroups.includes(g.key);
    return {
      id: `p${i + 1}`,
      pcs: g.pcs.map(pcOut),
      people,
      backdrop: back.backdrop,
      caption: back.caption,
      order: fighting ? { round: order.round, paused: order.paused, rows: order.rows.map((r) => ({ ...r, ...(r.statuses ? { statuses: r.statuses.slice() } : {}) })) } : null,
    };
  });

  return { campaign: String(campaign || model.campaign || ''), layout: layoutOf(panels.length), panels };

  // The running fight's order as the players know it (decision 7): ticked rows only, in the GM's order.
  function orderOf() {
    const f = st.fight;
    if (!f || typeof f !== 'object' || !Array.isArray(f.rows)) return null;
    // Bloodied is D&D's condition: a system whose words give none ('') shows none, and a model without words keeps D&D's
    const bloodiedWord = FM.bloodiedWord(model.rules && model.rules.words);
    // a PC and the unseen word as the model has them, never as the row says; an ally by the row's side, once
    // seen (an unseen ally is numbered and named as a foe is)
    const kindOf = (r) => {
      if (r.kind === 'lair') return 'lair';
      const info = infoOf(r.note);
      if (pcs.has(r.note) || (info && String(info.type || '').toLowerCase() === 'pc')) return 'pc';
      return sideOf(r) === 'ally' && r.seen === true ? 'ally' : 'foe';
    };
    const wordOf = (r) => {
      const c = cast.get(r.note);
      const n = has(notes, r.note) ? notes[r.note] : null;
      return (c && c.unseenAs) || (n && n.unseenAs) || personWord;
    };
    const rowsIn = f.rows.filter((r) => r && typeof r === 'object').map((r) => ({ ...r, kind: kindOf(r) }));
    // a number is fixed under the row's own word; one that disagrees with the model's word (or repeats) is
    // dropped, and every foe is numbered again by the model's word in the stored order
    const wordKey = FM.unseenKey;
    const taken = new Set();
    const clash = rowsIn.some((r) => {
      if (r.kind !== 'foe' || r.unseenN === null || r.unseenN === undefined) return false;
      const key = `${wordKey(wordOf(r))}#${r.unseenN}`;
      const bad = wordKey(r.word) !== wordKey(wordOf(r)) || taken.has(key);
      taken.add(key);
      return bad;
    });
    const unseen = FM.unseenLabels(clash ? rowsIn.map((r) => (r.kind === 'foe' ? { ...r, unseenN: null } : r)) : rowsIn, wordOf);
    const ticked = rowsIn.filter((r) => r.in);
    const copiesIn = (note) => ticked.filter((x) => x.note === note && x.kind !== 'pc').length;
    const withCopy = (name, r) => (r.copy && copiesIn(r.note) > 1 ? `${name} ${r.copy}` : name);
    const rows = ticked.map((r) => {
      const base = { ini: isNum(r.ini) ? r.ini : null, current: r.id === f.turn, out: Boolean(r.out) };
      if (r.kind === 'lair') return { name: 'Lair', ...base, lair: true };
      if (r.kind === 'foe') {
        const p = r.seen ? person(r.note) : null;
        const name = p && p.known ? withCopy(p.name, r) : (unseen.get(r.id) || personWord);
        return { name, ...base, lair: false };
      }
      let name;
      if (r.kind === 'pc') name = pcName(r.note, personWord);
      else {
        const p = person(r.note);
        name = p && p.known ? withCopy(p.name, r) : personWord;
      }
      const hp = isNum(r.hp) ? `${r.hp}${isNum(r.max) ? `/${r.max}` : ''}${r.temp > 0 ? ` +${r.temp}` : ''}` : null;
      const statuses = statusesOf({ conds: Array.isArray(r.conds) ? r.conds : [], exhaustion: r.exhaustion, conc: r.conc }).map(String)
        .concat(bloodiedWord && FM.isBloodied(r) ? [bloodiedWord] : []);
      return { name, ...base, lair: false, hp, statuses };
    });
    return { round: f.started && isNum(f.round) ? f.round : null, paused: Boolean(f.paused), rows };
  }
}

module.exports = { forPlayers, layoutOf };
