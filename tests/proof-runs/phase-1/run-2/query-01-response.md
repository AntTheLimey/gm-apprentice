---
query: "What are the CoC 7e Chase rules?"
system: coc-7e
type: lookup
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/systems/coc-7e/combat-reference.md
  - skills/ttrpg-expert/systems/coc-7e/rules-reference.md
  - skills/ttrpg-expert/systems/coc-7e/mechanics.md
---

# CoC 7e Chase Rules

CoC 7e uses a structured, abstract chase system built on a location track rather than precise distances.

## Setting Up a Chase

1. **Chase track**: Draw a line of locations (10–20 spaces). Place the pursuer and quarry at their starting positions on the track.
2. **Speed**: Each participant's MOV characteristic determines how many spaces they move per round. Higher MOV = more spaces covered.
3. **Hazards**: The Keeper places hazards at intervals along the track — fences, traffic, locked doors, crowds, and similar obstacles that each character must deal with as they pass through them.

## Chase Round Sequence

Each round of a chase proceeds as follows:

1. **Move**: Each participant moves a number of spaces equal to their MOV.
2. **Sprint attempt (optional)**: Any participant may attempt a CON roll to gain +1 extra space of movement. Failure means no extra movement and possible fatigue effects.
3. **Hazards**: If a participant's movement takes them through a hazard, they must roll the appropriate skill to navigate it (e.g., Athletics to leap a fence, Drive to swerve around traffic). Failure costs 1 space and may cause damage.
4. **Actions**: Participants may spend their action on attacks, skill use, or creating new obstacles for those behind them.

## Initiating a Chase

A chase begins when a character declares the **Flee** action during a combat round (this is one of the standard actions available per round).

## Chase Resolution

- **Caught**: The pursuer occupies the same space as the quarry — the chase ends in capture or combat.
- **Escaped**: The quarry reaches the end of the track, or opens a gap large enough that the pursuer can no longer close it.
- **Complications**: Bystander injuries, property damage, and attracting police or other unwanted attention are common side-effects of chases through populated areas.

## Key Design Notes

The chase track is deliberately abstract — it models relative distance and momentum rather than literal geography. The Keeper narrates what each space represents (a street corner, a rooftop, a crowded market stall) and places hazards to create interesting decision points. Characters who are faster in terms of MOV have a significant advantage, but hazard navigation skills and smart use of obstacles can offset a raw speed disadvantage.

**MOV reference** (for quick setup):

| Condition | MOV |
|-----------|-----|
| Both STR and DEX each less than SIZ | 7 |
| Either STR or DEX equals or exceeds SIZ | 8 |
| Both STR and DEX each exceed SIZ | 9 |

Age modifiers can reduce MOV below these values. Monsters and creatures often have higher MOV values — a MOV 12 Deep One is substantially faster than a MOV 8 investigator on open ground, making terrain and hazards the investigator's primary tools for escape.

---

*Source: skills/ttrpg-expert/systems/coc-7e/rules-reference.md (Chase Rules section). Mechanics described in our own words under BRP ORC License — not Chaosium text.*
