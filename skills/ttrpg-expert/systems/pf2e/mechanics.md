# Pathfinder 2e (Remaster) -- Core Mechanics

## System Overview

d20-based heroic fantasy by Paizo. Every uncertain act is a check: roll d20, add your total modifier, compare to a DC. The engine is unified -- attack rolls, saves, skill checks, and Perception share the same math and four-tier outcome scale. Three play modes: encounter (6-second rounds, three actions each), exploration (minutes to hours), downtime (days). Characters are built from ancestry, background, and class, advancing from level 1 to 20.

See `character-generation.md` for build steps, `classes.md`, `ancestries.md`, `feats.md`, `spells.md`, `equipment.md`, `monsters.md`, `conditions-rules.md`, and `session-procedures.md` for the rest.

## Core Resolution

**Formula:** d20 + attribute modifier + proficiency bonus + other bonuses - penalties, compared to a DC.

Meet or beat the DC to succeed. A DC derived from one of your own statistics is `10 + that statistic's total modifier` (e.g. Reflex DC = 10 + Reflex mod). Always round fractions down unless told otherwise.

| Die | Usage |
|-----|-------|
| d20 | Core resolution: attacks, saves, skill checks, Perception, flat checks |
| d4-d12 | Damage, healing, variable effects |

## Degrees of Success

Four outcomes measure not just pass/fail but how well or badly.

| Result vs DC | Degree |
|--------------|--------|
| Beat DC by 10+ | Critical success |
| Meet or beat DC | Success |
| Miss DC | Failure |
| Miss DC by 10+ | Critical failure |

**Natural 20:** shift the outcome one step better. **Natural 1:** shift one step worse. Apply the nat-20/nat-1 step before any other adjustment. A crit hit deals double damage; if an effect lists no crit line, its crit result equals its ordinary success (or failure) result.

## Proficiency Ranks

Five ranks set your bonus. Above untrained, the bonus scales with character level -- this is why a level-10 expert vastly outclasses a level-1 expert.

| Rank | Proficiency Bonus |
|------|-------------------|
| Untrained | +0 |
| Trained | level + 2 |
| Expert | level + 4 |
| Master | level + 6 |
| Legendary | level + 8 |

## Attributes

Remaster uses **attribute modifiers directly** -- there are no ability scores to convert. The six attributes and the checks they typically govern:

| Attribute | Governs |
|-----------|---------|
| Strength (Str) | Melee attacks/damage, Athletics |
| Dexterity (Dex) | Ranged attacks, AC, Reflex, Acrobatics/Stealth/Thievery |
| Constitution (Con) | Hit Points, Fortitude |
| Intelligence (Int) | Knowledge skills, extra languages/skills |
| Wisdom (Wis) | Perception, Will, Medicine/Nature/Religion/Survival |
| Charisma (Cha) | Social skills, many innate/spontaneous casters |

A new PC's key attribute is +4; the array runs roughly +4/+3/+2/+1 down to negatives, and no starting modifier exceeds +4. See `character-generation.md`.

## Bonuses and Penalties

Three typed sources plus untyped. **Same type does not stack** -- take only the highest bonus and the worst penalty of each type. Different types all apply.

| Type | Typical source |
|------|----------------|
| Circumstance | The situation (cover, flanking, Aid) |
| Status | Spells and magical conditions (heroism, frightened) |
| Item | Gear (armor, potency runes, tools) |
| Untyped penalties | Multiple attack penalty, range penalty -- these DO all stack |

## The Three-Action Economy

On your turn in an encounter you regain **3 actions and 1 reaction**. Four kinds of thing you can do:

| Type | Icon | Notes |
|------|------|-------|
| Single action | one action | Self-contained (Stride, Strike, Interact) |
| Activity | 2-3 actions | Spends several actions for one combined effect (Sudden Charge). Complete it in one turn or lose the actions spent |
| Reaction | reaction | Once per round; has a trigger; usable on any turn |
| Free action | free | No action cost; may have a trigger like a reaction, or be used like a single action if not |

Unused actions and reactions do not carry over. Speaking a sentence or two is free. `slowed`, `quickened`, and `stunned` change how many actions you get. See `conditions-rules.md`.

## Traits as Rules Carriers

Traits are keywords attached to actions, spells, items, and creatures that hook into other rules. A trait rarely does anything by itself -- it lets other effects reference it. Examples: the **attack** trait means the action feeds the multiple attack penalty; **move** actions can trigger reactions; **concentrate**, **manipulate**, **auditory**, **visual**, **fortune**, **death**, and **fire** all interact with specific abilities, conditions, and immunities. When a rule says "fire effects," it means anything with the fire trait.

## Attack Rolls

`d20 + attribute mod + proficiency + bonuses - penalties` vs the target's AC. Melee uses Str (or Dex with a finesse weapon); ranged uses Dex. Spell attacks use your spellcasting attribute.

### Multiple Attack Penalty (MAP)

Every action with the **attack** trait after your first this turn takes a cumulative untyped penalty. Recalculate per weapon on each attack; MAP resets at the start of your turn and does not apply on other creatures' turns.

| Attack this turn | Penalty | Agile weapon |
|------------------|---------|--------------|
| First | -- | -- |
| Second | -5 | -4 |
| Third+ | -10 | -8 |

**Range penalty:** ranged/thrown attacks take -2 per range increment past the first, out to a max of six increments.

## Armor Class

`AC = 10 + Dex mod (capped by armor's Dex Cap) + proficiency + armor's item bonus + other bonuses - penalties`. Use your proficiency in the armor you wear, or in unarmored defense if none. Raising a shield, cover, and flanking adjust AC (see `session-procedures.md`).

## Saving Throws and Perception

Three saves, each `d20 + attribute + proficiency`:

| Save | Attribute | Resists |
|------|-----------|---------|
| Fortitude | Con | Poison, disease, bodily harm |
| Reflex | Dex | Area effects, dodging |
| Will | Wis | Fear, charm, mental effects |

**Basic save** (used by many spells): crit success = no damage, success = half, failure = full, crit failure = double.

**Perception** = `d20 + Wis + proficiency`. Nearly every creature is at least trained. It notices things, sets your Perception DC, and is usually what you roll for **initiative** (highest goes first; ties go to enemies over PCs).

## Damage, Resistance, and Weakness

Roll the effect's damage dice, add modifiers, set the type, then apply defenses in order: **immunity first, then weakness, then resistance.**

- **Immunity** -- ignore all damage/effects of that type.
- **Weakness N** -- take N extra damage of that type.
- **Resistance N** -- reduce that type of damage by N (min 0).

Multiple weaknesses or resistances on one hit: use only the highest. Minimum 1 damage gets through after penalties (not after resistance).

**Physical:** bludgeoning, piercing, slashing. **Energy:** acid, cold, electricity, fire, sonic, plus vitality (harms undead) and void (harms the living), and force. **Other:** mental, poison, spirit, bleed (persistent), precision. Persistent damage recurs at the end of your turn, then a DC 15 flat check to end it.

## Conditions

Conditions are standardized states that grant advantages or impediments; many carry a numeric value (e.g. frightened 2, drained 1). Common combat ones: **off-guard** (-2 AC), **frightened**, **prone**, **grabbed/restrained**, **slowed**, **stunned**, **dying/wounded/doomed**. The full roster and mechanics live in `conditions-rules.md`.

## Hero Points

The GM grants roughly 1 per session, more for heroic deeds; cap 3, lost at session's end. Spending is not an action:

- **Reroll** -- spend 1 to reroll a check and take the second result (a fortune effect; one per check).
- **Cheat death** -- spend all your Hero Points when your dying value would rise: lose the dying condition and stabilize at 0 HP without gaining wounded.

---

*This work includes Licensed Material from Pathfinder Player Core, Player Core 2, GM Core, Monster Core, and Monster Core 2 © Paizo Inc., used under the ORC License (Library of Congress TX 9-307-067, https://paizo.com/orclicense).*
