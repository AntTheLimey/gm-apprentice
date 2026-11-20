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
  const recharge = [...new Set([...full.matchAll(/\*\*\*([^*]+?)\s*\(Recharge [0-9–-]+\)/g)].map((m) => m[1].trim()))].sort();
  return {
    ac, hp, init,
    legendaryResistance: number(/Legendary Resistance \((\d+)\/Day\)/i.exec(stats)) || 0,
    legendaryActions: number(/Legendary Actions \((\d+)\)/i.exec(stats)) || 0,
    recharge,
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

function warnFor(notePath, name, nums, add) {
  // A block with no numbers at all says so once; its missing initiative is part of that.
  if (nums.ac === null && nums.hp === null) {
    add('no-numbers', notePath, `${name} names a stat block with no numbers in the vault: fill them in prep`);
    return;
  }
  if (nums.ac === null) add('no-ac', notePath, `${name} has no AC in its Stats: fill it in prep`);
  if (nums.hp === null) add('no-hp', notePath, `${name} has no hit points in its Stats: fill them in prep`);
  if (nums.init === null) add('no-initiative', notePath, `${name} has no initiative modifier in its Stats (rolled at +0)`);
}

// One who entry read for a fight: its note's numbers and how many, or null when it makes no foe. A
// creature with no Stats, or any entry counted more than once with none, is a fight the sheet
// cannot run: it warns `no-stats`. An NPC listed once with no Stats is a social NPC: no warning.
function entry(notePath, index, count, add) {
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
  warnFor(notePath, info.name, nums, add);
  return { notePath, n, info, nums };
}

// The fight rows for a list of entries, keyed together so no two share a key, and numbered per
// note across the list (two lines of one creature give `Wolf 1` to `Wolf 5`). An ally starts from
// `carried` (the previous session's Table Log: `{ log, hp: Map<note path, hit points> }`) when it
// names the ally: `hpNow` is that figure and `carriedFrom` the log; `hp` stays the note's. A foe
// never carries, and an ally the log does not name has both null.
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
    const hpNow = nums.ally && carried && carried.hp.has(e.notePath) ? carried.hp.get(e.notePath) : null;
    return {
      key: keys[k++], note: e.notePath, name: total.get(e.notePath) > 1 ? `${info.name} ${i}` : info.name,
      ally: nums.ally, ac: nums.ac, hp: nums.hp, init: nums.init,
      legendaryResistance: nums.legendaryResistance, legendaryActions: nums.legendaryActions,
      recharge: nums.recharge, lair: nums.lair, stats: info.stats,
      hpNow, carriedFrom: hpNow === null ? null : carried.log,
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
// `carried` is the previous session's Table Log, as `rows` reads it.
function foesFor(beat, index, seen = new Set(), carried = null) {
  const warnings = [];
  const add = warner(seen, warnings);
  const entries = [];
  const texts = [];
  const doneNotes = new Set();
  for (const w of beat.who || []) {
    const e = entry(w.note, index, w.count, add);
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
  const treasure = fresh.map((t, i) => ({ key: keys[i], text: t.text, box: t.box }));
  return { foes, treasure, warnings };
}

module.exports = { foesOf, foesFor };
