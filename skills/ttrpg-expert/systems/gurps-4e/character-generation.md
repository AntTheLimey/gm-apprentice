# GURPS 4e Character Generation

Comprehensive character creation assistant for GURPS 4th Edition.
Supports any genre, power level, and campaign style. Works for
both players building PCs and GMs drafting NPCs.

## Campaign Context Awareness

The character generation workflow is context-sensitive. If the
user has an existing campaign (vault, notes, or shared context),
check for:
- Existing PCs and NPCs (avoid duplication, find party gaps)
- Campaign metadata (point total, TL, genre, house rules)

This file and `gurps-rules-reference.md` together contain
all the rules needed for character generation. They are the
authoritative reference within this skill.

## Character Generation Workflow

Follow these steps in order. The workflow is interactive — gather
information from the user at each stage before proceeding.

### Step 0: Campaign Context Gathering

Before touching a character sheet, establish the campaign
parameters. These constrain every decision that follows.

**Ask the user for:**

| Parameter | Why It Matters | Default If Not Given |
|-----------|---------------|---------------------|
| Point total | Budget ceiling | 150 pts (competent heroes) |
| Disadvantage limit | Usually -50 to -75 pts | -50 pts |
| Quirk limit | Usually -5 pts (5 quirks) | -5 pts |
| Genre/setting | Determines available traits | Modern realistic |
| Realism level | Realistic vs Cinematic | Realistic |
| Tech Level (TL) | Equipment and skill availability | TL8 (modern) |
| Available supplements | Which books are allowed | Basic Set only |
| Special rules | Magic, psionics, powers, supers | None |
| House rules | GM-specific modifications | None |

Point totals range from low (ordinary people) through heroic
(action heroes, special forces) to legendary and superheroic.
Higher budgets allow more extreme attributes and exotic abilities.

Look up the full point-total-to-power-level guidelines in your
converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/campaign-settings.md`

### Step 1: Character Concept

Help the user articulate a clear concept before spending points.
A good concept answers three questions:

1. **Who is this person?** (background, personality)
2. **What can they do?** (core competencies, role in the group)
3. **What drives them?** (motivations, goals, conflicts)

**Concept Suggestions**: If the user is unsure, offer 3-4
concepts that fit the campaign context. For each, sketch a
one-sentence pitch noting primary attributes, 2-3 key
advantages, and 2-3 likely disadvantages. This helps visualize
how the concept maps to the character sheet.

**Template Lenses**: If genre supplements are available (Action,
Dungeon Fantasy, Monster Hunters, etc.), check whether a
professional template or lens applies. Templates save time and
produce balanced characters. Always note the source book and
page number.

### Step 2: Primary Attributes

Four primary attributes, each defaulting to 10 (human average).

- **ST (Strength)** — Governs damage, lifting capacity, and HP
  base. One of the cheaper attributes per level.
- **DX (Dexterity)** — Governs physical skills and contributes
  to Basic Speed. One of the more expensive attributes per
  level because it broadly affects many skills.
- **IQ (Intelligence)** — Governs mental skills, Will, and
  Perception. Same cost tier as DX.
- **HT (Health)** — Governs endurance, FP base, and contributes
  to Basic Speed. Same cost tier as ST.

**Size Modifier affects ST cost**: For SM +1 or larger, ST cost
is reduced; for SM -1 or smaller, cost is unchanged but check
specific rules.

Look up attribute point costs per level in your converted GCA
data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/attributes.md`

**Guidance by archetype:**
- Combat-focused: ST 12-14, DX 12-14, HT 12+
- Skill-focused: DX or IQ 13-15, others 10-11
- Social-focused: IQ 12+, ST/DX less critical
- Balanced: 11-12 across the board

**Cost tracking**: Running total starts at 0. Each +1 above 10
costs the listed amount; each -1 below 10 gives back that amount.

**Validation:**
- Attributes below 1 not allowed for playable characters
- Attributes above 20 require GM permission in most campaigns
- ST and HT are cheaper than DX and IQ — front-loading DX/IQ
  is efficient but expensive; make sure concept justifies it

### Step 3: Secondary Characteristics

Derive from primary attributes; can be bought up or down.

- **HP (Hit Points)** — Defaults to ST
- **Will** — Defaults to IQ
- **Perception (Per)** — Defaults to IQ
- **FP (Fatigue Points)** — Defaults to HT
- **Basic Speed** — Derived from (HT+DX)/4
- **Basic Move** — Derived from Basic Speed (drop fractions)

Look up cost-to-modify values for each secondary characteristic
in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/attributes.md`

**Derived values to calculate:**
- **Damage**: Based on ST via the Damage Table. Look up in your
  converted GCA data:
  `~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/damage-table.md`
- **Basic Lift**: ST×ST/5 lbs
- **Dodge**: floor(Basic Speed) + 3
- **Size Modifier (SM)**: 0 for humans

**Validation:**
- HP should not exceed ST×1.5 (×2 cinematic) without justification
- Will and Per rarely deviate more than ±4 from IQ
- Basic Speed 5.00+ is fast; 7.00+ is exceptional

### Step 4: Advantages

Advantages are beneficial traits bought with character points.
For the full advantage list with costs, modifiers, and
prerequisites, reference `gurps-rules-reference.md`.

**Categories:**
- **Physical**: Enhanced attributes, DR, Appearance, etc.
- **Mental**: Talent, Eidetic Memory, Intuition, etc.
- **Social**: Status, Wealth, Rank, Contacts, Allies, Patrons
- **Exotic/Supernatural**: Innate Attack, powers, magic aptitude

**Enhancement and Limitation Modifiers:**
Advantages can be modified with enhancements (+% cost) and
limitations (-% cost). Net modifier cannot reduce cost below
20% of base value.

**Common Advantages by Genre:**

*Modern Military/Action*: Combat Reflexes, High Pain Threshold,
Fit/Very Fit, Danger Sense, Luck, Military Rank, Legal
Enforcement Powers, Trained by a Master (cinematic only)

*Fantasy*: Magery, Power Investiture, Eidetic Memory, Luck,
Patron

*Supers*: Innate Attack, DR, Enhanced Move, Flight, Super
ST/DX (with power modifier). For power modifiers and
supers-specific rules, reference `gurps-rules-reference.md`
(Powers and Supers section).

*Horror*: Medium, Oracle, Spirit Empathy, Luck, Danger Sense

Look up specific advantage point costs in your converted GCA
data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/advantages.md`

**Validation:**
- Some advantages require GM permission (Unkillable, Modular
  Abilities, etc.)
- Supernatural advantages need campaign justification
- Check synergies (Combat Reflexes = +1 all active defenses
  AND +6 vs surprise)
- Watch for redundancy (Acute Vision + Telescopic Vision)

### Step 5: Disadvantages

Disadvantages give back character points up to the campaign
limit (typically -50 to -75 pts).

**Self-Control Rolls (CR)**: Many mental disadvantages use a
self-control roll. Worse self-control (rolling less often to
resist) increases the point value of the disadvantage through
a multiplier.

Look up self-control roll values and multipliers in your
converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/disadvantages.md`

**Disadvantage-Driven Characters**: GURPS characters come alive
through disadvantages. They should reflect the concept, not be
picked for point value. A Navy SEAL with Duty (Military;
Extremely Hazardous) and Sense of Duty (Teammates) tells a
story. Greed on the same character doesn't.

**Duty frequency**: Duty value depends on how often the duty
comes up (frequency) and how dangerous it is. Extremely
Hazardous and Involuntary modifiers increase the value further.

Look up specific disadvantage point values in your converted
GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/disadvantages.md`

**Validation:**
- Total disadvantages cannot exceed campaign limit
- Quirks (-1 each) have separate limit (usually 5)
- Some disadvantages are mutually exclusive (Fearlessness vs
  Phobias, Mute vs Voice advantages)
- Enemy power relative to PC affects value

### Step 6: Skills

Skills are learned abilities. Effective level = controlling
attribute + modifier from difficulty and points spent.

**Difficulty Levels**: Skills come in Easy, Average, Hard, and
Very Hard. Harder skills require more points to reach the same
relative level compared to the controlling attribute.

Look up the skill difficulty/cost progression table in your
converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/skills.md`

**Skill Defaults**: Most skills can be attempted untrained at
attribute-4 to attribute-6. Some have no default (Karate,
Surgery, etc.).

**Techniques**: Specific applications of a skill bought up from
a default penalty. Example: Targeted Attack (Guns/Head) defaults
to Guns at a penalty, can be bought up to a reduced penalty. For
martial arts techniques, reference `gurps-rules-reference.md`
(Martial Arts section).

**Wildcard Skills**: Written as Skill! (e.g., Gun!). Cost 3 pts
per +1 from attribute. Cinematic campaigns only.

**Talents**: +1/level to a defined group of skills. More
efficient than buying skills individually when you want 3+ from
the group.

**Skill Recommendations by Role:**

*Combat Operator*: Guns (Rifle) or Guns (Pistol) 14+, Tactics,
Soldier, First Aid, Navigation, Stealth

*Face/Negotiator*: Diplomacy or Fast-Talk 14+, Detect Lies,
Savoir-Faire, Psychology, Intimidation

*Specialist/Technical*: Core professional skill 16+, supporting
skills 12-14, related skills 10-12

*Generalist*: Many skills at 12-13 with a few at 14-15

**Validation:**
- Skill level below attribute-3 is rarely worth buying (use
  default instead)
- Skills above 20 are cinematic unless heavily specialized
- Check controlling attribute is correct for each skill
- Verify TL-dependent skills match campaign TL
- Flag prerequisite requirements (Surgery requires First Aid)

### Step 7: Equipment and Loadout

Equipment purchased with starting wealth, not character points
(unless using Signature Gear advantage).

Starting wealth varies by Tech Level. Higher TLs provide more
starting money; the Wealth advantage multiplies it, while
Struggling/Poor/Dead Broke reduces it.

Look up starting wealth by TL in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/equipment.md`

For weapons and equipment stats, reference
`gurps-rules-reference.md` (Equipment section). Canonical
sources are GURPS High-Tech (TL5-8), Tactical Shooting
(modern firearms), Ultra-Tech (TL9+), and Low-Tech (TL0-4).

**Encumbrance**: Total carried weight vs Basic Lift determines
level (None/Light/Medium/Heavy/X-Heavy), penalizing Move and
Dodge. Always calculate this for combat characters.

### Step 8: Final Review and Validation

**Point Budget Audit:**
- [ ] Attributes total correct
- [ ] Secondary characteristic modifications totalled
- [ ] All advantages costed (including enhancement/limitation %)
- [ ] Disadvantages within campaign limit
- [ ] Quirks within limit
- [ ] Skills totalled correctly
- [ ] Grand total matches campaign point budget

**Mechanical Validation:**
- [ ] Derived stats correct (HP, Will, Per, FP, Basic Speed,
      Basic Move, Dodge, Damage)
- [ ] No illegal advantage/disadvantage combinations
- [ ] Skill prerequisites met
- [ ] Equipment matches available skills
- [ ] Encumbrance calculated and impact noted
- [ ] TL-appropriate skills and gear

**Narrative Validation:**
- [ ] Disadvantages reflect character concept
- [ ] Skills support stated role
- [ ] Background and traits tell a coherent story
- [ ] Character has GM hooks (enemies, duties, secrets)
- [ ] Character has reasons to work with the party

## Character Sheet Output Format

```
[CHARACTER NAME]
[Concept] — [Point Total] points

== Attributes ==
ST [value] [cost] | DX [value] [cost]
IQ [value] [cost] | HT [value] [cost]

== Secondary Characteristics ==
HP [value] [mod cost] | Will [value] [mod cost]
Per [value] [mod cost] | FP [value] [mod cost]
Basic Speed [value] [mod cost]
Basic Move [value] [mod cost]
Dodge [value] | Damage Thr [value] / Sw [value]

== Advantages == [total cost]
[Advantage Name] [cost] — [brief note]
...

== Disadvantages == [total cost]
[Disadvantage Name] [cost] — [brief note]
...

== Quirks == [total cost]
[Quirk] [-1]
...

== Skills == [total cost]
[Skill Name] (Difficulty)-[Level] [cost]
  controlling attr [value], effective [level]
...

== Equipment == (from $[starting wealth])
[Item] — $[cost], [weight] lbs
...
Encumbrance: [level] ([carried wt] / BL [basic lift])
Move: [adjusted] | Dodge: [adjusted]

== Point Summary ==
Attributes:      [x] pts
Secondary:       [x] pts
Advantages:      [x] pts
Disadvantages:   [x] pts
Quirks:          [x] pts
Skills:          [x] pts
TOTAL:           [x] / [budget] pts
Unspent:         [x] pts
```

## Incremental Build Mode

For complex characters, build incrementally. After each step,
present running point total and remaining budget:

```
After Step 2 (Attributes):
  Spent: 80 pts | Remaining: 120 pts of 200

After Step 4 (Advantages):
  Spent: 160 pts | Remaining: 40 pts of 200
  (Plus up to 50 pts from disadvantages)
```

This lets the user make informed trade-offs as they build.

## Cross-References

- Expanded rules (combat, advantages, powers, magic, martial
  arts, equipment): `gurps-rules-reference.md`
- NPC generation shortcuts: `npc-generation.md`
- Game system overview: `game-systems.md`

## Canonical GURPS Sources

All rules in this file are based on GURPS 4th Edition. Key
source books: Basic Set — Characters (chargen core), Basic
Set — Campaigns (combat, campaign rules), Powers, Supers,
Martial Arts, High-Tech, Tactical Shooting, Ultra-Tech,
Low-Tech, Bio-Tech, Psionic Powers, Magic, Action 1: Heroes.
Cite these by name and page number where possible.
