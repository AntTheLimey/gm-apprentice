'use strict';
// Call of Cthulhu 7e (and the Regency variant) for the run sheet: a foe's HP, MP, SAN and DEX from any of the five
// block shapes real vaults use (step 6b Task 3). No rules text ships; the two sums are the only rules here.
// It fights (Task 7): `describe()` is D&D's shape with CoC's values for what is known so far.

const path = require('node:path');
const { SYSTEM_NAMES } = require('../../shared-lists');
const { dnd, describeAs } = require('./dnd');
const { statSection, currentOf } = require('./stat-section');
const { pairs, firstOf, leadingNumber, clean } = require('./pairs');
const { extractSections } = require('../../processor');
const { parseCoC } = require('../../templates/coc/parse');
const { buildCoCLiveData } = require('../../templates/coc/live-data');

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

// A PC's numbers come from the same reader the player site uses (parseCoC, then buildCoCLiveData), so the GM page
// and the PC's own page never disagree. An empty Current column reads as the maximum. A sheet with no derived HP
// falls back to the foe reader on its stat block, or on its Current Status line (current = max), with a quiet note.
const NONE = { hpNow: null, hpMax: null, mpNow: null, mpMax: null, sanNow: null, sanMax: null, luck: null, dex: null };
const NO_HP = 'no HP on the sheet: type it in the fight';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

function statusBlock(body) {
  const m = /^#{1,6}[ \t]+Current Status[ \t]*$([\s\S]*?)(?=^#{1,6}[ \t]|(?![\s\S]))/im.exec(body);
  return m ? m[1] : '';
}

function readPc({ body, fm }) {
  try {
    const text = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
    const model = parseCoC(fm || {}, extractSections(text), 'coc-7e');
    const live = buildCoCLiveData(model, { campaignId: 'run-sheet', pcSlug: 'run-sheet' });
    const d = (live && live.hp && num(live.hp.max) !== null) ? live : null;
    if (d) {
      const now = (o) => (num(o.cur) !== null ? o.cur : (num(o.max) !== null ? o.max : null));
      return { numbers: { ...NONE, hpMax: d.hp.max, hpNow: now(d.hp), mpMax: num(d.mp.max), mpNow: now(d.mp),
        sanMax: num(d.san.max), sanNow: now(d.san), luck: num(d.luck.cur), dex: num(d.dex) } };
    }
    const block = statSection(text);
    const nums = readNumbers(`${block ? block.md : ''}\n${statusBlock(text)}`);
    if (nums.hp === null) return { numbers: { ...NONE }, note: NO_HP };
    return { numbers: { ...NONE, hpNow: nums.hp, hpMax: nums.hp, mpNow: nums.mp, mpMax: nums.mp, sanNow: nums.san, sanMax: nums.san,
      luck: nums.luck, dex: nums.dex }, note: 'numbers from a one-line sheet (current = max)' };
  } catch (e) {
    return { numbers: { ...NONE }, note: `the sheet could not be read: ${firstLine(e)}` };
  }
}

// Placeholders until later tasks fill them in: `vitals`, `prompts`, `wounding`, `consequences`, `defences`,
// `manoeuvres` keep D&D's shape (CoC-safe empties where D&D words would show).
function describeCoc(id) {
  const r = describeAs(id, id === 'coc-7e' ? 'Call of Cthulhu 7e' : SYSTEM_NAMES[id], true);
  // the order is DEX, plus 50 with a firearm ready (KR p409); HP never below 0 (KR p120); the entry box's pools:
  // MP never below 0 (KR p386), SAN never above 99 (KR p155, less Cthulhu Mythos, which the row does not hold)
  const fight = {
    initiative: 'dex', initDecimals: 0, hpFloor: 0, autoOut: false, firearmBonus: 50,
    pools: [
      { key: 'mp', prefix: 'm', label: 'MP', max: 'mpMax', floor: 0 },
      { key: 'san', prefix: 's', label: 'SAN', max: 'sanMax', floor: 0, cap: 99 },
    ],
  };
  Object.assign(r, { family: 'coc', ...JSON.parse(JSON.stringify(fight)) });
  Object.assign(r.fight, fight);
  r.toggles = { ...r.toggles, half: false, resisted: false, temp: false, deathSaves: false, concentration: false, exhaustion: false, counters: false, longRest: false, gun: true };
  r.statuses = ['Major wound', 'Prone', 'Unconscious', 'Dying', 'Temporary insanity', 'Indefinite insanity'];
  // the acting panel's boxes, in Tab order (the one list, Task 7 [P-C19]); `readout` ones are shown beside HP too
  r.panelBoxes = [
    { key: 'dex', label: 'DEX', readout: true }, { key: 'mp', label: 'MP' }, { key: 'san', label: 'SAN' },
    { key: 'fighting', label: 'Fighting' }, { key: 'firearms', label: 'Firearms' }, { key: 'dodge', label: 'Dodge' },
    { key: 'db', label: 'DB' }, { key: 'armour', label: 'Armour' }, { key: 'build', label: 'Build' }, { key: 'attacks', label: 'Attacks' },
  ];
  // the row's own figures: initiative, HP now/[max], MP and SAN as read-outs
  r.rowNumbers = ['ini', 'hp', 'max', 'mp', 'san'];
  r.words = {
    ...r.words, hp: 'HP', ac: '', temp: '', initiative: 'DEX', initBox: 'DEX', longRest: '', advancement: '', bloodied: '', noBlock: '',
    entryPlaceholder: '-7 / +3 / m-2 / s-5',
    entryInvalid: 'Type -7 or 7 (damage), +3 (healing), m-2 (MP) or s-5 (SAN)',
    gun: 'gun', gunTitle: `Firearm ready: +${fight.firearmBonus} to DEX for the order`,
  };
  return r;
}

// The row's own fields: initiative is DEX.
const foeRow = (n) => ({ init: n.dex, mp: n.mp, mpMax: n.mp, san: n.san, sanMax: n.san, dex: n.dex, armour: n.armour, from: n.from });

const make = (id) => ({ ...dnd, id, fights: true, readFoe, readPc, foeRow, stockNoActions: undefined, describe: () => describeCoc(id) });

module.exports = { coc: make('coc-7e'), cocRegency: make('coc-7e-regency'), readNumbers, keyOf, lacks };
