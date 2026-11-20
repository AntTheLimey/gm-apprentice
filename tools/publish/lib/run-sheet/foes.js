'use strict';
// Foes: the fight rows. Name, AC, HP, initiative and boss counters are read from a note's
// `### Stats` (the block itself is kept as written). Works with what it has: a foe whose stat
// block lacks numbers is still a foe, with null numbers and a warning; nothing here throws.
// No rules text ships, so the prototype's SRD recharge table is not ported.

const path = require('node:path');
const { itemKeys } = require('./keys');
const { SIGNED_SOURCE, toNumber } = require('./signed');
const { bullets } = require('./plan-text');

const FOE_TYPES = new Set(['npc', 'creature']);

const number = (m) => (m ? toNumber(m[1]) : null);

// Only a number AFTER the HP / Hit Points word counts ("regains 10 HP" and "DC 14" are not figures).
function readNumbers(stats, behaviour) {
  const ac = number(/\b(?:AC|Armor Class)[ \t*:]*(\d+)/.exec(stats));
  // The last HP figure stated wins: a session's tuning is written after the stock block.
  const hps = [...stats.matchAll(/\b(?:HP|Hit Points)[ \t*:]*(\d+)/g)];
  const hp = hps.length ? Number(hps[hps.length - 1][1]) : null;
  const init = number(new RegExp(`Initiative[^\\d\\n]{0,3}(${SIGNED_SOURCE})`).exec(stats));
  const full = `${stats}\n${behaviour}`;
  // A declaration with no number (`(Recharge -)`, a draft) is no recharge.
  const charges = [...full.matchAll(/\*\*\*([^*]+?)\s*\(Recharge (\d+(?:\s*[–-]\s*\d+)?)\)/g)];
  const recharge = [...new Set(charges.map((m) => m[1].trim()))].sort();
  // The lowest roll that recharges each: `(Recharge 5–6)` is 5, `(Recharge 6)` is 6. The first of a name counts.
  const rechargeAt = {};
  for (const m of charges) {
    const name = m[1].trim();
    if (!(name in rechargeAt)) rechargeAt[name] = Math.min(...m[2].match(/\d+/g).map(Number));
  }
  return {
    ac, hp, init,
    legendaryResistance: number(/Legendary Resistance \((\d+)\/Day\)/i.exec(stats)) || 0,
    legendaryActions: number(/Legendary Actions \((\d+)\)/i.exec(stats)) || 0,
    recharge, rechargeAt,
    lair: /Lair Actions/i.test(stats),
    ally: /\bas an ally\b/.test(stats),
  };
}

// What a note gives a fight row: null for a note the index lacks; `stats` '' when it has none.
function inspect(notePath, index) {
  if (!index.has(notePath)) return null;
  const fm = index.read(notePath).fm || {};
  const type = String(fm.type || '').toLowerCase();
  const name = String(fm.name || path.posix.basename(notePath, '.md'));
  const stats = FOE_TYPES.has(type) ? index.gmSection(notePath, 'Stats') : '';
  return { name, type, stats, behaviour: stats ? index.gmSection(notePath, 'Behaviour') : '', treasure: stats ? index.gmSection(notePath, 'Treasure') : '' };
}

function warner(seen, warnings) {
  return (kind, notePath, text) => {
    const k = JSON.stringify([kind, notePath, text]);
    if (seen.has(k)) return;
    seen.add(k);
    warnings.push({ kind, note: notePath, text });
  };
}

// What a block's numbers lack, as [{ kind, text }]. A block with no numbers at all says so once; its
// missing initiative is part of that.
function lacks(name, nums) {
  if (nums.ac === null && nums.hp === null) {
    return [{ kind: 'no-numbers', text: `${name} names a stat block with no numbers in the vault: fill them in prep` }];
  }
  const out = [];
  if (nums.ac === null) out.push({ kind: 'no-ac', text: `${name} has no AC in its Stats: fill it in prep` });
  if (nums.hp === null) out.push({ kind: 'no-hp', text: `${name} has no hit points in its Stats: fill them in prep` });
  if (nums.init === null) out.push({ kind: 'no-initiative', text: `${name} has no initiative modifier in its Stats (rolled at +0)` });
  return out;
}

// A `### Stats` that names a stock block (SRD or stock) and holds no action of its own.
const STOCK_NAMED = /\b(?:SRD|stock)\b/i;
const HAS_ACTION = /^[ \t]*(?:[-*+][ \t]+)?[*_]*Actions\b|Hit:|Attack Roll|to hit/im;

// One who entry read for a fight: its note's numbers and how many, or null when it makes no foe. A
// creature with no Stats, or any entry counted more than once with none, is a fight the sheet
// cannot run: it warns `no-stats`. An NPC listed once with no Stats is a social NPC: no warning.
// `canFight` is false for a beat that cannot fight (see beatCanFight): the numbers it lacks then go
// into the row's `prepNote` instead of a warning, for the Fight to say when it is wanted (5b).
function entry(notePath, index, count, add, canFight = true) {
  const info = inspect(notePath, index);
  if (!info) return null;
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  if (!info.stats) {
    if (info.type === 'creature' || n > 1) {
      add('no-stats', notePath, `${info.name} has no ### Stats under ## GM Notes: no fight row for ${n > 1 ? 'them' : 'it'}`);
    }
    return null;
  }
  const nums = readNumbers(info.stats, info.behaviour);
  const missing = lacks(info.name, nums);
  let prepNote = null;
  if (canFight) missing.forEach((w) => add(w.kind, notePath, w.text));
  else if (missing.length) prepNote = missing.map((w) => w.text).join('; ');
  if (STOCK_NAMED.test(info.stats) && !HAS_ACTION.test(info.stats)) {
    const text = `${info.name} names a stock stat block but no actions are in the vault: fill them in prep (gma stat-fill)`;
    if (canFight) add('stock-no-actions', notePath, text);
    else prepNote = prepNote ? `${prepNote}; ${text}` : text;
  }
  return { notePath, n, info, nums, prepNote };
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
function rows(entries, beatKey, carried = null) {
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
    const got = nums.ally && carried ? carried.of(e.notePath, i) : null;
    const hpNow = got && got.hp !== null ? got.hp : null;
    return {
      key: keys[k++], note: e.notePath, name: total.get(e.notePath) > 1 ? `${info.name} ${i}` : info.name,
      ally: nums.ally, ac: nums.ac, hp: nums.hp, init: nums.init,
      legendaryResistance: nums.legendaryResistance, legendaryActions: nums.legendaryActions,
      recharge: nums.recharge, rechargeAt: nums.rechargeAt, lair: nums.lair, stats: info.stats,
      hpNow, carriedFrom: hpNow === null ? null : got.log, prepNote: e.prepNote,
    };
  }));
}

// One note's foes, `count` of them. Exported for the Fight's Add (step 5).
function foesOf(notePath, index, count = 1, beatKey, seen = new Set(), carried = null) {
  const warnings = [];
  const e = entry(notePath, index, count, warner(seen, warnings));
  return { foes: e ? rows([e], beatKey, carried) : [], warnings };
}

// Every `who` entry of a beat, planned or contingency. `seen` carries one Plan's warnings across beats;
// `carried` is the allies' carried vitals, as `rows` reads them.
function foesFor(beat, index, seen = new Set(), carried = null) {
  const warnings = [];
  const add = warner(seen, warnings);
  const entries = [];
  const texts = [];
  const doneNotes = new Set();
  const canFight = beatCanFight(beat, index);
  for (const w of beat.who || []) {
    const e = entry(w.note, index, w.count, add, canFight);
    if (!e) continue;
    entries.push(e);
    if (doneNotes.has(w.note)) continue;
    doneNotes.add(w.note);
    for (const b of bullets(e.info.treasure)) texts.push({ text: b.text, box: b.box });
  }
  const foes = rows(entries, beat.key, carried);
  // A scene that lists its own treasure stands alone: a note's hoard is the same loot in other words.
  const own = (beat.treasure || []).map((t) => t.text);
  const fresh = own.length ? [] : texts;
  const keys = itemKeys(beat.key, 'loot', fresh.map((t) => t.text));
  const treasure = fresh.map((t, i) => ({ key: keys[i], text: t.text, box: t.box, item: index.itemOf(t.text) }));
  return { foes, treasure, warnings };
}

module.exports = { foesOf, foesFor };
