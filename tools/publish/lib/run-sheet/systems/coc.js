'use strict';
// Call of Cthulhu 7e (and the Regency variant) for the run sheet: a foe's HP, MP, SAN and DEX from any of the five
// block shapes real vaults use (step 6b Task 3), and its combat figures (Task 16). No rules text ships; the two sums
// are the only rules here, and `rules.coc`'s numbers are data with their page cites.
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
  // the combat figures (Task 16): `Fighting (Brawl) 40`, `Brawl 40%`, `Firearms (Handgun) 30`, `Dodge 20%`
  fighting: /^(?:Fighting|Brawl)$/i, firearms: /^Firearms?$/i, dodge: /^Dodge$/i, attacks: /^(?:Attacks|Attacks per round|Attacks\/round)$/i,
};

// `STR (Strength)` is STR; a key that is no CoC word is null.
function keyOf(raw) {
  const s = clean(raw).replace(/\s*\(.*\)\s*$/, '').replace(/[:.]$/, '').trim();
  for (const [k, re] of Object.entries(ALIASES)) if (re.test(s)) return k;
  return null;
}

// An attack line a block writes with a name of its own (`- Boat hook 45% (22/9), damage 1D6+DB`): its name and skill.
// A firearm's name says so (`Pocket pistol`); any other is Fighting. Dodge and the named skills are pairs' (keyOf).
// The name may hold digits (`.38 Revolver`, `12-gauge shotgun`): it runs to the ` NN%` figure.
const ATTACK_LINE = /^\s*[-*+]\s+(?:\*\*)?([^%*\s][^%]*?)(?:\*\*)?\s+(\d{1,3})\s*%.*\bdamage\b/i;
const FIREARM = /\b(?:firearms?|handgun|pistol|revolver|rifle|shotgun|carbine|smg|submachine|machine[- ]gun|musket|flintlock|blunderbuss|derringer|guns?)\b/i;
function attackLines(stats) {
  const out = { fighting: [], firearms: [] };
  for (const line of String(stats == null ? '' : stats).replace(/\r\n?/g, '\n').split('\n')) {
    const m = ATTACK_LINE.exec(line);
    if (!m || keyOf(m[1])) continue;
    out[FIREARM.test(m[1]) ? 'firearms' : 'fighting'].push(Number(m[2]));
  }
  return out;
}
const highest = (list) => { const ok = list.filter((v) => typeof v === 'number' && Number.isFinite(v)); return ok.length ? Math.max(...ok) : null; };

// A block's numbers: hp, mp and san are maxima; a value that is no number (`not tracked`, `n/a`, a dash) is null.
// Fighting and Firearms are the highest the block writes; DB stays words (`+1D4`).
function readNumbers(stats) {
  const ps = pairs(stats, keyOf);
  const n = (k) => leadingNumber(firstOf(ps, k));
  const all = (k) => ps.filter(([key]) => key === k).map(([, v]) => leadingNumber(v));
  const lines = attackLines(stats);
  const db = firstOf(ps, 'db');
  const nums = { hp: n('hp'), mp: n('mp'), san: n('san'), dex: n('dex'), luck: n('luck'), armour: null,
    str: n('str'), con: n('con'), siz: n('siz'), pow: n('pow'), int: n('int'),
    fighting: highest(all('fighting').concat(lines.fighting)), firearms: highest(all('firearms').concat(lines.firearms)),
    dodge: n('dodge'), db: db === null ? null : (clean(db).replace(/\s*[·|].*$/, '') || null), build: n('build'), attacks: leadingNumber(String(firstOf(ps, 'attacks') || '').replace(/^per round\s*:?\s*/i, '')), from: {} };
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

// The combat figures a PC's sheet writes (Task 16), only those it has: Fighting and Firearms its highest
// specialisations, Dodge, Build and the damage bonus from the Combat table.
const COMBAT_KEYS = ['fighting', 'firearms', 'dodge', 'db', 'build', 'attacks'];
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));
const combatOfNums = (nums) => Object.fromEntries(COMBAT_KEYS.map((k) => [k, nums[k]]));
function sheetCombat(model) {
  const skills = Array.isArray(model.skills) ? model.skills : [];
  const of = (re) => highest(skills.filter((s) => re.test(String(s.name || ''))).map((s) => num(s.reg)));
  const c = model.combat || {};
  return present({
    fighting: of(/^(?:Fighting\b|Brawl$)/i), firearms: of(/^Firearms?\b/i), dodge: of(/^Dodge$/i),
    build: leadingNumber(c.build), db: c.db ? clean(c.db) : null,
  });
}

// CON and INT from the sheet's characteristics, only those it writes (Task 18's cards show them; a PC's roll is the
// player's, so they are shown, never rolled).
const sheetChars = (model) => {
  const c = (model && model.chars) || {};
  return present({ con: c.CON ? num(c.CON.reg) : null, int: c.INT ? num(c.INT.reg) : null });
};

function readPc({ body, fm }) {
  try {
    const text = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
    // the sheet's own skills only (no built-in list), so a figure is one the sheet writes
    const model = parseCoC(fm || {}, extractSections(text), 'coc-7e', { skillList: false });
    const live = buildCoCLiveData(model, { campaignId: 'run-sheet', pcSlug: 'run-sheet' });
    const d = (live && live.hp && num(live.hp.max) !== null) ? live : null;
    if (d) {
      const now = (o) => (num(o.cur) !== null ? o.cur : (num(o.max) !== null ? o.max : null));
      return { numbers: { ...NONE, hpMax: d.hp.max, hpNow: now(d.hp), mpMax: num(d.mp.max), mpNow: now(d.mp),
        sanMax: num(d.san.max), sanNow: now(d.san), luck: num(d.luck.cur), dex: num(d.dex), ...sheetCombat(model), ...sheetChars(model) } };
    }
    const block = statSection(text);
    const nums = readNumbers(`${block ? block.md : ''}\n${statusBlock(text)}`);
    if (nums.hp === null) return { numbers: { ...NONE }, note: NO_HP };
    return { numbers: { ...NONE, hpNow: nums.hp, hpMax: nums.hp, mpNow: nums.mp, mpMax: nums.mp, sanNow: nums.san, sanMax: nums.san,
      luck: nums.luck, dex: nums.dex, ...present(combatOfNums(nums)), ...present({ con: nums.con, int: nums.int }) }, note: 'numbers from a one-line sheet (current = max)' };
  } catch (e) {
    return { numbers: { ...NONE }, note: `the sheet could not be read: ${firstLine(e)}` };
  }
}

// The cards a hit and a SAN loss raise (Task 18), read by coc-math's cocCardForHit, cocCardsAtRoundEnd and sanCard and
// by the card actions Task 13 built for GURPS. Names, figures and page cites only: death over max HP (KR p119, p120);
// the Major Wound, Prone and its CON roll (KR p119, p120); Unconscious and Dying at 0 HP, Dying's CON rolls (KR p120);
// stabilising (KR p120, p65); the INT roll (KR p155); the bout's rounds (KR p156) and its tables (KR p157).
const COC_CARDS = {
  status: { major: 'Major wound', dying: 'Dying' },
  // the lines' names on the cards and in the log
  lines: { dead: 'Over max HP', dying: '0 HP, Major wound', unconscious: '0 HP', major: 'Major wound', dyingCon: 'Dying', int: 'SAN loss' },
  stats: { con: 'CON', int: 'INT' },
  offers: {
    dead: { label: 'Out (dead)', out: true, ends: true },
    dying: { label: 'Dying, Unconscious', add: ['Dying', 'Unconscious'], ends: true },
    unconscious: { label: 'Unconscious', add: ['Unconscious'], ends: true },
    // the Major Wound's roll folds Prone in: a PC's Passed or Failed tap takes it in the same tap (`tap`)
    prone: { label: 'Prone', add: ['Prone'], tap: true },
    proneOut: { label: 'Prone, Unconscious', add: ['Prone', 'Unconscious'], ends: true, tap: true },
    // the bout's rounds are the Keeper's 1D10, rolled by the server when it is taken
    insane: { label: 'Temporary insanity', add: ['Temporary insanity'], bout: true },
    stabilised: { label: 'Stabilised', remove: ['Dying'] },
  },
  bout: { sides: 10 },
  // what a card names besides its lines: the bout's tables stay in the book
  notes: { int: 'bout tables: KR p157' },
};

// Placeholders until later tasks fill them in: `vitals`, `wounding`, `consequences`, `defences`,
// `manoeuvres` keep D&D's shape (CoC-safe empties where D&D words would show).
function describeCoc(id) {
  const r = describeAs(id, id === 'coc-7e' ? 'Call of Cthulhu 7e' : SYSTEM_NAMES[id], true);
  // the order is DEX, plus 50 with a firearm ready (KR p409); HP never below 0 (KR p120); the entry box's pools:
  // MP never below 0 (KR p386), SAN never above 99 (KR p155, less Cthulhu Mythos, which the row does not hold)
  // melee (Task 16): the tie winners by response (KR p103), the outnumbered die (KR p108), the Prone die on a melee
  // attack (KR p128), the dice cap (KR p91, p407); Fight Back first on an NPC's or creature's row [CCx]. Tasks 17-19
  // add to it.
  const coc = {
    tie: { dodge: 'defender', fightBack: 'attacker' },
    outnumbered: { bonus: 1 },
    prone: { status: 'Prone', meleeBonus: 1 },
    // the same cap as lib/dice rollPercent's net of bonus and penalty dice (KR p91, p407): change both together
    maxDice: 2,
    defaultResponse: 'fightBack',
    // what a hit and a SAN loss owe, as cards of prompts (Task 18): names and figures only. The card's numbers are
    // `prompts` below; a line rolls the row's `stat`; each offer adds or removes statuses by name.
    cards: COC_CARDS,
  };
  // a Major Wound is a hit of at least max HP over `majorWoundAt` (KR p119, p120); a SAN loss of `insanityAt` or more
  // in one entry asks for the INT roll (KR p155)
  const fight = {
    initiative: 'dex', initDecimals: 0, hpFloor: 0, autoOut: false, firearmBonus: 50, coc,
    prompts: { majorWoundAt: 2, insanityAt: 5 },
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
    entryInvalid: 'Type -7 or 7 (damage), 1D6+DB (dice), +3 (healing), m-2 (MP) or s-5 (SAN)',
    gun: 'gun', gunTitle: `Firearm ready: +${fight.firearmBonus} to DEX for the order`,
    // the melee exchange on the target's row (Task 16): a hint in our words, beside the buttons
    buildHint: 'Manoeuvre: compare Builds',
  };
  return r;
}

// The row's own fields: initiative is DEX.
const foeRow = (n) => ({ init: n.dex, mp: n.mp, mpMax: n.mp, san: n.san, sanMax: n.san, dex: n.dex, con: n.con, int: n.int, armour: n.armour, from: n.from,
  fighting: n.fighting, firearms: n.firearms, dodge: n.dodge, db: n.db, build: n.build, attacks: n.attacks });

const make = (id) => ({ ...dnd, id, fights: true, readFoe, readPc, foeRow, stockNoActions: undefined, describe: () => describeCoc(id) });

module.exports = { coc: make('coc-7e'), cocRegency: make('coc-7e-regency'), readNumbers, keyOf, lacks };
