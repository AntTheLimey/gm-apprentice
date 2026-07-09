# Pathfinder 2e (Remaster) — Character Sheet Reference

Section-by-section reference for a PF2e PC entity file in the vault. Use it
to build, audit, or fill any sheet field. The shared template lives at
`skills/shared/templates/pc-pf2e.md`.

## Stat Sheet

### Core

| Field | Source |
|---|---|
| Level / XP | 1–20; 1,000 XP per level |
| Hero Points | Start each session with 1; spend to reroll or avoid death |
| Class DC | 10 + proficiency bonus + key attribute modifier |

### Attributes

Six attributes recorded as **modifiers** (e.g. `+4`), not scores:
Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma. See
character-generation.md for how boosts and flaws set them.

### Combat

| Field | How to fill |
|---|---|
| **AC** | 10 + Dexterity mod (capped by armor) + armor proficiency bonus + item bonus |
| **Shield** | Note Hardness / HP / Break Threshold (BT); apply only while Raised |
| **Speed** | From ancestry; adjust for armor and effects |
| **HP** | Current / Max (max = ancestry HP + class HP + Con mod per level) |
| **Perception** | Wisdom mod + proficiency rank |
| **Saves** | Fortitude, Reflex, Will — attribute mod + proficiency rank each |

Record each defence's **rank** (U/T/E/M/L) alongside its modifier.

## Background Block

| Field | Source |
|---|---|
| Ancestry / Heritage | See character-generation.md |
| Background | Grants two boosts, a skill, a Lore, and a skill feat |
| Class + subclass | Class plus its 1st-level defining choice (e.g. Wizard's arcane thesis, Cleric's deity/doctrine) |

## Skills

| Column | Contents |
|---|---|
| Skill | Skill name (add each Lore separately) |
| Attribute | Key attribute (see character-generation.md skills table) |
| Rank | U / T / E / M / L |
| Modifier | Attribute mod + proficiency bonus (+ other bonuses) |

## Class Features

List class features gained so far with the level acquired (e.g. Fighter's
Reactive Strike and Shield Block at 1st). Note any choices made within a
feature.

## Ancestry Feats

Ancestry feats taken, with level. First at 1st level, then 5th, 9th, 13th,
17th.

## Class Feats

Class feats taken, with level, per the class advancement table.

## Skill & General Feats

- **Skill feats** — require training in the matching skill; from background
  (1st) and the class cadence
- **General feats** — any general or skill feat you qualify for; typically
  3rd level and every 4 levels

## Spellcasting

*Omit this section for non-casters.*

| Field | Contents |
|---|---|
| Tradition | Arcane / Divine / Occult / Primal |
| Spell attack / DC | Proficiency + key attribute modifier |
| Slots per rank | Number of slots at each spell rank per day |
| Prepared / Repertoire | Prepared casters list daily spells; spontaneous casters list their repertoire |
| Cantrips | At-will; auto-heighten to half level (round up) |

## Proficiencies

- **Armor** — unarmored plus any armor categories (light/medium/heavy) with rank
- **Weapons** — simple/martial/advanced or specific weapons, with rank
- **Languages** — from ancestry, plus extras equal to a positive Intelligence
  modifier

## Equipment

**Weapons** — table of Weapon | Damage | Traits | notes.

**Gear** — item, quantity, and **Bulk** (L = light; track total load).

**Invested items** — worn magic items requiring investiture; **maximum 10**.

**Coins** — cp / sp / gp / pp (10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp).

## Current Status

The live at-the-table block: current HP, conditions, temporary effects,
Hero Points remaining, expended spell slots, and anything that changes
during play. Downstream skills read this block.

## Notes

Player-facing background, personality, appearance, goals, and connections.

## GM Notes

Private hooks, secrets, and plot ties not shown to the player or on a
published site.

---

*This work includes Licensed Material from Pathfinder Player Core, Player Core 2, GM Core, Monster Core, and Monster Core 2 © Paizo Inc., used under the ORC License (Library of Congress TX 9-307-067, https://paizo.com/orclicense).*
