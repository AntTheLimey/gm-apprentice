> This file includes material from the System Reference
> Document 5.2 by Wizards of the Coast LLC (CC-BY 4.0).
> See ATTRIBUTION.md for full details.

# D&D 5e 2024 — Core Mechanics

## Overview

Heroic fantasy adventure game using a d20-based resolution system.
Published by Wizards of the Coast. The 2024 revision updates the
original 2014 rules with refined class designs, weapon mastery
properties, streamlined crafting, and revised feat structures while
maintaining backward compatibility. Characters are defined by
species, class, background, and level, and advance from level 1 to
20 through experience points or milestone progression.

## Dice Conventions

| Die Type | Usage |
|----------|-------|
| d20 | Core resolution (ability checks, attack rolls, saving throws) |
| d4, d6, d8, d10, d12 | Damage, healing, hit dice, variable effects |
| d100 (percentile) | Random tables, Wild Magic Surge |

The d20 is rolled against a target number: a Difficulty Class (DC)
for checks and saves, or an Armor Class (AC) for attacks. Meeting
or exceeding the target is a success.

**Advantage and Disadvantage**: Roll 2d20 and take the highest
(advantage) or lowest (disadvantage). Multiple sources do not
stack; if both apply simultaneously, they cancel out.

## Ability Scores

| Ability | Abbreviation | Description |
|---------|-------------|-------------|
| Strength | STR | Physical power, melee attacks, carrying capacity |
| Dexterity | DEX | Agility, reflexes, ranged attacks, AC |
| Constitution | CON | Health, stamina, concentration saves |
| Intelligence | INT | Reasoning, memory, arcane magic |
| Wisdom | WIS | Perception, insight, divine/primal magic |
| Charisma | CHA | Force of personality, social influence |

**Score Range**: 1-30 for all creatures. Player characters
typically start at 8-15 and cap at 20 without magic or special
features.

**Ability Modifier**: Calculated as `floor((score - 10) / 2)`.

| Score | Modifier | Score | Modifier |
|-------|----------|-------|----------|
| 3     | -4       | 12-13 | +1       |
| 4-5   | -3       | 14-15 | +2       |
| 6-7   | -2       | 16-17 | +3       |
| 8-9   | -1       | 18-19 | +4       |
| 10-11 | +0       | 20    | +5       |

## Derived Statistics

| Stat | Formula |
|------|---------|
| Armor Class (AC) | 10 + DEX modifier (unarmored); varies by armor |
| Hit Points (HP) | Hit die + CON modifier at 1st level; roll or average per additional level |
| Initiative | DEX modifier (+ bonuses from feats/features) |
| Proficiency Bonus | Based on character level (+2 at 1st, +6 at 17th) |
| Spell Save DC | 8 + proficiency bonus + spellcasting ability modifier |
| Spell Attack Bonus | Proficiency bonus + spellcasting ability modifier |
| Passive Perception | 10 + Perception modifier |
| Speed | Typically 30 ft (varies by species) |

## Proficiency Bonus by Level

| Level | Proficiency Bonus |
|-------|-------------------|
| 1-4   | +2                |
| 5-8   | +3                |
| 9-12  | +4                |
| 13-16 | +5                |
| 17-20 | +6                |

## Skills

Eighteen skills, each tied to one ability score.

| Skill | Ability | Skill | Ability |
|-------|---------|-------|---------|
| Acrobatics | DEX | Medicine | WIS |
| Animal Handling | WIS | Nature | INT |
| Arcana | INT | Perception | WIS |
| Athletics | STR | Performance | CHA |
| Deception | CHA | Persuasion | CHA |
| History | INT | Religion | INT |
| Insight | WIS | Sleight of Hand | DEX |
| Intimidation | CHA | Stealth | DEX |
| Investigation | INT | Survival | WIS |

## D20 Tests

**Standard Check**: d20 + ability modifier + proficiency bonus (if
proficient) against a DC.

| DC | Difficulty |
|----|------------|
| 5 | Very Easy |
| 10 | Easy |
| 15 | Medium |
| 20 | Hard |
| 25 | Very Hard |
| 30 | Nearly Impossible |

**Critical Hit**: Natural 20 on an attack roll always hits and
the attack's damage dice are rolled twice (SRD 5.2, CC-BY-4.0).

**Natural 20/1 on Attack Rolls**: A natural 20 always hits
regardless of AC; a natural 1 always misses (SRD 5.2,
CC-BY-4.0).

## Class Table

Twelve core classes, subclass chosen at level 3 (standardized in
2024 revision).

| Class | Hit Die | Primary Ability | Role |
|-------|---------|----------------|------|
| Barbarian | d12 | STR | Melee combatant, damage soaking |
| Bard | d8 | CHA | Support caster, skill expert |
| Cleric | d8 | WIS | Divine healer, varied domains |
| Druid | d8 | WIS | Nature caster, shapeshifter |
| Fighter | d10 | STR or DEX | Versatile martial combatant |
| Monk | d8 | DEX and WIS | Unarmed martial artist |
| Paladin | d10 | STR and CHA | Holy warrior, smite damage |
| Ranger | d10 | DEX and WIS | Tracker, skirmisher |
| Rogue | d8 | DEX | Sneak Attack, skill mastery |
| Sorcerer | d6 | CHA | Innate magic, metamagic |
| Warlock | d8 | CHA | Pact magic, invocations |
| Wizard | d6 | INT | Learned magic, vast spell list |

## Weapon Mastery (2024 Revision)

Martial classes gain weapon mastery properties.

| Mastery | Effect (SRD 5.2, CC-BY-4.0) |
|---------|--------|
| Cleave | On hit, make a melee attack roll against a second creature within 5 ft; don't add ability modifier to damage |
| Graze | On a miss, deal ability modifier damage of the weapon's type |
| Nick | Light property extra attack is part of the Attack action, not a Bonus Action |
| Push | Push Large or smaller target up to 10 ft straight away on hit |
| Sap | Target has Disadvantage on its next attack roll before your next turn |
| Slow | Reduce target's Speed by 10 ft until start of your next turn (doesn't stack) |
| Topple | Target must succeed on a CON save (DC 8 + ability mod + proficiency) or fall Prone |
| Vex | On hit with damage, gain Advantage on your next attack against that target before end of your next turn |

## Conditions (SRD 5.2, CC-BY-4.0)

| Condition | Key Effect |
|-----------|-----------|
| Blinded | Can't see; attacks against have Advantage, own attacks have Disadvantage |
| Charmed | Can't attack charmer; charmer has Advantage on social checks |
| Deafened | Can't hear; auto-fails hearing-based checks |
| Exhaustion | Cumulative levels: -2 per level on D20 Tests, -5 ft Speed per level; 6 levels = death |
| Frightened | Disadvantage on checks/attacks while source is in sight; can't willingly move closer |
| Grappled | Speed 0; ends if grappler is Incapacitated or target is moved out of range |
| Incapacitated | Can't take actions or reactions; Disadvantage on Initiative |
| Invisible | Can't be seen; attacks against have Disadvantage, own attacks have Advantage |
| Paralyzed | Incapacitated; auto-fails STR/DEX saves; attacks have Advantage; hits within 5 ft are Critical |
| Petrified | Incapacitated; weight x10; immune to poison/disease; resistant to all damage |
| Poisoned | Disadvantage on attack rolls and ability checks |
| Prone | Disadvantage on attacks; melee attacks within 5 ft have Advantage; ranged attacks have Disadvantage |
| Restrained | Speed 0; attacks against have Advantage; own attacks have Disadvantage; DEX saves at Disadvantage |
| Stunned | Incapacitated; auto-fails STR/DEX saves; attacks have Advantage |
| Unconscious | Incapacitated and Prone; drop held items; auto-fail STR/DEX saves; attacks have Advantage; hits within 5 ft are Critical |

Note: Exhaustion in the 2024 revision is cumulative levels
that reduce D20 Tests by 2x level and Speed by 5 ft x level.
A Long Rest removes 1 Exhaustion level. At 6 levels, the
creature dies.

## Heroic Inspiration (SRD 5.2, CC-BY-4.0)

A player character can hold one instance of Heroic Inspiration
at a time. Expend it to reroll any die immediately after rolling;
you must use the new roll. If you gain Heroic Inspiration while
already having it, you can give it to another PC who lacks it.

## Character Advancement

| Tier | Levels | Proficiency | Description |
|------|--------|-------------|-------------|
| 1 | 1-4 | +2 | Local heroes |
| 2 | 5-10 | +3 to +4 | Heroes of the realm |
| 3 | 11-16 | +4 to +5 | Masters of the realm |
| 4 | 17-20 | +6 | Masters of the world |

| Level | Experience Points | Proficiency Bonus |
|-------|-------------------|-------------------|
| 1     | 0                 | +2                |
| 2     | 300               | +2                |
| 3     | 900               | +2                |
| 4     | 2,700             | +2                |
| 5     | 6,500             | +3                |
| 6     | 14,000            | +3                |
| 7     | 23,000            | +3                |
| 8     | 34,000            | +3                |
| 9     | 48,000            | +4                |
| 10    | 64,000            | +4                |
| 11    | 85,000            | +4                |
| 12    | 100,000           | +4                |
| 13    | 120,000           | +5                |
| 14    | 140,000           | +5                |
| 15    | 165,000           | +5                |
| 16    | 195,000           | +5                |
| 17    | 225,000           | +6                |
| 18    | 265,000           | +6                |
| 19    | 305,000           | +6                |
| 20    | 355,000           | +6                |

## Sources

- Wizards of the Coast, Systems Reference Document 5.2
  (CC-BY-4.0).
- Wizards of the Coast, 2024 Player's Handbook.

## External References

When you need the full detail of a framework referenced above,
fetch the original source at runtime. Do not reproduce the
content — summarize what you learn in your own words for the
user.
