'use strict';
// D&D 5e (2024) for the run sheet: how a foe's `### Stats` and a PC's sheet are read, and what the page and the
// fight need to know (`describe()`, plain data). Moved here unchanged from foes.js and party.js (step 6b Task 1).
// No rules text ships, so the prototype's SRD recharge table is not ported.

const path = require('node:path');
const { SIGNED_SOURCE, toNumber } = require('../signed');
const { tableRows } = require('../plan-text');
const { SYSTEM_NAMES } = require('../../shared-lists');
const FM = require('../web/fight-math');
const { statSection, currentOf } = require('./stat-section');

const FOE_TYPES = new Set(['npc', 'creature']);

const number = (m) => (m ? toNumber(m[1]) : null);

// The bullet list under the line that holds `Lair Actions`, as written (dedented, so it renders as a list): the
// consecutive bullet lines after that line, indented or not. '' when the line has no list.
const BULLET = /^([ \t]*)[-*+][ \t]+\S/;
function lairActionsOf(stats) {
  const lines = String(stats).split('\n');
  for (let at = 0; at < lines.length; at++) {
    if (!/Lair Actions/i.test(lines[at])) continue;
    const list = [];
    for (let i = at + 1; i < lines.length && BULLET.test(lines[i]); i++) list.push(lines[i]);
    if (!list.length) continue;
    const indent = Math.min(...list.map((l) => BULLET.exec(l)[1].length));
    return list.map((l) => l.slice(indent)).join('\n');
  }
  return '';
}

const BOLD_CHARGE = /\*\*\*([^*]+?)\s*\(Recharge (\d+(?:\s*[–-]\s*\d+)?)\)/g;

// Only a number AFTER the HP / Hit Points word counts ("regains 10 HP" and "DC 14" are not figures).
function readNumbers(stats, behaviour) {
  const ac = number(/\b(?:AC|Armor Class)[ \t*:]*(\d+)/.exec(stats));
  // The last HP figure stated wins: a session's tuning is written after the stock block.
  const hps = [...stats.matchAll(/\b(?:HP|Hit Points)[ \t*:]*(\d+)/g)];
  const hp = hps.length ? Number(hps[hps.length - 1][1]) : null;
  const init = number(new RegExp(`Initiative[^\\d\\n]{0,3}(${SIGNED_SOURCE})`).exec(stats));
  const full = `${stats}\n${behaviour}`;
  // A declaration with no number (`(Recharge -)`, a draft) is no recharge.
  const charges = [...full.matchAll(BOLD_CHARGE)];
  // The plain form of a one-line block, `Frost Breath (Recharge 6)`: the name is the run of capitalised words
  // before the bracket, small joining words kept (`Breath of Frost`). The bold form wins a name it already gave.
  const plain = [...full.replace(BOLD_CHARGE, ' ').matchAll(/((?:[A-Z][\w'’-]*)(?:[ \t]+(?:(?:of|the|and|in|on|from|to|at|with|a|an)[ \t]+)*[A-Z][\w'’-]*)*)[ \t]*\(Recharge (\d+(?:\s*[–-]\s*\d+)?)\)/g)]
    .map((m) => [null, m[1], m[2]]);
  const all = [...charges, ...plain];
  const recharge = [...new Set(all.map((m) => m[1].trim()))].sort();
  // The lowest roll that recharges each: `(Recharge 5–6)` is 5, `(Recharge 6)` is 6. The first of a name counts.
  const rechargeAt = {};
  for (const m of all) {
    const name = m[1].trim();
    if (!(name in rechargeAt)) rechargeAt[name] = Math.min(...m[2].match(/\d+/g).map(Number));
  }
  return {
    ac, hp, init,
    // `(2/Day)`, or SRD 5.2.1's `(3/Day, or 4/Day in Lair)`: the first count (the in-lair use is the GM's)
    legendaryResistance: number(/Legendary Resistance \((\d+)\/Day[^)\n]*\)/i.exec(stats)) || 0,
    // `Legendary Actions (3)`, or SRD 5.2.1's `Legendary Action Uses: 3 (4 in Lair)`
    legendaryActions: number(/Legendary Actions \((\d+)\)/i.exec(stats)) || number(/Legendary Action Uses\W{0,6}(\d+)/i.exec(stats)) || 0,
    recharge, rechargeAt,
    lair: /Lair Actions/i.test(stats),
    lairActions: lairActionsOf(stats),
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

// A note's name as the fight row shows it: its frontmatter `name`, else its file name.
const nameOf = (notePath, fm) => String(fm.name || path.posix.basename(notePath, '.md'));

// A note's stat block and its numbers: `stats` '' when it has none (only an NPC or a creature has one), and then
// `nums` null. `text` is the note's body (frontmatter stripped), which the stat section finder reads; `hpStart` is the HP the block says it
// starts at (`HP 10 (currently 4)`), null when it says none.
function readFoe({ notePath, index, text }) {
  const fm = index.read(notePath).fm || {};
  const type = String(fm.type || '').toLowerCase();
  const found = FOE_TYPES.has(type) ? statSection(text == null ? index.read(notePath).body : text) : null;
  if (!found || !found.md) return { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null };
  const stats = found.md;
  const nums = readNumbers(stats, index.gmSection(notePath, 'Behaviour'));
  return { stats, statsHeading: found.heading, nums, lacks: lacks(nameOf(notePath, fm), nums), hpStart: currentOf(stats) };
}

// Whether a block names a stock stat block and holds no action of its own (the `stock-no-actions` warning).
const stockNoActions = (stats) => STOCK_NAMED.test(stats) && !HAS_ACTION.test(stats);

const numberFrom = (cell, signed) => {
  const t = String(cell || '').trim();
  if (signed && new RegExp(`^(?:${SIGNED_SOURCE}|\\d+)(?:\\.\\d+)?$`).test(t)) return toNumber(t);
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
};

function statsOf(body) {
  const rows = tableRows(body);
  const pick = (label, signed) => {
    for (const r of rows) {
      if (r[0] !== label) continue;
      const n = numberFrom(r[1], signed);
      if (n !== null) return n;
    }
    return null;
  };
  return { ac: pick('AC'), hpMax: pick('HP (Max)'), hpNow: pick('HP (Current)'), init: pick('Initiative', true) };
}

// A PC's numbers from its sheet's table rows.
const readPc = ({ body }) => ({ numbers: statsOf(body) });

// What the run sheet needs to know about D&D, as plain data (model.rules). `fight` is the reducer's part,
// cut here so the page only copies it into `fightStart` (fight-math.js holds it, so the page and the
// reducer share one copy: FM.DND_FIGHT_RULES).
function describeAs(id, label, fights) {
  const f = JSON.parse(JSON.stringify(FM.DND_FIGHT_RULES));
  return {
    id, family: 'dnd', label, fights,
    ...f,
    toggles: {
      half: true, resisted: true, temp: true, deathSaves: true, concentration: true, exhaustion: true, counters: true, longRest: true,
      gun: false, hitChips: false, defences: false, manoeuvres: false,
    },
    statuses: FM.DND_STATUSES.slice(),
    // the acting panel's counters, and the row's own numbers, as the page draws them today
    panelBoxes: ['legendaryResistance', 'legendaryActions', 'recharge', 'lairActions'],
    rowNumbers: ['ini', 'hp', 'max', 'ac'],
    words: {
      hp: 'HP', ac: 'AC', temp: 'temp HP', initiative: 'initiative', bloodied: 'Bloodied',
      entryPlaceholder: '-37/+8/t5',
      entryInvalid: 'Type -37 or 37 (damage), +8 (healing) or t5 (temp HP)',
      longRest: 'Long rest: everyone to full',
      advancement: 'One line each, e.g. level 6 for the dragon (milestone)',
    },
    // the end panel's vitals columns (Task 16 moves them to the ontology)
    vitals: ['hp', 'max', 'conditions'],
    fight: JSON.parse(JSON.stringify(f)),
  };
}

const DND_ID = 'dnd-5e-2024';
const dnd = {
  id: DND_ID,
  fights: true,
  readFoe,
  readPc,
  // the system's own fields on a foe's row, beyond the shared ones: D&D adds none
  foeRow: () => ({}),
  stockNoActions,
  describe: () => describeAs(DND_ID, SYSTEM_NAMES[DND_ID], true),
};

module.exports = { dnd, describeAs, readNumbers, lacks, lairActionsOf, statsOf, STOCK_NAMED, HAS_ACTION };
