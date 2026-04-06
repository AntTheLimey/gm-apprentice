# D&D 5e 2024 -- Core Mechanics

## System Overview

d20-based heroic fantasy. Roll d20 + modifiers >= target number (DC or AC). Published by Wizards of the Coast; 2024 revision updates the 2014 rules with weapon mastery, streamlined crafting, revised feats, and a unified prepared-spell model. Characters defined by class, species, background, and level (1-20).

## Dice Conventions

| Die | Usage |
|-----|-------|
| d20 | Core resolution: ability checks, attack rolls, saving throws |
| d4/d6/d8/d10/d12 | Damage, healing, hit dice, variable effects |
| d100 | Random tables, Wild Magic Surge |

Roll d20 vs DC (checks/saves) or AC (attacks). Meet or exceed = success. Round down all fractions unless told otherwise.

## The Six Ability Scores

| Ability | Abbr | Measures | Checks | Saves |
|---------|------|----------|--------|-------|
| Strength | STR | Physical might | Lift, push, break | Resist direct force |
| Dexterity | DEX | Agility, reflexes | Move nimbly/quietly | Dodge harm |
| Constitution | CON | Health, stamina | Push body beyond limits | Endure toxins |
| Intelligence | INT | Reasoning, memory | Reason, remember | Recognize illusions |
| Wisdom | WIS | Perception, fortitude | Notice things | Resist mental assault |
| Charisma | CHA | Confidence, poise | Influence, entertain | Assert identity |

**Score range:** 1-30 for all creatures. PCs typically 8-15 at creation, cap at 20 without magic. 10-11 = human average.

### Ability Modifier Table

| Score | Mod | Score | Mod | Score | Mod |
|-------|-----|-------|-----|-------|-----|
| 1 | -5 | 10-11 | +0 | 20-21 | +5 |
| 2-3 | -4 | 12-13 | +1 | 22-23 | +6 |
| 4-5 | -3 | 14-15 | +2 | 24-25 | +7 |
| 6-7 | -2 | 16-17 | +3 | 26-27 | +8 |
| 8-9 | -1 | 18-19 | +4 | 28-29 | +9 |
| | | | | 30 | +10 |

Formula: `floor((score - 10) / 2)`

## Proficiency Bonus by Level

| Level | PB | Level | PB |
|-------|----|-------|----|
| 1-4 | +2 | 13-16 | +5 |
| 5-8 | +3 | 17-20 | +6 |
| 9-12 | +4 | | |

Added to D20 Tests using proficient skills, saves, weapons, or tools.

## D20 Tests

**Formula:** d20 + ability modifier + proficiency bonus (if proficient) + circumstantial bonuses/penalties

Three types: **Ability Checks** (overcome challenges), **Saving Throws** (resist threats), **Attack Rolls** (hit targets).

### Difficulty Classes

| DC | Difficulty |
|----|------------|
| 5 | Very Easy |
| 10 | Easy |
| 15 | Medium |
| 20 | Hard |
| 25 | Very Hard |
| 30 | Nearly Impossible |

## Advantage and Disadvantage

Roll 2d20, take highest (Advantage) or lowest (Disadvantage). Multiple sources do not stack. If both apply simultaneously, they cancel out.

## Attack Rolls

| Attack Type | Ability |
|------------|---------|
| Melee weapon / Unarmed Strike | STR (or DEX with Finesse) |
| Ranged weapon | DEX |
| Spell attack | Spellcasting ability (varies by class) |

**Natural 20:** Always hits, Critical Hit -- roll weapon/spell damage dice twice, then add modifiers.
**Natural 1:** Always misses regardless of modifiers or AC.

## Derived Statistics

| Stat | Formula |
|------|---------|
| Armor Class (AC) | 10 + DEX mod (unarmored); varies by armor |
| Hit Points (HP) | Hit die + CON mod at 1st level; roll or average per level after |
| Initiative | DEX mod (+ bonuses from feats/features) |
| Spell Save DC | 8 + proficiency bonus + spellcasting ability mod |
| Spell Attack Bonus | Proficiency bonus + spellcasting ability mod |
| Passive Perception | 10 + WIS (Perception) mod |
| Speed | Typically 30 ft (varies by species) |

## Skills (18)

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

## Class Summary

| Class | HD | Primary | Saves | Role |
|-------|-----|---------|-------|------|
| Barbarian | d12 | STR | STR/CON | Melee combatant, damage soak |
| Bard | d8 | CHA | DEX/CHA | Support caster, skill expert |
| Cleric | d8 | WIS | WIS/CHA | Divine healer, varied domains |
| Druid | d8 | WIS | INT/WIS | Nature caster, shapeshifter |
| Fighter | d10 | STR/DEX | STR/CON | Versatile martial |
| Monk | d8 | DEX+WIS | STR/DEX | Unarmed martial artist |
| Paladin | d10 | STR+CHA | WIS/CHA | Holy warrior, smite |
| Ranger | d10 | DEX+WIS | STR/DEX | Tracker, skirmisher |
| Rogue | d8 | DEX | DEX/INT | Sneak Attack, skill master |
| Sorcerer | d6 | CHA | CON/CHA | Innate magic, metamagic |
| Warlock | d8 | CHA | WIS/CHA | Pact magic, invocations |
| Wizard | d6 | INT | INT/WIS | Learned magic, vast spell list |

Subclass chosen at level 3 (standardised in 2024 revision).

## Weapon Mastery Properties (2024)

| Mastery | Effect |
|---------|--------|
| Cleave | On hit, attack roll vs second creature within 5 ft; don't add ability mod to damage |
| Graze | On miss, deal ability modifier damage of the weapon's type |
| Nick | Light property extra attack is part of Attack action, not Bonus Action |
| Push | Push Large or smaller target up to 10 ft straight away on hit |
| Sap | Target has Disadvantage on next attack roll before your next turn |
| Slow | Reduce target's Speed by 10 ft until start of your next turn (no stack) |
| Topple | Target must succeed CON save (DC 8 + ability mod + PB) or fall Prone |
| Vex | On hit with damage, Advantage on next attack vs that target before end of next turn |

## Conditions (15)

| Condition | Key Effect |
|-----------|-----------|
| Blinded | Can't see; attacks against have Adv, own attacks have Disadv |
| Charmed | Can't attack charmer; charmer has Adv on social checks |
| Deafened | Can't hear; auto-fails hearing checks |
| Exhaustion | Cumulative levels: -2/level on D20 Tests, -5 ft Speed/level; 6 = death. Long Rest removes 1 level |
| Frightened | Disadv on checks/attacks while source in sight; can't willingly move closer |
| Grappled | Speed 0; ends if grappler Incapacitated or target moved out of range |
| Incapacitated | Can't take actions or reactions; Disadv on Initiative |
| Invisible | Can't be seen; attacks against have Disadv, own attacks have Adv |
| Paralyzed | Incapacitated; auto-fail STR/DEX saves; attacks have Adv; hits in 5 ft are Critical |
| Petrified | Incapacitated; weight x10; immune poison/disease; resistant all damage |
| Poisoned | Disadv on attack rolls and ability checks |
| Prone | Disadv on attacks; melee in 5 ft has Adv; ranged has Disadv. Costs half move to stand |
| Restrained | Speed 0; attacks against have Adv; own attacks have Disadv; DEX saves at Disadv |
| Stunned | Incapacitated; auto-fail STR/DEX saves; attacks have Adv |
| Unconscious | Incapacitated + Prone; drop held items; auto-fail STR/DEX saves; attacks have Adv; hits in 5 ft are Critical |

## Damage Types (13)

Acid, Bludgeoning, Cold, Fire, Force, Lightning, Necrotic, Piercing, Poison, Psychic, Radiant, Slashing, Thunder

**Resistance** = half damage. **Vulnerability** = double damage. **Immunity** = no damage. Each applied once per instance.

## Heroic Inspiration

One instance at a time. Expend to reroll any die immediately after rolling; must use new roll. If you gain it while already having it, give it to another PC who lacks it.

## Character Advancement

| Tier | Levels | PB | Description |
|------|--------|----|-------------|
| 1 | 1-4 | +2 | Local heroes |
| 2 | 5-10 | +3/+4 | Heroes of the realm |
| 3 | 11-16 | +4/+5 | Masters of the realm |
| 4 | 17-20 | +6 | Masters of the world |

### Experience Points Table

| Lvl | XP | PB | Lvl | XP | PB |
|-----|---------|----|----|---------|-----|
| 1 | 0 | +2 | 11 | 85,000 | +4 |
| 2 | 300 | +2 | 12 | 100,000 | +4 |
| 3 | 900 | +2 | 13 | 120,000 | +5 |
| 4 | 2,700 | +2 | 14 | 140,000 | +5 |
| 5 | 6,500 | +3 | 15 | 165,000 | +5 |
| 6 | 14,000 | +3 | 16 | 195,000 | +5 |
| 7 | 23,000 | +3 | 17 | 225,000 | +6 |
| 8 | 34,000 | +3 | 18 | 265,000 | +6 |
| 9 | 48,000 | +4 | 19 | 305,000 | +6 |
| 10 | 64,000 | +4 | 20 | 355,000 | +6 |

---
*This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.*
