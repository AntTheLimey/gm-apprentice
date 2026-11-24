'use strict';
// The humanoid hit locations: the Basic Set's (B398, B552) and Martial Arts's extended ones (MA137). Names, numbers
// and short notes only, each with its page. The one table: the run sheet's damage helper and location list
// (systems/gurps.js WOUNDING), the player site's reference block and to-hit calculator, and the generated table in
// skills/ttrpg-expert/systems/gurps-4e/combat.md all read it; test/combat-reference-sync.test.js holds them to it.
//
// A location: `key` (the word a GM types), `name`, `penalty` to hit, `roll` (B552's 3d roll; `right`/`left` for a
// limb; none for a location no random roll gives), and its wounding, read by gurps-math's woundingAt:
//   `targets`  the damage types that can target it (every type when absent)
//   `by`       a multiplier by damage type in place of the type's usual one; `all` one for every type but `except`
//   `as`       the location whose multipliers and DR it takes; `plus` added to that multiplier
//   `dr`       extra DR on top of the row's (not for `except` types or fatigue); `drAs` the place whose DR it takes
//   `face`     the face's DR (bare when the face is open); `sided` left or right may be named
//   `cripple`  crippled by injury over max HP / this; `cap` injury past that is lost
//   `knockdown` { shock: any shock calls the knockdown roll; major: its modifier on a major wound (not for `except`
//              types); extra: by type; crippledAuto: crippling it knocks down and stuns outright, no roll }
//   `male`     what a male target takes there, which the run sheet says and never applies (it knows no sex):
//              shock times `shock` (at most `shockMax`) from `shockTypes`, `knockdown` to the knockdown roll
//   `miss`     where an attack that misses by 1 lands (B552, MA137), when it lands anywhere but the place aimed at
//   `note`     a short note; `cite` its pages.
// The order is the table's: a stable sort by penalty gives the run sheet's list, mildest first.

const PIERCING = ['pi-', 'pi', 'pi+', 'pi++'];
const each = (keys, v) => Object.fromEntries(keys.map((k) => [k, v]));
// a limb's or extremity's reduced multipliers (B552)
const LIMB_DOWN = { 'pi+': 1, 'pi++': 1, imp: 1 };
// the types that can target the eye and the vitals (B398); veins and arteries, joints, the spine (MA137)
const POINTED = [...PIERCING, 'imp', 'tbb'];
const VEIN = ['cut', ...POINTED];
const JOINT = ['cr', 'cut', ...PIERCING, 'tbb'];
const SPINE = ['cr', 'cut', ...POINTED];

const LOCATIONS = [
  { key: 'torso', name: 'Torso', penalty: 0, roll: '9–10', cite: 'B398, B552' },
  { key: 'arm', name: 'Arm', penalty: -2, roll: { right: '8', left: '12' }, by: LIMB_DOWN, cripple: 2, cap: true, sided: true, note: 'shield arm −4', cite: 'B398, B552' },
  { key: 'leg', name: 'Leg', penalty: -2, roll: { right: '6–7', left: '13–14' }, by: LIMB_DOWN, cripple: 2, cap: true, sided: true, cite: 'B398, B552' },
  { key: 'groin', name: 'Groin', penalty: -3, roll: '11', male: { shock: 2, shockMax: 8, shockTypes: ['cr'], knockdown: -5 }, note: 'a male target: double shock from crushing (max 8), knockdown −5', miss: 'torso', cite: 'B398, B552' },
  { key: 'vitals', name: 'Vitals', penalty: -3, roll: null, by: { ...each(PIERCING, 3), imp: 3, tbb: 2 }, targets: ['cr', ...POINTED], knockdown: { shock: true, major: -5 }, note: 'crushing may aim here, at ×1', miss: 'torso', cite: 'B398, B552, MA137' },
  { key: 'hand', name: 'Hand', penalty: -4, roll: '15', by: LIMB_DOWN, cripple: 3, cap: true, sided: true, note: 'shield hand −8', cite: 'B398, B552' },
  { key: 'foot', name: 'Foot', penalty: -4, roll: '16', by: LIMB_DOWN, cripple: 3, cap: true, sided: true, cite: 'B398, B552' },
  { key: 'face', name: 'Face', penalty: -5, roll: '5', by: { cor: 1.5 }, face: true, knockdown: { shock: true, major: -5 }, note: 'from behind −7', miss: 'torso', cite: 'B398, B552, MA137' },
  { key: 'neck', name: 'Neck', penalty: -5, roll: '17–18', by: { cut: 2, cr: 1.5, cor: 1.5 }, miss: 'torso', cite: 'B398, B552' },
  { key: 'arm vein', name: 'Arm vein or artery', penalty: -5, roll: null, as: 'arm', plus: 0.5, targets: VEIN, sided: true, note: 'no crippling', miss: 'arm', cite: 'MA137' },
  { key: 'leg vein', name: 'Leg vein or artery', penalty: -5, roll: null, as: 'leg', plus: 0.5, targets: VEIN, sided: true, note: 'no crippling', miss: 'leg', cite: 'MA137' },
  { key: 'arm joint', name: 'Arm joint', penalty: -5, roll: null, as: 'arm', targets: JOINT, cripple: 3, cap: true, sided: true, miss: 'arm', cite: 'MA137' },
  { key: 'leg joint', name: 'Leg joint', penalty: -5, roll: null, as: 'leg', targets: JOINT, cripple: 3, cap: true, sided: true, miss: 'leg', cite: 'MA137' },
  { key: 'jaw', name: 'Jaw', penalty: -6, roll: null, as: 'face', face: true, knockdown: { shock: true, major: -5, extra: { cr: -1 } }, note: 'front only', miss: 'torso', cite: 'MA137' },
  { key: 'skull', name: 'Skull', penalty: -7, roll: '3–4', all: 4, except: ['tox'], dr: 2, knockdown: { shock: true, major: -10 }, note: 'from behind −5', miss: 'torso', cite: 'B398, B552, MA137' },
  { key: 'ear', name: 'Ear', penalty: -7, roll: null, as: 'face', face: true, sided: true, knockdown: { shock: true, major: -5 }, note: 'a cut can take it off', miss: 'torso', cite: 'MA137' },
  { key: 'nose', name: 'Nose', penalty: -7, roll: null, as: 'face', face: true, cripple: 4, knockdown: { shock: true, major: -5 }, note: 'front only', miss: 'torso', cite: 'MA137' },
  { key: 'hand joint', name: 'Hand joint', penalty: -7, roll: null, as: 'hand', targets: JOINT, cripple: 4, cap: true, sided: true, miss: 'hand', cite: 'MA137' },
  { key: 'foot joint', name: 'Foot joint', penalty: -7, roll: null, as: 'foot', targets: JOINT, cripple: 4, cap: true, sided: true, miss: 'foot', cite: 'MA137' },
  { key: 'spine', name: 'Spine', penalty: -8, roll: null, targets: SPINE, dr: 3, cripple: 1, knockdown: { shock: true, major: -5, crippledAuto: true }, note: 'from behind only', miss: 'torso', cite: 'MA137' },
  { key: 'neck vein', name: 'Neck vein or artery', penalty: -8, roll: null, as: 'neck', plus: 0.5, targets: VEIN, miss: 'neck', cite: 'MA137' },
  { key: 'eye', name: 'Eye', penalty: -9, roll: null, by: { ...each(PIERCING, 4), imp: 4, tbb: 4 }, targets: POINTED, face: true, drAs: 'face', cripple: 10, sided: true, knockdown: { shock: true, major: -10 }, note: 'front or side', miss: 'torso', cite: 'B398, B552' },
];

// mildest penalty first, ties in the table's order
const LOCATION_ORDER = LOCATIONS.map((l, i) => [l, i]).sort((a, b) => b[0].penalty - a[0].penalty || a[1] - b[1]).map(([l]) => l.key);

// Words a GM types for a location that are not its key.
const LOCATION_WORDS = {
  v: 'vitals', sk: 'skull', head: 'skull', e: 'eye', eyes: 'eye', n: 'neck', t: 'torso', g: 'groin', a: 'arm', arms: 'arm',
  l: 'leg', legs: 'leg', h: 'hand', hands: 'hand', ft: 'foot', feet: 'foot', ears: 'ear', j: 'jaw',
  elbow: 'arm joint', knee: 'leg joint', wrist: 'hand joint', ankle: 'foot joint', jugular: 'neck vein',
  'arm artery': 'arm vein', 'leg artery': 'leg vein', 'neck artery': 'neck vein',
};

// Chinks in armour (B400): a separate aim, not a location; names and numbers for the reference only.
const CHINKS = { targets: POINTED, torso: -8, other: -10, cite: 'B400' };

module.exports = { LOCATIONS, LOCATION_ORDER, LOCATION_WORDS, CHINKS };
