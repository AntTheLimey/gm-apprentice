> BRP combat data: BRP ORC License. See ATTRIBUTION.md.

# Call of Cthulhu 7e — Combat and Spot Rules Reference

Quick-reference for combat flow, the attack/defence matrix,
fumble tables, and common spot rules. Used during play for
fast resolution of combat and hazards.

## Combat Round Structure (12 seconds)

1. **Statements** — All participants declare intent in DEX
   order (highest first). Defensive actions need not be
   declared. Actions may be delayed to a later DEX rank.

2. **Powers** — Instantaneous powers activate in INT order
   (highest first). Non-instantaneous powers resolve at the
   start of the next round. Using a power counts as the
   round's action.

3. **Actions** — Execute in DEX rank order:
   - **Move**: Up to 30m (defence only). 6-15m = 1/2 DEX
     rank. 16-29m = 1/4 DEX rank.
   - **Attack**: Strike a target (+up to 5m movement).
   - **Noncombat action**: Use a skill, draw a weapon, open a
     door (5 DEX ranks per extra action).
   - **Engage**: Move up to 5m and attack.
   - **Disengage**: Declare at start; only dodge/parry/move.
     If all defences succeed, escape combat.

4. **Resolution** — Compare rolls on the Attack and Defence
   Matrix. Apply damage, check for wounds.

**At any time**: Parry, Dodge, fight defensively, speak.

## Attack and Defence Matrix

| Attack | vs Parry/Dodge | Result |
|--------|---------------|--------|
| Critical | Critical | Parried/dodged, no effect |
| Critical | Special | Normal success; armour applies; parrying weapon takes 2 HP |
| Critical | Success | Special success; full dmg + modifier + special type; armour applies; parrying weapon takes 4 HP |
| Critical | Failure | Critical hit: full damage + modifier, bypasses armour |
| Critical | Fumble | Critical hit (as above); defender also rolls on fumble table |
| Special | Critical | Parried/dodged; attacking weapon takes 1 HP |
| Special | Special | Parried/dodged, no effect |
| Special | Success | Normal success; armour applies; parrying weapon takes 2 HP |
| Special | Failure | Special success: full dmg + modifier + special type; armour applies |
| Special | Fumble | Special success (as above); defender fumble table |
| Success | Critical | Parried; attacker's weapon takes 2 HP |
| Success | Special | Parried; attacker's weapon takes 1 HP |
| Success | Success | Parried/dodged, no effect |
| Success | Failure | Hit: roll damage, subtract armour |
| Success | Fumble | Hit (as above); defender fumble table |
| Failure | -- | Miss, no effect |
| Fumble | -- | Miss; attacker rolls on fumble table |

"Full damage" = maximum die result for the weapon (not damage
modifier). This is NOT the same as "maximum possible damage."

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

## Multiple Actions

- **Multiple attacks**: Skill over 100% allows extra attacks.
  Each successive attack at -5 DEX ranks.
- **Multiple parries**: Each after the first at cumulative -30%.
- **Multiple dodges**: Each after the first at cumulative -30%.
- **Parry OR Dodge**: Choose one type per round (unless fully
  defensive, which allows both but at -30% cumulative).
- **Fighting defensively**: Forfeit attacks to gain one extra
  Dodge without the -30% penalty.

## Spot Rules — Quick Reference

### Ambush
Attackers must succeed at Stealth opposed by target's Listen,
Sense, or Spot. Unseen missile attackers get a free round of
Easy attacks; targets cannot dodge or parry. Melee ambushers
who are undetected make Easy attacks; targets' defences are
Difficult.

### Backstab and Helpless Opponents
Attacking an unprotected back in melee: the attack is Easy.
Target can attempt a Difficult Listen/Sense, then Difficult
Dodge/Parry. Helpless targets (unconscious, restrained):
attack is Easy, no defence possible.

### Cover
Partial cover makes attacks Difficult. A roll between the
adjusted and normal skill rating hits the cover instead. Thick
cover may stop the attack entirely; thin cover may let damage
through (compare damage vs obstacle's AV/HP).

### Darkness
- Semi-darkness: -10% to relevant skills
- Light fog: -25%
- Full darkness: skills are Difficult
- Complete darkness: visual Spot is Impossible
Detect opponents in total dark with Difficult Sense or Listen.

### Disease
Minor disease: Stamina roll to avoid. If caught, CON x2 roll
next morning to recover; multiplier increases by 1 each day
until cured. Major disease attacks a characteristic:
- 1 failure: lose 1 char point/week (mild)
- 2 failures: 1/day (acute)
- 3 failures: 1/hour (severe)
- 4+: 1/minute (terminal)

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
Declare intent. Make a Difficult attack (targeting head).
Roll damage normally:
- If damage < major wound threshold (after armour): target
  takes minimum damage, not knocked out.
- If damage >= major wound threshold (after armour): target
  takes 1 damage and is unconscious for 1D10+10 rounds.

### Choking, Drowning, Asphyxiation
First round: CON x10 (Easy Stamina). Each subsequent round:
reduce multiplier by 1. When the roll fails: take damage each
round (1D8 for water, 1D4 for smoke, 1D6 for dense smoke,
1D8+corrosion for poison gas). If surprised, start at CON x3
(with successful Luck roll) or CON x1 (without).

### Fire and Heat
- Candle/lantern: 1 HP/round of direct contact
- Torch/small fire: 1D6/round; may set target alight
- Bonfire: 1D6+2/round; clothing catches fire on POW x1 fail
- Intense fire (lava, furnace): 3D6/round; auto-ignites
Conventional armour protects for 1D3 rounds only. Fire-
retardant gear protects normally.

### Explosions
Damage = XD6 at epicentre. Reduce by 1D6 per 2m from centre.
Dodge roll to avoid entirely, or Agility roll to halve damage
(both leave you prone). Damage is general (not by hit location)
unless using hit locations, where divide among 1D4 random
locations.

### Autofire
Burst: +20% to hit. Full auto: +40%. Roll one attack. On
success, roll appropriate die for number of rounds hitting.
Only the first round can achieve special or critical. Against
spread targets: no skill bonus; roll separately per target.
Narrow field of fire (corridor): +20% additional.

---

> **Attribution:** Combat and spot rule data from *Basic
> Roleplaying: Universal Game Engine* by Chaosium Inc., used
> under the ORC License. See ATTRIBUTION.md for full license
> details.
