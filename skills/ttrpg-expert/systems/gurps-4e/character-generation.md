# GURPS 4e Character Generation

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](https://www.sjgames.com/general/online_policy.html).

Comprehensive character creation assistant for GURPS 4th Edition.
Supports any genre, power level, and campaign style. Works for
both players building PCs and GMs drafting NPCs.

## Campaign Context Awareness

The character generation workflow is context-sensitive. If the
user has an existing campaign (vault, notes, or shared context),
check for:
- Existing PCs and NPCs (avoid duplication, find party gaps)
- Campaign metadata (point total, TL, genre, house rules)

This file, together with the GURPS topic files (traits,
skills, equipment, spells, combat, powers, magic, social
rules), contains all the rules needed for character
generation. See SKILL.md for file routing.

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

**Point Total Guidelines** (B487):

| Points | Power Level | Examples |
|--------|------------|---------|
| 25 | Ordinary person | Civilians, bystanders |
| 50 | Competent normal | Trained professional |
| 75 | Experienced | Veteran, skilled expert |
| 100 | Exceptional | Elite professional |
| 150 | Heroic | Action hero, special forces |
| 200 | Larger-than-life | Cinematic hero, low supers |
| 300 | Legendary | Comic book hero |
| 500+ | Superheroic | Major supers, demigods |

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

| Attribute | Cost per Level | Governs |
|-----------|---------------|---------|
| ST (Strength) | 10 pts/level | Damage, lifting, HP base |
| DX (Dexterity) | 20 pts/level | Physical skills, Basic Speed |
| IQ (Intelligence) | 20 pts/level | Mental skills, Will, Per |
| HT (Health) | 10 pts/level | Endurance, FP base, Basic Speed |

**Size Modifier affects ST cost**: For SM +1 or larger, ST cost
drops to 9/level; for SM -1 or smaller, cost is unchanged but
check specific rules.

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

| Characteristic | Base | Cost to Modify |
|---------------|------|---------------|
| HP (Hit Points) | = ST | 2 pts/level |
| Will | = IQ | 5 pts/level |
| Perception (Per) | = IQ | 5 pts/level |
| FP (Fatigue Points) | = HT | 3 pts/level |
| Basic Speed | = (HT+DX)/4 | 5 pts/+0.25 |
| Basic Move | = Basic Speed (drop fractions) | 5 pts/level |

**Derived values to calculate:**
- **Damage**: Based on ST via the Damage Table (B16).
  Key breakpoints: ST 10 = 1d-2 thr / 1d sw; ST 12 = 1d-1 / 1d+2;
  ST 14 = 1d / 2d; ST 16 = 1d+1 / 2d+2
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
prerequisites, reference `traits-*.md` files or the
chargen kit file for your archetype.

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

*Modern Military/Action*: Combat Reflexes [15], High Pain
Threshold [10], Fit/Very Fit [5/15], Danger Sense [15],
Luck [15], Military Rank [5/level], Legal Enforcement Powers
[varies], Trained by a Master [30] (cinematic only)

*Fantasy*: Magery [varies], Power Investiture [10/level],
Eidetic Memory [5], Luck [15], Patron [varies]

*Supers*: Innate Attack [varies], DR [varies], Enhanced Move
[20/level], Flight [40], Super ST/DX [varies with power
modifier]. For power modifiers and supers-specific rules,
reference `powers-rules.md`.

*Horror*: Medium [10], Oracle [15], Spirit Empathy [10],
Luck [15], Danger Sense [15]

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

**Self-Control Rolls (CR)**: Many mental disadvantages use CR:

| CR | Resist On | Point Multiplier |
|----|----------|-----------------|
| 6 | Almost never | ×2 |
| 9 | Quite rarely | ×1.5 |
| 12 | Fairly often | ×1 (base) |
| 15 | Almost always | ×0.5 |

**Disadvantage-Driven Characters**: GURPS characters come alive
through disadvantages. They should reflect the concept, not be
picked for point value. A Navy SEAL with Duty (Military;
Extremely Hazardous; 15 or less) [-20] and Sense of Duty
(Teammates) [-5] tells a story. Greed [-15] on the same
character doesn't.

**Duty frequency**: 6 or less [-2], 9 or less [-5], 12 or
less [-10], 15 or less [-15]. Extremely Hazardous doubles
the base value. Involuntary adds another -5.

**Validation:**
- Total disadvantages cannot exceed campaign limit
- Quirks (-1 each) have separate limit (usually 5)
- Some disadvantages are mutually exclusive (Fearlessness vs
  Phobias, Mute vs Voice advantages)
- Enemy power relative to PC affects value

### Step 6: Skills

Skills are learned abilities. Effective level = controlling
attribute + modifier from difficulty and points spent.

**Difficulty Levels and Cost Progression:**

| Pts Spent | Easy (E) | Average (A) | Hard (H) | Very Hard (VH) |
|-----------|----------|-------------|----------|----------------|
| 1 | Attr+0 | Attr-1 | Attr-2 | Attr-3 |
| 2 | Attr+1 | Attr+0 | Attr-1 | Attr-2 |
| 4 | Attr+2 | Attr+1 | Attr+0 | Attr-1 |
| 8 | Attr+3 | Attr+2 | Attr+1 | Attr+0 |
| 12 | Attr+4 | Attr+3 | Attr+2 | Attr+1 |
| 16 | Attr+5 | Attr+4 | Attr+3 | Attr+2 |
| +4 per | +1 | +1 | +1 | +1 |

**Skill Defaults**: Most skills can be attempted untrained at
attribute-4 to attribute-6. Some have no default (Karate,
Surgery, etc.).

**Techniques**: Specific applications of a skill bought up from
a default penalty. Example: Targeted Attack (Guns/Head) defaults
to Guns-7, can be bought up to Guns-3 max. For martial arts
techniques, reference `skills-combat.md`.

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

**Starting Wealth by TL:**

| TL | Setting | Starting Wealth |
|----|---------|----------------|
| 3 | Medieval | $1,000 |
| 4 | Renaissance | $2,000 |
| 5 | Industrial | $5,000 |
| 6 | WWI-WWII | $10,000 |
| 7 | Early Modern | $15,000 |
| 8 | Modern | $20,000 |
| 9+ | Near Future+ | $30,000+ |

Wealth advantage multiplies starting wealth; Struggling/Poor/
Dead Broke reduces it.

For weapons and equipment stats, reference
`equipment-weapons.md`, `equipment-armor.md`, and
`equipment-gear.md`. Canonical sources are GURPS High-Tech
(TL5-8), Tactical Shooting (modern firearms), Ultra-Tech
(TL9+), and Low-Tech (TL0-4).

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

## Quick Reference — Common Traits

These traits appear in most builds. For unusual traits, read
the full trait files (see SKILL.md routing).

### Common Advantages

| Trait | Cost | Page | Notes |
|-------|------|------|-------|
| Acute Senses | 2/level | B35 | +1/level to one sense roll |
| Charisma | 5/level | B41 | +1/level reaction, influence |
| Combat Reflexes | 15 | B43 | +1 all active defenses, +6 vs surprise, never freeze |
| Danger Sense | 15 | B47 | GM rolls Per secretly when danger threatens |
| Fearlessness | 2/level | B55 | +1/level to Fright Checks |
| Fit | 5 | B55 | +1 all HT rolls except death |
| Very Fit | 15 | B55 | +2 all HT rolls, double FP recovery |
| Hard to Kill | 2/level | B58 | +1/level to HT rolls for death checks |
| Hard to Subdue | 2/level | B59 | +1/level to HT rolls to stay conscious |
| High Pain Threshold | 10 | B59 | No shock penalties, +3 knockdown/stun |
| Luck | 15 | B66 | Reroll any bad roll 1×/hour |
| Extraordinary Luck | 30 | B66 | Reroll 1×/30 min |
| Magery 0 | 5 | B66 | Can learn spells |
| Magery | +10/level | B66 | +level to spell skill and learning |
| Night Vision | 1/level | B71 | Reduce darkness penalties |
| Rapid Healing | 5 | B79 | +5 to HT rolls for natural healing |
| Talent | 5/10/15 per level | B89 | +1/level to a skill group + reactions |
| Trained by a Master | 30 | B93 | Cinematic. Halves Rapid Strike penalty |
| Voice | 10 | B97 | +2 to Diplomacy, Fast-Talk, Performance, etc. |
| Weapon Master | 20-45 | B99 | +1/die to damage, halves Rapid Strike |

### Common Disadvantages

| Trait | Cost | Page | Notes |
|-------|------|------|-------|
| Bad Temper | -10* | B124 | CR. Snap under stress |
| Bloodlust | -10* | B125 | CR. Fight to kill |
| Code of Honor | -5 to -15 | B127 | -5 Professional, -10 Soldier's, -15 Chivalric |
| Compulsive Behavior | -5* to -15* | B128 | CR. Various compulsions |
| Curious | -5* | B129 | CR. Must investigate |
| Duty | varies | B133 | Freq × hazard. 12 or less = -10, EH ×2 |
| Enemy | varies | B135 | Power × frequency |
| Flashbacks | -5 to -20 | B136 | -5 mild, -10 moderate, -20 severe |
| Honesty | -10* | B138 | CR. Follow the law |
| Loner | -5* | B142 | CR. Avoid working with others |
| Nightmares | -5* | B144 | CR. Roll each morning |
| Overconfidence | -5* | B148 | CR. Underestimate threats |
| Pacifism | -5 to -30 | B148 | -5 Reluctant Killer to -30 Total Nonviolence |
| Phobia | -5* to -15* | B148 | CR. Various fears |
| Post-Combat Shakes | -5* | B150 | CR. After combat stress |
| Secret | -5 to -30 | B152 | Severity determines cost |
| Sense of Duty | -2 to -20 | B153 | -2 small group to -20 all sapients |
| Stubbornness | -5 | B157 | Won't back down |
| Vow | -5 to -15 | B160 | -5 minor to -15 major |
| Weirdness Magnet | -15 | B162 | Paranormal. Strange things happen |

*CR = has Self-Control Roll. Base cost at CR 12 (×1).
CR 15 = ×0.5, CR 9 = ×1.5, CR 6 = ×2.

**Disadvantage Limits:** Most campaigns cap at -50 to -75
points (not counting quirks). Quirks cap at -5 (5 × -1).

## Cross-References

- Combat rules: `combat.md`
- Traits: `traits-*.md` (by category)
- Skills: `skills-*.md` (by category)
- Equipment: `equipment-*.md` (by type)
- Powers: `powers-rules.md`
- Magic: `magic-rules.md`, `spells.md`
- NPC generation shortcuts: `npc-generation.md`
- Game system overview: `game-systems.md`

## Canonical GURPS Sources

All rules in this file are based on GURPS 4th Edition. Key
source books: Basic Set — Characters (chargen core), Basic
Set — Campaigns (combat, campaign rules), Powers, Supers,
Martial Arts, High-Tech, Tactical Shooting, Ultra-Tech,
Low-Tech, Bio-Tech, Psionic Powers, Magic, Action 1: Heroes.
Cite these using GCS page reference codes where possible (e.g., "B14" for Basic Set Characters, "M74" for Magic).
