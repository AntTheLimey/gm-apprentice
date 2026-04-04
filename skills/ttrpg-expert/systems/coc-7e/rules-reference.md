> BRP mechanics: BRP ORC License. See ATTRIBUTION.md.

# Call of Cthulhu 7e — Rules Reference

Advanced mechanics for play: detailed skill resolution, opposed
rolls, combat flow, pushing rolls, sanity, luck spending, chase
rules, recovery, and experience.

## Skill Rolls and Success Levels (BRP ORC License)

### Basic Resolution

Roll D100 (two ten-sided dice) equal to or under the skill
rating to succeed. The roll produces five possible outcomes:

| Result | Threshold | Effect |
|--------|-----------|--------|
| Critical | 01 (always) | Best possible outcome; max damage, bypass armor |
| Extreme | <= 1/5 of skill | Exceptional result; special effects (impale, knockback) |
| Hard | <= 1/2 of skill | Good result; overcomes difficult challenges |
| Regular | <= skill rating | Adequate result |
| Failure | > skill rating | Task not accomplished |
| Fumble | 96-00 if skill < 50%; 00 if skill >= 50% | Dramatic mishap |

CoC 7e uses the terms Hard and Extreme in place of BRP's
Special and Critical for the intermediate success levels.

### Difficulty Levels

| Difficulty | Threshold |
|------------|-----------|
| Regular | Roll under skill |
| Hard | Roll under half skill |
| Extreme | Roll under one-fifth skill |

The Keeper sets the difficulty before the roll. Most rolls are
Regular. Hard applies to challenging circumstances. Extreme is
reserved for near-impossible tasks.

### Bonus and Penalty Dice

Instead of numeric modifiers, CoC 7e uses bonus and penalty
dice. Roll an extra tens die:

- **Bonus die**: Take the lower tens die (better result).
- **Penalty die**: Take the higher tens die (worse result).

Multiple bonus/penalty dice can stack (up to 2). If both apply,
they cancel one-for-one.

## Opposed Rolls (BRP ORC License)

When two characters' skills or characteristics directly contest
each other, use an opposed roll. Three methods from BRP:

### Method 1: Highest Success Level

Both participants roll. Compare success levels:
1. Higher success level wins (Extreme > Hard > Regular).
2. If tied, the higher roll that still succeeded wins.
3. If still tied, the higher skill rating wins.

This is the default method in CoC 7e.

### Method 2: Subtraction

The passive party rolls first. If successful, their full skill
value is subtracted from the active party's skill rating before
the active roll. Used when one party is actively resisting.

### Method 3: Resistance Table

Convert both skills to a characteristic-scale value (divide
by 5) and resolve using the resistance table formula:
Chance = 50% + (active x 5) - (passive x 5). Used when
comparing raw capabilities rather than trained skills.

## Combat Flow (BRP ORC License)

### Round Structure

Each combat round is approximately 12 seconds. Rounds proceed
in DEX rank order (highest DEX acts first).

**Round phases:**

1. **Declaration**: In reverse DEX order (lowest first), each
   combatant states their intended action.
2. **Action Resolution**: In DEX rank order (highest first),
   each combatant resolves their action.
3. **End of Round**: Apply ongoing effects, check for
   unconsciousness or death.

### Actions per Round

Each character gets one action per round:

| Action | Description |
|--------|-------------|
| Attack (melee) | Fighting (Brawl) or weapon skill roll |
| Attack (ranged) | Firearms skill roll |
| Move | Up to MOV x 5 yards if taking no other action |
| Flee | Initiate a chase (see Chase Rules) |
| Skill use | One non-combat skill (First Aid, etc.) |
| Other | Draw weapon, stand up, etc. |

### Defensive Reactions

Defensive reactions are taken in response to attacks and do not
use up the character's action:

- **Dodge**: Roll Dodge skill. Success avoids the attack
  entirely. Usable against melee and ranged attacks.
- **Fighting Back**: Roll Fighting skill in response to a
  melee attack. If successful and higher than attacker's roll,
  the defender avoids the attack and deals damage.
- **Use Cover**: Drop behind available cover against ranged
  attacks (Keeper's discretion).

Only one defensive reaction per round without penalty. Each
additional reaction beyond the first suffers a cumulative
penalty die.

### Damage and Injury

- Damage reduces HP. At 0 HP, the character is dying.
- **Major Wound**: If damage taken in a single hit equals or
  exceeds half the character's max HP, it is a major wound.
  The character must make a CON roll or fall unconscious.
  Major wounds require First Aid within one round and extended
  medical treatment.
- **Armor**: Subtracts from damage (e.g., heavy leather = 1
  point, bulletproof vest = 8 points).

### Firearms Specifics

| Weapon Type | Base Range | Damage | Attacks/Round |
|-------------|-----------|--------|---------------|
| .32 Revolver | 15 yards | 1D8 | 1 (3 in round) |
| .45 Automatic | 15 yards | 1D10+2 | 1 (3 in round) |
| Shotgun (12-gauge) | 10/20/50 | 4D6/2D6/1D6 | 1 or 2 |
| Hunting Rifle | 110 yards | 2D6+4 | 1 (1/2 round) |

Range penalties: point-blank (bonus die), base range (no
modifier), long range (penalty die), extreme range (not
possible for most weapons).

## Pushing Rolls (CoC-Specific)

CoC 7e's signature addition to BRP resolution. When a
regular skill roll fails, the player may request to "push"
the roll -- attempting the task again with greater effort or
risk.

**Pushing rules:**
- The player must describe how they are trying harder or
  differently.
- The Keeper decides if pushing is possible (some situations
  do not allow a second attempt).
- Roll again. If the pushed roll also fails, the consequences
  are significantly worse than the original failure.
- Each roll can only be pushed once.
- Combat rolls cannot be pushed.
- Sanity rolls cannot be pushed.

**Pushed failure consequences** (examples):
- Physical skill: injury, equipment damage, alerting enemies
- Social skill: offending the NPC, burning the bridge
- Mental skill: wasted time, false conclusion, attracting
  attention

Pushing creates dramatic tension: the player chooses between
accepting a failure and risking something worse.

## Sanity System Overview (CoC-Specific)

CoC's signature mechanic. This overview is conceptual.

### Sanity Points

- **Starting SAN**: POW x 5.
- **Maximum SAN**: 99 minus Cthulhu Mythos skill.
- **Current SAN**: Tracks moment-to-moment mental state.

### Sanity Checks

When an investigator encounters something horrifying:
1. The Keeper calls for a SAN roll (D100 under current SAN).
2. **Success**: Lose the smaller amount (often 0 or 1 point).
3. **Failure**: Lose the larger amount (varies by encounter).

Typical SAN losses:

| Encounter | Success | Failure |
|-----------|---------|---------|
| Surprise corpse | 0 | 1 |
| Ghoul | 0 | 1D6 |
| Deep One | 0 | 1D6 |
| Shoggoth | 1D6 | 1D20 |
| Great Old One | 1D10 | 1D100 |

### Bouts of Madness

- **Temporary**: Losing 5+ SAN in one event triggers a bout
  of temporary madness (lasts 1D10 hours or until treated).
- **Indefinite**: Losing 20% or more of current SAN in one
  game session triggers indefinite insanity (requires
  extended treatment).
- **Permanent**: Reaching 0 SAN. The investigator is retired
  as permanently and incurably insane.

### The Mythos Doom Spiral

As Cthulhu Mythos skill increases, maximum SAN decreases.
The most knowledgeable investigators are the most fragile.
This is the core dramatic engine of CoC.

## Luck Spending (CoC-Specific)

Luck is a spendable resource in CoC 7e:

- **Spending**: After a failed skill roll, spend Luck points
  equal to the difference between the roll and the skill
  rating to convert the failure into a success.
- **Depletion**: Spent Luck is gone until recovered. As Luck
  depletes, the investigator's safety net disappears.
- **Recovery**: Luck may be recovered between sessions at the
  Keeper's discretion (typically 1D10 per session).
- **Group Luck**: The investigator with the lowest Luck score
  sets the difficulty for group Luck rolls.

Luck spending cannot be used on SAN rolls, damage rolls, or
to improve pushed rolls.

## Chase Rules (CoC-Specific)

CoC 7e uses a structured chase system with an abstract track:

### Setting Up a Chase

1. **Chase track**: Draw a line of locations (10-20 spaces).
   Place the pursuer and quarry at their starting positions.
2. **Speed**: MOV determines spaces moved per round. Higher
   MOV = more spaces.
3. **Hazards**: The Keeper places hazards at intervals on the
   track (fences, traffic, locked doors, crowds).

### Chase Round

1. Each participant moves their MOV in spaces.
2. Optionally, attempt a CON roll to gain +1 space (failure
   means no extra movement and possible fatigue).
3. If a hazard is encountered, roll the appropriate skill to
   navigate it. Failure costs 1 space and may cause damage.
4. Participants may spend actions on attacks, skill use, or
   creating obstacles for those behind them.

### Chase Resolution

- **Caught**: Pursuer occupies the same space as quarry.
- **Escaped**: Quarry reaches the end of the track or opens
  a gap beyond the pursuer's ability to close.
- **Complications**: Bystander injuries, property damage,
  attracting police attention.

## Recovery and Healing

### Hit Point Recovery

- **First Aid**: Heals 1 HP if applied within one round of
  injury (one hour for non-combat wounds). Requires a
  successful First Aid roll.
- **Medicine**: Heals 1D3 HP. Requires a successful Medicine
  roll and proper facilities.
- **Natural healing**: 1 HP per week of rest.
- **Major wounds**: Require successful Medicine roll plus
  1D4 weeks of recovery. Without treatment, make a CON roll
  each day or lose 1 HP.

### Sanity Recovery

- **Psychoanalysis**: A successful Psychoanalysis roll can
  restore 1D3 SAN points. One attempt per month of treatment.
- **Self-help**: Achieving a personal goal or resolving a
  backstory element may restore SAN at the Keeper's
  discretion.
- **Institutional care**: Extended stay in a sanatorium can
  restore larger amounts over months of game time.
- **Mythos ceiling**: SAN lost to Cthulhu Mythos knowledge
  can never be recovered.

### Magic Point Recovery

Magic points regenerate at a rate of 1 per 2 hours of rest,
fully recovering after 24 hours.

## Resistance Table Usage (BRP ORC License)

The resistance table resolves contests between characteristics:

**Formula**: Chance = 50% + (active x 5) - (passive x 5)

| Active - Passive | Chance | Active - Passive | Chance |
|-----------------|--------|-----------------|--------|
| -10 or less | 01% (auto-fail) | +1 | 55% |
| -5 | 25% | +5 | 75% |
| -3 | 35% | +7 | 85% |
| -1 | 45% | +10 or more | 99% (auto-succeed) |
| 0 | 50% | | |

Common uses:
- STR vs SIZ: forcing doors, grappling, lifting
- POT vs CON: poison and disease resistance
- POW vs POW: magical resistance, willpower contests
- STR vs STR: arm wrestling, tug-of-war

## Experience Checks (BRP ORC License)

### During Play

When a skill is used successfully under stressful conditions,
the player marks an experience check next to that skill.

### Between Adventures

For each checked skill, roll D100:
- If the roll **exceeds** the current skill rating, the skill
  increases by 1D10 points.
- If the roll is equal to or under the current skill, no
  improvement occurs.

**Skill deterioration**: Skills above 90% are harder to
improve (the roll must exceed 90+). This creates a natural
ceiling on expertise.

**Cthulhu Mythos**: Cannot be improved through experience
checks. Only increases through encounters with the Mythos.

## External References

- [Chaosium Inc. (publisher)](https://www.chaosium.com/)
- [BRP ORC License](https://www.chaosium.com/orclicense)
- [Dhole's House (online investigator generator)](https://www.dholeshouse.org/)
