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
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
---

# CoC 7e Chase Rules

Chase rules handle pursuit on foot, by vehicle, or any situation where one party is fleeing and another is pursuing. They use an abstract track system rather than precise measurement.

---

## Setting Up the Chase

1. **Draw a chase track** — a line of 10–20 spaces representing the route. Place the pursuer and quarry at their starting positions (the gap between them is their starting separation).
2. **Assign base speed** — each participant's MOV value determines how many spaces they move per round. A typical investigator has MOV 8; most humans range from MOV 7–9. Creatures can be considerably faster or slower.
3. **Place hazards** — the Keeper distributes barriers at intervals along the track (fences, traffic, locked doors, crowds, narrow alleys). Each hazard requires a skill roll to navigate.

---

## Chase Round Structure

Each round proceeds as follows:

1. **Move** — each participant advances a number of spaces equal to their MOV.
2. **Sprint attempt (optional)** — a participant may attempt a CON roll to gain +1 extra space this round. On a failure, no extra movement is gained and fatigue may accumulate (Keeper's discretion).
3. **Hazard navigation** — if a participant's movement brings them to a hazard space, they must roll the appropriate skill (Athletics, Drive, Climb, etc.) to pass through:
   - Success: move through normally.
   - Failure: lose 1 space of progress and possibly take damage or suffer a complication.
4. **Actions** — in addition to moving, each participant may take one action:
   - **Attack** — make a combat roll against another participant on the same or adjacent space.
   - **Create an obstacle** — use a skill to drop something, slam a door, overturn a cart, etc., placing a new hazard for those behind.
   - **Other stunt** — any contextually appropriate skill use (e.g., Driving to cut off a vehicle, Throw to trip a pursuer).

---

## Chase Resolution

| Outcome | Condition |
|---------|-----------|
| **Caught** | The pursuer occupies the same space as the quarry. |
| **Escaped** | The quarry reaches the end of the track, or opens a gap the pursuer cannot close in the remaining rounds. |
| **Abandoned** | A participant is incapacitated, trapped by a hazard, or chooses to stop. |

**Complications to consider:** bystander injuries, property damage, attracting police or cult attention, and expending resources (MP, Luck, HP from failed hazard rolls).

---

## Key Skills in a Chase

| Situation | Skill |
|-----------|-------|
| Running / jumping obstacles | Athletics (or DEX roll) |
| Driving a vehicle | Drive Auto / Drive (appropriate vehicle) |
| Climbing fences or walls | Climb |
| Squeezing through crowds | Athletics or Dodge |
| Attacking while fleeing | Fighting or Firearms (with a penalty die for movement) |
| Throwing an obstacle | Throw |

---

## MOV Reference

MOV is determined by comparing raw (pre-multiplication) STR, DEX, and SIZ:

| Condition | MOV |
|-----------|-----|
| Both STR and DEX are each less than SIZ | 7 |
| Either STR or DEX equals or exceeds SIZ | 8 |
| Both STR and DEX each exceed SIZ | 9 |

Age modifiers can reduce MOV further. Many creatures have MOV values well outside the human range (e.g., a Ghoul at MOV 9, a Byakhee at MOV 12+).

---

## Keeper Guidance

- **Keep the track visual** — sketching it on paper or a whiteboard helps players track their position and plan actions.
- **Hazards create drama** — place 3–5 hazards on a typical foot chase; too few and the chase is just a footrace, too many and it becomes a grind.
- **Vary the skill demands** — a chase through a marketplace might need Athletics, Dodge, and maybe Charm (bluff past a stallholder blocking the path).
- **Firearms during a chase** — shooting while running is a Firearms roll at a penalty die. Being shot at while fleeing follows normal combat resolution; the quarry may use Dodge as a reaction without losing their movement action.
- **Vehicle chases** — use Drive skill in place of Athletics for the sprint attempt and hazard rolls; MOV is replaced by vehicle speed category (Keeper assigns spaces/round based on vehicle type).
- **Chase vs. combat** — once a pursuer is in the same space as the quarry, normal combat begins. The quarry can still attempt to flee on their action (re-initiating the chase), but the pursuer gets an attack opportunity first.

---

> Source: CoC 7e chase mechanics described from BRP ORC-licensed mechanical framework. Our own description of game mechanics; not Chaosium text. See ATTRIBUTION.md.
