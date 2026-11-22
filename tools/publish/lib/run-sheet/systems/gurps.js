'use strict';
// GURPS 4e for the run sheet: a foe's HP, FP, Basic Speed, ST, DX, HT, Dodge and DR from any of the five block
// shapes real vaults use (step 6b Task 4). A block may hold very little (a campaign with no NPC numbers at all), so
// HP comes from ST, FP from HT and Basic Speed from DX and HT when the block lacks them, each marked; the sums live
// once in web/gurps-math.js. Names and numbers only. Fights stay off until Task 7; `describe()` is D&D's shape
// with GURPS's values for what is known so far.

const path = require('node:path');
const { dnd, describeAs } = require('./dnd');
const { statSection } = require('./stat-section');
const { pairs, firstOf, leadingNumber, clean } = require('./pairs');
const { deriveGurps } = require('../web/gurps-math');

const FOE_TYPES = new Set(['npc', 'creature']);

// The attribute names are exact (a lower-case `st` is a word); the rest ignore case.
const ALIASES = {
  st: /^ST$/, dx: /^DX$/, iq: /^IQ$/, ht: /^HT$/, dr: /^DR$/,
  hp: /^(?:HP|Hit Points)$/i, fp: /^(?:FP|Fatigue Points)$/i, speed: /^(?:Basic Speed|Speed)$/i,
  move: /^(?:Basic Move|Move)$/i, dodge: /^Dodge$/i, will: /^Will$/i, per: /^Per$/i,
};

// `ST (Strength)` is ST; a key that is no GURPS word is null.
function keyOf(raw) {
  const s = clean(raw).replace(/\s*\(.*\)\s*$/, '').replace(/[:.]$/, '').trim();
  for (const [k, re] of Object.entries(ALIASES)) if (re.test(s)) return k;
  return null;
}

// A pool figure: the maximum, whether written `9`, `6/9` (current over maximum) or `10 (currently 4)`.
function maxOf(v) {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)/.exec(String(v == null ? '' : v));
  return m ? Number(m[2]) : leadingNumber(v);
}

// A block's numbers: hp and fp are maxima; a value that is no number (`n/a`, a dash) is null.
function readNumbers(stats) {
  const ps = pairs(stats, keyOf);
  const n = (k) => leadingNumber(firstOf(ps, k));
  const nums = { hp: maxOf(firstOf(ps, 'hp')), fp: maxOf(firstOf(ps, 'fp')), speed: n('speed'), dx: n('dx'), st: n('st'), ht: n('ht'),
    dodge: n('dodge'), dr: null, from: {} };
  const dr = clean(firstOf(ps, 'dr') || '');
  if (dr && !/^[-–—]+$/.test(dr)) nums.dr = dr;
  const d = deriveGurps(nums, { max: nums.hp !== null, fpMax: nums.fp !== null, speed: nums.speed !== null });
  if (d.max !== undefined) nums.hp = d.max;
  if (d.fpMax !== undefined) nums.fp = d.fpMax;
  if (d.speed !== undefined) nums.speed = d.speed;
  nums.from = d.from;
  return nums;
}

const hasNumbers = (nums) => ['hp', 'fp', 'speed', 'dx', 'st', 'ht', 'dodge'].some((k) => nums[k] !== null) || nums.dr !== null;

function lacks(name, nums) {
  if (!hasNumbers(nums)) return [{ kind: 'no-numbers', text: `${name} names a stat block with no numbers in the vault: type ST, HT and DX in the fight, or fill them in prep` }];
  const out = [];
  if (nums.hp === null) out.push({ kind: 'no-hp', text: `${name} has no HP in its stats: type it in the fight, or fill it in prep` });
  if (nums.speed === null) out.push({ kind: 'no-speed', text: `${name} has no Basic Speed: it sorts last until you type it or DX and HT` });
  return out;
}

// The current figure a block states for a pool (`FP 7/10`, `FP 10 (currently 4)`), the last written, or null.
function currentOf(md, word) {
  const text = String(md == null ? '' : md);
  const found = [];
  for (const m of text.matchAll(new RegExp(String.raw`\b${word}[ \t*:]*\d+[ \t*]*\(\s*currently[ \t]+(\d+)\s*\)`, 'gi'))) found.push([m.index, Number(m[1])]);
  for (const m of text.matchAll(new RegExp(String.raw`\b${word}[ \t*:]*(\d+)[ \t]*/[ \t]*\d+`, 'gi'))) found.push([m.index, Number(m[1])]);
  if (!found.length) return null;
  found.sort((a, b) => a[0] - b[0]);
  return found[found.length - 1][1];
}

const nameOf = (notePath, fm) => String(fm.name || path.posix.basename(notePath, '.md'));

function readFoe({ notePath, index, text }) {
  const fm = index.read(notePath).fm || {};
  const type = String(fm.type || '').toLowerCase();
  const found = FOE_TYPES.has(type) ? statSection(text == null ? index.read(notePath).body : text) : null;
  if (!found || !found.md) return { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null, fpStart: null };
  const nums = readNumbers(found.md);
  return {
    stats: found.md, statsHeading: found.heading, nums, lacks: lacks(nameOf(notePath, fm), nums),
    hpStart: currentOf(found.md, '(?:HP|Hit Points)'), fpStart: currentOf(found.md, '(?:FP|Fatigue Points)'),
  };
}

// Placeholders until later tasks fill them in: `panelBoxes`, `rowNumbers`, `vitals`, `words`, `statuses`, `marks`,
// `prompts`, `pools`, `wounding`, `consequences`, `defences`, `manoeuvres`, `tiredAt`, `firearmBonus` keep D&D's
// shape (GURPS-safe empties where D&D words would show).
function describeGurps(id) {
  const r = describeAs(id, 'GURPS 4e', false);
  const fight = { initiative: 'speed', initDecimals: 2, orderFixed: true, hpFloor: null, autoOut: false };
  Object.assign(r, { family: 'gurps', ...fight });
  Object.assign(r.fight, fight);
  r.toggles = { ...r.toggles, half: false, resisted: false, temp: false, deathSaves: false, concentration: false, exhaustion: false, counters: false, longRest: false };
  r.statuses = [];
  r.panelBoxes = [];
  r.rowNumbers = [];
  r.words = { ...r.words, hp: 'HP', ac: '', temp: '', initiative: 'Basic Speed', longRest: '', advancement: '' };
  return r;
}

// The row's own fields: initiative is Basic Speed.
const foeRow = (n) => ({ init: n.speed, fp: n.fp, fpMax: n.fp, speed: n.speed, dx: n.dx, st: n.st, ht: n.ht, dodge: n.dodge, dr: n.dr, from: n.from });

const gurps = { ...dnd, id: 'gurps-4e', fights: false, readFoe, foeRow, stockNoActions: undefined, describe: () => describeGurps('gurps-4e') };

module.exports = { gurps, readNumbers, keyOf, lacks };
