'use strict';
// GURPS 4e for the run sheet: a foe's HP, FP, Basic Speed, ST, DX, HT, Dodge and DR from any of the five block
// shapes real vaults use (step 6b Task 4). A block may hold very little (a campaign with no NPC numbers at all), so
// HP comes from ST, FP from HT and Basic Speed from DX and HT when the block lacks them, each marked; the sums live
// once in web/gurps-math.js. Names and numbers only. It fights (Task 7): `describe()` is D&D's shape with
// GURPS's values for what is known so far.

const path = require('node:path');
const { dnd, describeAs } = require('./dnd');
const { statSection } = require('./stat-section');
const { pairs, firstOf, leadingNumber, clean } = require('./pairs');
const { deriveGurps } = require('../web/gurps-math');
const { extractSections } = require('../../processor');
const { parseGurps } = require('../../templates/gurps/parse');
const { buildVitals } = require('../../templates/gurps/live-data');

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
  v = String(v == null ? '' : v).replace(/^\(\s*/, '');
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)/.exec(String(v == null ? '' : v));
  return m ? Number(m[2]) : leadingNumber(v);
}

// A block's numbers: hp and fp are maxima; a value that is no number (`n/a`, a dash) is null.
function readNumbers(stats) {
  const ps = pairs(stats, keyOf);
  const n = (k) => maxOf(firstOf(ps, k));
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

// A PC's numbers come from the same reader the site uses (parseGurps, then buildVitals; the pattern of
// flush/gurps-max.js), so the GM page and the PC's own page agree. Max is in Secondary Characteristics, current in
// Current Status (`**FP:** 10/12`); a missing current reads as the maximum.
const NONE = { hpNow: null, hpMax: null, fpNow: null, fpMax: null, speed: null, dx: null, ht: null };
const NO_POOLS = 'no HP or FP on the sheet: type them in the fight';
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
const figure = (v) => { const n = parseFloat(String(v == null ? '' : v)); return Number.isFinite(n) ? n : null; };

function readPc({ body, fm }) {
  try {
    const model = parseGurps(fm || {}, extractSections(String(body == null ? '' : body).replace(/\r\n?/g, '\n')));
    const v = buildVitals(model);
    if (!v) return { numbers: { ...NONE }, note: NO_POOLS };
    const ht = ((model.attributes || {}).primary || {}).HT;
    return { numbers: { hpNow: v.hp.cur, hpMax: v.hp.max, fpNow: v.fp.cur, fpMax: v.fp.max,
      speed: figure(v.basicSpeed), dx: figure(v.dx), ht: figure(ht && ht.value) } };
  } catch (e) {
    return { numbers: { ...NONE }, note: `the sheet could not be read: ${firstLine(e)}` };
  }
}

// Placeholders until later tasks fill them in: `vitals`, `prompts`, `wounding`, `consequences`, `defences`,
// `manoeuvres`, `firearmBonus` keep D&D's shape (GURPS-safe empties where D&D words would show).
function describeGurps(id) {
  const r = describeAs(id, 'GURPS 4e', true);
  // The order is Basic Speed, set at the start (B363); HP goes below 0. Marks are names and numbers for
  // fight-math's marksOf: Reeling (B419) by `part` of max HP, 0 or less (B419), and the minus-HP lines (B419)
  // by `times` max HP. Tired (B426) by `part` of max FP; FP's floor (B426) by `floorTimes` its max.
  const fight = {
    initiative: 'speed', initDecimals: 2, orderFixed: true, hpFloor: null, autoOut: false,
    marks: [
      { key: 'reeling', name: 'Reeling', part: 3 },
      { key: 'zero', name: '0 or less', atMost: 0, log: 'HP 0 or less' },
      ...[1, 2, 3, 4, 5].map((n) => ({ key: `minus${n}`, name: `\u2212${n}\u00d7HP`, times: n })),
    ],
    tiredAt: { name: 'Tired', part: 3 },
    pools: [{ key: 'fp', prefix: 'f', label: 'FP', max: 'fpMax', floorTimes: -1 }],
  };
  Object.assign(r, { family: 'gurps', ...JSON.parse(JSON.stringify(fight)) });
  Object.assign(r.fight, fight);
  r.toggles = { ...r.toggles, half: false, resisted: false, temp: false, deathSaves: false, concentration: false, exhaustion: false, counters: false, longRest: false };
  // Reeling and Shock are marks, set by the fight itself, so neither is in the list
  r.statuses = ['Stunned', 'Prone', 'Kneeling', 'Unconscious', 'Mortal wound'];
  // the acting panel's boxes, in Tab order (the one list, Task 7 [P-C19]); `readout` ones are shown beside HP too.
  // HP max and FP max are on the row.
  r.panelBoxes = [
    { key: 'st', label: 'ST' }, { key: 'ht', label: 'HT' }, { key: 'dx', label: 'DX' }, { key: 'speed', label: 'Speed', readout: true },
    { key: 'dodge', label: 'Dodge', readout: true }, { key: 'parry', label: 'Parry' }, { key: 'block', label: 'Block' }, { key: 'dr', label: 'DR' },
  ];
  // the row's own figures: initiative (Basic Speed), HP now/[max], FP now/[max]
  r.rowNumbers = ['ini', 'hp', 'max', 'fp', 'fpMax'];
  r.words = {
    ...r.words, hp: 'HP', ac: '', temp: '', initiative: 'Basic Speed', initBox: 'Spd', longRest: '', advancement: '', bloodied: '', noBlock: '',
    entryPlaceholder: '-7 / +3 / f-2',
    entryInvalid: 'Type -7 or 7 (damage), +3 (healing) or f-2 (FP)',
  };
  return r;
}

// The row's own fields: initiative is Basic Speed.
const foeRow = (n) => ({ init: n.speed, fp: n.fp, fpMax: n.fp, speed: n.speed, dx: n.dx, st: n.st, ht: n.ht, dodge: n.dodge, dr: n.dr, from: n.from });

const gurps = { ...dnd, id: 'gurps-4e', fights: true, readFoe, readPc, foeRow, stockNoActions: undefined, describe: () => describeGurps('gurps-4e') };

module.exports = { gurps, readNumbers, keyOf, lacks };
