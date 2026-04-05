# GURPS 4e Powers Framework

> GURPS is a trademark of Steve Jackson Games, and its rules
> and art are copyrighted by Steve Jackson Games. All rights
> are reserved by Steve Jackson Games. This game aid is the
> original creation of AntTheLimey and is released for free
> distribution, and not for resale, under the permissions
> granted in the
> [Steve Jackson Games Online Policy](http://www.sjgames.com/general/online_policy.html).

In-play procedural reference for the GURPS 4e Powers framework.
Covers enhancements and limitations, power sources, building
powers, power talents, anti-powers, and psionic powers.

Source: GURPS Powers, GURPS Psionic Powers, GURPS Supers.

---

## Enhancement and Limitation Modifiers

Enhancements increase an advantage's cost by a percentage;
limitations decrease it. They're core to the Powers system but
apply to any advantage.

### Key Enhancements

| Enhancement | Cost | Effect |
|-------------|------|--------|
| Affects Others | +50%/level | Share advantage with others by touch |
| Area Effect | +50%/level | Affects an area (2-yard radius per level) |
| Armor Divisor (2) | +50% | Target DR is halved |
| Armor Divisor (3) | +100% | Target DR is divided by 3 |
| Armor Divisor (5) | +150% | Target DR is divided by 5 |
| Armor Divisor (10) | +200% | Target DR is divided by 10 |
| Selective Area | +20% | Exclude specific targets from area effect |
| Reduced Time | +20%/level | Halve activation time per level |
| Persistent | +40% | Effect remains without concentration |
| Extended Duration | +20%/level | Double duration per level |
| Increased Range | +10%/level | Double range per level |
| Rapid Fire | +40%/level | Multiple projectiles per attack |
| Follow-Up | +0% | Triggered by another attack hitting |

### Key Limitations

| Limitation | Cost | Effect |
|------------|------|--------|
| Accessibility | -varies | Limited conditions for use |
| Costs Fatigue | -5%/FP | Drains FP each use |
| Limited Use | -varies | Finite uses per day (-10% for 2/day, -20% for 1/day) |
| Nuisance Effect | -5% | Annoying but not disabling side effect |
| Requires (Attribute) Roll | -10% | Must roll to activate |
| Takes Extra Time | -10%/level | Double activation time per level |
| Unreliable | -varies | Activation roll required (-5% at 15, -10% at 12, etc.) |
| Emanation | -20% | Centered on self, can't exclude self |
| Melee Attack | -25% | Requires melee range (Reach C) |
| Preparation Required | -varies | Time to prepare before use |
| Requires Concentrate | -15% | Must take Concentrate maneuver |
| Uncontrollable | -10% to -30% | Can't fully control when/how it activates |

---

## Power Source Modifiers

Power source modifiers are special limitations that tie an
advantage to a thematic power source. All abilities in a power
share the same power modifier.

| Power Source | Modifier | Description |
|-------------|----------|-------------|
| Divine | -10% | Requires faith and patron deity; can be revoked for violations of moral code |
| Magical | -10% | Can be dispelled; detected as magic; blocked by anti-magic |
| Psionic | -10% | Subject to anti-psi abilities; detected as psionic |
| Spirit | -25% | Requires spirit cooperation; spirits may refuse or demand payment |
| Super | -10% | Innate metahuman ability; affected by Neutralize/Static vs supers |
| Chi | -10% | Internal energy; requires discipline and focus; disrupted by injury |

### Choosing a Power Source

The power source determines:
1. **What can counter it**: Anti-powers target specific sources.
2. **How it's detected**: Each source is detectable differently.
3. **Narrative restrictions**: E.g., Divine powers may require
   prayer; Spirit powers require negotiation.
4. **What Power Talent applies**: Each power has its own talent.

---

## Net Modifier Rule

When applying enhancements and limitations together:

- Calculate total enhancement percentage (positive)
- Calculate total limitation percentage (negative)
- Net modifier = sum of both

**Minimum cost rule**: The final cost of a modified advantage
cannot be less than **20% of the base cost** (round up). No
matter how many limitations you stack, you always pay at least
1/5 of the unmodified price.

**Example**: Innate Attack 2d [20 base]
- With -80% in limitations: 20 x 0.20 = 4 points (minimum)
- With -50% in limitations: 20 x 0.50 = 10 points

---

## Building a Power

A "power" is a thematic group of advantages sharing a power
source. The procedure:

### Step 1: Define the Power Source

Choose the source that fits the narrative (Divine, Magical,
Psionic, Spirit, Super, Chi, or a custom source with GM
approval).

### Step 2: Select Abilities

Pick advantages that represent the power's effects. Common
building blocks:

| Advantage | Base Cost | Typical Use |
|-----------|-----------|-------------|
| Innate Attack | varies | Damage-dealing abilities |
| Affliction | 10/level | Status effects, debuffs |
| Damage Resistance | 5/level | Defensive barriers |
| Enhanced ST/DX | 10 or 20/level | Physical augmentation |
| Enhanced Move | 20/level | Speed powers |
| Flight | 40 | Aerial movement |
| Healing | 25 | Restore HP to others |
| Invisibility | 40 | Concealment |
| Mind Control | 50 | Mental domination |
| Mind Reading | 30 | Telepathy |
| Telekinesis | 5/level | Move objects at range |
| Teleportation | 100 | Instant travel |
| Warp | 100 | Dimension/plane travel |

### Step 3: Apply Modifiers

1. Apply the power source modifier to each advantage.
2. Add any additional enhancements or limitations.
3. Calculate final cost using the net modifier rule.

### Step 4: Add a Power Talent (Optional)

Power Talents add their level to all rolls made with abilities
in that power.

**Example -- Low-Level Super Soldier (200 pts):**
- Enhanced ST +5 (Super, -10%) [41]
- DR 5 (Tough Skin, -40%; Super, -10%) [13]
- Enhanced Move 1 (Super, -10%) [18]
- Regeneration (Slow; Super, -10%) [9]

---

## Power Talents

A Power Talent adds its level to all skill rolls and reaction
rolls associated with a specific power.

| Power Breadth | Cost per Level |
|--------------|---------------|
| Narrow (few abilities) | 5 pts/level |
| Moderate | 10 pts/level |
| Broad (many abilities) | 15 pts/level |

- Power Talents also give a reaction bonus from those who
  respect or fear the power.
- Maximum level is typically 4 (GM discretion).
- Applies to: activation rolls, resistance rolls for the
  power's abilities, and any skill rolls closely tied to the
  power.

---

## Anti-Powers

Some advantages specifically counter powers:

| Ability | Cost | Effect |
|---------|------|--------|
| Neutralize | 50 pts | Shut down one specific power in a target; Quick Contest of Will + Talent vs target's Will + Talent |
| Static | 30 pts | Create a field that dampens a specific power; all abilities of that type are at -Talent level in the area |
| Resistant to (power) | varies | Bonus to resist effects of a specific power (+3 for 5 pts, +8 for 7 pts, immunity for 10-15 pts) |

### Neutralize Procedure

1. Touch the target or use at range (with appropriate
   enhancements).
2. Quick Contest: your Will + your anti-power Talent vs
   target's Will + their power Talent.
3. If you win, the target's power is shut down for minutes
   equal to your margin of victory.

### Static Procedure

1. Activate as a standard action.
2. Creates a field centered on you (default radius = 2 yards).
3. All abilities of the targeted power type are penalized
   within the field.
4. Costs FP to maintain (typically 1 FP/minute).

---

## Psionic Powers

From GURPS Psionic Powers. Psionics use the Powers framework
with the Psionic (-10%) power modifier.

### How Psionics Work

- Each psionic ability is built from advantages + the Psionic
  (-10%) modifier.
- Psionic Talents add to rolls for all abilities in one
  category.
- Subject to Anti-Psi abilities (Neutralize, Static, Screen).
- Detectable by other psions and psi-sensitive individuals.

### Psionic Abilities by Talent

| Talent | Abilities | Focus |
|--------|-----------|-------|
| Antipsi | Neutralize, Screen, Static | Counter other psionics |
| Astral Projection | Projection, Dream Travel | Out-of-body experience |
| Electrokinesis | Dampen, Surge, Cyberpsi | Control electronics and electricity |
| ESP | Clairsentience, Precognition, Psychometry | Perception beyond normal senses |
| Psychic Healing | Cure, Stabilize | Heal injury and illness |
| Psychic Vampirism | Drain, Steal | Absorb energy or traits from others |
| Psychokinesis | TK, PK Shield, Cryokinesis, Pyrokinesis | Move objects, energy manipulation |
| Telepathy | Telesend, Telereceive, Mind Control, Mental Blow | Mental communication and influence |

### Psionic Talent Costs

Each psionic talent is 5 pts/level and adds to all rolls for
abilities in that category. Maximum 4 levels unless the
campaign is cinematic.

### Using Psionic Abilities In Play

1. **Activate**: Usually requires Concentrate maneuver for
   1 second.
2. **Roll**: 3d6 <= ability skill (IQ or Will + Talent +
   modifiers, depending on the ability).
3. **Resistance**: Target resists with Will (or HT for
   physical effects) in a Quick Contest.
4. **Duration**: Most abilities last as long as you
   concentrate; some are instant.

---

## Cross-References

- Enhancement/limitation details: see tables above
- Power source descriptions: see tables above
- Magic as a power: `magic-rules.md`
- Core mechanics (contests, rolls): `mechanics.md`
- Trait costs and descriptions: `traits-*.md` files
