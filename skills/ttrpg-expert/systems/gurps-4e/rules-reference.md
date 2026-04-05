# GURPS 4e Expanded Rules Reference

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](http://www.sjgames.com/general/online_policy.html).

Deep-dive reference for GURPS 4th Edition mechanics beyond the
summaries in `game-systems.md`. This file covers combat, advantages
and disadvantages, equipment, powers, magic, and martial arts.

This file is the authoritative GURPS rules reference within
this skill. All point costs, formulas, and mechanics are based
on GURPS 4th Edition sourcebooks. Cite source book and page
number where possible (e.g., "Basic Set — Characters, p.14").

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

| Location | Penalty | DR Modifier | Wounding Modifier |
|----------|---------|-------------|-------------------|
| Torso | +0 | — | ×1 |
| Skull | -7 | DR 2 (bone) | ×4 |
| Face | -5 | — | ×4 (no DR 2 bone) |
| Neck | -5 | — | ×2 (crushing ×1.5) |
| Eye | -9 | — | ×4, can blind |
| Groin | -3 | — | ×1 (knockdown at HT-5) |
| Arm | -2 | — | ×1 (cripple at HP/2) |
| Leg | -2 | — | ×1 (cripple at HP/2) |
| Hand | -4 | — | ×1 (cripple at HP/3) |
| Foot | -4 | — | ×1 (cripple at HP/3) |
| Vitals | -3 | — | ×3 (imp/pi only) |

### Damage Types

| Type | Abbreviation | Notes |
|------|-------------|-------|
| Crushing | cr | Blunt trauma; double knockback |
| Cutting | cut | ×1.5 after DR penetration |
| Impaling | imp | ×2 after DR penetration |
| Piercing (small) | pi- | ×0.5 after DR |
| Piercing | pi | ×1 after DR |
| Piercing (large) | pi+ | ×1.5 after DR |
| Piercing (huge) | pi++ | ×2 after DR |
| Burning | burn | ×1 after DR; can ignite |
| Corrosion | cor | ×1; also damages DR |
| Toxic | tox | ×1; internal only |
| Fatigue | fat | To FP, not HP |

### Ranged Combat Modifiers

| Factor | Modifier |
|--------|---------|
| Range (Speed/Range Table) | -0 to -17+ |
| Target Size (SM) | Per SM difference |
| Aim (1 turn) | +weapon Acc |
| Aim (2 turns) | +Acc +1 |
| Aim (3+ turns) | +Acc +2 |
| Braced | Included in Acc for 2-handed |
| Scope | +1 to +3 (stacks with Acc) |
| Move and Attack | -4 (max effective 9) |
| Pop-up attack | -2 |
| Shooting into melee | -4 per interposing figure |

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

**Combat Reflexes** [15]: +1 all active defenses, +6 vs surprise,
+2 Fright Checks, never freeze. One of the best combat advantages
in the game. (Characters p.43)

**High Pain Threshold** [10]: Never suffer shock penalties, +3 to
resist knockdown/stun, +3 to resist torture. (Characters p.59)

**Danger Sense** [15]: GM rolls Per (or IQ) secretly when danger
threatens; success = warning. (Characters p.47)

**Fit** [5] / **Very Fit** [15]: Fit = +1 to all HT rolls
(except resist death). Very Fit = +2 to all HT rolls, recover FP
at double rate. (Characters p.55)

**Luck** [15] / **Extraordinary Luck** [30] / **Ridiculous Luck**
[60]: Reroll any one roll (take best) once per hour of play /
30 min / 10 min. Cinematic campaigns may allow higher levels.
(Characters p.66)

**Talent** [varies]: +1/level to a group of skills plus reaction
bonuses from those who value the talent. Cost = 5/10/15 pts per
level depending on breadth. (Characters p.89)

**Trained by a Master** [30]: Halves skill penalties for rapid
strikes, allows cinematic martial arts techniques. Prerequisite
for many Martial Arts options. Cinematic. (Characters p.93)

**Weapon Master** [20-45]: +1/die to damage with chosen
weapon(s), halves penalties for Rapid Strike. Cost varies by
breadth. (Characters p.99)

**Magery** [5 + 10/level]: Prerequisite for spells. Level adds
to spell skill and to IQ for learning spells. Magery 0 [5] =
can learn spells but no bonus. (Characters p.66)

### Key Disadvantages with Rules Notes

**Duty** [varies]: Frequency × hazard. Base: 6 or less [-2],
9 or less [-5], 12 or less [-10], 15 or less [-15]. Extremely
Hazardous = ×2. Involuntary = extra -5. (Characters p.133)

**Enemy** [varies]: Frequency × power. Less powerful than PC
[-5 base], equal [-10 base], more powerful [-20 base], entire
government [-30 base]. Frequency multiplier same as Duty.
(Characters p.135)

**Sense of Duty** [varies]: -2 to small group, -5 to large
group, -10 to nation, -15 to all living things, -20 to all
sapient beings. (Characters p.153)

**Code of Honor** [varies]: -5 (Professional), -10 (Gentleman's
or Soldier's), -15 (Chivalric). (Characters p.127)

**Overconfidence** [-5*]: Self-control roll to avoid rash
actions. Asterisk = modified by CR. (Characters p.148)

**Compulsive Behavior** [-5* to -15*]: Various. -5 for minor,
-10 for moderate, -15 for seriously inconvenient. Modified by
CR. (Characters p.128)

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
- Affects Others (+50%/level): Share advantage with others
- Area Effect (+50%/level): Affects an area (2 yd radius/level)
- Armor Divisor (+50% for (2), +100% for (3), +150% for (5), +200% for (10))
- Selective Area (+20%): Exclude targets from area effect
- Reduced Time (+20%/level): Halve activation time

**Key Limitations:**
- Accessibility (-varies): Limited conditions for use
- Costs Fatigue (-5%/FP): Drains FP to use
- Limited Use (-varies): Finite uses per day
- Nuisance Effect (-5%): Annoying side effect
- Requires (Attribute) Roll (-10%): Must roll to activate
- Takes Extra Time (-10%/level): Double activation time
- Unreliable (-varies): Activation roll required

**Power Modifiers** (from Powers): These are special limitations
that tie an advantage to a power source:
- Divine (-10%): Requires faith and patron deity
- Magical (-10%): Can be dispelled, detected as magic
- Psionic (-10%): Subject to anti-psi
- Spirit (-25%): Requires spirit cooperation
- Super (-10%): Innate metahuman ability
- Chi (-10%): Internal energy, requires discipline

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
- Damage (often listed directly, e.g., 7d pi for 5.56mm)
- Accuracy (Acc): Bonus when Aiming
- Range: Half damage / max range in yards
- RoF: Shots per turn
- Shots: Magazine capacity
- Bulk: Handling penalty (more negative = harder to maneuver)
- Recoil (Rcl): Penalty to subsequent shots in a burst

### Key Modern Firearms (TL8)

Source: GURPS High-Tech (TL5-8 weapons) and GURPS
High-Tech — Weapon Tables. Key weapon categories:

**Pistols**: 2d-3d pi/pi+ damage, Acc 2-3, typical weight 2-3 lbs
**SMGs**: 2d-3d pi damage, Acc 2-4, RoF 8-15
**Assault Rifles**: 5d-7d pi damage, Acc 4-5, RoF 10-15
**Battle Rifles**: 7d pi damage, Acc 5, RoF 10-11
**Shotguns**: 1d+1 pi per pellet (×9), or slugs 4d+4 pi++
**Sniper Rifles**: 7d-9d pi damage, Acc 5-6+scope

### Armor

**Modern Body Armor** (TL8):
- Ballistic vest: DR 8/2* (pi/cut vs other)
- Tactical vest: DR 12/5* with plates
- Full tactical gear: DR 12-35 depending on plates

The * notation means the first number applies to piercing and
cutting attacks; the second applies to all other damage types.

**Medieval/Fantasy** (Source: GURPS Low-Tech):
- Leather: DR 1-2
- Chain mail: DR 4
- Light plate: DR 6
- Heavy plate: DR 7-8
- Shield: DB +1 to +3

### Encumbrance Table

| Level | Weight | Move Penalty | Dodge Penalty |
|-------|--------|-------------|---------------|
| None (0) | ≤ BL | None | None |
| Light (1) | ≤ 2×BL | -1 | -1 |
| Medium (2) | ≤ 3×BL | -2 | -2 |
| Heavy (3) | ≤ 6×BL | -3 | -3 |
| X-Heavy (4) | ≤ 10×BL | -4 | -4 |

---

## 5. Powers Framework

The Powers framework (from GURPS Powers) lets you build any
superhuman ability by combining advantages with power modifiers.

### How Powers Work

A "power" is a thematic group of advantages sharing a power
source (e.g., all your fire-based abilities share the "Fire
Power" source with a -10% limitation). This groups them
narratively and mechanically.

**Building a Power:**
1. Choose a power source (see Power Modifiers above)
2. Select advantages that represent the power's effects
3. Apply the power source modifier to each advantage
4. Optionally add a Talent for the power (+1/level to rolls)

**Example — Low-Level Super Soldier (200 pts):**
- Enhanced ST +5 (Super, -10%) [41]
- DR 5 (Tough Skin, -40%; Super, -10%) [13]
- Enhanced Move 1 (Super, -10%) [18]
- Regeneration (Slow; Super, -10%) [9]

### Power Talents

Power Talents add their level to all rolls made with abilities
in that power. Cost is 5 pts/level for narrow powers, 10/level
for broad.

### Anti-Powers

Some advantages specifically counter powers:
- Neutralize (specific power) [50]: Shut down one power
- Static (specific power) [30]: Create power-dampening field
- Resistant to (power) [varies]: Bonus to resist

Source: GURPS Supers covers origin stories, power
frameworks, and metahuman campaign design in detail.

---

## 6. Magic System

GURPS has multiple magic systems. The default is the spell-based
system from GURPS Magic.

### Default (Spell-Based) Magic

**Prerequisites:**
- Magery 0 [5] to learn any spells
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

| Skill | Difficulty | Default | Parry | Notes |
|-------|-----------|---------|-------|-------|
| Boxing | DX/A | — | Skill/2+3 | +1/die damage, +1 Parry |
| Brawling | DX/E | — | Skill/2+3 | +1/die damage above skill 2 |
| Karate | DX/H | — | Skill/2+3 | +1/die damage at DX+1, +2/die at DX+2 |
| Judo | DX/H | — | Skill/2+3 | Can parry weapons unarmed at -3 |
| Wrestling | DX/A | — | — | Grappling; +1 per 2 pts of ST |
| Broadsword | DX/A | Various | Skill/2+3 | Sword & similar |
| Knife | DX/E | Various | Skill/2+3 | Fast draw common |
| Shield | DX/E | Various | — | Block = Skill/2+3 |
| Staff | DX/A | Various | Skill/2+3 | Reach 1-2 |
| Guns (Pistol) | DX/E | DX-4 | — | Ranged; no parry |
| Guns (Rifle) | DX/E | DX-4 | — | Ranged; no parry |

### Key Techniques

Techniques are specializations bought up from a negative default.
Cost is 1 pt to reduce penalty by 1 (for Average techniques) or
to reduce by 1 from a Hard technique.

| Technique | Default | Max | Notes |
|-----------|---------|-----|-------|
| Arm Lock | Skill+0 | +4 | Grappling follow-up |
| Back Kick | Skill-4 | Skill-1 | More damage, less accuracy |
| Choke Hold | Skill-2 | +0 | Fatigue/suffocation |
| Disarm | Skill-2 | +0 | Quick Contest to disarm |
| Elbow Strike | Skill-2 | +0 | Close combat |
| Feint | Skill+0 | — | Not technically a technique; use Quick Contest |
| Knee Strike | Skill-1 | +0 | Close combat |
| Targeted Attack | Skill-(location penalty) | Skill-1 to -3 | Reduce hit location penalty |
| Sweep | Skill-3 | -1 | Knock prone |
| Rapid Strike | Skill-6 each | Skill-3 each | Two attacks; halved with TBAM/WM |

### Cinematic Combat Options

Require **Trained by a Master** [30] or **Weapon Master** [20-45]:
- Rapid Strike penalties halved (to -3 each)
- Flying Leap, Power Blow, Pressure Points, Kiai
- Breaking Blow, Mental Strength, Blind Fighting
- Chambara-style dramatic combat

Source: GURPS Martial Arts — Fairbairn Close Combat Systems
covers specific military CQC styles including Defendu,
Gutter Fighting, and SAS/SBS Close Combat.

### Gun Fu (Cinematic Firearms)

From GURPS Gun Fu. For cinematic gun combat:
- Dual-Weapon Attack: -4 each hand (halved with Gunslinger)
- Shooting from unusual positions
- Pistol-whip and weapon transition techniques

Source: GURPS Gun Fu for complete cinematic firearms rules.

---

## 8. Psionic Powers

From GURPS Psionic Powers. Psionics use the Powers framework
with the Psionic (-10%) power modifier.

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
