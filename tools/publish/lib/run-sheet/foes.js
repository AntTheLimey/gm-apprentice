'use strict';
// Foes: the fight rows. A note's stat block and its numbers are read by the vault's system (systems/: D&D's name,
// AC, HP, initiative and boss counters from `### Stats`; the block itself is kept as written). Works with what it
// has: a foe whose stat block lacks numbers is still a foe, with null numbers and a warning; nothing here throws.

const path = require('node:path');
const fate = require('../fate');
const { itemKeys } = require('./keys');
const { bullets, links } = require('./plan-text');
const { startingSide } = require('./sides');
const { systemFor } = require('./systems');
const { lairActionsOf } = require('./systems/dnd');

const DND = systemFor(null);
// The notes that stand for several people at once (beats.js): a counted link to one gives rows.
const GROUP_TYPES = new Set(['faction', 'organization', 'npc_group']);

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

// The note-less numbers of a blank row: nothing to read, so every figure is null for the GM to type.
const BLANK_NUMS = () => ({ ac: null, hp: null, init: null, from: {}, legendaryResistance: 0, legendaryActions: 0, recharge: [], rechargeAt: {}, lair: false, lairActions: lairActionsOf('') });
const NO_NUMBERS = (name) => `${name}: no numbers in the vault: type them in the fight, or fill them in prep`;

// A blank row's entry: no stat block, so no numbers, for a fight beat the GM types them into (S6-D7). `label` is
// what its rows are called; `notePath` is null for a line with no note. `benched` rows start unticked (D4).
function blankEntry(notePath, label, type, n, side, benched) {
  return { notePath, n, info: { name: label, type, stats: '', treasure: '' }, nums: BLANK_NUMS(), hpStart: null, fpStart: null, prepNote: null, side, benched };
}

// One who entry read for a fight: its note's numbers and how many, or null when it makes no foe. A
// creature with no Stats, or any entry counted more than once with none, warns `no-stats`; so does an
// entry for a beat that `blank`s its statless entries (`blank` is `{ label }`, the name a group note's
// rows go by, or null), which gives them rows with blank numbers instead of none: a creature or counted
// entry ticked in, a single statless NPC benched with no warning. Any other single entry with no Stats is a
// social one: no row, no warning.
// `canFight` is false for a beat that cannot fight (see beatCanFight): the numbers it lacks then go
// into the row's `prepNote` instead of a warning, for the Fight to say when it is wanted (5b).
function entry(notePath, index, count, add, canFight = true, sides = null, whoText = null, system = DND, blank = null) {
  const info = inspect(notePath, index, system);
  if (!info) return null;
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  if (!info.stats) {
    const crowd = info.type === 'creature' || n > 1;
    const label = blank && GROUP_TYPES.has(info.type) && blank.label ? blank.label : info.name;
    // `blank` false is a beat that makes no row for this one (the dead): nothing to type into, so no warning
    if (crowd && blank !== false) add('no-stats', notePath, NO_NUMBERS(label));
    if (!blank || !(crowd || info.type === 'npc')) return null;
    return blankEntry(notePath, label, info.type, crowd ? n : 1, sideOf(notePath, index, sides, whoText, ''), !crowd);
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
  return { notePath, n, info, nums, hpStart: info.read.hpStart ?? null, fpStart: info.read.fpStart ?? null, prepNote, side: sideOf(notePath, index, sides, whoText, info.stats) };
}

// Can this beat fight: its Type is combat, fight, battle or ambush, or it is a contingency, or its who holds a
// creature or a count above 1. A beat with no type (no field, or an empty one) can.
function beatCanFight(beat, index) {
  if (beat.type === undefined || beat.type === null || !String(beat.type).trim() || beat.contingency) return true;
  if (/\b(?:combat|fight|battle|ambush)\b/.test(String(beat.type))) return true;
  return (beat.who || []).some((w) => (w.count || 1) > 1 || (w.note && index.has(w.note) && String((index.read(w.note).fm || {}).type || '').toLowerCase() === 'creature'));
}

// The fight rows for a list of entries, keyed together so no two share a key, and numbered per
// note across the list (two lines of one creature give `Wolf 1` to `Wolf 5`). An ally starts from
// `carried` (the reader's `{ of(note) }`: `{ hp, log }` from the latest Table Log naming the ally,
// or null) when it has a figure: `hpNow` is that figure and `carriedFrom` the log; `hp` stays the
// note's. A foe never carries, and an ally with no figure has both null. An ally's carried MP, SAN or FP
// (step 6b) is `mpNow`, `sanNow` or `fpNow`, on the row only when carried and the row has that pool.
function rows(entries, beatKey, carried = null, system = DND) {
  const idOf = (e) => e.notePath || `name:${e.info.name}`;
  const paths = entries.flatMap((e) => Array(e.n).fill(idOf(e)));
  const keys = itemKeys(beatKey, 'foe', paths);
  const total = new Map();
  for (const p of paths) total.set(p, (total.get(p) || 0) + 1);
  const at = new Map();
  let k = 0;
  return entries.flatMap((e) => Array.from({ length: e.n }, () => {
    const i = (at.get(idOf(e)) || 0) + 1;
    at.set(idOf(e), i);
    const { info, nums } = e;
    const got = e.side.ally && carried && e.notePath ? carried.of(e.notePath, i) : null;
    const hpNow = got && got.hp !== null ? got.hp : null;
    return {
      key: keys[k++], note: e.notePath || null, name: total.get(idOf(e)) > 1 ? `${info.name} ${i}` : info.name,
      ally: e.side.ally, allyFrom: e.side.allyFrom, allyBy: e.side.allyBy, ac: nums.ac, hp: nums.hp, init: nums.init,
      legendaryResistance: nums.legendaryResistance, legendaryActions: nums.legendaryActions,
      recharge: nums.recharge, rechargeAt: nums.rechargeAt, lair: nums.lair, lairActions: nums.lairActions, stats: info.stats,
      ...system.foeRow(nums),
      hpNow, carriedFrom: hpNow === null ? null : got.log, prepNote: e.prepNote, hpStart: e.hpStart,
      ...carriedPools(got, system.foeRow(nums)),
      ...(e.fpStart == null ? {} : { fpStart: e.fpStart }),
      ...(e.benched ? { benched: true } : {}),
    };
  }));
}

// The pools an ally carried from an earlier Table Log, for those its row holds: { mpNow, sanNow, fpNow }.
function carriedPools(got, row) {
  const out = {};
  if (!got) return out;
  for (const k of ['mp', 'san', 'fp']) if (typeof got[k] === 'number' && row[k] !== undefined && row[k] !== null) out[`${k}Now`] = got[k];
  return out;
}

// One note's foes, `count` of them. Exported for the Fight's Add (step 5).
function foesOf(notePath, index, count = 1, beatKey, seen = new Set(), carried = null, sides = null, system = DND) {
  const warnings = [];
  const e = entry(notePath, index, count, warner(seen, warnings), true, sides, null, system);
  return { foes: e ? rows([e], beatKey, carried, system) : [], warnings };
}

// A line with no note: counted (`Foam-covered guards x4`), blank rows named and numbered by the line's words, which
// are all there is to read its side from; single (`The shikarri`), one benched row with no warning, as D4 gives a
// statless NPC.
function noteless(w, whoText, sides, add) {
  const label = w.name;
  const single = !(w.count > 1);
  if (!single) add('no-stats', null, NO_NUMBERS(label));
  const side = startingSide({ whoText, quickRefText: '', statsText: '', fm: {}, partyNotes: ((sides || {}).partyNotes) || [], resolve: null });
  return blankEntry(null, label, '', single ? 1 : w.count, side, single);
}

// Every `who` entry of a beat, planned or contingency. `seen` carries one Plan's warnings across beats;
// `carried` is the allies' carried vitals, as `rows` reads them.
// `others` is every beat of the Plan: a contingency's Then links skip people a planned beat already lists.
function foesFor(beat, index, seen = new Set(), carried = null, sides = null, system = DND, others = []) {
  const warnings = [];
  const add = warner(seen, warnings);
  const entries = [];
  const texts = [];
  const doneNotes = new Set();
  const canFight = beatCanFight(beat, index);
  for (const w of beat.who || []) {
    const wants = `${w.wants || ''} ${w.knownAs || ''}`.trim();
    // a fight beat's statless entries get blank rows: a group note's rows go by the line's own words
    // (the dead are bodies, never fighters: they get none)
    const blank = canFight ? (w.dead ? false : { label: w.knownAs && w.knownAs !== w.name ? w.knownAs : '' }) : null;
    const e = w.note ? entry(w.note, index, w.count, add, canFight, sides, wants, system, blank)
      : canFight && !w.dead ? noteless(w, wants, sides, add) : null;
    if (!e) continue;
    entries.push(e);
    if (doneNotes.has(w.note)) continue;
    doneNotes.add(w.note);
    for (const b of bullets(e.info.treasure)) texts.push({ text: b.text, box: b.box });
  }
  if (!(beat.who || []).length) {
    const kindOf = (p) => (index.has(p) ? String((index.read(p).fm || {}).type || '').toLowerCase() : '');
    // the dead are bodies, never fighters (the who path's rule, lib/fate.js): no row, no warning
    const living = (p) => !fate.isDeadBody(index.read(p).body, index.read(p).fm);
    const people = (paths) => [...new Set(paths)].filter((p) => p && ['npc', 'creature'].includes(kindOf(p)) && living(p));
    if (beat.contingency) {
      // no NPCs block: its Then lines name the people who arrive, so they are ticked, statless ones too (they
      // get a blank row and the warning), minus anyone a planned beat already lists
      const planned = new Set(others.filter((o) => o !== beat && !o.contingency).flatMap((o) => (o.who || []).map((w) => w.note)));
      for (const p of people(links(beat.then || '').map((l) => index.resolve(l))).filter((p) => !planned.has(p))) {
        const e = entry(p, index, 1, add, true, sides, '', system, { label: '' });
        if (!e) continue;
        if (e.benched) { e.benched = false; add('no-stats', p, NO_NUMBERS(e.info.name)); }
        entries.push(e);
      }
      if (entries.length) add('who-from-then', null, `${beat.title}: no NPCs block; its rows come from the people its Then lines link`);
    } else if (canFight) {
      // an older Plan's fight names its people in Entities only: creatures ticked, NPCs benched
      for (const p of people(beat.entities || [])) {
        const e = entry(p, index, 1, add, true, sides, '', system, { label: '' });
        if (!e) continue;
        if (e.info.type === 'npc') e.benched = true;
        entries.push(e);
      }
      if (entries.length) add('who-from-entities', beat.sceneNote || null, `${beat.title}: no NPCs list; the fight rows come from its Entities line (NPCs unticked)`);
    }
  }
  const foes = rows(entries, beat.key, carried, system);
  // A scene that lists its own treasure stands alone: a note's hoard is the same loot in other words.
  const own = (beat.treasure || []).map((t) => t.text);
  const fresh = own.length ? [] : texts;
  const keys = itemKeys(beat.key, 'loot', fresh.map((t) => t.text));
  const treasure = fresh.map((t, i) => ({ key: keys[i], text: t.text, box: t.box, item: index.itemOf(t.text) }));
  return { foes, treasure, warnings };
}

module.exports = { foesOf, foesFor, sideOf, beatCanFight };
