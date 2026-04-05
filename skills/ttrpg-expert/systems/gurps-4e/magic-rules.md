# GURPS 4e Magic System

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](http://www.sjgames.com/general/online_policy.html).

In-play procedural reference for GURPS 4e magic casting.
Covers the default spell-based system, Ritual Magic, and
Ritual Path Magic (RPM). This file is about casting
PROCEDURES -- for the spell catalog, see `spells.md`.

Source: GURPS Magic, GURPS Thaumatology.

---

## Default (Spell-Based) Magic

The standard GURPS magic system from GURPS Magic. Each spell is
a separate skill with prerequisites.

### Prerequisites

- **Magery 0** [5]: Required to learn any spell at all.
- **Higher Magery** [+10/level]: Adds to spell skill and to IQ
  for the purpose of learning spells.
- **Spell prerequisites**: Most spells require one or more other
  spells (and sometimes a minimum Magery level) before they can
  be learned. Prerequisite chains can be long for powerful
  spells.

### Spell Skills

Each spell is an **IQ/Hard** skill. Effective level:

```text
Spell Skill = IQ + Magery + (points spent per IQ/H cost table)
```

Spells default to prerequisite spells at -6, but most mages buy
spells directly.

### Casting Procedure

1. **Choose spell** and declare target/area.
2. **Determine casting time**: Most spells take 1 second
   (Concentrate maneuver). Some require multiple seconds.
3. **Roll 3d6 <= effective spell skill** (after all modifiers).
4. **Pay FP cost** (paid whether the spell succeeds or fails).
5. **Resolve effect** based on success/failure/critical.

### Casting Cost and Cost Reduction

- Each spell has a base FP cost listed in its description.
- **High skill reduces cost**: -1 FP for every 2 full levels
  of skill above 15.
  - Skill 15: full cost
  - Skill 17: -1 FP
  - Skill 19: -2 FP
  - Skill 21: -3 FP
- **Minimum cost**: 1 FP for most spells (some exceptions
  noted in spell descriptions).
- **At 0 FP**: Caster may spend HP instead, at risk of
  unconsciousness.

### Maintaining Spells

Many spells can be maintained after casting:
- Maintenance costs a reduced FP amount (listed per spell)
  per duration interval.
- Each maintained spell gives **-1 to cast new spells**.
- A caster can maintain multiple spells simultaneously but
  the penalties stack.
- Dropping a maintained spell is a free action.

### Critical Success and Failure

- **Critical success**: Spell works well; costs no FP; may
  have enhanced effect.
- **Critical failure**: Consult the Magic Critical Failure
  Table (M7). Effects range from spell fails harmlessly to
  dangerous backfire.

### Spell Colleges

Spells are organized into colleges (thematic groups). A mage
can specialize in one or more colleges.

| College | Focus |
|---------|-------|
| Air | Wind, weather, gases |
| Animal | Animal control and communication |
| Body Control | Alter own/others' physical state |
| Communication & Empathy | Telepathy, translation, empathy |
| Earth | Stone, soil, metals |
| Enchantment | Create permanent magic items |
| Fire | Flames, heat |
| Food | Create, purify, spoil food |
| Gate | Teleportation, plane travel |
| Healing | Cure wounds, disease, poison |
| Illusion & Creation | Illusions, solid creation |
| Knowledge | Divination, identification |
| Light & Darkness | Illumination, shadow |
| Making & Breaking | Repair, shape, destroy objects |
| Meta-Spells | Counterspells, magic detection |
| Mind Control | Influence, compulsion |
| Movement | Levitation, haste, telekinesis |
| Necromancy | Death, undead, spirits |
| Plant | Plant control and growth |
| Protection & Warning | Wards, shields, alarms |
| Sound | Sound manipulation |
| Technology | Machine control (high-TL) |
| Water | Liquids, ice, underwater |
| Weather | Large-scale weather control |

### Mana Levels

The ambient mana level affects magic:

| Mana Level | Effect |
|------------|--------|
| No Mana | No magic works at all |
| Low Mana | All spells at -5; no area spells |
| Normal Mana | Standard casting |
| High Mana | All spells at +1; critical failure only on 17-18 |
| Very High Mana | Spells work automatically; critical failure on 16-18 |

---

## Ritual Magic (Alternative System)

An alternative from GURPS Thaumatology for settings where
spell-by-spell learning doesn't fit.

### Core Mechanic

- Learn **Ritual Magic** (IQ/VH) or **Thaumatology** (IQ/VH)
  as a core skill.
- Buy **Path skills** for each college (IQ/VH), defaulting to
  the core skill at -6.
- To cast a spell: roll against the relevant Path skill, with
  penalties for spell complexity.
- **No prerequisite chains** -- any spell in a college is
  accessible if you know the Path.

### When to Use

Best for low-magic settings, ritual-heavy campaigns, or
settings where magic is rare and dangerous. Simpler to manage
for GMs who don't want to track prerequisite trees.

---

## Ritual Path Magic (RPM)

An alternative system from GURPS Monster Hunters and GURPS
Thaumatology: Ritual Path Magic. Designed for modern
supernatural and investigation games.

### Core Mechanic

- Caster knows **Path skills** (e.g., Path of Body, Path of
  Mind, Path of Energy).
- To cast, define a ritual by combining Paths and effects.
- **Gather energy** to meet the ritual's energy cost: roll
  Path skill each turn to accumulate energy.
- When enough energy is gathered, the ritual activates.

### Key Features

- **Flexible**: No fixed spell list; casters build effects
  on the fly.
- **Energy-based**: More powerful effects cost more energy and
  take longer to gather.
- **Conditional rituals**: Can prepare rituals in advance,
  triggered by conditions.
- **Charms and potions**: Create one-use magic items by
  binding rituals.

### When to Use

Best for modern horror, urban fantasy, and investigation
campaigns where flexible, improvisational magic fits the tone.
Works well with Monster Hunters templates.

---

## Cross-References

- Spell catalog: `spells.md`
- Magery advantage details: `traits-supernatural.md`
- Powers framework (for magic as a power): `powers-rules.md`
- Core mechanics (skill rolls, success/failure): `mechanics.md`
