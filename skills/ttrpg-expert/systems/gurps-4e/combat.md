# GURPS 4e Combat Mechanics

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](http://www.sjgames.com/general/online_policy.html).

In-play procedural reference for GURPS 4e combat. Covers the
full turn sequence, maneuvers, attack resolution, defenses,
hit locations, damage types, ranged modifiers, shock/knockdown,
and death/dying thresholds.

Source: GURPS Basic Set — Campaigns, Chapters 11-13.

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
| Move and Attack | Full | One attack | -4 to hit (min effective skill 9); all active defenses available |
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
| Dodge | Basic Speed + 3 (floor) | Always available unless stunned; -1 per encumbrance level |
| Parry | Skill/2 + 3 (floor) | Weapon or unarmed; -4 cumulative same weapon; retreating Parry +1 (+3 for fencing weapons) |
| Block | Shield skill/2 + 3 (floor) | Requires shield; retreating Block +1 |

### Retreat

Once per turn, step back 1 yard for a defense bonus:
- **Dodge**: +3
- **Parry**: +1 (+3 if fencing weapon: rapier, saber,
  smallsword, main-gauche)
- **Block**: +1

**Slip**: Sidestep variant that gives +3 to Dodge without
requiring backward movement. Useful when your back is to a wall.

### Key Modifiers to Defenses

- **Combat Reflexes** [15]: +1 to all active defenses at all
  times, +6 to recover from surprise, never freeze.
- **Enhanced Defenses**: +1 per level to one specific defense.
- **Stunned**: No active defenses until you recover.
- **Side/rear attacks**: -2 to defend from the side; no defense
  against attacks from directly behind (without Peripheral
  Vision or 360-degree Vision).

---

## Hit Locations

| Location | Penalty | DR Modifier | Wounding Modifier |
|----------|---------|-------------|-------------------|
| Torso | +0 | -- | x1 |
| Skull | -7 | DR 2 (bone) | x4 |
| Face | -5 | -- | x4 (no DR 2 bone) |
| Neck | -5 | -- | x2 (crushing x1.5) |
| Eye | -9 | -- | x4, can blind |
| Groin | -3 | -- | x1 (knockdown at HT-5) |
| Arm | -2 | -- | x1 (cripple at HP/2) |
| Leg | -2 | -- | x1 (cripple at HP/2) |
| Hand | -4 | -- | x1 (cripple at HP/3) |
| Foot | -4 | -- | x1 (cripple at HP/3) |
| Vitals | -3 | -- | x3 (imp/pi only) |

### Crippling

A limb or extremity is crippled when injury to that location
exceeds the crippling threshold in a single blow:
- **Arms and Legs**: Over HP/2 injury
- **Hands and Feet**: Over HP/3 injury
- **Eyes**: Over HP/10 injury

Excess injury beyond the crippling threshold is lost (does not
carry over to general HP).

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
| Move and Attack | -4 (max effective 9) |
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
  turn only (max -4)
- **Knockdown**: Take HP/2+ in one blow -> roll HT or fall prone
  and be stunned. Major Wound (HP/2+ from single attack) also
  requires a HT roll.
- **Stun**: Skip next turn; recover by rolling HT at start of
  each turn.
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
- Martial arts styles and techniques: `rules-reference.md`
  section 7
- Character generation: `character-generation.md`
- Ranged weapons stats: `rules-reference.md` section 4
