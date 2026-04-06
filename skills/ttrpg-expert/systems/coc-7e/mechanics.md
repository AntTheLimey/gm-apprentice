> BRP mechanical foundation: BRP ORC License. See ATTRIBUTION.md.
> CoC 7e adaptation: Our own descriptions of uncopyrightable
> game mechanics (Baker v. Selden, 1879). Not Chaosium text.

# Call of Cthulhu 7e -- Core Mechanics

## Overview

Lovecraftian horror investigation game built on the Basic
Roleplaying (BRP) percentile system. Published by Chaosium Inc.
Investigators are ordinary people confronting cosmic horrors
beyond human comprehension. The game emphasises investigation,
atmosphere, and the slow erosion of sanity over combat prowess.

## Characteristics

CoC 7e uses eight characteristics. Each is generated on a
3-18 (or 8-18) scale, then multiplied by 5 to produce the
percentile value used in play. For each characteristic,
record the full value, the half value (for Hard rolls), and
the one-fifth value (for Extreme rolls).

| Characteristic | Roll | x5 Range | Governs |
|----------------|------|----------|---------|
| STR (Strength) | 3D6 x 5 | 15-90 | Melee damage, lifting, grappling |
| CON (Constitution) | 3D6 x 5 | 15-90 | Endurance, HP, poison/disease resistance |
| SIZ (Size) | (2D6+6) x 5 | 40-90 | Height/weight, HP, damage modifier |
| DEX (Dexterity) | 3D6 x 5 | 15-90 | Initiative, Dodge base, reflexes |
| APP (Appearance) | 3D6 x 5 | 15-90 | Physical attractiveness, first impressions |
| INT (Intelligence) | (2D6+6) x 5 | 40-90 | Personal interest points, Idea roll |
| POW (Power) | 3D6 x 5 | 15-90 | Starting SAN, magic points, willpower |
| EDU (Education) | (2D6+6) x 5 | 40-90 | Occupation skill points, knowledge base |

Note: CoC 7e uses APP (Appearance) instead of BRP's CHA
(Charisma). EDU is a standard characteristic, not optional.
STR, CON, DEX, APP, and POW use 3D6. SIZ, INT, and EDU use
2D6+6 (ensuring a higher floor).

**Example**: Rolling 12 for STR gives STR 60 (half 30,
fifth 12).

### Point-Buy Alternative

Allocate 460 points among the eight characteristics (as
percentile values). No characteristic may exceed 80 before
age modifiers. EDU, SIZ, and INT must be at least 40.

## Derived Values

| Derived Value | Formula |
|---------------|---------|
| **Hit Points (HP)** | (CON + SIZ) / 10, rounded down. Use the percentile values. Typical range: 8-14. |
| **Magic Points (MP)** | POW / 5. Use the percentile value divided by 5. Typical range: 3-18. |
| **Sanity (SAN)** | Starting SAN = POW (the percentile value). Maximum starting SAN = 99. |
| **Luck** | Roll 3D6 x 5. Separate roll, not derived from any characteristic. Spendable resource. |
| **Dodge** | DEX / 2. Half the DEX percentile value. This is the base for the Dodge skill. |
| **Move Rate (MOV)** | See table below. |
| **Damage Bonus** | See STR+SIZ table below. |
| **Build** | See STR+SIZ table below. |

### Move Rate (MOV)

Compare STR, DEX, and SIZ (use the raw pre-multiplication
values, i.e., the 3-18 scale):

| Condition | MOV |
|-----------|-----|
| Both STR and DEX are each less than SIZ | 7 |
| Either STR or DEX equals or exceeds SIZ | 8 |
| Both STR and DEX each exceed SIZ | 9 |

Age modifiers reduce MOV further (see character generation).

### Damage Bonus and Build

Based on STR + SIZ (add the percentile values together):

| STR + SIZ | Damage Bonus | Build |
|-----------|-------------|-------|
| 2-64 | -2 | -2 |
| 65-84 | -1 | -1 |
| 85-124 | None | 0 |
| 125-164 | +1D4 | +1 |
| 165-204 | +1D6 | +2 |
| 205-284 | +2D6 | +3 |
| Each +80 | +1D6 | +1 |

Damage bonus applies to melee and thrown weapon attacks.
Firearms never apply the damage bonus.

Build determines grappling contests: the difference in Build
between opponents affects their opposed Fighting (Brawl) rolls
during grapples.

## Skill System

Skills are rated 0-100%+ on a percentile scale. Each skill
has a base chance representing untrained ability. CoC 7e uses
its own curated skill list (see skills.md) with names like
Spot Hidden, Library Use, and Psychology rather than BRP
generics.

### Skill Roll Resolution

Roll D100 equal to or under the skill rating to succeed.
Six degrees of outcome:

| Result | Threshold | Effect |
|--------|-----------|--------|
| Critical | 01 | Best possible outcome |
| Extreme | <= 1/5 of skill | Exceptional result |
| Hard | <= 1/2 of skill | Good result; overcomes difficult challenges |
| Regular | <= skill rating | Standard success |
| Failure | > skill rating | Task not accomplished |
| Fumble | 96-00 if skill < 50%; 00 if skill >= 50% | Dramatic mishap |

CoC 7e uses the terms Critical, Extreme, Hard, and Regular
(not the BRP terms Critical, Special, and Success).

### Difficulty Levels

| Difficulty | Threshold |
|------------|-----------|
| Regular | Roll under skill |
| Hard | Roll under half skill |
| Extreme | Roll under one-fifth skill |

The Keeper sets the difficulty before the roll. Most rolls are
Regular. Hard applies when conditions are challenging. Extreme
is reserved for near-impossible tasks.

### Bonus and Penalty Dice

Instead of BRP's numeric modifiers, CoC 7e uses bonus and
penalty dice. Roll an extra tens die:

- **Bonus die**: Take the lower tens die (better result).
- **Penalty die**: Take the higher tens die (worse result).

Multiple bonus/penalty dice can stack (up to 2). If both
apply, they cancel one-for-one. The Keeper assigns them based
on circumstances.

### Pushing Rolls

When a regular skill roll fails, the player may "push" the
roll -- one re-attempt with greater effort and risk:

- Describe how the attempt differs from the first try.
- If the pushed roll fails, consequences are much worse.
- Each roll can only be pushed once.
- Combat rolls and SAN rolls cannot be pushed.

### Opposed Rolls

When two characters' skills directly contest each other, both
roll and compare success levels:

1. Higher success level wins (Extreme > Hard > Regular).
2. If tied, the higher roll that still succeeded wins.
3. If still tied, the higher skill rating wins.

### Luck Spending

After a failed skill roll, spend Luck points equal to the
difference between the roll and the skill rating to convert
failure to success. Cannot be used on SAN rolls, damage rolls,
or pushed rolls.

## Combat Basics

Combat rounds are approximately 12 seconds. Characters act in
DEX rank order (highest DEX first).

### Actions per Round

Each character gets one action per round:

| Action | Description |
|--------|-------------|
| Attack (melee) | Fighting (Brawl) or weapon skill roll |
| Attack (ranged) | Firearms skill roll |
| Move | Up to MOV x 5 yards if taking no other action |
| Flee | Initiate a chase |
| Skill use | One non-combat skill (First Aid, etc.) |
| Other | Draw weapon, stand up, etc. |

### Defensive Reactions

Defensive reactions respond to attacks and do not use the
character's action:

- **Dodge**: Roll Dodge skill. Success avoids the attack.
- **Fight Back**: Roll Fighting skill against a melee attack.
  If successful and higher than the attacker's roll, the
  defender avoids the attack and deals damage.
- **Use Cover**: Drop behind cover against ranged attacks.

One free defensive reaction per round. Each additional reaction
incurs a cumulative penalty die.

### Damage and Injury

- Damage reduces HP. At 0 HP, the investigator is dying.
- **Major Wound**: Damage in a single hit >= half max HP.
  The investigator must make a CON roll or fall unconscious.
  Major wounds need First Aid within one round and extended
  medical treatment.
- **Armour**: Subtracts from incoming damage.

### Firearms

Range affects rolls: point-blank (bonus die), base range (no
modifier), long range (penalty die), extreme range (not
possible for most weapons). No damage bonus applies.

## Sanity System

CoC's signature mechanic and central dramatic engine.

### Sanity Points

- **Starting SAN**: Equal to POW (the percentile value).
- **Maximum SAN**: 99 minus Cthulhu Mythos skill.
- **Current SAN**: Tracks moment-to-moment mental state.

### Sanity Checks

When encountering something horrifying, the Keeper calls for a
SAN roll (D100 under current SAN):
- **Success**: Lose the smaller amount (often 0 or 1 point).
- **Failure**: Lose the larger amount (varies by encounter).

SAN losses are expressed as success/failure. Example: 0/1D6
means lose nothing on success, 1D6 on failure.

### Bouts of Madness

- **Temporary**: Losing 5+ SAN from one event triggers
  temporary madness (1D10 hours or until treated).
- **Indefinite**: Losing 20%+ of current SAN in one session
  triggers indefinite insanity (requires extended treatment).
- **Permanent**: Reaching 0 SAN. The investigator is retired.

### The Mythos Doom Spiral

As Cthulhu Mythos skill increases, maximum SAN decreases.
The most knowledgeable investigators are the most fragile.

## Experience and Advancement

When a skill succeeds under stress, mark an experience check.
Between adventures, roll D100 for each checked skill: if the
roll exceeds the current skill rating, the skill increases
by 1D10 points.

Cthulhu Mythos cannot be improved through experience checks.
It only increases through Mythos encounters and tome study.

## Entity Attributes for CoC

```yaml
npc:
  occupation: string
  characteristics:
    str: number (percentile, e.g. 60)
    con: number
    siz: number
    int: number
    pow: number
    dex: number
    app: number
    edu: number
  derived:
    hp: number   # (CON+SIZ)/10
    mp: number   # POW/5
    san: number  # starting = POW
    luck: number # 3D6x5
    damage_bonus: string
    build: number
    mov: number
    dodge: number  # DEX/2
  skills:
    - name: string
      value: number
```

## External References

- [Chaosium Inc. (publisher)](https://www.chaosium.com/)
- [Call of Cthulhu character sheets (free download)](https://www.chaosium.com/cthulhu-character-sheets/)
- [BRP ORC License](https://www.chaosium.com/orclicense)
- [Dhole's House (online investigator generator)](https://www.dholeshouse.org/)
