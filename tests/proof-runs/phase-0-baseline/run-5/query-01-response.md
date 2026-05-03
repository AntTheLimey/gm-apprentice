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

CoC 7e uses a structured chase system with an abstract track to resolve pursuit and escape scenes. Chases are initiated when a character declares the **Flee** action during a combat round.

---

## Setting Up a Chase

1. **Chase track**: Draw a line of locations (10-20 spaces). Place the pursuer and quarry at their starting positions on the track.
2. **Speed**: Each participant's **MOV** (Move Rate) determines how many spaces they move per round. Higher MOV = more spaces covered.
3. **Hazards**: The Keeper places hazards at intervals on the track — fences, traffic, locked doors, crowds, and similar obstacles.

### MOV Quick Reference

MOV is derived from STR, DEX, and SIZ (raw pre-multiplication 3-18 values):

| Condition | MOV |
|-----------|-----|
| Both STR and DEX are each less than SIZ | 7 |
| Either STR or DEX equals or exceeds SIZ | 8 |
| Both STR and DEX each exceed SIZ | 9 |

Age modifiers can reduce MOV further.

---

## Chase Round Sequence

Each round of a chase proceeds as follows:

1. **Move**: Each participant moves their MOV in spaces along the track.
2. **Sprint attempt** (optional): A participant may attempt a **CON roll** to gain +1 space of movement. On a failure, no extra movement is gained and the character may suffer fatigue effects.
3. **Hazards**: If a participant encounters a hazard on the track, they must roll the appropriate skill to navigate it. Failure costs **1 space** and may cause damage.
4. **Actions**: Participants may spend their action on attacks, skill use, or creating new obstacles for those behind them.

---

## Chase Resolution

| Outcome | Condition |
|---------|-----------|
| **Caught** | The pursuer occupies the same space as the quarry |
| **Escaped** | The quarry reaches the end of the track, or opens a gap large enough that the pursuer cannot close it |
| **Complications** | Bystander injuries, property damage, attracting police attention — at the Keeper's discretion |

---

## Keeper Notes

- The abstract track (rather than precise mapping) keeps chases fast-moving and dramatic.
- Hazard design is the Keeper's primary tool for shaping the chase — pick hazards that suit the setting and the skills your investigators have.
- Characters with a higher MOV have a significant structural advantage; players may compensate through smart hazard navigation and sprinting.
- Chases through crowds or difficult terrain are a natural fit for Stealth, Climb, Jump, Drive, and similar skills as hazard resolution rolls.

---

*Source: Rules described in our own words per BRP ORC License. See ATTRIBUTION.md.*
