# GURPS 4th Edition — Core Mechanics

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](https://www.sjgames.com/general/online_policy.html).

## Overview

Generic Universal RolePlaying System using 3d6 roll-under.
Point-buy character creation with no fixed classes or levels.
Covers any genre via modular supplements. Detailed combat
with 1-second turns, hit locations, and active defenses.

For deep rules coverage, see the topic files (combat.md,
traits-*.md, skills-*.md, equipment-*.md, etc.).
For character generation workflows, see
`character-generation.md`.

## Primary Attributes

| Attribute | Default | Cost | Governs |
|-----------|---------|------|---------|
| ST | 10 | 10/level | Damage, HP, Basic Lift |
| DX | 10 | 20/level | Physical skills, Basic Speed |
| IQ | 10 | 20/level | Mental skills, Will, Perception |
| HT | 10 | 10/level | FP, Basic Speed, consciousness |

## Secondary Characteristics

| Characteristic | Base | Cost to Modify |
|---------------|------|---------------|
| HP | ST | ±2 pts/level |
| Will | IQ | ±5 pts/level |
| Per | IQ | ±5 pts/level |
| FP | HT | ±3 pts/level |
| Basic Speed | (HT+DX)/4 | ±5 pts per ±0.25 |
| Basic Move | Basic Speed (floor) | ±5 pts/level |
| Dodge | Basic Speed + 3 (floor) | Derived, not bought directly |
| Basic Lift | ST×ST/5 lbs | Derived from ST |

## Damage Table (Key Breakpoints)

| ST | Thrust | Swing |
|----|--------|-------|
| 8 | 1d-3 | 1d-2 |
| 10 | 1d-2 | 1d |
| 11 | 1d-1 | 1d+1 |
| 12 | 1d-1 | 1d+2 |
| 13 | 1d | 2d-1 |
| 14 | 1d | 2d |
| 16 | 1d+1 | 2d+2 |
| 18 | 1d+2 | 3d |
| 20 | 2d-1 | 3d+2 |

## Skills

| Difficulty | Attr-3 | Attr-2 | Attr-1 | Attr+0 | Attr+1 | Attr+2 | Each +1 |
|------------|--------|--------|--------|--------|--------|--------|---------|
| Easy | — | — | — | 1 | 2 | 4 | +4 |
| Average | — | — | 1 | 2 | 4 | 8 | +4 |
| Hard | — | 1 | 2 | 4 | 8 | 12 | +4 |
| Very Hard | 1 | 2 | 4 | 8 | 12 | 16 | +4 |

Controlling attribute is typically DX for physical skills,
IQ for mental/knowledge skills. Some skills use HT, Per,
or Will. Defaults allow untrained use at a penalty.

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
`traits-*.md` files.

- **Advantages**: Beneficial traits (cost points)
- **Disadvantages**: Limiting traits (give points back,
  subject to campaign limit, typically -50 to -75)
- **Quirks**: Minor traits (-1 point each, max 5)
- **Enhancements/Limitations**: Percentage modifiers on
  advantage costs (+/- %, minimum 20% of base)

Self-control rolls for mental disadvantages:
CR 6 (×2), CR 9 (×1.5), CR 12 (×1), CR 15 (×0.5)

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
