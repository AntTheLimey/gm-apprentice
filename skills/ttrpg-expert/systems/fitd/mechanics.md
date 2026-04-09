# Forged in the Dark -- Core Mechanics

Heist/scoundrel games using d6 dice pools. Structured cycle:
free play → score → downtime.

**Related FitD files:**
- Advanced rules (effect, harm, armor, wanted): `systems/fitd/rules-reference.md`
- Score/downtime procedures: `systems/fitd/session-procedures.md`
- Factions and clocks: `systems/fitd/factions.md`

## Dice Pool Resolution

- Roll d6s equal to action rating
- Read **single highest**: 6 = full success, 4-5 = partial
  (consequences), 1-3 = bad outcome
- **Critical:** two+ 6s = additional advantage
- **Zero dice:** roll 2d6, take lowest (cannot crit)

## The 12 Actions

### Insight (resists deception/understanding)

- **Hunt** — track, follow, ambush, precision shooting
- **Study** — research, analyze, detect lies
- **Survey** — observe, spot trouble, detect intentions
- **Tinker** — devices, locks, safes, traps

### Prowess (resists physical strain/injury)

- **Finesse** — dexterity, pickpocket, vehicles, dueling
- **Prowl** — sneak, hide, rooftops, attack from hiding
- **Skirmish** — close combat, brawl, seize positions
- **Wreck** — force, explosives, chaos, sabotage

### Resolve (resists mental strain/willpower)

- **Attune** — arcane, ghosts, perceive beyond sight
- **Command** — intimidate, threaten, lead gangs
- **Consort** — socialize, leverage contacts
- **Sway** — charm, lie, persuade, argue

**Attribute rating** = number of actions under that attribute
with ≥1 dot (0-4). Used for resistance rolls.

## Four Roll Types

### Action Roll

Core roll for dangerous/troublesome attempts.
1. Player states goal and chooses action
2. GM sets position (controlled/risky/desperate)
3. GM sets effect (limited/standard/great)
4. Add bonus dice (max +2d: one assist, one push/bargain)
5. Roll and judge result

### Fortune Roll

Disclaim GM decisions. Roll trait rating + bonuses.

| Result | Outcome |
|:---:|---------|
| Crit | Exceptional / extreme effect |
| 6 | Good / standard effect |
| 4-5 | Mixed / limited effect |
| 1-3 | Bad / poor effect |

### Resistance Roll

Reduce/avoid consequences. Always succeeds. Roll attribute
rating; suffer 6 minus highest die in stress. Crit = also
clear 1 stress.

- Insight: deception/understanding consequences
- Prowess: physical strain/injury
- Resolve: mental strain/willpower

### Downtime Roll

Same progression as fortune roll, used for recovery, projects,
assets, heat reduction.

## Position & Effect

Default: risky/standard. Nine combinations.

### Position Outcomes

**Controlled** (dominant advantage):
- 6/crit: success (crit: +effect)
- 4-5: hesitate — minor consequence or try differently
- 1-3: falter — seize risky opportunity or withdraw

**Risky** (head-to-head, the default):
- 6/crit: success (crit: +effect)
- 4-5: success + consequence (harm, complication, worse position).
  The consequence must not negate the success.
- 1-3: bad outcome (harm, complication, lost opportunity)

**Desperate** (overreach/serious trouble):
- 6/crit: success (crit: +effect)
- 4-5: success + severe consequence
- 1-3: worst outcome (severe harm, serious complication)

### Effect Level

| Level | Description | Clock Ticks |
|:---:|-------------|:---:|
| Great | More than usual | 3 |
| Standard | Normal | 2 |
| Limited | Partial/weak | 1 |

Zero effect and extreme effect exist beyond this range.

## Bonus Dice (max +2d)

- **Assist:** teammate takes 1 stress → +1d (one per roll)
- **Push:** 2 stress → +1d OR +1 effect OR act despite
  incapacitation (pick one benefit per push)
- **Devil's Bargain:** bonus die for complication regardless
  of outcome. Cannot combine with pushing.

## Stress & Trauma

**Stress** (9-box track): spent to resist consequences
(6 minus roll), push (+1d/+1 effect: 2 stress), assist
(1 stress).

**Trauma:** when last stress box marked, suffer permanent
trauma condition. Taken out of action, return with zero stress.
Four traumas = retire.

Conditions: Cold, Haunted, Obsessed, Paranoid, Reckless,
Soft, Unstable, Vicious.

## Vice & Overindulgence

Types: Faith, Gambling, Luxury, Obligation, Pleasure, Stupor,
Weird. Roll lowest attribute; clear stress = highest die.
Overindulge if clearing more than marked:

- **Attract Trouble:** extra entanglement
- **Brag:** +2 heat
- **Lost:** vanish; play different PC until return
- **Tapped:** purveyor cuts you off; find new one

No indulgence = take stress equal to trauma count.

## Coin & Stash

| Amount | Example |
|:---:|---------|
| 1 | Full purse of silver; week's wages |
| 2 | Fine weapon; weekly small business income |
| 4 | Satchel of silver; month's wages |
| 6 | Exquisite jewel |
| 8 | Monthly take for small business |
| 10 | Liquidating significant asset |

Uses: 1 coin = extra downtime activity or +1 result level;
avoid entanglements; stash for retirement; advance Tier
(new Tier × 8).

**Stash:** each row of 10 = lifestyle tier. Retire at 40.
Withdraw: 2 stash → 1 coin.

## Faction Tier & Scale

| Tier | Gang Scale |
|:---:|------------|
| 0 | 1-2 people |
| I | 3-6 (small) |
| II | 12 (medium) |
| III | 20 (large) |
| IV | 40 (huge) |
| V | 80 (massive) |

**Hold:** Weak or Strong. Crew starts Strong at Tier 0.

## Rep & Advancement

Rep: 2 base +1 per tier above, -1 per tier below (min 0).
12 rep to advance (minus turf, min 6):
- Weak hold → becomes strong. Reset rep.
- Strong hold → pay coin (new Tier × 8), +1 Tier, hold → weak.

Turf: each piece = -1 rep needed (max 6). Persists through
resets.

## Topics in Other FitD Files

These mechanics are covered in detail elsewhere to avoid
duplication:
- **Consequences** (5 types, harm table, armor): `systems/fitd/rules-reference.md`
- **Score procedures** (engagement roll, flashbacks, teamwork): `systems/fitd/session-procedures.md`
- **Downtime phase** (payoff, heat, entanglements, activities): `systems/fitd/session-procedures.md`
- **Clocks** (types, sizing, naming): `systems/fitd/session-procedures.md`
- **Faction turns** (clock advancement, maneuvers): `systems/fitd/session-procedures.md`
- **Faction details** (Doskvol factions, tiers, NPCs): `systems/fitd/factions.md`

---
*Based on Blades in the Dark by John Harper, CC BY 3.0.*
