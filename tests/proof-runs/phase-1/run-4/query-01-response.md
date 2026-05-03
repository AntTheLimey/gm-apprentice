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
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
---

# CoC 7e Chase Rules

CoC 7e uses a structured, abstract chase system to resolve pursuit and evasion. It replaces blow-by-blow movement tracking with a location track and skill-based hazards.

---

## Initiating a Chase

A chase begins when one party **flees** (using their action in the combat round) and another pursues. Choosing "Flee" as your action initiates the chase — it does not consume a reaction, but it does use your round action.

---

## Setting Up the Chase Track

1. **Draw a track** of abstract locations/waypoints — typically 10–20 spaces.
2. **Place participants** at their starting positions on the track (the gap between them represents the head start, if any).
3. **Place hazards** at intervals: fences, locked doors, crowds, traffic, narrow alleys. Each hazard requires a skill roll to navigate.

---

## Chase Round Structure

Each chase round proceeds as follows:

1. **Move**: Each participant moves a number of spaces equal to their **MOV** characteristic.
   - On foot: typical human MOV is 8.
   - Vehicles/mounts: use their MOV rating instead.

2. **Boost (optional)**: A participant may attempt a **CON roll** to gain +1 extra space.
   - Success: move 1 additional space.
   - Failure: no extra movement, and the Keeper may impose fatigue (penalty die on future CON rolls during the chase).

3. **Hazards**: If a participant enters a space containing a hazard, they must roll the appropriate skill to navigate it:
   - Success: pass through, no penalty.
   - Failure: lose 1 space (fall behind or slow down), and may suffer damage depending on the hazard type.
   - Example skills: Athletics (jumping a fence), Drive Auto (weaving through traffic), Climb (scaling a wall), Dodge (ducking through a crowd).

4. **Actions**: In addition to movement, each participant may take one action per round:
   - **Attack**: Roll an appropriate combat skill against a target within range. Ranged attacks are possible; melee requires closing the gap.
   - **Create an obstacle**: Knock over a market stall, slam a door, throw debris — forces pursuers to navigate a new hazard.
   - **Stunt / skill use**: Any contextually appropriate skill the Keeper allows.

---

## Ending the Chase

| Outcome | Condition |
|---------|-----------|
| **Caught** | Pursuer occupies the same space as the quarry. |
| **Escaped** | Quarry reaches the end of the track, or opens a gap the pursuer cannot close given remaining track length and speed differential. |
| **Abandoned** | One side gives up (CON failure forcing collapse, a decision to stop pursuing, loss of line of sight in a complex environment). |

---

## Complications

Chases can generate secondary consequences regardless of who wins:

- **Bystander injuries** from reckless movement through crowds.
- **Property damage** attracting police attention.
- **Investigator exposure**: witnesses see the investigators fleeing a crime scene or attacking someone in public.
- **Fatigue**: Extended chases may require further CON rolls after the chase ends.

---

## MOV Reference (Common Values)

| Entity | MOV |
|--------|-----|
| Average human | 8 |
| Fit/athletic human | 9 |
| Elderly/impaired human | 6–7 |
| Bicycle | 10 |
| Car (city speeds) | 20+ |
| Deep One | 8 land / 12 water |

---

## Keeper Guidance

- **Keep it cinematic**: Chase tracks should evoke a specific environment. A 1920s Boston alley chase feels different from a ship's deck chase or a foggy moor pursuit.
- **Hazards are the drama**: Without hazards, a chase is just a speed comparison. Place 3–5 hazards on a standard track, and vary the skills they require so different investigators get moments.
- **Failure is not the end**: A failed hazard roll costs position but rarely ends the chase instantly — use it to tighten the tension rather than calling the chase over prematurely.
- **CoC chases are lethal opportunities**: A pursuer who catches an investigator mid-chase has a free attack. Remind players that escaping is often smarter than fighting.

---

## Integration with Combat

- **Flee action**: Declared during a normal combat round in place of attacking. Initiates a chase on that same round.
- **Shooting during a chase**: Ranged attacks are possible but suffer situational penalties at the Keeper's discretion (running, cover from intervening hazards).
- **Melee during a chase**: Only possible when participants share the same space; if the attacker wins that exchange, the quarry must use their next action to flee again or be held.

---

*Source: rules-reference.md (Chase Rules section) + session-procedures.md (Chase Procedures section) + combat-reference.md (Flee action). Mechanics are our own descriptions of uncopyrightable game mechanics; not Chaosium text. See ATTRIBUTION.md.*
