# Call of Cthulhu 7e -- Rules Reference

Advanced mechanics for play: detailed skill resolution, opposed
rolls, combat flow, pushing rolls, sanity, luck spending, chase
rules, recovery, and experience.

## Skill Rolls and Success Levels

### Basic Resolution

Roll D100 (two ten-sided dice) equal to or under the skill
rating to succeed. The roll produces six possible outcomes:

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

## Opposed Rolls

When two characters' skills or characteristics directly contest
each other, use an opposed roll. Both participants roll and
compare success levels:

1. Higher success level wins (Extreme > Hard > Regular).
2. If tied, the higher roll that still succeeded wins.
3. If still tied, the higher skill rating wins.

This is the standard method in CoC 7e. When characteristics
directly oppose each other (e.g., STR vs STR in a grapple),
both parties roll against their characteristic as if it were
a skill, comparing success levels the same way.

## Combat Flow

### Round Structure

Each combat round is approximately 12 seconds. Rounds proceed
in DEX order (highest DEX acts first).

**Round phases:**

1. **Determine Initiative**: Characters act in DEX order
   (highest first); a readied firearm shoots at DEX + 50
   (p.112). Ties go to the higher combat skill.
2. **Actions**: Each combatant resolves their action in DEX
   order. Defensive reactions are declared when attacked.
3. **End of Round**: Apply ongoing effects, check for
   unconsciousness, dying, or death.

### Actions per Round

Each character gets one action per round:

| Action | Description |
|--------|-------------|
| Attack (melee) | Fighting (Brawl) or weapon skill roll |
| Attack (ranged) | Firearms skill roll |
| Move | Up to MOV yards and still act normally; up to MOV x 5 yards and then one melee attack at the end of the round, or shots with a penalty die (p.127) |
| Flee | Initiate a chase (see Chase Rules) |
| Skill use | One non-combat skill (First Aid, etc.) |
| Other | Draw weapon, stand up, etc. |

### Defensive Reactions

Defensive reactions are taken in response to attacks and do not
use up the character's action:

- **Dodge**: Opposed Dodge roll against a melee or thrown
  attack. A higher level of success, or the same level, avoids
  the attack.
- **Fighting Back**: Opposed Fighting roll against a melee
  attack. A higher level of success avoids the attack and deals
  damage; the same level goes to the attacker.
- **Dive for Cover**: Against shots, a Dodge roll; if it
  succeeds, the shooter takes a penalty die. Either way the
  diver forfeits their next attack (p.113).

A character may dodge or fight back against every attack. Once
they have, later melee attacks on them that round gain a bonus
die. A creature with several attacks a round may defend that
many times first (Keeper Rulebook p.108; see
combat-reference.md).

### Damage and Injury

- Damage reduces HP. At 0 HP alone the character is
  Unconscious; Dying needs a Major Wound as well (Keeper
  Rulebook p.120).
- **Major Wound**: If damage taken in a single hit is at least
  half the character's max HP, it is a major wound (p.119). The
  character falls prone and makes a CON roll or falls
  unconscious (p.120). First Aid must come within one hour to
  help; only First Aid stabilises a dying character (p.120).
- **Armor**: Subtracts from damage (e.g., heavy leather = 1
  point, bulletproof vest = 8 points).

### Firearms Specifics

| Weapon Type | Base Skill | Damage | Attacks/Round |
|-------------|-----------|--------|---------------|
| .32 Revolver | 20% | 1D8 | 1 (3 per round) |
| .45 Automatic | 20% | 1D10+2 | 1 (3 per round) |
| Shotgun (12-gauge) | 25% | 4D6/2D6/1D6 | 1 or 2 |
| Hunting Rifle | 25% | 2D6+4 | 1 (1 per 2 rounds) |

Range sets the difficulty: point-blank (within a fifth of DEX
in feet) gains a bonus die, base range is Regular, long range
(up to 2x base) is Hard, very long range (up to 4x base) is
Extreme. No damage bonus applies to firearms.

## Pushing Rolls

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

## Sanity System

CoC's signature mechanic and central dramatic engine.

### Sanity Points

- **Starting SAN**: Equal to POW (the percentile value).
- **Maximum SAN**: 99 minus Cthulhu Mythos skill.
- **Current SAN**: Tracks moment-to-moment mental state.

### Sanity Checks

When an investigator encounters something horrifying:
1. The Keeper calls for a SAN roll (D100 under current SAN).
2. **Success**: Lose the smaller amount (often 0 or 1 point).
3. **Failure**: Lose the larger amount (varies by encounter).

SAN losses are expressed as success/failure (e.g., 0/1D6 means
zero points on a successful SAN roll, 1D6 on a failed roll).
Typical ranges by threat severity:

| Threat Level | Typical Loss | Examples |
|-------------|-------------|---------|
| Mundane horror | 0/1 | Discovering a mutilated body, witnessing a violent death |
| Minor unnatural | 0/1D4 | First sight of a minor supernatural creature or impossible event |
| Significant unnatural | 0/1D6 | Encountering a clearly inhuman entity, reading a blasphemous text |
| Major Mythos | 1/1D10 | Witnessing a powerful alien entity, experiencing dimensional warping |
| Overwhelming | 1D10/1D100 | Direct encounter with a cosmic-scale entity |

Specific SAN losses for individual creatures and events are
listed in the Keeper Rulebook and published scenarios.

### Bouts of Madness

- **Temporary**: Losing 5 or more SAN from one roll calls for
  an INT roll; a success means temporary insanity (1D10 hours)
  (Keeper Rulebook p.155).
- **Indefinite**: Losing a fifth or more of current SAN in one
  game day triggers indefinite insanity (requires extended
  treatment) (p.155).
- **Permanent**: Reaching 0 SAN. The investigator is retired
  as permanently and incurably insane.

### The Mythos Doom Spiral

As Cthulhu Mythos skill increases, maximum SAN decreases.
The most knowledgeable investigators are the most fragile.
This is the core dramatic engine of CoC.

## Luck Spending

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

## Chase Rules

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

Magic points regenerate at 1 per hour (2 per hour with POW
over 100, 3 over 200), never above a fifth of POW (Keeper
Rulebook p.176; see powers-magic.md).

## Experience and Improvement

### During Play

When a skill is used successfully under stressful conditions,
the player marks an experience check next to that skill.

### Between Adventures

For each checked skill, roll D100:
- If the roll **exceeds** the current skill rating, the skill
  increases by 1D10 points.
- If the roll is equal to or under the current skill, no
  improvement occurs.

**High skills**: Skills above 90% are harder to improve (the
roll must exceed 90+). This creates a natural ceiling on
expertise.

**Cthulhu Mythos**: Cannot be improved through experience
checks. Only increases through reading Mythos tomes and
encounters with Mythos entities.

## External References

- [Chaosium Inc. (publisher)](https://www.chaosium.com/)
- [BRP ORC License](https://www.chaosium.com/orclicense)
- [Dhole's House (online investigator generator)](https://www.dholeshouse.org/)
