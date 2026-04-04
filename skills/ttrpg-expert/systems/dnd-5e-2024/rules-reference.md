> This file includes material from the System Reference
> Document 5.2 by Wizards of the Coast LLC (CC-BY 4.0).
> See ATTRIBUTION.md for full details.

# D&D 5e 2024 — Rules Reference

Advanced mechanics for play: combat flow, actions, spellcasting,
death saves, resting, conditions, and environmental rules.

## Combat Flow

1. **Determine Surprise**: Any creature caught unawares has
   Disadvantage on its Initiative roll.
2. **Roll Initiative**: Each participant rolls d20 + DEX modifier
   (or uses Initiative score: 10 + DEX modifier). Creatures act
   in descending order.
3. **Take Turns**: On your turn you get one Action, one Bonus
   Action (if a feature grants one), your Movement (up to your
   Speed), and one free object interaction.
4. **Reactions**: One Reaction per round (resets at the start of
   your turn). Common reaction: Opportunity Attack.
5. **Next Round**: After all combatants act, a new round begins.

### Action Economy per Turn (SRD 5.2, CC-BY-4.0)

| Resource | Usage |
|----------|-------|
| Action | Attack, Dash, Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, Utilize |
| Bonus Action | Light weapon extra attack, certain spells, class features |
| Reaction | Opportunity attack, certain spells (one per round) |
| Movement | Up to speed in feet, splittable around actions |

## Actions in Detail (SRD 5.2, CC-BY-4.0)

| Action | Effect |
|--------|--------|
| **Attack** | Make one attack roll with a weapon or Unarmed Strike. You can equip or unequip one weapon as part of this action. |
| **Dash** | Gain extra movement equal to your Speed for the current turn. |
| **Disengage** | Your movement doesn't provoke Opportunity Attacks for the rest of the turn. |
| **Dodge** | Until your next turn, attacks against you have Disadvantage (if you can see the attacker) and you have Advantage on DEX saves. Lost if Incapacitated or Speed is 0. |
| **Help** | Give an ally Advantage on their next ability check (choose a skill/tool) or give an ally Advantage on their next attack against a creature within 5 ft of you. Expires at start of your next turn. |
| **Hide** | DC 15 DEX (Stealth) check while Heavily Obscured or behind Three-Quarters/Total Cover and out of enemy line of sight. On success, gain the Invisible condition. |
| **Influence** | Urge a monster to do something. GM determines Willing/Unwilling/Hesitant. Hesitant requires an ability check modified by attitude (Hostile/Indifferent/Friendly). Default DC: 15 or monster's INT, whichever is higher. |
| **Magic** | Cast a spell with a casting time of one action, or activate a magic item that requires this action. |
| **Ready** | Choose a perceivable trigger and an action (or movement) to take as a Reaction when the trigger occurs. Readied spells require Concentration until released. |
| **Search** | Make a WIS check to detect something: Insight (state of mind), Medicine (ailment), Perception (hidden creature/object), Survival (tracks/food). |
| **Study** | Make an INT check to recall knowledge: Arcana (spells, magic), History (events, people), Investigation (traps, riddles), Nature (terrain, beasts), Religion (deities, undead). |
| **Utilize** | Use an object that requires an action (e.g. drink a potion, don/doff a shield, activate a device). |

## Spellcasting Basics

- **Spell Slots**: Finite resource recovered on a Long Rest
  (Short Rest for Warlock Pact Magic). Levels 1st through 9th.
- **Cantrips**: Cast at will with no slot. Damage scales at
  character levels 5, 11, and 17.
- **Concentration**: Only one Concentration spell active at a
  time. Taking damage forces a CON save (DC 10 or half damage
  taken, whichever is higher, max DC 30). Starting a new
  Concentration effect ends the previous one. Ends if
  Incapacitated or dead.
- **Ritual Casting**: Add 10 minutes to casting time; no slot
  expended. Cannot be cast at a higher level.
- **Components**: Verbal (V), Somatic (S), Material (M). A
  Spellcasting Focus can replace non-consumed, non-costed
  material components.
- **2024 Revision**: All classes use a prepared spell model.

## Death Saving Throws (SRD 5.2, CC-BY-4.0)

At 0 HP, a player character rolls d20 at the start of each
turn (DC 10):
- **10+**: One success. Three successes = stabilized (Stable;
  no further saves required).
- **1-9**: One failure. Three failures = death.
- **Natural 20**: Regain 1 HP (no longer at 0 HP).
- **Natural 1**: Counts as two failures.
- **Damage at 0 HP**: Each hit causes one automatic failure
  (a Critical Hit within 5 ft causes two failures).

A stabilized creature regains 1 HP after 1d4 hours unless
healed sooner.

## Resting (SRD 5.2, CC-BY-4.0)

### Short Rest (1 hour)

- Spend Hit Dice to heal: roll each spent HD + CON modifier,
  regain that many HP (minimum 1).
- Some class features recharge on a Short Rest.
- **Interrupted by**: rolling Initiative, casting a non-cantrip
  spell, or taking damage. An interrupted Short Rest confers
  no benefits.

### Long Rest (8 hours; at least 6 hours sleeping)

- Regain **all** lost HP.
- Regain **all** spent Hit Dice (2024 revision — previously
  only half).
- Reduced ability scores return to normal.
- Exhaustion level decreases by 1.
- Most class features recharge.
- Must wait 16 hours before starting another Long Rest.
- **Interrupted by**: rolling Initiative, casting a non-cantrip
  spell, taking damage, or 1 hour of walking/physical exertion.
  If you rested at least 1 hour before interruption, you gain
  Short Rest benefits. You can resume; each interruption adds
  1 hour to the required time.

## Conditions Quick Reference

See mechanics.md for the full 15-condition table. Key
interactions:

- **Incapacitated** is a prerequisite for Paralyzed, Stunned,
  and Unconscious.
- **Exhaustion** stacks (cumulative levels); all other conditions
  do not stack with themselves.
- **Prone** costs half your movement to stand up from.
- **Grappled** sets Speed to 0; escaping requires an action
  (Athletics or Acrobatics vs. grappler's Athletics).

## Cover (SRD 5.2, CC-BY-4.0)

| Cover Type | Benefit |
|------------|---------|
| Half Cover | +2 to AC and DEX saves |
| Three-Quarters Cover | +5 to AC and DEX saves |
| Total Cover | Can't be targeted directly |

A target benefits only from the most protective degree of cover.

## Light and Visibility (SRD 5.2, CC-BY-4.0)

| Lighting | Obscurement | Effect |
|----------|-------------|--------|
| Bright Light | None | Normal vision |
| Dim Light | Lightly Obscured | Disadvantage on Perception checks relying on sight |
| Darkness | Heavily Obscured | Effectively Blinded |

**Darkvision**: See Dim Light as Bright Light and Darkness as
Dim Light (greyscale only) within the specified range.

**Blindsight**: See within range without relying on sight; not
blocked by Blinded condition or Darkness.

## Difficult Terrain

Every foot of movement in Difficult Terrain costs 1 extra foot.
Sources include: hostile creatures, furniture, heavy snow/ice/
rubble/undergrowth, shin-to-waist-deep liquid, narrow openings,
and slopes of 20+ degrees.

## Damage Types (SRD 5.2, CC-BY-4.0)

| Type | Examples |
|------|----------|
| Acid | Corrosive liquids, digestive enzymes |
| Bludgeoning | Blunt objects, constriction, falling |
| Cold | Freezing water, icy blasts |
| Fire | Flames, unbearable heat |
| Force | Pure magical energy |
| Lightning | Electricity |
| Necrotic | Life-draining energy |
| Piercing | Fangs, puncturing objects |
| Poison | Toxic gas, venom |
| Psychic | Mind-rending energy |
| Radiant | Holy energy, searing radiation |
| Slashing | Claws, cutting objects |
| Thunder | Concussive sound |

**Resistance**: Damage of that type is halved (applied once).
**Vulnerability**: Damage of that type is doubled (applied once).
**Immunity**: Damage of that type has no effect.
