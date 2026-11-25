# GURPS 4e Combat Mechanics

In-play procedural reference for GURPS 4e combat. Covers the
full turn sequence, maneuvers, attack resolution, defenses,
hit locations, damage types, ranged modifiers, shock/knockdown,
and death/dying thresholds.

Source: GURPS Basic Set — Campaigns, Chapters 11-13; GURPS Martial Arts (MA123, MA137) where noted.

---

## Turn Sequence

Each combat turn is 1 second. On their turn a character chooses
a maneuver, then the turn resolves.

**Turn order**: Characters act in descending Basic Speed order.
Ties broken by highest DX, then by player/GM choice.

---

## Maneuvers

| Maneuver | Move | Action | Notes |
|----------|------|--------|-------|
| Do Nothing | None | None | Default if stunned |
| Move | Full | None | Move up to full Move |
| Change Posture | -- | -- | Stand, kneel, sit, lie down, etc. |
| Aim | Step | Aim weapon | +Acc on next attack; cumulative +1/turn (max +2) |
| Attack | Step | One attack | Melee or ranged |
| All-Out Attack | Half | Attack | Determined (+4 hit), Strong (+2 dmg or +1/die), Double (2 attacks), or Feint+Attack; no active defense |
| Move and Attack | Full | One attack | Melee -4, effective skill at most 9; ranged -2 or Bulk; Dodge or Block only, no retreat (B365) |
| All-Out Defense | Step | None | +2 to one defense, or two different defenses |
| Concentrate | Step | Mental | For spells, psionics, etc. |
| Ready | Step | Ready item | Draw weapon, reload, etc. |
| Wait | Varies | Triggered | Interrupt on specified trigger |
| Evaluate | Step | Study foe | +1 to hit per turn (max +3) |
| Feint | Step | Contest | Quick Contest of weapon skills; success penalizes foe's defense |

### Maneuver Notes

- **Step**: Move up to 1 yard (even in heavy encumbrance).
- **Half Move**: Move up to half your Move score (round down).
- **Full Move**: Move up to your full Move score.
- **All-Out Attack options**:
  - *Determined*: +4 to hit
  - *Strong*: +2 damage (or +1 per die for swing)
  - *Double*: Two attacks (same or different targets)
  - *Feint+Attack*: Feint then attack in one turn
- **Wait**: Declare a trigger condition. When triggered, you
  interrupt and act. Your action must be legal for the maneuver
  you're performing (usually Attack or All-Out Attack).

---

## Attack Resolution

1. **Roll to hit**: 3d6 <= effective skill (after modifiers)
2. **Defense roll**: Target rolls active defense (Dodge, Parry,
   or Block)
3. **Damage**: Roll damage dice, subtract DR, apply to HP

### Critical Hits and Misses

- **Critical hit**: Roll of 3-4 always; 5 if skill 15+; 6 if
  skill 16+. Target gets no active defense.
- **Critical miss**: Roll of 18 always; 17 if effective skill
  15 or less. Consult the Critical Miss Table (B556).

---

## Active Defenses

| Defense | Base | Notes |
|---------|------|-------|
| Dodge | Basic Speed + 3 (floor) | -1 per encumbrance level; -4 while stunned (B420) |
| Parry | Skill/2 + 3 (floor) | Weapon or unarmed; -4 cumulative same weapon; retreating Parry +1 (+3 for fencing weapons) |
| Block | Shield skill/2 + 3 (floor) | Requires shield; retreating Block +1 |

### Retreat

Once per turn, step back 1 yard for a defense bonus:
- **Dodge**: +3
- **Parry**: +1 (+3 if fencing weapon: rapier, saber,
  smallsword, main-gauche)
- **Block**: +1

**Sideslip** and **Slip** (Martial Arts, MA123): a sideways
step at -1 plus the retreat bonus, or a step closer at -2 plus
it. Useful when your back is to a wall.

### Key Modifiers to Defenses

- **Combat Reflexes** [15]: +1 to all active defenses at all
  times, +6 to recover from surprise, never freeze.
- **Enhanced Defenses**: +1 per level to one specific defense.
- **Stunned**: -4 to every active defense and no retreat (B420).
- **Side/rear attacks**: -2 to defend from the side; no defense
  against attacks from directly behind (without Peripheral
  Vision or 360-degree Vision).

---

## Hit Locations

Every location the Basic Set (B398, B552) and Martial Arts
(MA137) give a humanoid, mildest penalty first. Notes name only
what differs from a torso hit: the damage types that may target
the place, the wounding multipliers that change (types sharing a
figure are grouped; anything not named wounds as the torso does),
crippling, knockdown, and where a miss by 1 lands. Fatigue damage
ignores location effects. Excess injury past a crippling
threshold is lost where the notes say so.

<!-- The table between the markers is written by
`node tools/publish/scripts/gen-combat-reference.js --write`
from the run sheet's hit-location table; edit that, not this. -->
<!-- generated: hit-locations -->
| Location | Penalty | DR | Notes | Page |
|---|---|---|---|---|
| Torso | 0 | -- | -- | B398, B552 |
| Arm | -2 | -- | imp, pi+, pi++ x1; crippled over HP/2, excess lost; shield arm -4 | B398, B552 |
| Leg | -2 | -- | imp, pi+, pi++ x1; crippled over HP/2, excess lost | B398, B552 |
| Groin | -3 | -- | miss by 1 hits the torso; male: crushing shock x2 (max 8), knockdown -5 | B398, B552 |
| Vitals | -3 | -- | not cut, burn, cor, tox; imp, pi-, pi, pi+, pi++ x3; tbb x2; knockdown on any shock, -5 on a major wound; miss by 1 hits the torso; crushing may aim here, at x1 | B398, B552, MA137 |
| Hand | -4 | -- | imp, pi+, pi++ x1; crippled over HP/3, excess lost; shield hand -8 | B398, B552 |
| Foot | -4 | -- | imp, pi+, pi++ x1; crippled over HP/3, excess lost | B398, B552 |
| Face | -5 | open face: none | cor x1.5; knockdown on any shock, -5 on a major wound; miss by 1 hits the torso; from behind -7 | B398, B552, MA137 |
| Neck | -5 | -- | cr, cor x1.5; cut x2; miss by 1 hits the torso | B398, B552 |
| Arm vein or artery | -5 | as arm | not cr, burn, cor, tox; cut x2; imp, pi, pi++, tbb x1.5; pi- x1; miss by 1 hits the arm; no crippling | MA137 |
| Leg vein or artery | -5 | as leg | not cr, burn, cor, tox; cut x2; imp, pi, pi++, tbb x1.5; pi- x1; miss by 1 hits the leg; no crippling | MA137 |
| Arm joint | -5 | as arm | not imp, burn, cor, tox; pi+, pi++ x1; crippled over HP/3, excess lost; miss by 1 hits the arm | MA137 |
| Leg joint | -5 | as leg | not imp, burn, cor, tox; pi+, pi++ x1; crippled over HP/3, excess lost; miss by 1 hits the leg | MA137 |
| Jaw | -6 | as face | cor x1.5; knockdown on any shock, -5 on a major wound, cr -1 more; miss by 1 hits the torso; front only | MA137 |
| Skull | -7 | +2 (not tox) | x4; knockdown on any shock, -10 on a major wound; miss by 1 hits the torso; from behind -5; none of this for tox | B398, B552, MA137 |
| Ear | -7 | as face | cor x1.5; knockdown on any shock, -5 on a major wound; miss by 1 hits the torso; a cut can take it off | MA137 |
| Nose | -7 | as face | cor x1.5; crippled over HP/4; knockdown on any shock, -5 on a major wound; miss by 1 hits the torso; front only | MA137 |
| Hand joint | -7 | as hand | not imp, burn, cor, tox; pi+, pi++ x1; crippled over HP/4, excess lost; miss by 1 hits the hand | MA137 |
| Foot joint | -7 | as foot | not imp, burn, cor, tox; pi+, pi++ x1; crippled over HP/4, excess lost; miss by 1 hits the foot | MA137 |
| Spine | -8 | +3 | not burn, cor, tox; crippled over HP; knockdown on any shock, -5 on a major wound; crippling it knocks down and stuns outright; miss by 1 hits the torso; from behind only | MA137 |
| Neck vein or artery | -8 | as neck | not cr, burn, cor, tox; cut, imp, pi++ x2.5; pi- x1; pi, tbb x1.5; pi+ x2; miss by 1 hits the neck | MA137 |
| Eye | -9 | as face | only imp, pi-, pi, pi+, pi++, tbb; x4; crippled over HP/10; knockdown on any shock, -10 on a major wound; miss by 1 hits the torso; front or side | B398, B552 |
<!-- /generated -->

Chinks in armour (B400): impaling, piercing and tight-beam
burning only; -8 for the torso, -10 anywhere else in place of
the location's penalty; DR halved.

### Crippling

A limb or extremity is crippled when injury to that location
exceeds the crippling threshold in a single blow (see the
table's notes). A crippling injury counts as a major wound
(B420).

---

## Damage Types

| Type | Abbreviation | Notes |
|------|-------------|-------|
| Crushing | cr | Blunt trauma; double knockback |
| Cutting | cut | x1.5 after DR penetration |
| Impaling | imp | x2 after DR penetration |
| Piercing (small) | pi- | x0.5 after DR |
| Piercing | pi | x1 after DR |
| Piercing (large) | pi+ | x1.5 after DR |
| Piercing (huge) | pi++ | x2 after DR |
| Burning | burn | x1 after DR; can ignite |
| Corrosion | cor | x1; also damages DR |
| Toxic | tox | x1; internal only |
| Fatigue | fat | To FP, not HP |

### Damage Calculation

1. Roll damage dice
2. Subtract target's DR for the hit location
3. If penetrating damage > 0, multiply by the wounding modifier
   for the damage type and hit location
4. Apply the result as injury to HP

---

## Ranged Combat Modifiers

| Factor | Modifier |
|--------|---------|
| Range (Speed/Range Table) | -0 to -17+ |
| Target Size (SM) | Per SM difference |
| Aim (1 turn) | +weapon Acc |
| Aim (2 turns) | +Acc +1 |
| Aim (3+ turns) | +Acc +2 |
| Braced | Included in Acc for 2-handed |
| Scope | +1 to +3 (stacks with Acc) |
| Move and Attack | -2 or Bulk, whichever is worse (B365) |
| Pop-up attack | -2 |
| Shooting into melee | -4 per interposing figure |

### Speed/Range Table (Key Entries)

| Range (yards) | Modifier |
|---------------|---------|
| 2 | 0 |
| 3 | -1 |
| 5 | -2 |
| 7 | -3 |
| 10 | -4 |
| 15 | -5 |
| 20 | -6 |
| 30 | -7 |
| 50 | -8 |
| 70 | -9 |
| 100 | -10 |

### Bulk

Bulk penalizes Move and Attack and snap shots. More negative =
harder to use while moving. Pistols are typically -2; rifles
-5 or worse.

---

## Shock and Knockdown

- **Shock**: Lose HP in one turn -> -HP lost to DX and IQ next
  turn only (max -4) (B419).
- **Major wound**: injury of more than half HP from one blow,
  or any crippling injury (B420).
- **Knockdown**: one HT roll, called by a major wound or by a
  hit to the skull, face, eye or vitals that gives any shock
  (Martial Arts adds jaw, nose, ear and spine). Modifiers by
  location are in the table's notes. Failure: stunned and
  prone; failure by 5 or more, or a critical failure:
  unconscious (B420).
- **Stun**: Do Nothing each turn; roll HT at the **end** of each
  turn to recover, acting normally from the next turn (B420).
- **High Pain Threshold** [10]: Immune to shock penalties;
  +3 to resist knockdown/stun.

---

## Death and Dying

| Threshold | Effect |
|-----------|--------|
| 1/3 HP | Halve Move and Dodge (round up) |
| 0 HP | Roll HT each turn to stay conscious. Collapse on failure. |
| -1xHP | Roll HT or die. Death check each time you lose a full multiple of HP (-HP, -2xHP, -3xHP, etc.) |
| -5xHP | Automatic death. No roll. |
| -10xHP | Total bodily destruction. |

### Death Check Details

- Each death check is a separate HT roll.
- Modifiers: Hard to Kill (+1/level), Easy to Kill (-1/level).
- On failure: you die immediately.
- On success: you remain alive (but still possibly unconscious
  at 0 HP or below).
- The interval between checks is equal to your full HP total.
  E.g., HP 12 character checks at -12, -24, -36, -48, and
  dies automatically at -60.

---

## Grappling (Quick Reference)

1. **Grab**: Attack maneuver; roll vs DX, Brawling, Judo, or
   Wrestling to grapple.
2. **Maintain**: Free action each turn to keep grapple.
3. **Follow-up**: On subsequent turns, attempt takedown, pin,
   choke, lock, or throw via Quick Contest of ST or grappling
   skill.
4. **Break free**: Quick Contest of ST or grappling skill to
   escape.

---

## Cross-References

- Core mechanics (attributes, skills, roll math): `mechanics.md`
- Martial arts styles and techniques: `skills-combat.md`
- Character generation: `character-generation.md`
- Ranged weapons stats: `equipment-weapons.md`
