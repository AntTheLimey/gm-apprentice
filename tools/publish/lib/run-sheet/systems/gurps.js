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
const { deriveGurps, drFigure } = require('../web/gurps-math');
const { extractSections } = require('../../processor');
const { parseGurps } = require('../../templates/gurps/parse');
const { buildVitals } = require('../../templates/gurps/live-data');
const { sections } = require('../plan-text');

const FOE_TYPES = new Set(['npc', 'creature']);

// The wounding table (Task 12), names and numbers only. Fields: `types` (B379); per location `by`, `all`, `except`,
// `only`, `dr`, `face`, `sided`, `cripple`, `cap` (B398, B420, B552).
const PIERCING = ['pi-', 'pi', 'pi+', 'pi++'];
const each = (keys, v) => Object.fromEntries(keys.map((k) => [k, v]));
const LIMB_DOWN = { 'pi+': 1, 'pi++': 1, imp: 1 }; // B552
const WOUNDING = {
  types: { 'pi-': 0.5, pi: 1, 'pi+': 1.5, 'pi++': 2, cut: 1.5, imp: 2, cr: 1, burn: 1, tbb: 1, cor: 1, tox: 1, fat: 1 }, // B379
  // the long names and one-letter forms a GM types (`tbb` is tight-beam burning)
  typeWords: {
    c: 'cr', i: 'imp', p: 'pi', b: 'burn', t: 'tox', f: 'fat', crushing: 'cr', cutting: 'cut', impaling: 'imp',
    piercing: 'pi', burning: 'burn', corrosion: 'cor', toxic: 'tox', fatigue: 'fat',
  },
  locations: {
    torso: {}, // B398
    vitals: { by: { ...each(PIERCING, 3), imp: 3, tbb: 2 }, only: true }, // B398, B552
    eye: { by: { ...each(PIERCING, 4), imp: 4, tbb: 4 }, only: true, face: true, cripple: 10, sided: true }, // B398, B552
    skull: { all: 4, except: ['tox'], dr: 2 }, // B398, B552
    face: { by: { cor: 1.5 }, face: true }, // B398, B552
    neck: { by: { cut: 2, cr: 1.5, cor: 1.5 } }, // B398, B552
    groin: {}, // B398, B552
    arm: { by: LIMB_DOWN, cripple: 2, cap: true, sided: true }, // B398, B552; the cap B420
    leg: { by: LIMB_DOWN, cripple: 2, cap: true, sided: true }, // B398, B552; the cap B420
    hand: { by: LIMB_DOWN, cripple: 3, cap: true, sided: true }, // B398, B552; the cap B420
    foot: { by: LIMB_DOWN, cripple: 3, cap: true, sided: true }, // B398, B552; the cap B420
  },
  locationWords: {
    v: 'vitals', sk: 'skull', head: 'skull', e: 'eye', eyes: 'eye', n: 'neck', t: 'torso', g: 'groin', a: 'arm', arms: 'arm',
    l: 'leg', legs: 'leg', h: 'hand', hands: 'hand', ft: 'foot', feet: 'foot',
  },
  sides: ['left', 'right'],
  // the chips' order before any is used on a row
  typeChips: ['cr', 'cut', 'imp', 'pi-', 'pi', 'pi+', 'pi++', 'burn', 'tbb', 'cor', 'tox', 'fat'],
  locationChips: ['torso', 'vitals', 'skull', 'face', 'eye', 'neck', 'groin', 'arm', 'leg', 'hand', 'foot'],
};

// What a hit and a turn's start and end owe (Task 13), names and numbers only, read by gurps-math's cardForHit,
// cardsAtTurnStart and cardsAtTurnEnd. The page offers each as a prompt; nothing here decides an outcome.
const CONSEQUENCES = {
  shock: { cap: 4, bigHp: 20, per: 10 }, // B419
  major: 2, // B420; a crippled place counts too, B420, B421
  knockdown: {
    places: ['skull', 'face', 'eye', 'vitals'], // B420
    major: { face: -5, vitals: -5, groin: -5, skull: -10, eye: -10 }, // B420
    out: 5, // B420
  },
  death: [1, 2, 3, 4], // B419
  dead: 5, // B419
  mortal: 2, // B423
  // the names on the cards and in the log
  lines: { death: 'Death check', dead: 'dead', knockdown: 'Knockdown', conscious: 'HT to stay conscious', recover: 'HT to recover' },
  offers: {
    mortal: { label: 'Mortal wound', add: ['Mortal wound'] },
    dead: { label: 'Out (dead)', out: true, ends: true },
    stunned: { label: 'Stunned and Prone', add: ['Stunned', 'Prone'] },
    unconscious: { label: 'Unconscious', add: ['Unconscious'], ends: true },
    recover: { label: 'clear Stunned', remove: ['Stunned'] },
  },
  mortalStatus: 'Mortal wound',
  stunned: 'Stunned',
  unconscious: 'Unconscious',
};

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

// `face 0`, `face open`, `open face`, `bare face`, `face bare`, `face unarmoured`, on the DR's own line
const FACE_BARE = /\bface\s*(?::\s*)?(?:0\b|open\b|bare\b|none\b|unarmou?red\b)|\b(?:open|bare)[ -]face/i;

// A block's numbers: hp and fp are maxima; a value that is no number (`n/a`, a dash) is null.
function readNumbers(stats) {
  const ps = pairs(stats, keyOf);
  const n = (k) => maxOf(firstOf(ps, k));
  const nums = { hp: maxOf(firstOf(ps, 'hp')), fp: maxOf(firstOf(ps, 'fp')), speed: n('speed'), dx: n('dx'), st: n('st'), ht: n('ht'),
    dodge: n('dodge'), dr: null, from: {} };
  // DR is its leading figure (`2 (leather)` is 2); a block that says the face is bare (`DR 2 (face 0)`) opens it
  const dr = clean(firstOf(ps, 'dr') || '');
  if (dr && !/^[-–—]+$/.test(dr)) nums.dr = drFigure(dr);
  const drLines = String(stats == null ? '' : stats).replace(/\r\n?/g, '\n').split('\n').filter((l) => /\bDR\b/.test(l));
  if (drLines.some((l) => FACE_BARE.test(l))) nums.faceOpen = true;
  const d = deriveGurps(nums, { max: nums.hp !== null, fpMax: nums.fp !== null, speed: nums.speed !== null });
  if (d.max !== undefined) nums.hp = d.max;
  if (d.fpMax !== undefined) nums.fp = d.fpMax;
  if (d.speed !== undefined) nums.speed = d.speed;
  nums.from = d.from;
  const er = energyReserve(stats);
  if (er) { nums.er = er.max; if (er.now !== er.max) nums.erStart = er.now; }
  if (isCaster(stats)) nums.caster = true;
  return nums;
}

// ---- magic (Task 10): who casts, and the Energy Reserve. Names only: the spell list itself is shown as written. ----

// A figure may follow a parenthesis (`Energy Reserve (Magical) 6`, `Magery (One College) 2`).
// An Energy Reserve, written three ways: `FP 11 (+4 Energy Reserve)`, a trait `Energy Reserve 4`, or a current over a
// maximum (`Energy Reserve 6/6`, a Current Status table row `| Energy Reserve | 6/6 |` too). { now, max } or null.
// A table row's other cells (a cost) are never the figure: only the current-over-maximum form reads across a `|`.
function energyReserve(text) {
  const t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const pair = /\bEnergy Reserve\b(?:[ \t]*\([^)\n|]*\))?[ \t*:|]*(\d+)[ \t]*\/[ \t]*(\d+)/i.exec(t);
  if (pair) return { now: Math.min(Number(pair[1]), Number(pair[2])), max: Number(pair[2]) };
  const one = /\(\s*\+\s*(\d+)\s*Energy Reserve\b/i.exec(t) || /\bEnergy Reserve\b(?:[ \t]*\([^)\n|]*\))?[ \t*:]*(\d+)\b(?![ \t]*\/)/i.exec(t);
  return one ? { now: Number(one[1]), max: Number(one[1]) } : null;
}

const DASHES = /^[\s\-–—]*$/;
// `Light-15`, `Create Fire (15)`, `Sense Foes 15`: a name with a skill level after it
const LEVELLED = /[A-Za-z)][ \t]*(?:[-–][ \t]*\d{1,2}\b|\([ \t]*\d{1,2}[ \t]*\)|[ \t]\d{1,2}\b)/;
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/[*_`]/g, '').trim());
const SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
// A table row that names a spell: its first cell is a name (not a dash, nor the header's word), and a cell holds a level.
const spellRow = (line) => {
  if (!/^\s*\|/.test(line) || SEPARATOR.test(line)) return false;
  const c = cellsOf(line);
  return !DASHES.test(c[0]) && !/^(?:name|spells?)$/i.test(c[0]) && c.slice(1).some((x) => /^\d{1,2}$/.test(x));
};
// A block's spell list with skill levels: a `Spells` label or heading with levelled names on its line, or the
// bullets or table rows under it; or a table whose header's first cell is `Spell`.
function hasSpellList(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  let under = false;
  let spellTable = false;
  for (const line of lines) {
    const plain = line.replace(/[*_`]/g, '').trim();
    const head = /^(?:#{1,6}[ \t]+|[-*+][ \t]+)?Spells?\b[^:]*?(?::|$)(.*)$/i.exec(plain);
    if (head && !/^\|/.test(plain)) {
      if (LEVELLED.test(head[1])) return true;
      under = !head[1].trim();
      spellTable = false;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const c = cellsOf(line);
      if (!SEPARATOR.test(line) && /^spells?$/i.test(c[0])) { spellTable = true; continue; }
      if ((under || spellTable) && spellRow(line)) return true;
      continue;
    }
    spellTable = false;
    if (!plain) continue;
    if (under && /^[-*+]\s/.test(line.trim()) && LEVELLED.test(plain)) return true;
    if (under && !/^[-*+]\s/.test(line.trim())) under = false;
  }
  return false;
}
// An NPC casts with Magery 1 or more (Magery 0 cannot cast), or a spell list with skill levels.
const isCaster = (md) => /\bMagery\b(?:[ \t]*\([^)\n|]*\))?[ \t*:]*\+?0*[1-9]/i.test(String(md == null ? '' : md)) || hasSpellList(md);

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

// A PC casts when the sheet's Spells table lists a spell: the site's reader keeps an empty table's
// `| — | … | No spells |` row as a spell named "—", which does not count. Its `## Spells` section, as written, is the
// panel's fold; its Energy Reserve (any of the three forms, a Current Status row's current first) is the row's.
function magicOf(model, text) {
  const out = {};
  const er = energyReserve(text);
  if (er) Object.assign(out, { erNow: er.now, erMax: er.max });
  const listed = (model.spells || []).some((x) => x && !DASHES.test(String(x.name == null ? '' : x.name)));
  if (!listed) return { numbers: out, spells: null };
  out.caster = true;
  const sec = sections(text, 2).find((x) => /^spells\b/i.test(x.title.replace(/[*_`]/g, '').trim()));
  return { numbers: out, spells: sec && sec.text ? sec.text : null };
}

// A PC's DR by location, from the sheet's `DR by Hit Location` table (parseGurps's model.defenses.hitLocations):
// each row's place (`Skull`, `Arms`, `Left Arm`, `Arms/Legs`, `Head`) to the table's own location names, its DR
// (`3`, `2*`) to its leading figure. A sided row gives its own key (`left arm`); the plain key (`arm`) comes from rows
// with no side, and from a sided row only when no plain row names that place. The first row for a key wins.
// null when no row reads.
function drByLocationOf(model) {
  const rows = ((model && model.defenses) || {}).hitLocations || [];
  const out = {};
  const put = (k, v) => { if (!(k in out)) out[k] = v; };
  const read = [];
  for (const row of rows) {
    const dr = drFigure(row && row.dr);
    if (dr === null) continue;
    for (const part of String((row && row.location) || '').toLowerCase().split(/\s*(?:\/|,|&|\band\b)\s*/)) {
      const words = part.replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
      const side = WOUNDING.sides.find((x) => words.includes(x)) || null;
      const name = words.filter((x) => x !== side).join(' ');
      const loc = WOUNDING.locations[name] ? name : WOUNDING.locationWords[name];
      if (!loc || name.length < 3) continue;
      read.push({ side, loc, dr, head: name === 'head' });
    }
  }
  for (const x of read) {
    if (x.side) put(`${x.side} ${x.loc}`, x.dr);
    else { put(x.loc, x.dr); if (x.head) put('face', x.dr); }
  }
  // a place named only with a side: its plain key from the first such row
  for (const x of read) if (x.side) put(x.loc, x.dr);
  return Object.keys(out).length ? out : null;
}

function readPc({ body, fm }) {
  try {
    const text = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
    const model = parseGurps(fm || {}, extractSections(text));
    const v = buildVitals(model);
    if (!v) return { numbers: { ...NONE }, note: NO_POOLS };
    const ht = ((model.attributes || {}).primary || {}).HT;
    const magic = magicOf(model, text);
    const drByLocation = drByLocationOf(model);
    return { numbers: { hpNow: v.hp.cur, hpMax: v.hp.max, fpNow: v.fp.cur, fpMax: v.fp.max,
      speed: figure(v.basicSpeed), dx: figure(v.dx), ht: figure(ht && ht.value), ...magic.numbers, ...(drByLocation ? { drByLocation } : {}) },
    ...(magic.spells ? { spells: magic.spells } : {}) };
  } catch (e) {
    return { numbers: { ...NONE }, note: `the sheet could not be read: ${firstLine(e)}` };
  }
}

// Placeholders until later tasks fill them in: `vitals`, `prompts`, `defences`,
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
    // the Energy Reserve pays spells only, never below 0; the GM picks which pool a spell comes from (Task 10)
    pools: [{ key: 'fp', prefix: 'f', label: 'FP', max: 'fpMax', floorTimes: -1 }, { key: 'er', prefix: 'e', label: 'Energy Reserve', max: 'erMax', floor: 0 }],
    // a hit typed as damage, type and place (Task 12)
    wounding: WOUNDING,
    // what a hit and a turn's start and end owe, as prompts (Task 13)
    consequences: CONSEQUENCES,
  };
  Object.assign(r, { family: 'gurps', ...JSON.parse(JSON.stringify(fight)) });
  Object.assign(r.fight, fight);
  r.toggles = { ...r.toggles, hitChips: true, half: false, resisted: false, temp: false, deathSaves: false, concentration: false, exhaustion: false, counters: false, longRest: false };
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
    // a caster's box: a spell is paid with f-3 (FP) or e-3 (Energy Reserve)
    casterPlaceholder: '\u2726 f-3',
    entryInvalid: 'Type -7 or 7 (injury), 9 imp vitals or 2d+1 cr (a hit), +3 (healing), f-2 (FP) or e-2 (Energy Reserve)',
    faceOpen: 'face open', faceOpenTitle: 'Face open: DR 0 for a hit to the face or an eye',
    noReserve: 'No Energy Reserve: f-N pays from FP',
    noFp: 'No FP on this row: type its max FP or HT',
    casterTitle: 'A caster: f-3 pays a spell from FP', reserveTitle: 'e-3 spends it',
  };
  return r;
}

// The row's own fields: initiative is Basic Speed.
// An Energy Reserve and a caster only where the block has them.
const foeRow = (n) => ({ init: n.speed, fp: n.fp, fpMax: n.fp, speed: n.speed, dx: n.dx, st: n.st, ht: n.ht, dodge: n.dodge, dr: n.dr, from: n.from,
  ...(n.faceOpen ? { faceOpen: true } : {}),
  ...(n.er == null ? {} : { er: n.er, erMax: n.er, ...(n.erStart == null ? {} : { erStart: n.erStart }) }),
  ...(n.caster ? { caster: true } : {}) });

const gurps = { ...dnd, id: 'gurps-4e', fights: true, readFoe, readPc, foeRow, stockNoActions: undefined, describe: () => describeGurps('gurps-4e') };

module.exports = { gurps, readNumbers, keyOf, lacks, energyReserve, hasSpellList, isCaster, WOUNDING, CONSEQUENCES, drByLocationOf };
