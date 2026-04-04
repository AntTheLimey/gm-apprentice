# Game Systems

Overview of TTRPG systems supported by Imagineer.

## Call of Cthulhu 7th Edition

### Overview

Lovecraftian horror investigation game using percentile dice.

### Characteristics

| Characteristic | Range | Description |
|---------------|-------|-------------|
| STR | 1-100 | Physical strength |
| CON | 1-100 | Health and stamina |
| SIZ | 1-100 | Physical size |
| DEX | 1-100 | Agility and reflexes |
| APP | 1-100 | Physical appearance |
| INT | 1-100 | Intelligence |
| POW | 1-100 | Willpower and magical aptitude |
| EDU | 1-100 | Education and knowledge |

### Derived Statistics

| Stat | Formula |
|------|---------|
| HP | (CON + SIZ) / 10 |
| MP | POW / 5 |
| SAN | POW |
| Luck | 3d6 × 5 |
| MOV | Based on STR, DEX, SIZ |

### Skills

Skills are percentile-based (0-99). Key categories:

- **Investigation**: Library Use, Spot Hidden, Listen
- **Social**: Persuade, Fast Talk, Intimidate
- **Combat**: Fighting, Firearms
- **Academic**: Archaeology, History, Occult

### Roll Mechanics

| Result | Roll vs Skill |
|--------|---------------|
| Critical | 01 |
| Extreme | ≤ skill/5 |
| Hard | ≤ skill/2 |
| Regular | ≤ skill |
| Failure | > skill |
| Fumble | 96-100 (if skill < 50) |

### Sanity System

- **Starting SAN**: Equal to POW
- **Maximum SAN**: 99 - Cthulhu Mythos skill
- **Insanity**: At 0 SAN or major loss

### Entity Attributes for CoC

```yaml
npc:
  occupation: string
  characteristics:
    str: number (1-100)
    con: number (1-100)
    # etc.
  skills:
    - name: string
      value: number
  sanity: number
```

## GURPS 4th Edition

### Overview

Generic Universal RolePlaying System using 3d6 roll-under.
Point-buy character creation with no fixed classes or levels.
Covers any genre via modular supplements. Detailed combat
with 1-second turns, hit locations, and active defenses.

For deep rules coverage, see `gurps-rules-reference.md`.
For character generation workflows, see
`gurps-character-generation.md`.

### Primary Attributes

| Attribute | Default | Cost | Governs |
|-----------|---------|------|---------|
| ST | 10 | 10/level | Damage, HP, Basic Lift |
| DX | 10 | 20/level | Physical skills, Basic Speed |
| IQ | 10 | 20/level | Mental skills, Will, Perception |
| HT | 10 | 10/level | FP, Basic Speed, consciousness |

### Secondary Characteristics

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

### Damage Table (Key Breakpoints)

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

### Skills

| Difficulty | Attr-3 | Attr-2 | Attr-1 | Attr+0 | Attr+1 | Attr+2 | Each +1 |
|------------|--------|--------|--------|--------|--------|--------|---------|
| Easy | — | — | — | 1 | 2 | 4 | +4 |
| Average | — | — | 1 | 2 | 4 | 8 | +4 |
| Hard | — | 1 | 2 | 4 | 8 | 12 | +4 |
| Very Hard | 1 | 2 | 4 | 8 | 12 | 16 | +4 |

Controlling attribute is typically DX for physical skills,
IQ for mental/knowledge skills. Some skills use HT, Per,
or Will. Defaults allow untrained use at a penalty.

### Roll Mechanics

- Roll 3d6 ≤ effective skill to succeed
- Critical success: 3-4 always; 5 if skill 15+; 6 if skill 16+
- Critical failure: 18 always; 17 if skill 15 or less
- Margin of success = skill - roll (matters for contests,
  damage bonuses, and degree of success)
- Quick Contests: both sides roll; highest margin wins

### Active Defenses

| Defense | Formula | Notes |
|---------|---------|-------|
| Dodge | floor(Basic Speed) + 3 | -1 per encumbrance level |
| Parry | floor(Weapon Skill/2) + 3 | -4 cumulative same weapon |
| Block | floor(Shield Skill/2) + 3 | Once per turn |

Retreat: +3 Dodge, +1 Parry/Block (once per turn, step back).
Combat Reflexes: +1 to all active defenses.

### Advantages/Disadvantages

Point-buy system for traits. Full lists with costs in
`gurps-rules-reference.md`.

- **Advantages**: Beneficial traits (cost points)
- **Disadvantages**: Limiting traits (give points back,
  subject to campaign limit, typically -50 to -75)
- **Quirks**: Minor traits (-1 point each, max 5)
- **Enhancements/Limitations**: Percentage modifiers on
  advantage costs (+/- %, minimum 20% of base)

Self-control rolls for mental disadvantages:
CR 6 (×2), CR 9 (×1.5), CR 12 (×1), CR 15 (×0.5)

### Character Generation

Full workflow in `gurps-character-generation.md`. Summary:

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

### Entity Attributes for GURPS

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

## Forged in the Dark

### Overview

Heist/scoundrel games using d6 dice pools.

### Action Ratings

Grouped by attribute:

**Insight**:
- Hunt, Study, Survey, Tinker

**Prowess**:
- Finesse, Prowl, Skirmish, Wreck

**Resolve**:
- Attune, Command, Consort, Sway

### Dice Pool Mechanics

- Roll d6s equal to action rating
- Highest die determines result:
  - 6: Full success
  - 4-5: Partial success (complication)
  - 1-3: Failure (bad outcome)
- Critical: Two or more 6s

### Position & Effect

**Position** (how dangerous):
- Controlled: Safe, low stakes
- Risky: Standard danger
- Desperate: High danger

**Effect** (how impactful):
- Limited: Minor progress
- Standard: Normal progress
- Great: Major progress

### Stress & Trauma

- **Stress**: 0-9 track, avoid consequences
- **Trauma**: Permanent condition at stress-out
- **Harm**: Physical/mental injury levels

### Faction System

- **Tier**: Power level (0-5)
- **Status**: Relationship (-3 to +3)
- **Hold**: Weak or Strong

### Entity Attributes for FitD

```yaml
npc:
  crew_type: string
  playbook: string
  action_ratings:
    hunt: number (0-4)
    study: number (0-4)
    # etc.
  stress: number
  trauma: [string]
  harm:
    level_1: [string]
    level_2: [string]
    level_3: string

faction:
  tier: number (0-5)
  hold: "weak" | "strong"
  status_with_crew: number (-3 to +3)
```

## D&D 5th Edition (2024 Revision)

### Overview

Heroic fantasy adventure game using a d20-based resolution system.
Published by Wizards of the Coast. The 2024 revision updates the
original 2014 rules with refined class designs, weapon mastery
properties, streamlined crafting, and revised feat structures while
maintaining backward compatibility. Characters are defined by
species, class, background, and level, and advance from level 1 to
20 through experience points or milestone progression.

### Dice Conventions

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

### Ability Scores

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

### Derived Statistics

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

### Skills

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

### Roll Mechanics

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
doubles all damage dice. The 2024 revision limits critical hits to
attack rolls only.

**Natural 20/1**: In the 2024 revision, natural 20 on any d20 roll
always succeeds and natural 1 always fails.

### Class System

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

### Weapon Mastery (2024 Revision)

Martial classes gain weapon mastery properties.

| Mastery | Effect |
|---------|--------|
| Cleave | Damage a second creature on hit |
| Graze | Deal ability modifier damage on a miss |
| Nick | Extra light weapon attack as bonus action |
| Push | Push target 10 ft away on hit |
| Sap | Disadvantage on target's next attack |
| Slow | Reduce target's speed by 10 ft |
| Topple | Target must save or fall prone |
| Vex | Advantage on next attack against target |

### Spellcasting

- **Spell Slots**: Finite resource, recovered on long rest (short
  rest for Warlocks). Levels 1st through 9th.
- **Cantrips**: Cast at will, scale at levels 5, 11, and 17.
- **Concentration**: One spell at a time. CON save on damage
  (DC 10 or half damage, whichever is higher) to maintain.
- **Ritual Casting**: Add 10 minutes, no slot required.
- **2024 Revision**: All classes use a prepared spell model.

### Combat

**Action Economy** (per turn):

| Resource | Usage |
|----------|-------|
| Action | Attack, Cast, Dash, Dodge, Disengage, Help, Hide, Ready |
| Bonus Action | Off-hand attack, certain spells, class features |
| Reaction | Opportunity attack, Counterspell, Shield (one per round) |
| Movement | Up to speed in feet, splittable around actions |

**Death Saving Throws**: At 0 HP, roll d20 at start of each turn
(DC 10). Three successes stabilize; three failures kill. Natural
20 regains 1 HP. Natural 1 counts as two failures.

### Rest System

| Rest | Duration | Benefits |
|------|----------|----------|
| Short | 1 hour | Spend hit dice to heal; some features recharge |
| Long | 8 hours | All HP, half hit dice, all spell slots, most features |

### Character Advancement

| Tier | Levels | Proficiency | Description |
|------|--------|-------------|-------------|
| 1 | 1-4 | +2 | Local heroes |
| 2 | 5-10 | +3 to +4 | Heroes of the realm |
| 3 | 11-16 | +4 to +5 | Masters of the realm |
| 4 | 17-20 | +6 | Masters of the world |

### Entity Attributes for D&D 5e

```yaml
pc:
  required:
    - name
    - species
    - class
    - level
  optional:
    - subclass
    - background
    - alignment
    - ability_scores:
        str: number (1-30)
        dex: number (1-30)
        con: number (1-30)
        int: number (1-30)
        wis: number (1-30)
        cha: number (1-30)
    - armor_class: number
    - hit_points: number
    - speed: number
    - proficiency_bonus: number
    - saving_throw_proficiencies: [string]
    - skill_proficiencies: [string]
    - feats: [string]
    - equipment: [string]
    - spells_known: [string]
    - weapon_masteries: [string]

npc:
  required:
    - name
  optional:
    - species
    - challenge_rating: number (0-30)
    - armor_class: number
    - hit_points: number
    - ability_scores:
        str: number (1-30)
        dex: number (1-30)
        con: number (1-30)
        int: number (1-30)
        wis: number (1-30)
        cha: number (1-30)
    - speed: string
    - skills: [string]
    - damage_resistances: [string]
    - condition_immunities: [string]
    - senses: string
    - languages: [string]
    - actions: [string]
    - legendary_actions: [string]
    - alignment: string

creature:
  required:
    - name
    - challenge_rating
    - armor_class
    - hit_points
  optional:
    - size: string
    - type: string
    - ability_scores:
        str: number (1-30)
        dex: number (1-30)
        con: number (1-30)
        int: number (1-30)
        wis: number (1-30)
        cha: number (1-30)
    - speed: string
    - damage_vulnerabilities: [string]
    - damage_resistances: [string]
    - damage_immunities: [string]
    - condition_immunities: [string]
    - senses: string
    - languages: [string]
    - traits: [string]
    - actions: [string]
    - legendary_actions: [string]
```

## System-Agnostic Patterns

### Common Entity Attributes

All systems share:

- Name (required)
- Description
- Tags
- GM notes (GM-only)
- Source document
- Source confidence

### Validation Rules

1. Verify attributes match game system schema
2. Check skill values are in valid range
3. Validate derived statistics
4. Confirm required fields present

### Cross-System Considerations

When designing features:

- Don't hardcode system mechanics
- Use schema validation
- Support flexible attributes
- Allow system-specific extensions
