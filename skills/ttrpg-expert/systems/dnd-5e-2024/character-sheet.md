# D&D 5e 2024 -- Character Sheet Reference

Complete sheet reference for the d20 system. Use this to build, audit, or understand any character sheet field.

## Identity Block

| Field | Source |
|-------|--------|
| Character Name | Player choice |
| Class / Subclass | Class (lv 1) / Subclass (lv 3) |
| Level | 1-20; see XP table in mechanics.md |
| Experience Points | 0 at level 1; see advancement table |
| Species | See character-generation.md |
| Background | See character-generation.md |
| Alignment | LG/NG/CG/LN/N/CN/LE/NE/CE |
| Player Name | Real-world player |

## Ability Scores and Modifiers

Six scores (STR, DEX, CON, INT, WIS, CHA). Each has a modifier: `floor((score - 10) / 2)`.

| Score Range | Modifier |
|------------|----------|
| 8-9 | -1 |
| 10-11 | +0 |
| 12-13 | +1 |
| 14-15 | +2 |
| 16-17 | +3 |
| 18-19 | +4 |
| 20 | +5 |

## Proficiency Bonus

Determined by total character level, not class level.

| Level | PB | Level | PB |
|-------|----|-------|----|
| 1-4 | +2 | 13-16 | +5 |
| 5-8 | +3 | 17-20 | +6 |
| 9-12 | +4 | | |

## Core Combat Stats

| Stat | How to Calculate |
|------|-----------------|
| **Armor Class** | 10 + DEX mod (unarmored). With armor: see armor table. Shield adds +2. |
| **Initiative** | DEX mod + any bonuses (Alert feat adds PB) |
| **Speed** | From species (typically 30 ft). Modified by armor, features |
| **Hit Point Maximum** | Level 1: hit die max + CON mod. Higher levels: roll or average hit die + CON mod per level |
| **Current HP** | Track during play |
| **Temporary HP** | Don't stack; take highest. Don't restore; buffer before real HP |
| **Hit Dice** | One per level, die size from class. Spend on Short Rest to heal |
| **Passive Perception** | 10 + WIS (Perception) mod. Adv = +5, Disadv = -5 |

## Death Saves

At 0 HP, roll d20 at start of each turn (DC 10):
- 10+ = success. Three successes = stabilised.
- 1-9 = failure. Three failures = death.
- Nat 20 = regain 1 HP. Nat 1 = two failures.
- Damage at 0 HP = auto failure (crit within 5 ft = two failures).

## Saving Throws

Each class grants proficiency in 2 saves. Formula: ability mod + PB (if proficient).

| Class | Proficient Saves |
|-------|-----------------|
| Barbarian | STR, CON |
| Bard | DEX, CHA |
| Cleric | WIS, CHA |
| Druid | INT, WIS |
| Fighter | STR, CON |
| Monk | STR, DEX |
| Paladin | WIS, CHA |
| Ranger | STR, DEX |
| Rogue | DEX, INT |
| Sorcerer | CON, CHA |
| Warlock | WIS, CHA |
| Wizard | INT, WIS |

## Skills (18)

Formula: ability mod + PB (if proficient). Expertise = double PB.

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

Proficiencies come from class (2-4 skills) + background (2 skills).

## Attacks

| Field | Formula |
|-------|---------|
| Melee attack bonus | STR mod + PB (or DEX for Finesse) |
| Ranged attack bonus | DEX mod + PB |
| Melee damage | Weapon die + STR mod (or DEX for Finesse) |
| Ranged damage | Weapon die + DEX mod |
| Spell attack bonus | Spellcasting ability mod + PB |

## Equipment

Record items, quantity, and weight. See equipment.md for full tables.

### Currency

| CP | SP | EP | GP | PP |
|----|----|----|----|----|
| 100 CP = 1 GP | 10 SP = 1 GP | 2 EP = 1 GP | 1 GP | 1 PP = 10 GP |

## Features and Traits

- **Class Features:** From class table by level
- **Species Traits:** From species (see character-generation.md)
- **Feats:** From background (lv 1) and Ability Score Improvement levels
- **Weapon Masteries:** From class; number increases with level

## Proficiencies

- **Armor Training:** From class (Light/Medium/Heavy/Shield)
- **Weapons:** From class (Simple/Martial/specific)
- **Tools:** From class + background
- **Languages:** Common + 2 standard (from origin)

## Spellcasting Block

| Field | Source |
|-------|--------|
| Spellcasting Ability | Class determines (INT/WIS/CHA) |
| Spell Save DC | 8 + ability mod + PB |
| Spell Attack Bonus | Ability mod + PB |

### Spell Slots by Level

Full casters (Bard, Cleric, Druid, Sorcerer, Wizard) use the standard spell slot progression. Half casters (Paladin, Ranger) get slots at half rate. Warlock uses Pact Magic (fewer slots, all same level, recharge on Short Rest).

### Prepared Spells

All 2024 classes use a prepared spell model. Number of prepared spells shown in class table. Cantrips are always available (no slot cost).

## Backstory Fields

Personality Traits, Ideals, Bonds, Flaws -- from background or player invention.

## Appearance

Age, Height, Weight, Eyes, Skin, Hair, Description -- player choice guided by species.

---
*This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.*
