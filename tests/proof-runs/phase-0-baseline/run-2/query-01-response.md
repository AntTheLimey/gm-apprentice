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
---

# CoC 7e Chase Rules

Chase rules are covered in `skills/ttrpg-expert/systems/coc-7e/rules-reference.md`.
Source: BRP ORC License foundation; CoC 7e mechanics described in our own words.

---

## Overview

CoC 7e uses a structured, abstract chase system — not measured in feet or metres
during play, but in **spaces on a chase track**. The track represents the
environment as a series of positions, with hazards placed along the way.

---

## Setting Up a Chase

1. **Draw the chase track.** Create a line of 10–20 spaces representing the
   environment (a street, a building, open countryside, etc.).
2. **Place participants.** Put the pursuer and quarry at their starting positions
   on the track. The gap between them is the current separation.
3. **Place hazards.** The Keeper positions obstacles at intervals — fences, crowds,
   locked doors, oncoming traffic, slippery floors, etc. Hazards make the chase
   interesting and create moments where relative positions can shift dramatically.

---

## Chase Round Structure

Each round of a chase proceeds as follows:

1. **Move.** Each participant moves a number of spaces equal to their **MOV**
   characteristic. Higher MOV = faster mover = more spaces per round.

2. **Push for speed (optional).** A participant may attempt a **CON roll** to gain
   +1 space of movement. On a failure, they gain no extra movement and may suffer
   fatigue effects at the Keeper's discretion.

3. **Navigate hazards.** When a participant enters a space containing a hazard,
   they must roll the appropriate skill (Climb for a fence, Drive for traffic,
   Jump for a gap, etc.):
   - **Success:** Pass through normally.
   - **Failure:** Lose 1 space (fallen back or slowed), and may take damage
     depending on the hazard type.

4. **Actions during the chase.** Participants can spend their action on something
   other than pure movement:
   - **Attack** a nearby participant (if close enough).
   - **Use a skill** to create an obstacle for those behind them (overturn a market
     stall, slam a door, etc.).
   - **Other actions** at the Keeper's discretion.

---

## Chase Resolution

The chase ends when one of the following conditions is met:

| Outcome | Condition |
|---------|-----------|
| **Caught** | The pursuer occupies the same space as the quarry. |
| **Escaped** | The quarry reaches the end of the track, or opens a gap large enough that the pursuer cannot realistically close it. |
| **Complications** | The chase causes collateral consequences — bystander injuries, property damage, attracting police attention, drawing mythos attention, etc. |

---

## Key Rules Summary

| Element | Rule |
|---------|------|
| Movement per round | MOV in spaces |
| Extra movement | CON roll for +1 space (failure = no bonus) |
| Hazard navigation | Appropriate skill roll; failure = -1 space + possible damage |
| Combat during chase | Possible if participants are adjacent; uses normal combat resolution |
| Creating obstacles | Skill roll to place a hazard behind you; slows pursuers |

---

## Keeper Notes

- **MOV values** for reference: most human adults have MOV 7–8. Fit investigators
  may reach MOV 8–9. Monsters vary widely (see `creatures.md` for individual
  entries).
- **Hazard design** is where the Keeper has the most creative control. A good chase
  track has 3–5 hazards, varied in the skills they test, so different investigators
  have moments to shine (or suffer).
- **Triggering a chase:** a character choosing the "Flee" action in a combat round
  initiates a chase. The transition from combat to chase is immediate; the chase
  track is established before the next round begins.
- **Vehicles:** The same framework applies to vehicle chases. MOV is replaced by
  the vehicle's speed rating, and hazards become things like sharp corners, road
  blocks, and traffic. Drive rolls substitute for most physical navigation rolls.

---

*Source: `skills/ttrpg-expert/systems/coc-7e/rules-reference.md` — Chase Rules
section. Mechanics described in original language; not reproduced from Chaosium
text. BRP ORC License applies to the mechanical foundation.*
