# GURPS 4th Edition — Core Mechanics

## Overview

Generic Universal RolePlaying System using 3d6 roll-under.
Point-buy character creation with no fixed classes or levels.
Covers any genre via modular supplements. Detailed combat
with 1-second turns, hit locations, and active defenses.

For deep rules coverage, see `rules-reference.md`.
For character generation workflows, see
`character-generation.md`.

## Primary Attributes

GURPS characters are built on four primary attributes, each
defaulting to 10 (human average). Raising or lowering them
costs character points:

- **ST (Strength)** — Governs melee damage, lifting capacity
  (Basic Lift), and base Hit Points. Cheaper per level than
  DX or IQ, making it efficient for physical combatants.
- **DX (Dexterity)** — Governs physical skills (combat,
  athletics, stealth) and contributes to Basic Speed. The
  most expensive physical attribute because it affects so
  many skills at once.
- **IQ (Intelligence)** — Governs mental and knowledge skills,
  and sets the base for Will and Perception. As expensive as
  DX because it is the controlling attribute for many skills.
- **HT (Health)** — Governs endurance, Fatigue Points, and
  contributes to Basic Speed. Also governs consciousness
  rolls and recovery. Same cost as ST.

For specific point costs per attribute level, this skill reads
from your converted GCA data at
`~/.gm-apprentice/data/gurps-4e/`. Run the setup wizard to
connect your GCA4 data files.

## Secondary Characteristics

Secondary characteristics derive from primary attributes. Each
can be bought up or down from its base value at a per-level
cost.

- **HP (Hit Points)** — Defaults to ST. Represents physical
  toughness and how much damage you can absorb.
- **Will** — Defaults to IQ. Governs resistance to mental
  influence, fear, and psychic attacks.
- **Perception (Per)** — Defaults to IQ. Governs noticing
  things, spotting ambushes, and sensory rolls.
- **FP (Fatigue Points)** — Defaults to HT. Represents
  endurance; spent on extra effort, spellcasting, and
  sustained exertion.
- **Basic Speed** — Derived from (HT+DX)/4. Determines turn
  order in combat and contributes to Dodge.
- **Basic Move** — Derived from Basic Speed (drop fractions).
  Yards moved per turn on the ground.
- **Dodge** — Derived from Basic Speed + 3 (drop fractions
  first). Primary active defense against any attack.
- **Basic Lift** — Derived from ST×ST/5 lbs. Determines
  carrying capacity and encumbrance thresholds.

For specific point costs to modify secondary characteristics,
this skill reads from your converted GCA data at
`~/.gm-apprentice/data/gurps-4e/`. Run the setup wizard to
connect your GCA4 data files.

## Skills

Skills are learned abilities rated by difficulty level: Easy,
Average, Hard, or Very Hard. The difficulty determines how
many character points you must invest to reach a given level
relative to the controlling attribute.

- **Controlling Attribute** — Typically DX for physical skills,
  IQ for mental/knowledge skills. Some skills use HT, Per,
  or Will.
- **Difficulty** — Harder skills require more points to reach
  the same relative level. A Very Hard skill at attribute+0
  costs significantly more than an Easy skill at the same
  relative level.
- **Defaults** — Most skills can be attempted untrained at a
  penalty (typically attribute-4 to attribute-6). Some have
  no default (Karate, Surgery, etc.).

For the skill cost progression table (points spent vs.
difficulty level), this skill reads from your converted GCA
data at `~/.gm-apprentice/data/gurps-4e/`. Run the setup
wizard to connect your GCA4 data files.

## Roll Mechanics

- Roll 3d6 ≤ effective skill to succeed
- Critical success: 3-4 always; 5 if skill 15+; 6 if skill 16+
- Critical failure: 18 always; 17 if skill 15 or less
- Margin of success = skill - roll (matters for contests,
  damage bonuses, and degree of success)
- Quick Contests: both sides roll; highest margin wins

## Active Defenses

| Defense | Formula | Notes |
|---------|---------|-------|
| Dodge | floor(Basic Speed) + 3 | -1 per encumbrance level |
| Parry | floor(Weapon Skill/2) + 3 | -4 cumulative same weapon |
| Block | floor(Shield Skill/2) + 3 | Once per turn |

Retreat: +3 Dodge, +1 Parry/Block (once per turn, step back).
Combat Reflexes: +1 to all active defenses.

## Advantages/Disadvantages

Point-buy system for traits. Full lists with costs in
`rules-reference.md`.

- **Advantages**: Beneficial traits (cost points)
- **Disadvantages**: Limiting traits (give points back,
  subject to campaign limit, typically -50 to -75)
- **Quirks**: Minor traits (-1 point each, max 5)
- **Enhancements/Limitations**: Percentage modifiers on
  advantage costs (+/- %, minimum 20% of base)

Mental disadvantages often use self-control rolls (CR) to
determine how often the character must give in to the
compulsion. Worse self-control (harder to resist) increases
the point value of the disadvantage.

For specific self-control roll multipliers and point cost
tables, this skill reads from your converted GCA data at
`~/.gm-apprentice/data/gurps-4e/`. Run the setup wizard to
connect your GCA4 data files.

## Character Generation

Full workflow in `character-generation.md`. Summary:

1. Establish campaign context (points, TL, genre, rules)
2. Define character concept
3. Buy primary attributes
4. Adjust secondary characteristics
5. Select advantages (within budget)
6. Take disadvantages (within campaign limit)
7. Choose quirks
8. Buy skills
9. Select equipment (based on Starting Wealth)
10. Validate: point budget, prerequisites, legal combos

## Entity Attributes for GURPS

```yaml
pc:
  required:
    - name
    - point_total
  optional:
    - concept: string
    - attributes:
        st: number
        dx: number
        iq: number
        ht: number
    - secondary:
        hp: number
        will: number
        per: number
        fp: number
        basic_speed: number
        basic_move: number
    - advantages: [{name: string, cost: number, notes: string}]
    - disadvantages: [{name: string, cost: number, self_control: number}]
    - quirks: [string]
    - skills: [{name: string, level: number, relative: string, cost: number}]
    - techniques: [{name: string, default_from: string, level: number}]
    - equipment: [{name: string, weight: number, cost: number}]
    - point_breakdown:
        attributes: number
        advantages: number
        disadvantages: number
        quirks: number
        skills: number
        total: number

npc:
  required:
    - name
  optional:
    - attributes:
        st: number
        dx: number
        iq: number
        ht: number
    - advantages: [string]
    - disadvantages: [string]
    - skills:
        - name: string
          level: number
    - point_total: number
    - combat:
        dodge: number
        parry: string
        block: string
        dr: number
```
