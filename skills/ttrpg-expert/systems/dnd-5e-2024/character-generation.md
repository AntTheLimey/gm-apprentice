# D&D 5e 2024 -- Character Generation

Step-by-step creation from the SRD 5.2 (2024 revision).

## Creation Workflow

1. **Choose a Class** -- pick from 12 core classes
2. **Determine Origin** -- select background and species, choose languages
3. **Determine Ability Scores** -- generate six scores, assign, adjust
4. **Choose an Alignment** -- nine alignments (LG/NG/CG/LN/N/CN/LE/NE/CE)
5. **Fill in Details** -- class features, derived numbers, equipment, spells

## Step 1: Choose a Class

| Class | Likes | Primary Ability | Complexity |
|-------|-------|-----------------|------------|
| Barbarian | Battle | Strength | Average |
| Bard | Performing | Charisma | High |
| Cleric | Gods | Wisdom | Average |
| Druid | Nature | Wisdom | High |
| Fighter | Weapons | Strength or Dexterity | Low |
| Monk | Unarmed combat | Dexterity and Wisdom | High |
| Paladin | Defense | Strength and Charisma | Average |
| Ranger | Survival | Dexterity and Wisdom | Average |
| Rogue | Stealth | Dexterity | Low |
| Sorcerer | Power | Charisma | High |
| Warlock | Occult lore | Charisma | High |
| Wizard | Spellbooks | Intelligence | Average |

- Write level (typically 1) and XP (0 at level 1).
- At level 3+, choose a subclass.
- Note class's armor training.

## Step 2: Determine Origin

### Backgrounds (SRD 5.2)

Each background provides: a feat, proficiency in 2 skills + 1 tool, starting equipment or 50 GP, and 3 ability scores for Step 3 adjustment.

| Background | Abilities | Feat | Skills | Tool |
|-----------|-----------|------|--------|------|
| Acolyte | INT, WIS, CHA | Magic Initiate (Cleric) | Insight, Religion | Calligrapher's Supplies |
| Criminal | DEX, CON, INT | Alert | Sleight of Hand, Stealth | Thieves' Tools |
| Sage | CON, INT, WIS | Magic Initiate (Wizard) | Arcana, History | Calligrapher's Supplies |
| Soldier | STR, DEX, CON | Savage Attacker | Athletics, Intimidation | Gaming Set (choice) |

### Species (SRD 5.2)

| Species | Size | Speed | Key Traits |
|---------|------|-------|------------|
| Dragonborn | M | 30 ft | Breath Weapon (PB/day), Damage Resistance, Darkvision 60 ft, Draconic Flight (lv 5) |
| Dwarf | M | 30 ft | Darkvision 120 ft, Poison Resistance, Dwarven Toughness (+1 HP/level), Stonecunning |
| Elf | M | 30 ft | Darkvision 60 ft, Fey Ancestry, Keen Senses, Trance. Lineage: Drow/High/Wood |
| Gnome | S | 30 ft | Darkvision 60 ft, Gnomish Cunning (Adv INT/WIS/CHA saves vs magic), Gnomish Lineage |
| Goliath | M | 35 ft | Large Form, Powerful Build, Giant Ancestry (choose one: Cloud/Fire/Frost/Hill/Stone/Storm) |
| Halfling | S | 30 ft | Brave (Adv vs Frightened), Halfling Nimbleness, Luck, Naturally Stealthy |
| Human | M/S | 30 ft | Resourceful (Heroic Inspiration on Long Rest), Skillful (extra skill), Versatile (extra Origin feat) |
| Orc | M | 30 ft | Adrenaline Rush, Darkvision 120 ft, Relentless Endurance (drop to 1 HP instead of 0, 1/LR) |
| Tiefling | M/S | 30 ft | Darkvision 60 ft, Fiendish Legacy (choose Abyssal/Chthonic/Infernal), Otherworldly Presence |

### Languages

Every character knows Common + 2 from the Standard Languages table.

**Standard:** Common Sign Language, Draconic, Dwarvish, Elvish, Giant, Gnomish, Goblin, Halfling, Orc

**Rare:** Abyssal, Celestial, Deep Speech, Druidic, Infernal, Primordial (Aquan/Auran/Ignan/Terran), Sylvan, Thieves' Cant, Undercommon

## Step 3: Determine Ability Scores

### Generation Methods

**Standard Array:** 15, 14, 13, 12, 10, 8

**Random Generation:** Roll 4d6 drop lowest, six times.

**Point Buy (27 points):**

| Score | Cost | Score | Cost |
|-------|------|-------|------|
| 8 | 0 | 12 | 4 |
| 9 | 1 | 13 | 5 |
| 10 | 2 | 14 | 7 |
| 11 | 3 | 15 | 9 |

### Suggested Standard Array by Class

| Class | STR | DEX | CON | INT | WIS | CHA |
|-------|-----|-----|-----|-----|-----|-----|
| Barbarian | 15 | 13 | 14 | 10 | 12 | 8 |
| Bard | 8 | 14 | 12 | 13 | 10 | 15 |
| Cleric | 14 | 8 | 13 | 10 | 15 | 12 |
| Druid | 8 | 12 | 14 | 13 | 15 | 10 |
| Fighter | 15 | 14 | 13 | 8 | 10 | 12 |
| Monk | 12 | 15 | 13 | 10 | 14 | 8 |
| Paladin | 15 | 10 | 13 | 8 | 12 | 14 |
| Ranger | 12 | 15 | 13 | 8 | 14 | 10 |
| Rogue | 12 | 15 | 13 | 14 | 10 | 8 |
| Sorcerer | 10 | 13 | 14 | 8 | 12 | 15 |
| Warlock | 8 | 14 | 13 | 12 | 10 | 15 |
| Wizard | 8 | 12 | 13 | 15 | 14 | 10 |

### Background Adjustment

Your background lists 3 abilities. Increase one by 2 and a different one by 1, or increase all three by 1. No score above 20.

### Ability Modifiers

Formula: `floor((score - 10) / 2)`. See mechanics.md for full table.

## Step 4: Choose Alignment

| | Lawful | Neutral | Chaotic |
|------|--------|---------|---------|
| Good | LG | NG | CG |
| Neutral | LN | N | CN |
| Evil | LE | NE | CE |

Game assumes PCs are not evil. Check with GM before making an evil character.

## Step 5: Fill in Details

### Calculate Numbers

| Number | Formula |
|--------|---------|
| Saving Throws | Ability mod + PB (if proficient) |
| Skill Modifiers | Ability mod + PB (if proficient) |
| Passive Perception | 10 + WIS (Perception) mod |
| Initiative | DEX mod |
| Armor Class | 10 + DEX mod (unarmored); varies with armor |
| Melee Attack | STR mod + PB |
| Ranged Attack | DEX mod + PB |
| Spell Save DC | 8 + spellcasting ability mod + PB |
| Spell Attack | Spellcasting ability mod + PB |

### Level 1 Hit Points

| Class | HP Maximum |
|-------|-----------|
| Barbarian | 12 + CON mod |
| Fighter, Paladin, Ranger | 10 + CON mod |
| Bard, Cleric, Druid, Monk, Rogue, Warlock | 8 + CON mod |
| Sorcerer, Wizard | 6 + CON mod |

### Equipment

Both background and class provide starting equipment. Coins can be spent on additional gear from equipment tables.

### Spellcasting (if applicable)

1. Note spell slots from class table
2. Note cantrips known
3. Note prepared spells count
4. Choose cantrips and prepared spells
5. All 2024 classes use prepared spell model

### Backstory Prompts

Who raised you? Dearest childhood friend? Pets? Fallen in love? Organisations? What drives adventure?

Record personality traits, ideals, bonds, and flaws.

---
*This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.*
