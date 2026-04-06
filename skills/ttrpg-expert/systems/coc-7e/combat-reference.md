> BRP combat foundation: BRP ORC License. See ATTRIBUTION.md.
> CoC 7e adaptation: Our own descriptions of uncopyrightable
> game mechanics (Baker v. Selden, 1879). Not Chaosium text.

# Call of Cthulhu 7e -- Combat and Spot Rules Reference

Quick-reference for combat flow, defensive reactions, fighting
manoeuvres, firearms rules, and common spot rules. Used during
play for fast resolution of combat and hazards.

## Combat Round Structure (approx. 12 seconds)

1. **Determine Initiative** -- Characters act in DEX order
   (highest DEX first). Ties are simultaneous.

2. **Actions** -- Each combatant gets one action per round,
   resolved in DEX order:
   - **Attack (melee)**: Roll Fighting (Brawl) or weapon skill.
   - **Attack (ranged)**: Roll Firearms skill.
   - **Move**: Up to MOV x 5 yards if taking no other action.
   - **Flee**: Initiate a chase (see Chase Rules).
   - **Skill use**: One non-combat skill (First Aid, etc.).
   - **Other**: Draw weapon, stand up, etc.

3. **Defensive Reactions** -- Taken in response to attacks;
   do not consume the character's action:
   - **Dodge**: Roll Dodge to avoid the attack entirely.
   - **Fight Back**: Roll Fighting against a melee attacker;
     if your success level is higher, you avoid the attack
     AND deal damage.
   - **Use Cover**: Drop behind available cover (ranged only).
   One free reaction per round. Each additional reaction
   incurs a cumulative penalty die.

4. **End of Round** -- Apply ongoing effects, check for
   unconsciousness, dying, or death.

## Attack vs Defence Resolution

When an attacker rolls and the defender uses a reaction (Dodge
or Fight Back), compare success levels:

| Attacker | Defender | Result |
|----------|----------|--------|
| Higher level | -- | Attacker hits; roll damage |
| -- | Higher level (Dodge) | Attack avoided entirely |
| -- | Higher level (Fight Back) | Attack avoided; defender deals damage |
| Same level | -- | Compare actual die rolls; higher successful roll wins |
| Failure | -- | Miss, no damage |
| Fumble | -- | Miss; attacker suffers a mishap |

**Success level hierarchy**: Extreme > Hard > Regular > Failure.
Critical (01) counts as the highest possible success level.

When an attack hits with an Extreme success, it deals
enhanced damage (impale for piercing weapons, knockback for
blunt weapons, or other effects at Keeper's discretion).
Armour is subtracted from damage as normal.

## Fumble Tables (Condensed)

### Melee Attack Fumbles (D100)
- 01-25: Lose 1-1D3 rounds, helpless
- 26-40: Fall prone
- 41-60: Drop or throw weapon 1D10m
- 61-65: Weapon loses 1D10 HP
- 66-75: Vision obscured, -30% for 1D3 rounds
- 76-98: Hit nearest ally (normal/special/critical)
- 99-00: Roll again 2-3 more times

### Melee Parry Fumbles (D100)
- 01-20: Lose next round, helpless
- 21-50: Fall prone or drop weapon
- 51-75: Vision obscured, -30% for 1D3 rounds
- 76-93: Wide open; foe auto-hits (normal/special/critical)
- 94-00: Roll again 2-3 more times

### Missile/Firearm Fumbles (D100)
- 01-25: Lose 1-1D3 rounds
- 26-40: Fall prone
- 41-55: Vision obscured, -30% for 1D3 rounds
- 56-85: Drop, damage, or break weapon
- 86-98: Hit nearest ally (normal/special/critical)
- 99-00: Roll again 2-3 more times

### Natural Weapon Fumbles (D100)
- 01-30: Lose 1-1D3 rounds
- 31-60: Fall prone, possibly twist ankle (-1 MOV)
- 61-75: Vision obscured
- 76-85: Strain, lose 1 HP in attacking limb
- 86-98: Hit ally or hard surface
- 99-00: Roll again 2-3 more times

## Multiple Defensive Reactions

- Each investigator gets **one free** defensive reaction per
  round (Dodge or Fight Back).
- Each additional reaction beyond the first incurs a
  **cumulative penalty die**.
- Fighting defensively (forfeiting your action) grants one
  additional free reaction without the penalty die.

## Spot Rules -- Quick Reference

### Ambush
Attackers must succeed at Stealth opposed by target's Listen
or Spot Hidden. Surprise grants the attackers a free round
of attacks with a bonus die; targets cannot use defensive
reactions. After the surprise round, combat proceeds normally.

### Backstab and Helpless Opponents
Attacking from behind in melee: roll with a bonus die. Target
may attempt a Hard Listen roll to notice, then a Hard Dodge.
Helpless targets (unconscious, restrained): attack succeeds
automatically, no defence possible.

### Cover
Partial cover imposes a penalty die on attacks. If the attack
roll would have hit without the penalty but misses with it,
the shot hits the cover instead. Thick cover may stop the
attack entirely; thin cover may let damage through (compare
damage vs material's armour value).

### Darkness
- Semi-darkness: one penalty die
- Light fog/smoke: one penalty die
- Full darkness: two penalty dice (or impossible for visual
  tasks)
- Complete darkness: visual Spot Hidden is impossible
Detect opponents in total dark with a Hard Listen roll.

### Disease
Roll CON to resist infection. If caught, roll CON daily to
fight off the disease. Failure means the disease progresses
(losing HP or characteristic points depending on severity).
Medicine rolls can assist recovery. Specific diseases have
their own progression and treatment rules.

### Poison
Poison has a Potency (POT). Resist with CON vs POT on the
resistance table. Failure: take POT in damage (to HP or
characteristic, depending on poison type). Success: take
half POT damage. Speed of onset varies (instant, 1D6 rounds,
hours). Antidotes reduce effective POT.

### Falling
1D6 damage per 3 metres fallen. SIZ 5 or less: reduce by
1D6. SIZ 20+: add 1D6 per 20 SIZ above 20. Armour provides
half protection for falls up to 3m. A successful Jump roll
reduces falling damage by 1D6 per success level.

### Firing into Combat
-20% to skill when firing into melee. If the roll is between
the modified and normal chance, a random other combatant is
hit (Luck rolls to determine who). Firing while engaged in
melee is Difficult (but point-blank Easy cancels this).

### Knockout Attacks
Declare intent before rolling. Make a Fighting roll (targeting
the head). If the attack succeeds, compare damage to half the
target's max HP:
- Damage < half max HP: target takes minimum damage, stays
  conscious.
- Damage >= half max HP: target takes 1 HP damage and is
  knocked unconscious.

### Choking, Drowning, Asphyxiation
An investigator can hold their breath for a number of rounds
equal to their CON/10 (round down). After that, roll CON
each round with increasing difficulty. Failure means the
investigator begins drowning/suffocating, taking 1D8 damage
per round (water), 1D4 (smoke), or 1D6 (dense smoke). If
surprised (no chance to prepare), the situation is immediately
dangerous.

### Fire and Heat
- Candle/lantern: 1 HP/round of direct contact
- Torch/small fire: 1D6/round; may set target alight
- Bonfire: 1D6+2/round; clothing catches fire on POW x1 fail
- Intense fire (lava, furnace): 3D6/round; auto-ignites
Conventional armour protects for 1D3 rounds only. Fire-
retardant gear protects normally.

### Explosions
Damage = XD6 at epicentre. Reduce by 1D6 per 2m from centre.
A successful Dodge roll allows diving for cover (reduces
damage and leaves the investigator prone). Damage is applied
to the investigator as a whole (not by hit location).

### Autofire
Burst: +20% to hit. Full auto: +40%. Roll one attack. On
success, roll appropriate die for number of rounds hitting.
Only the first round can achieve special or critical. Against
spread targets: no skill bonus; roll separately per target.
Narrow field of fire (corridor): +20% additional.

---

> **Attribution:** Combat framework adapted from *Basic
> Roleplaying: Universal Game Engine* by Chaosium Inc., used
> under the ORC License. CoC 7e-specific combat mechanics
> (fight back, bonus/penalty dice, success level comparison)
> are our own descriptions of uncopyrightable game mechanics.
> See ATTRIBUTION.md for full license details.
