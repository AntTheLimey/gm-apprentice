'use strict';
// Foes: the fight rows. A note's stat block and its numbers are read by the vault's system (systems/: D&D's name,
// AC, HP, initiative and boss counters from `### Stats`; the block itself is kept as written). Works with what it
// has: a foe whose stat block lacks numbers is still a foe, with null numbers and a warning; nothing here throws.

const path = require('node:path');
const { itemKeys } = require('./keys');
const { bullets } = require('./plan-text');
const { startingSide } = require('./sides');
const { systemFor } = require('./systems');

const DND = systemFor(null);

// What a note gives a fight row: null for a note the index lacks; `stats` '' when it has none. The system reads the
// stat block and its numbers (`readFoe`), so the place a block is found is one place.
function inspect(notePath, index, system = DND) {
  if (!index.has(notePath)) return null;
  const note = index.read(notePath);
  const fm = note.fm || {};
  const type = String(fm.type || '').toLowerCase();
  const name = String(fm.name || path.posix.basename(notePath, '.md'));
  const read = system.readFoe({ notePath, index, text: note.body });
  const stats = read.stats;
  return { name, type, stats, read, treasure: stats ? index.gmSection(notePath, 'Treasure') : '' };
}

// The starting side of a note (sides.js), from its own frontmatter and stats and the Plan's context:
// `sides` is `{ quickRef: Map(note -> the Quick Reference row's words), partyNotes }`, or null for none.
// `whoText` is what the row's own who line says about it ('' when it says nothing: that is its word); null when
// the row has no who line of its own (a row added in the fight, a cast entry), which then reads every beat's who
// lines about the note (`sides.who`).
function sideOf(notePath, index, sides, whoText = null, statsText = '') {
  const ctx = sides || {};
  return startingSide({
    whoText: whoText !== null ? whoText : (ctx.who && ctx.who.get(notePath)) || '', statsText,
    quickRefText: (ctx.quickRef && ctx.quickRef.get(notePath)) || '',
    fm: index.read(notePath).fm || {},
    partyNotes: ctx.partyNotes || [],
    resolve: (t) => index.resolve(t),
  });
}

function warner(seen, warnings) {
  return (kind, notePath, text) => {
    const k = JSON.stringify([kind, notePath, text]);
    if (seen.has(k)) return;
    seen.add(k);
    warnings.push({ kind, note: notePath, text });
  };
}

// One who entry read for a fight: its note's numbers and how many, or null when it makes no foe. A
// creature with no Stats, or any entry counted more than once with none, is a fight the sheet
// cannot run: it warns `no-stats`. An NPC listed once with no Stats is a social NPC: no warning.
// `canFight` is false for a beat that cannot fight (see beatCanFight): the numbers it lacks then go
// into the row's `prepNote` instead of a warning, for the Fight to say when it is wanted (5b).
function entry(notePath, index, count, add, canFight = true, sides = null, whoText = null, system = DND) {
  const info = inspect(notePath, index, system);
  if (!info) return null;
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  if (!info.stats) {
    if (info.type === 'creature' || n > 1) {
      add('no-stats', notePath, `${info.name} has no ### Stats under ## GM Notes: no fight row for ${n > 1 ? 'them' : 'it'}`);
    }
    return null;
  }
  const { nums, lacks: missing } = info.read;
  let prepNote = null;
  if (canFight) missing.forEach((w) => add(w.kind, notePath, w.text));
  else if (missing.length) prepNote = missing.map((w) => w.text).join('; ');
  if (system.stockNoActions && system.stockNoActions(info.stats)) {
    const text = `${info.name} names a stock stat block but no actions are in the vault: fill them in prep (gma stat-fill)`;
    if (canFight) add('stock-no-actions', notePath, text);
    else prepNote = prepNote ? `${prepNote}; ${text}` : text;
  }
  return { notePath, n, info, nums, hpStart: info.read.hpStart ?? null, prepNote, side: sideOf(notePath, index, sides, whoText, info.stats) };
}

// Can this beat fight: its Type is combat, fight, battle or ambush, or it is a contingency, or its who holds a
// creature or a count above 1. A beat with no `type` field (one built by hand) can.
function beatCanFight(beat, index) {
  if (beat.type === undefined || beat.contingency) return true;
  if (/\b(?:combat|fight|battle|ambush)\b/.test(beat.type)) return true;
  return (beat.who || []).some((w) => (w.count || 1) > 1 || (w.note && index.has(w.note) && String((index.read(w.note).fm || {}).type || '').toLowerCase() === 'creature'));
}

// The fight rows for a list of entries, keyed together so no two share a key, and numbered per
// note across the list (two lines of one creature give `Wolf 1` to `Wolf 5`). An ally starts from
// `carried` (the reader's `{ of(note) }`: `{ hp, log }` from the latest Table Log naming the ally,
// or null) when it has a figure: `hpNow` is that figure and `carriedFrom` the log; `hp` stays the
// note's. A foe never carries, and an ally with no figure has both null.
function rows(entries, beatKey, carried = null, system = DND) {
  const paths = entries.flatMap((e) => Array(e.n).fill(e.notePath));
  const keys = itemKeys(beatKey, 'foe', paths);
  const total = new Map();
  for (const p of paths) total.set(p, (total.get(p) || 0) + 1);
  const at = new Map();
  let k = 0;
  return entries.flatMap((e) => Array.from({ length: e.n }, () => {
    const i = (at.get(e.notePath) || 0) + 1;
    at.set(e.notePath, i);
    const { info, nums } = e;
    const got = e.side.ally && carried ? carried.of(e.notePath, i) : null;
    const hpNow = got && got.hp !== null ? got.hp : null;
    return {
      key: keys[k++], note: e.notePath, name: total.get(e.notePath) > 1 ? `${info.name} ${i}` : info.name,
      ally: e.side.ally, allyFrom: e.side.allyFrom, allyBy: e.side.allyBy, ac: nums.ac, hp: nums.hp, init: nums.init,
      legendaryResistance: nums.legendaryResistance, legendaryActions: nums.legendaryActions,
      recharge: nums.recharge, rechargeAt: nums.rechargeAt, lair: nums.lair, lairActions: nums.lairActions, stats: info.stats,
      ...system.foeRow(nums),
      hpNow, carriedFrom: hpNow === null ? null : got.log, prepNote: e.prepNote, hpStart: e.hpStart,
    };
  }));
}

// One note's foes, `count` of them. Exported for the Fight's Add (step 5).
function foesOf(notePath, index, count = 1, beatKey, seen = new Set(), carried = null, sides = null, system = DND) {
  const warnings = [];
  const e = entry(notePath, index, count, warner(seen, warnings), true, sides, null, system);
  return { foes: e ? rows([e], beatKey, carried, system) : [], warnings };
}

// Every `who` entry of a beat, planned or contingency. `seen` carries one Plan's warnings across beats;
// `carried` is the allies' carried vitals, as `rows` reads them.
function foesFor(beat, index, seen = new Set(), carried = null, sides = null, system = DND) {
  const warnings = [];
  const add = warner(seen, warnings);
  const entries = [];
  const texts = [];
  const doneNotes = new Set();
  const canFight = beatCanFight(beat, index);
  for (const w of beat.who || []) {
    const e = entry(w.note, index, w.count, add, canFight, sides, `${w.wants || ''} ${w.knownAs || ''}`.trim(), system);
    if (!e) continue;
    entries.push(e);
    if (doneNotes.has(w.note)) continue;
    doneNotes.add(w.note);
    for (const b of bullets(e.info.treasure)) texts.push({ text: b.text, box: b.box });
  }
  const foes = rows(entries, beat.key, carried, system);
  // A scene that lists its own treasure stands alone: a note's hoard is the same loot in other words.
  const own = (beat.treasure || []).map((t) => t.text);
  const fresh = own.length ? [] : texts;
  const keys = itemKeys(beat.key, 'loot', fresh.map((t) => t.text));
  const treasure = fresh.map((t, i) => ({ key: keys[i], text: t.text, box: t.box, item: index.itemOf(t.text) }));
  return { foes, treasure, warnings };
}

module.exports = { foesOf, foesFor, sideOf };
