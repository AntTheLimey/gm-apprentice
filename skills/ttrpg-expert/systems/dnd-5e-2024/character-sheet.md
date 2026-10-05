# D&D 5e 2024 -- Character Sheet Reference

Complete sheet reference for the d20 system. Use this to build, audit, or understand any character sheet field.

## Writing the Sheet in the Vault

The PC note's layout is the template's (`shared/templates/pc-dnd-5e-2024.md`). The published page finds each block by its heading and column names, so keep both exactly as the template has them; a renamed one falls out of the sheet into a plain table.

**Order of work.** The tool owns the sums, so let it do them first and build on what it wrote:

1. Write the level, the six scores, the save and skill proficiency cells, and any `### Bonuses` rows. Leave every derived cell blank or as it was.
2. Run the tool and show the GM its `FILL` rows; on their yes, run it again with `--write`.
3. Read the modifiers and proficiency bonus it filled, then write what it leaves to you: the attack lines, AC, the hit point maximum and Speed.
4. Add Gear with weights, then run the tool once more so the Carrying values are filled.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/dnd_sheet.py" "path/to/PC.md"
```

It prints a row for every derived cell: `SAME`, `FILL` (old -> new), `KEPT`, or `ERROR` when it cannot read the sheet (nothing is written then; fix the note first). Run it after building a character, after a level-up, and after any change to a score, a proficiency, a bonus or the gear.

**Bonuses, not hand sums.** A hand sum is right today and stale at the next level-up. An item, feat or feature that adds to saves, checks, initiative or the spell numbers gets one row in `### Bonuses` (`Applies To | Bonus | Source`); the tool adds it in and says so in its report, and the cell it feeds stays a bare number.

- **Applies To**, comma-separated: `Saves`, `Ability Checks` (every skill and Initiative), `Skills`, `Initiative`, one save (`Wisdom Save`), a skill name, `Passive Perception` / `Passive Investigation` / `Passive Insight`, `Spell Attack`, `Spell Save DC`.
- **Bonus:** a signed number, an ability (`CHA`: that modifier, as it is), `PB`, or `Half PB` (rounded down).

```text
| Saves      | +1  | Ring of Protection |
| Initiative | PB  | Alert              |
| Saves      | CHA | Aura of Protection |
```

A bard's Jack of All Trades is not a Bonuses row: write `Half` in the `Proficient` cell of each skill the bard lacks, and the tool adds half the proficiency bonus. In the 2024 rules that feature covers skill checks only, so Initiative gets nothing from it; a table that rules otherwise adds `Initiative | Half PB | Jack of All Trades`.

Write a number by hand, with its reason, only for what that vocabulary cannot say: `+7 (GM boon)`. The tool keeps any cell that is not blank or a bare number and replaces a bare one, so a hand-set value with no reason is lost at the next fill. A Bonuses row the tool cannot read is reported `KEPT` and adds nothing; reword it or move the number to its cell with a reason.

**Attack lines** (`### Weapons & Damage Cantrips`) are yours. To hit is the ability modifier plus the proficiency bonus when proficient; damage is the weapon's die plus the same modifier. Strength for melee, Dexterity for ranged; a Finesse weapon takes whichever is better, and a thrown weapon keeps its melee ability. Name the mastery and the range in Notes. A damage cantrip is a row too, so the player sees it beside the weapons. The **Atk Bonus / DC** cell (and a spell's **Hit / DC**) holds a signed number for an attack roll (`+5`) or `DC 13 Wis` for a save, never both and never prose.

**AC, HP maximum, Speed** are also yours, because too many features move them for a sum to be trusted. Say what the AC is made of in `**Armour Class:**` under Defences: `Chain Mail 16 + Shield 2`. Other movement goes in its own Combat row (`Fly Speed`, `Swim Speed`, `Climb Speed`, `Burrow Speed`) and joins the Speed tile. `Attacks per Action` and any feature's own DC (a row whose label ends `Save DC`) are Combat rows too.

**Empty values.** Write what an empty thing looks like, not a dash the page would have to print: hit dice `0/3` (none spent of three), death saves `0/0`, `HP (Current)` equal to the maximum when the note gives only one number. Leave a Defences line out when there is nothing to list. Delete the slot rows above the character's highest slot level, and delete the whole Spellcasting or Companions section when it is unused.

**Class features, species traits, feats.** One row each, `Name | Action | Uses | Used | Recovers | Summary`:

- **Action:** `Action`, `Bonus Action` or `Reaction`; blank for a passive feature. The Combat tab groups by these words.
- **Uses / Used:** whole numbers; both blank when a feature has no limit. A pool is `Uses` with the pool's size (Lay on Hands at level 5 is `25`), and `Used` counts points spent.
- **Recovers:** `Long Rest`, `Short Rest`, or `1 Short Rest, all Long Rest` (one use back on a short rest, all on a long one). The live sheet's rest buttons act on exactly these three phrases, whatever their capitals, so do not paraphrase them. Anything else (`Dawn`, `1d6+1 at dawn`) or a blank is shown as written and left to the player: no rest button touches it. Hit dice and spell slots need no `Recovers`: both return on a long rest (a short rest is when the player spends hit dice), and a slot row whose level starts `Pact` returns on a short rest too.

```text
| Second Wind | Bonus Action | 2 | 0 | 1 Short Rest, all Long Rest | Heal 1d10 + Fighter level |
```

**Spells.** One row each under `### Spells`: Level is `Cantrip` or `1` to `9`; Tags are comma-separated, `C` for concentration and `R` for ritual, plus anything else worth showing (`Always prepared`). **Source** is blank for a class spell; a spell an item, feat or species trait grants names it there, and its cost in charges goes in Tags (`1 charge`).

```text
| Detect Magic | 1 | Action | Self | V, S | 10 minutes | | C, R | | Sense magic within 30 ft |
```

**Magic items, companions.** Every magic item is a row in `### Magic Items` (`Attuned` is `Yes` or `No`; `Charges`, `Used` and `Recovers` work as feature uses do), what it adds to a save or check is a Bonuses row, and a spell it casts is a Spells row with the item as Source. A steed, familiar or other creature that fights beside the PC is a row in `## Companions`, its name linked to the creature's note when there is one.

**Weight.** Everything carried has a `### Gear` row with the weight of one in pounds, weapons and armour included: the attack table lists attacks, not possessions. Weights of SRD items are in `equipment.md`; write `—` for something weightless. The tool totals Gear and coins into `### Carrying` and sets the capacity from Strength and Size. A magic item's weight counts only when the item also has a Gear row; the Magic Items table adds none.

**Live sheet.** On a site with live stats on, the player runs the PC from the page: damage, healing and temporary hit points entered as amounts; marks for death saves, hit dice, spell slots, feature uses and item charges; conditions, exhaustion, Heroic Inspiration and Concentrating; and a Short Rest and a Long Rest button. The page rolls nothing and works out no modifiers, saves or bonuses. A rest never sets Heroic Inspiration. What this means for the note:

- The numbers return to the note at wrap-up, each into its own cell (`HP (Current)`, `Temp HP`, the spent half of hit dice, `Death Saves (S/F)`, `Conditions`, `Exhaustion`, `Heroic Inspiration`, `Expended`, `Used`). Concentrating is never saved to the note.
- The value saved on the site wins over the note's cell for 30 days, whether or not wrap-up has run: writing the numbers back does not clear it. So a value in that list is changed by the player on their sheet, not by editing the note mid-campaign: the edit would not show.
- Every maximum comes from the note (`HP (Max)`, `Uses`, `Charges`, a slot `Total`, the maximum half of hit dice). A level-up is a note edit, and the page fits its saved counts to the new numbers.
- A cell the page cannot read is not live and is never written back. Keep them exact: `HP (Current)`, `HP (Max)`, `Temp HP` and `Exhaustion` a whole number, with a reason in brackets after it if you want one (`31 (after the fall)`); hit dice `spent/max` (`2/5`); death saves `0/0` up to `3/3`; `Used` and `Expended` bare whole numbers no larger than their total.
- Give each row in a table its own name. The page follows the first row with a name; a later row with the same name is never live, even when the first is itself not live (a `Used` over its `Uses`), and the build warns.

**Summaries.** One line, in your own words. Never copy a book's text: the note is published, and rules text is not ours to republish. For anything outside the SRD, summarise only what the GM tells you or shows you; otherwise write the name and a page reference.

**Converting an old-layout PC** (prose features, `### Prepared Spells` lists, stats in frontmatter): read `sheet-conversion.md` beside this file first. An old note still publishes with nothing lost, so convert a PC when you next work on that character, not in bulk.

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
| **Passive Perception** | 10 + Perception modifier (WIS mod + PB if proficient). Adv = +5, Disadv = -5 |

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

Recorded in the note's `### Spells` table (see Writing the Sheet in the Vault). All 2024 classes use a prepared spell model. Number of prepared spells shown in class table. Cantrips are always available (no slot cost).

## Backstory Fields

Personality Traits, Ideals, Bonds, Flaws -- from background or player invention.

## Appearance

Age, Height, Weight, Eyes, Skin, Hair, Description -- player choice guided by species.
