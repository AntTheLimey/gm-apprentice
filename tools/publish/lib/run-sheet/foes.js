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
  const ac = number(/\bAC[ \t*:]*(\d+)/.exec(stats));
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

function inspect(notePath, index) {
  if (!notePath || !index.notes().includes(notePath)) return null;
  const note = index.read(notePath);
  const fm = note.fm || {};
  if (!FOE_TYPES.has(String(fm.type || '').toLowerCase())) return null;
  const stats = index.gmSection(notePath, 'Stats');
  if (!stats) return null;
  const name = String(fm.name || path.posix.basename(notePath, '.md'));
  return { name, stats, behaviour: index.gmSection(notePath, 'Behaviour'), treasure: index.gmSection(notePath, 'Treasure') };
}

function warnFor(notePath, name, nums, seen, warnings) {
  const add = (kind, text) => {
    const k = JSON.stringify([kind, notePath, text]);
    if (seen.has(k)) return;
    seen.add(k);
    warnings.push({ kind, note: notePath, text });
  };
  if (nums.ac === null && nums.hp === null) add('no-numbers', `${name} names a stat block with no numbers in the vault: fill them in prep`);
  if (nums.init === null) add('no-initiative', `${name} has no initiative modifier in its Stats (rolled at +0)`);
}

function build(notePath, index, count, beatKey, seen) {
  const info = inspect(notePath, index);
  if (!info) return { foes: [], warnings: [], info: null };
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  const nums = readNumbers(info.stats, info.behaviour);
  const warnings = [];
  warnFor(notePath, info.name, nums, seen, warnings);
  const keys = itemKeys(beatKey, 'foe', Array(n).fill(notePath));
  const foes = keys.map((key, i) => ({
    key, note: notePath, name: n > 1 ? `${info.name} ${i + 1}` : info.name,
    ally: nums.ally, ac: nums.ac, hp: nums.hp, init: nums.init,
    legendaryResistance: nums.legendaryResistance, legendaryActions: nums.legendaryActions,
    recharge: nums.recharge, lair: nums.lair, stats: info.stats,
  }));
  return { foes, warnings, info };
}

// One note's foes, `count` of them. Exported for the Fight's Add (step 5).
function foesOf(notePath, index, count = 1, beatKey, seen = new Set()) {
  const { foes, warnings } = build(notePath, index, count, beatKey, seen);
  return { foes, warnings };
}

// Every `who` entry of a beat, planned or contingency. `seen` carries one Plan's warnings across beats.
function foesFor(beat, index, seen = new Set()) {
  const foes = [];
  const warnings = [];
  const texts = [];
  const doneNotes = new Set();
  for (const w of beat.who || []) {
    const r = build(w.note, index, w.count, beat.key, seen);
    foes.push(...r.foes);
    warnings.push(...r.warnings);
    if (!r.info || doneNotes.has(w.note)) continue;
    doneNotes.add(w.note);
    for (const b of bullets(r.info.treasure)) texts.push({ text: b.text, box: b.box });
  }
  // Loot keys follow the beat's own so the same words keep one key apiece.
  const own = (beat.treasure || []).map((t) => t.text);
  const fresh = texts.filter((t) => !own.includes(t.text));
  const keys = itemKeys(beat.key, 'loot', [...own, ...fresh.map((t) => t.text)]).slice(own.length);
  const treasure = fresh.map((t, i) => ({ key: keys[i], text: t.text, box: t.box }));
  return { foes, treasure, warnings };
}

module.exports = { foesOf, foesFor };
