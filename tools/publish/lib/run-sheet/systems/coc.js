'use strict';
// Call of Cthulhu 7e (and the Regency variant) for the run sheet: a foe's HP, MP, SAN and DEX from any of the five
// block shapes real vaults use (step 6b Task 3). No rules text ships; the two sums are the only rules here.
// Fights stay off until Task 7 builds the rows and panel; `describe()` is D&D's shape with CoC's values for
// what is known so far.

const path = require('node:path');
const { SYSTEM_NAMES } = require('../../shared-lists');
const { dnd, describeAs } = require('./dnd');
const { statSection, currentOf } = require('./stat-section');
const { pairs, firstOf, leadingNumber, clean } = require('./pairs');

const FOE_TYPES = new Set(['npc', 'creature']);

const ALIASES = {
  hp: /^(?:HP|Hit Points)$/i, mp: /^(?:MP|Magic Points)$/i, san: /^(?:SAN|Sanity)$/i, dex: /^(?:DEX|Dexterity)$/i,
  luck: /^Luck$/i, armour: /^(?:Armour|Armor)$/i, str: /^(?:STR|Strength)$/i, con: /^(?:CON|Constitution)$/i,
  siz: /^(?:SIZ|Size)$/i, pow: /^(?:POW|Power|Willpower)$/i, mov: /^(?:MOV|Move)$/i, int: /^(?:INT|Intelligence)$/i,
  app: /^(?:APP|Appearance)$/i, edu: /^(?:EDU|Education)$/i, db: /^(?:DB|Damage Bonus)$/i, build: /^Build$/i,
};

// `STR (Strength)` is STR; a key that is no CoC word is null.
function keyOf(raw) {
  const s = clean(raw).replace(/\s*\(.*\)\s*$/, '').replace(/[:.]$/, '').trim();
  for (const [k, re] of Object.entries(ALIASES)) if (re.test(s)) return k;
  return null;
}

// A block's numbers: hp, mp and san are maxima; a value that is no number (`not tracked`, `n/a`, a dash) is null.
function readNumbers(stats) {
  const ps = pairs(stats, keyOf);
  const n = (k) => leadingNumber(firstOf(ps, k));
  const nums = { hp: n('hp'), mp: n('mp'), san: n('san'), dex: n('dex'), luck: n('luck'), armour: null,
    str: n('str'), con: n('con'), siz: n('siz'), pow: n('pow'), from: {} };
  const armour = firstOf(ps, 'armour');
  if (armour) nums.armour = clean(armour).replace(/\s*[·|].*$/, '') || null;
  if (nums.hp === null && nums.con !== null && nums.siz !== null) { nums.hp = Math.floor((nums.con + nums.siz) / 10); nums.from.hp = 'from CON+SIZ'; }
  if (nums.mp === null && nums.pow !== null) { nums.mp = Math.floor(nums.pow / 5); nums.from.mp = 'from POW'; }
  return nums;
}

const hasNumbers = (nums) => ['hp', 'mp', 'san', 'dex', 'luck', 'str', 'con', 'siz', 'pow'].some((k) => nums[k] !== null) || nums.armour !== null;

function lacks(name, nums) {
  if (!hasNumbers(nums)) return [{ kind: 'no-numbers', text: `${name} names a stat block with no numbers in the vault: fill them in prep` }];
  const out = [];
  if (nums.hp === null) out.push({ kind: 'no-hp', text: `${name} has no HP in its stats: type it in the fight, or fill it in prep` });
  if (nums.dex === null) out.push({ kind: 'no-dex', text: `${name} has no DEX: it sorts last until you type it` });
  return out;
}

const nameOf = (notePath, fm) => String(fm.name || path.posix.basename(notePath, '.md'));

function readFoe({ notePath, index, text }) {
  const fm = index.read(notePath).fm || {};
  const type = String(fm.type || '').toLowerCase();
  const found = FOE_TYPES.has(type) ? statSection(text == null ? index.read(notePath).body : text) : null;
  if (!found || !found.md) return { stats: '', statsHeading: null, nums: null, lacks: [], hpStart: null };
  const nums = readNumbers(found.md);
  return { stats: found.md, statsHeading: found.heading, nums, lacks: lacks(nameOf(notePath, fm), nums), hpStart: currentOf(found.md) };
}

// Placeholders until later tasks fill them in: `panelBoxes`, `rowNumbers`, `vitals`, `words`, `statuses`,
// `marks`, `prompts`, `pools`, `wounding`, `consequences`, `defences`, `manoeuvres`, `tiredAt`, `firearmBonus`
// keep D&D's shape (CoC-safe empties where D&D words would show).
function describeCoc(id) {
  const r = describeAs(id, id === 'coc-7e' ? 'Call of Cthulhu 7e' : SYSTEM_NAMES[id], false);
  const fight = { initiative: 'dex', initDecimals: 0, hpFloor: 0, autoOut: false };
  Object.assign(r, { family: 'coc', ...fight });
  Object.assign(r.fight, fight);
  r.toggles = { ...r.toggles, half: false, resisted: false, temp: false, deathSaves: false, concentration: false, exhaustion: false, counters: false, longRest: false };
  r.statuses = [];
  r.panelBoxes = [];
  r.rowNumbers = [];
  r.words = { ...r.words, hp: 'HP', ac: '', temp: '', initiative: 'DEX', longRest: '', advancement: '' };
  return r;
}

// The row's own fields: initiative is DEX.
const foeRow = (n) => ({ init: n.dex, mp: n.mp, mpMax: n.mp, san: n.san, sanMax: n.san, dex: n.dex, armour: n.armour, from: n.from });

const make = (id) => ({ ...dnd, id, fights: false, readFoe, foeRow, stockNoActions: undefined, describe: () => describeCoc(id) });

module.exports = { coc: make('coc-7e'), cocRegency: make('coc-7e-regency'), readNumbers, keyOf, lacks };
