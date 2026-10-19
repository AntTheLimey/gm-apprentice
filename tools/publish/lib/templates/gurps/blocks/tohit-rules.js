// The GURPS to-hit calculator's rules numbers: names, numbers and page references only.
// js/gurps-tohit.js carries the logic and no rules numbers; tohit-data.js writes this object
// into each page's gurps-tohit-data block as `rules` (#420). With reference.js, this is the
// one place GURPS rules content lives in the publish tool.

const TOHIT_RULES = {
  // The roll: 3d6 (B9). Criticals (B556): 3-4 always a critical success, 5 at effective skill 15+,
  // 6 at 16+. 18 always a critical failure, 17 one at skill 15 or less, and any roll 10 or more
  // over the skill. 17 always fails.
  dice: 3,
  crit: { always: 4, more: [[5, 15], [6, 16]] },
  fumble: { always: 18, seventeenUpTo: 15, over: 10 },
  alwaysFails: 17,

  // Aim: Acc, then +1 for a 2nd turn and +2 for 3 or more (B364); braced +1 (B364).
  extraAim: [0, 0, 1, 2],
  maxExtraAimTurns: 3,               // the extra-aim bonus stops growing at 3 turns (B364)
  braced: 1,
  // Sighting aids together add no more than base Acc (B364); a variable scope gives +1 per
  // turn aimed up to its bonus, a fixed one all of it once aimed that many turns (B412);
  // Telescopic Vision follows the scope rule, and only one scope counts at a time (B92, B412).
  // All aiming bonuses together are at most twice Acc (B372); from a moving vehicle, at most
  // the vehicle's SR (B469).
  aimLimitFactor: 2,
  // Targeting systems count under the base-Acc sight cap and the twice-Acc cap when aiming
  // (B364, B372, HT155). A laser sight gives +1 with or without Aim (B412, HT156). A targeting
  // or silhouette program is a bonus to the shooting skill, not an Acc bonus (HT157), as is any
  // aid not named here: those are flat and outside the aim caps.
  sightNames: ['Laser sight', 'Scope', 'HUD link', 'Smartgun'],
  // A reflex sight is +1 to the shooting skill, not to Acc, and needs no Aim (HT156); the programs
  // likewise (HT157). These apply with or without Aim whatever the sheet flagged, outside the caps.
  skillAids: ['Reflex sight', 'Targeting program', 'Silhouette program'],
  skillPrefixes: ['Guns', 'Gunner', 'Beam Weapons'],
  alwaysOn: ['Laser sight'],

  // All-Out Attack (Determined): ranged +1, melee +4 (B365). Committed Attack (Determined) +2 (MA99).
  // All-Out Attack (Strong): +2 damage, or +1 a die if better (B365).
  aoaRanged: 1,
  aoaMelee: 4,
  committed: 2,
  aosDamage: 2,
  aosPerDie: 1,
  // Move and Attack: ranged takes the worse of -2 or Bulk (B325, B548); melee -4 and the
  // adjusted skill cannot exceed 9 (B325).
  moveRangedMin: 2,
  moveMelee: -4,
  moveMeleeCap: 9,
  popup: -2,                         // pop-up attack, and no Aim (B390)

  // Rapid fire by shots (B373); from 100 shots the extended table in HT172 (High-Tech) carries on:
  // +7 at 100, +8 at 200, +9 at 400, +10 at 800, one more for each doubling. B373's own table
  // ends at 99 shots.
  rofSteps: [[800, 10], [400, 9], [200, 8], [100, 7], [50, 6], [25, 5], [17, 4], [13, 3], [9, 2], [5, 1]],
  // RoF is the most shots one attack fires; fewer, down to 1, is allowed (B373, B270). A weapon
  // that fires only full auto (RoF written N!) fires at least a quarter of its RoF, rounded up (B270, B408).
  fullAutoMinDivisor: 4,
  // A shotgun's RoF NxM: each shot is M projectiles, and the rapid-fire bonus and the most hits
  // count them all (B373, B409). Closer than a tenth of its 1/2D range the multiplier adds no
  // shots: the damage dice and the target's DR are multiplied by half of it, rounded down (B409).
  closeRangeDivisor: 10,
  closeDamageDivisor: 2,

  rapidStrike: -6,                   // each attack (B370)
  rapidStrikeHalf: -3,               // with Trained by a Master (B93) or Weapon Master (MA48)
  deceptiveStep: 2,                  // each -2 to hit is -1 to the foe's defence (B369, B548)
  deceptiveFloor: 10,                // Deceptive Attack may not take the final effective skill below 10 (B369)
  deceptiveMax: 8,                   // the largest Deceptive Attack the calculator offers
  // Telegraphic: +4 to hit; the foe defends at +2. It does not stack with Evaluate and cannot be
  // combined with Deceptive Attack (MA113).
  telegraphic: 4,
  telegraphicFoe: 2,
  evaluateMax: 3,                    // +1 a turn, at most +3 (B364)

  // Cover (B407, B548): target only partly exposed -2; light cover or concealment -2; -4 for each
  // figure the shot passes. Target crouching, kneeling, sitting, crawling or lying: -2, but only
  // against the torso, groin or a leg (B548, B551).
  cover: { partial: -2, light: -2 },
  behind: -4,
  targetLow: -2,
  targetLowLocs: ['torso', 'groin', 'leg'],

  dual: -4,                          // Dual-Weapon Attack, each attack; the foe defends at -1 (B417, MA83)
  dualFoe: -1,
  dualBoughtMax: 4,                  // the technique buys off at most the -4 (MA83, B230)
  offHand: -4,                       // none with Ambidexterity (B39) or Off-Hand Weapon Training (B232); B417, B547
  offHandBoughtMax: 4,               // the technique buys off at most the -4 (B232)
  badFooting: -2,                    // -2 or worse at the GM's option (B547)
  shockMax: 4,                       // shock is at most -4 (B419)
  totalDarkness: -10,                // darkness is -1 to -9, total darkness -10 (B547, B548); Night Vision
                                     // takes off one point a level but not from -10 (B71)
  blindCap: 9,                       // adjusted skill at most 9 when fighting blind (B389, B547)
  freeFallBeamRcl: 2,                // zero gravity caps DX rolls at Free Fall; beam weapons exempt
                                     // below Rcl 2 (B197, B350). Free Fall replaces the skill when lower (B197, B344).
  // Attacker's posture, melee: -2 crouching, kneeling, sitting; -4 crawling or lying (B551, B547).
  posture: { low: -2, prone: -4 },

  // Speed/Range: 2 yards is 0, then one point worse each step of 3, 5, 7, 10, 15, 20 and so on
  // by tens (B550, B372). A range between two entries takes the larger penalty.
  rangeSteps: [2, 3, 5, 7, 10, 15],
};

module.exports = { TOHIT_RULES };
