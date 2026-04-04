# GURPS 4e Expanded Rules Reference

Deep-dive reference for GURPS 4th Edition mechanics beyond the
summaries in `game-systems.md`. This file covers combat, advantages
and disadvantages, equipment, powers, magic, and martial arts.

This file is the authoritative GURPS rules reference within
this skill. All procedural mechanics are based on GURPS 4th
Edition sourcebooks. Cite source book and page number where
possible (e.g., "Basic Set — Characters, p.14").

For specific point costs, damage values, and mechanical tables,
this skill reads from your converted GCA data at
`~/.gm-apprentice/data/gurps-4e/`. Run the setup wizard to
connect your GCA4 data files.

## Table of Contents

1. Combat Mechanics
2. Advantages and Disadvantages (Expanded)
3. Enhancement and Limitation Modifiers
4. Equipment and Gear
5. Powers Framework
6. Magic System
7. Martial Arts and Techniques
8. Psionic Powers

---

## 1. Combat Mechanics

### Turn Sequence

Each combat turn is 1 second. On their turn a character chooses
a maneuver, then the turn resolves.

### Maneuvers

| Maneuver | Move | Action | Notes |
|----------|------|--------|-------|
| Do Nothing | None | None | Default if stunned |
| Move | Full | None | Move up to full Move |
| Change Posture | — | — | Stand, kneel, sit, lie down, etc. |
| Aim | Step | Aim weapon | +Acc on next attack; cumulative +1/turn (max +2) |
| Attack | Step | One attack | Melee or ranged |
| All-Out Attack | Half | Attack | Determined (+4 hit), Strong (+2 dmg or +1/die), Double (2 attacks), or Feint+Attack; no active defense |
| Move and Attack | Full | One attack | -4 to hit (min effective skill 9); all active defenses available |
| All-Out Defense | Step | None | +2 to one defense, or two different defenses |
| Concentrate | Step | Mental | For spells, psionics, etc. |
| Ready | Step | Ready item | Draw weapon, reload, etc. |
| Wait | Varies | Triggered | Interrupt on specified trigger |
| Evaluate | Step | Study foe | +1 to hit per turn (max +3) |
| Feint | Step | Contest | Quick Contest of weapon skills; success penalizes foe's defense |

### Attack Resolution

1. **Roll to hit**: 3d6 ≤ effective skill (after modifiers)
2. **Defense roll**: Target rolls active defense (Dodge, Parry, or Block)
3. **Damage**: Roll damage dice, subtract DR, apply to HP

### Active Defenses

| Defense | Base | Notes |
|---------|------|-------|
| Dodge | Basic Speed + 3 (floor) | Always available unless stunned; -1 per encumbrance level |
| Parry | Skill/2 + 3 (floor) | Weapon or unarmed; -4 cumulative same weapon; retreating Parry +1 (+3 for fencing weapons) |
| Block | Shield skill/2 + 3 (floor) | Requires shield; retreating Block +1 |

**Retreat**: Once per turn, step back 1 yard for a defense
bonus: +3 to Dodge, +1 to Parry (+3 if fencing weapon), +1 to
Block. Slip is a sidestep variant that gives +3 to Dodge
without requiring backward movement.

**Combat Reflexes**: +1 to all active defenses at all times,
+6 to recover from surprise, never freeze.

### Hit Locations

Hit locations impose an attack penalty and modify wounding
effects on that body part. Key locations include the torso
(no penalty, standard wounding), skull, face, neck, eyes,
vitals, limbs, hands, and feet. Some locations have inherent
DR (e.g., skull bone) and different wounding multipliers for
different damage types.

Look up the full hit location table (penalties, DR modifiers,
and wounding multipliers) in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-campaigns/combat-tables.md`

### Damage Types

Damage types determine the wounding multiplier applied after
armor penetration. The main types are:

- **Crushing (cr)** — Blunt trauma; double knockback
- **Cutting (cut)** — Slashing; enhanced wounding after DR
- **Impaling (imp)** — Piercing deep; high wounding multiplier
- **Piercing (pi-, pi, pi+, pi++)** — Ranging from small to
  huge, with increasing wounding effectiveness
- **Burning (burn)** — Fire/energy; can ignite
- **Corrosion (cor)** — Also damages DR
- **Toxic (tox)** — Internal only
- **Fatigue (fat)** — Applies to FP, not HP

Look up specific wounding multipliers for each damage type in
your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-campaigns/combat-tables.md`

### Ranged Combat Modifiers

Ranged combat applies modifiers for range (via the Speed/Range
Table), target size (SM), aiming duration, bracing, scope
bonuses, movement penalties, pop-up attacks, and shooting into
melee. Aim gives the weapon's Accuracy bonus on the first turn,
with cumulative +1 per additional turn of aiming (max +2 extra).

Look up the full ranged combat modifier table in your converted
GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-campaigns/combat-tables.md`

### Shock and Knockdown

- **Shock**: Lose HP in one turn → -HP lost to DX and IQ next
  turn only (max -4)
- **Knockdown**: Take HP/2+ in one blow → roll HT or fall prone
  and be stunned. Major Wound (HP/2+ from single attack) also
  requires a HT roll.
- **Stun**: Skip next turn; recover by rolling HT at start of
  each turn

### Death and Dying

- **0 HP**: Roll HT each turn to stay conscious. Collapse on
  failure.
- **-1×HP**: Roll HT or die. Make a death check each time you
  lose another full multiple of HP (at -HP, -2×HP, -3×HP, etc.)
- **-5×HP**: Automatic death. No roll.
- **-10×HP**: Total bodily destruction.

---

## 2. Advantages and Disadvantages (Expanded)

### Key Advantages with Rules Notes

Advantage names and what they do conceptually. These traits are
bought with character points — look up specific costs in your
converted GCA data.

**Combat Reflexes**: +1 all active defenses, +6 vs surprise,
+2 Fright Checks, never freeze. One of the best combat
advantages in the game. (Characters p.43)

**High Pain Threshold**: Never suffer shock penalties, +3 to
resist knockdown/stun, +3 to resist torture. (Characters p.59)

**Danger Sense**: GM rolls Per (or IQ) secretly when danger
threatens; success = warning. (Characters p.47)

**Fit / Very Fit**: Fit = +1 to all HT rolls (except resist
death). Very Fit = +2 to all HT rolls, recover FP at double
rate. (Characters p.55)

**Luck / Extraordinary Luck / Ridiculous Luck**: Reroll any
one roll (take best) at varying frequencies — once per hour of
play, every 30 min, or every 10 min. Cinematic campaigns may
allow higher levels. (Characters p.66)

**Talent**: +1/level to a group of skills plus reaction bonuses
from those who value the talent. Cost depends on breadth of the
skill group. (Characters p.89)

**Trained by a Master**: Halves skill penalties for rapid
strikes, allows cinematic martial arts techniques. Prerequisite
for many Martial Arts options. Cinematic. (Characters p.93)

**Weapon Master**: +1/die to damage with chosen weapon(s),
halves penalties for Rapid Strike. Cost varies by breadth of
weapons covered. (Characters p.99)

**Magery**: Prerequisite for spells. Level adds to spell skill
and to IQ for learning spells. Magery 0 = can learn spells but
no bonus. (Characters p.66)

Look up specific advantage point costs in your converted GCA
data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/advantages.md`

### Key Disadvantages with Rules Notes

**Duty**: Value depends on frequency (how often it comes up)
and hazard level. Extremely Hazardous and Involuntary modifiers
increase the value. (Characters p.133)

**Enemy**: Value depends on frequency and power relative to the
PC (less powerful, equal, more powerful, or an entire
government). (Characters p.135)

**Sense of Duty**: Value depends on the size of the group the
character feels duty toward (small group through all sapient
beings). (Characters p.153)

**Code of Honor**: Value varies by strictness of the code
(Professional, Gentleman's/Soldier's, Chivalric).
(Characters p.127)

**Overconfidence**: Self-control roll to avoid rash actions.
Value modified by self-control number. (Characters p.148)

**Compulsive Behavior**: Various types at different base values
for minor, moderate, and seriously inconvenient compulsions.
Modified by self-control roll. (Characters p.128)

Look up specific disadvantage point values in your converted
GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/disadvantages.md`

### Disadvantage Limits

Most campaigns cap disadvantages at -50 to -75 points (not
counting quirks). Quirks cap separately at -5 (5 quirks at
-1 each). These limits keep characters playable — a character
with -200 points of disadvantages is crippled by limitations.

---

## 3. Enhancement and Limitation Modifiers

Enhancements increase an advantage's cost by a percentage;
limitations decrease it. They're core to the Powers system but
apply to any advantage.

**Key Enhancements:**
- Affects Others: Share advantage with others
- Area Effect: Affects an area (radius per level)
- Armor Divisor: Penetrate DR more effectively (multiple tiers)
- Selective Area: Exclude targets from area effect
- Reduced Time: Halve activation time per level

**Key Limitations:**
- Accessibility: Limited conditions for use
- Costs Fatigue: Drains FP to use
- Limited Use: Finite uses per day
- Nuisance Effect: Annoying side effect
- Requires (Attribute) Roll: Must roll to activate
- Takes Extra Time: Double activation time per level
- Unreliable: Activation roll required

**Power Modifiers** (from Powers): These are special limitations
that tie an advantage to a power source:
- Divine: Requires faith and patron deity
- Magical: Can be dispelled, detected as magic
- Psionic: Subject to anti-psi
- Spirit: Requires spirit cooperation
- Super: Innate metahuman ability
- Chi: Internal energy, requires discipline

Look up specific enhancement and limitation percentage values
in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/modifiers.md`

**Net modifier rule**: Total limitation percentage cannot reduce
final cost below 20% of the base cost.

---

## 4. Equipment and Gear

### Weapons Overview

Weapons are defined by: damage, reach/range, weight, cost,
ST requirement, and special notes.

**Melee Damage Formula:**
- Swing + modifier (e.g., sw+1 for a broadsword)
- Thrust + modifier (e.g., thr+2 for a spear)
- Damage type (cut, cr, imp, etc.)

**Ranged Weapons:**
- Damage (often listed directly, e.g., dice + type)
- Accuracy (Acc): Bonus when Aiming
- Range: Half damage / max range in yards
- RoF: Shots per turn
- Shots: Magazine capacity
- Bulk: Handling penalty (more negative = harder to maneuver)
- Recoil (Rcl): Penalty to subsequent shots in a burst

For specific weapon statistics, look up in your converted GCA
data or reference the source books directly:
`~/.gm-apprentice/data/gurps-4e/gurps-high-tech/weapons.md`

Source: GURPS High-Tech (TL5-8 weapons) and GURPS
High-Tech — Weapon Tables for detailed stats.

### Armor

Armor provides Damage Resistance (DR) that subtracts directly
from incoming damage. DR values vary by material and
construction, from light leather to heavy plate to modern
ballistic vests with ceramic plates. Some armor has split DR
(one value for piercing/cutting, another for other damage
types, noted with *).

Look up specific armor DR values in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-high-tech/armor.md`

Source: GURPS Low-Tech (TL0-4 armor), GURPS High-Tech (TL5-8
armor), GURPS Ultra-Tech (TL9+ armor).

### Encumbrance

Encumbrance is based on total carried weight relative to Basic
Lift (BL). There are five levels: None, Light, Medium, Heavy,
and X-Heavy. Each level above None penalizes both Move and
Dodge by an increasing amount.

Look up the encumbrance table (weight thresholds and
Move/Dodge penalties) in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-campaigns/encumbrance.md`

---

## 5. Powers Framework

The Powers framework (from GURPS Powers) lets you build any
superhuman ability by combining advantages with power modifiers.

### How Powers Work

A "power" is a thematic group of advantages sharing a power
source (e.g., all your fire-based abilities share the "Fire
Power" source with a limitation). This groups them
narratively and mechanically.

**Building a Power:**
1. Choose a power source (see Power Modifiers above)
2. Select advantages that represent the power's effects
3. Apply the power source modifier to each advantage
4. Optionally add a Talent for the power (+1/level to rolls)

To build specific power examples with point costs, look up
advantages and modifiers in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/advantages.md`

### Power Talents

Power Talents add their level to all rolls made with abilities
in that power. Cost depends on whether the power is narrow or
broad.

### Anti-Powers

Some advantages specifically counter powers:
- Neutralize (specific power): Shut down one power
- Static (specific power): Create power-dampening field
- Resistant to (power): Bonus to resist

Look up anti-power costs in your converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-basic-set-4th-ed-characters/advantages.md`

Source: GURPS Supers covers origin stories, power
frameworks, and metahuman campaign design in detail.

---

## 6. Magic System

GURPS has multiple magic systems. The default is the spell-based
system from GURPS Magic.

### Default (Spell-Based) Magic

**Prerequisites:**
- Magery 0 to learn any spells
- Higher Magery adds to spell skill and IQ for spell learning
- Most spells require other spells as prerequisites

**Spell Skills**: Each spell is an IQ/Hard skill. Effective
level = IQ + Magery + relative level from points spent.

**Casting Cost**: Spells cost FP (or HP at 0 FP). Cost varies
by spell and distance/area. High skill reduces cost: -1 FP per
full 2 levels above 15 (minimum 1 FP for most spells).

**Spell Categories (Colleges):**
Air, Animal, Body Control, Communication & Empathy, Earth,
Enchantment, Fire, Food, Gate, Healing, Illusion & Creation,
Knowledge, Light & Darkness, Making & Breaking, Meta-Spells,
Mind Control, Movement, Necromancy, Plant, Protection & Warning,
Sound, Technology, Water, Weather

**Maintaining Spells**: Many spells can be maintained after
casting for a reduced FP cost per duration interval. Caster
can maintain multiple spells but each gives -1 to cast new
spells.

### Ritual Magic (Alternative System)

Uses a single core skill (Ritual Magic or Thaumatology) with
path skills for each college. No prerequisite chains. Better
for low-magic settings.

### RPM (Ritual Path Magic)

Another alternative from Monster Hunters / Thaumatology. Uses
energy gathering to fuel flexible rituals. Better for modern
horror and investigation games.

Source: GURPS Magic for detailed spell lists and college
prerequisites; GURPS Thaumatology for alternative frameworks.

---

## 7. Martial Arts and Techniques

Source: GURPS Martial Arts. This section covers the core
technique system and key combat techniques.

### Martial Arts Styles

A style is a collection of skills, techniques, cinematic skills,
and perks that represent a coherent fighting tradition. Styles
have:
- **Required Skills**: Core combat skills (e.g., Karate, Judo)
- **Optional Skills**: Supporting skills (e.g., Acrobatics,
  Body Language)
- **Techniques**: Specific maneuvers at reduced penalty
- **Cinematic Skills**: For over-the-top campaigns (Power Blow,
  Kiai, Pressure Points, etc.)
- **Style Perks**: 1-point advantages unique to the style

### Key Combat Skills

| Skill | Difficulty | Parry | Notes |
|-------|-----------|-------|-------|
| Boxing | DX/A | Skill/2+3 | Bonus to damage, +1 Parry |
| Brawling | DX/E | Skill/2+3 | Bonus to damage at higher skill |
| Karate | DX/H | Skill/2+3 | Scaling damage bonus at higher skill |
| Judo | DX/H | Skill/2+3 | Can parry weapons unarmed at -3 |
| Wrestling | DX/A | — | Grappling; ST bonus |
| Broadsword | DX/A | Skill/2+3 | Sword & similar |
| Knife | DX/E | Skill/2+3 | Fast draw common |
| Shield | DX/E | — | Block = Skill/2+3 |
| Staff | DX/A | Skill/2+3 | Reach 1-2 |
| Guns (Pistol) | DX/E | — | Ranged; no parry |
| Guns (Rifle) | DX/E | — | Ranged; no parry |

### Key Techniques

Techniques are specializations bought up from a negative default.
Cost is 1 pt to reduce penalty by 1 (for Average techniques) or
to reduce by 1 from a Hard technique.

Common techniques include: Arm Lock, Back Kick, Choke Hold,
Disarm, Elbow Strike, Knee Strike, Targeted Attack, Sweep,
and Rapid Strike. Each has a default relative to the parent
skill and a maximum level it can be improved to.

Look up specific technique defaults and max values in your
converted GCA data:
`~/.gm-apprentice/data/gurps-4e/gurps-martial-arts/techniques.md`

### Cinematic Combat Options

Require **Trained by a Master** or **Weapon Master**:
- Rapid Strike penalties halved (to -3 each)
- Flying Leap, Power Blow, Pressure Points, Kiai
- Breaking Blow, Mental Strength, Blind Fighting
- Chambara-style dramatic combat

Source: GURPS Martial Arts — Fairbairn Close Combat Systems
covers specific military CQC styles including Defendu,
Gutter Fighting, and SAS/SBS Close Combat.

### Gun Fu (Cinematic Firearms)

From GURPS Gun Fu. For cinematic gun combat:
- Dual-Weapon Attack: penalty each hand (halved with Gunslinger)
- Shooting from unusual positions
- Pistol-whip and weapon transition techniques

Source: GURPS Gun Fu for complete cinematic firearms rules.

---

## 8. Psionic Powers

From GURPS Psionic Powers. Psionics use the Powers framework
with the Psionic power modifier.

### Psionic Abilities

Organized by talent:
- **Antipsi**: Neutralize, Screen, Static
- **Astral Projection**: Projection, Dream Travel
- **Electrokinesis**: Dampen, Surge, Cyberpsi
- **ESP**: Clairsentience, Precognition, Psychometry
- **Psychic Healing**: Cure, Stabilize
- **Psychic Vampirism**: Drain, Steal
- **Psychokinesis**: TK, PK Shield, Cryokinesis, Pyrokinesis
- **Telepathy**: Telesend, Telereceive, Mind Control, Mental
  Blow

Each ability is built from advantages + the Psionic modifier.
Psionic Talents add to rolls for all abilities in one category.

Source: GURPS Psionic Powers for full ability builds, costs,
and psionic talent descriptions.

---

## Cross-References

**Within this skill:**
- Character generation workflow: `gurps-character-generation.md`
- Game system overview: `game-systems.md`
- NPC generation: `npc-generation.md`

**Canonical GURPS 4e Sources** (cite by name and page when
providing detailed rulings):
- Basic Set — Characters: Attributes, advantages, skills
- Basic Set — Campaigns: Combat, world-building, campaign types
- Action 1 — Heroes: Action hero templates and lenses
- High-Tech: TL5-8 weapons and equipment
- Tactical Shooting: Realistic firearms rules
- Martial Arts: Styles, techniques, cinematic combat
- Supers: Powers, origins, metahuman campaigns
- Psionic Powers: Psi abilities and builds
- Gun Fu: Cinematic firearms
- Powers: Power framework and modifiers
- Magic: Spell-based magic system
- Thaumatology: Alternative magic frameworks
- Low-Tech: TL0-4 weapons, armor, and equipment
- Ultra-Tech: TL9+ equipment
- Bio-Tech: Biological modifications
