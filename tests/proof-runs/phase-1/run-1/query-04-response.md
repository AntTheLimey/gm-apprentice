---
query: "How does the GURPS 4e grappling system work?"
system: gurps-4e
type: lookup
total_tokens: 26536
wall_clock_ms: 53274
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/systems/gurps-4e/combat.md
  - skills/ttrpg-expert/systems/gurps-4e/skills-combat.md
---

## GURPS 4e Grappling

Source: GURPS Basic Set — Campaigns, Chapter 11 (B370+), and the technique list at B230-B232.

---

### Core Concept

Grappling in GURPS is not a single roll — it is a sequence of contested actions that plays out over multiple seconds. You first establish a grip, then use follow-up actions to control, damage, or throw your opponent.

---

### Step 1: Grab (Establishing the Grapple)

On your turn, take an **Attack maneuver** and roll against **DX, Brawling, Judo, or Wrestling** (your choice, use whichever is highest). Each skill has a different emphasis:

| Skill | Difficulty | Key trait |
|---|---|---|
| Brawling | DX/E | General unarmed; cheapest to buy up |
| Wrestling | DX/A | Best grappling skill; +1 to ST-based follow-ups per 2 pts of ST |
| Judo | DX/H | Can parry weapons at -3 while grappling; best for throws |
| DX | — | Default if you have none of the above |

The target gets an **active defense** (Dodge, Parry, or Block) as normal. If the attack succeeds and the defense fails, you have a grip on the target — they are **grappled**.

A grappled character suffers **-4 to DX** (which flows through to attacks, defenses, and skills that use DX). You do not automatically do damage on a grab — it is purely positional control.

---

### Step 2: Maintaining the Grapple

Holding on is a **free action** each of your turns — it costs nothing as long as you are not doing something incompatible with holding on. The grapple persists until the target breaks free or you release them.

---

### Step 3: Follow-Up Actions

Once you have a grip, subsequent turns let you attempt more damaging or controlling actions. Each is a **Quick Contest** of your ST or grappling skill vs. the target's ST or grappling skill (they defend with whichever is higher).

**Common follow-ups:**

| Action | Mechanic | Effect |
|---|---|---|
| **Takedown** | Quick Contest, ST or Wrestling | Target falls prone; still grappled |
| **Pin** | Quick Contest, ST or Wrestling | Target is immobilized; you must remain in contact |
| **Choke Hold** | Roll vs. Wrestling or Judo at -2 (technique: Choke Hold) | Inflicts fatigue each turn; target suffocates if FP reaches 0 |
| **Arm Lock** | Roll vs. Wrestling or Judo (technique: Arm Lock) | Target's arm is locked; causes pain, may cripple |
| **Throw (Judo)** | Quick Contest, Judo vs. ST or Judo | Target is thrown; takes falling damage based on ST; grapple ends |
| **Neck Snap** | ST-based roll (Hard technique) | Lethal; requires established grapple and prior control |
| **Finger Lock** | Roll vs. Wrestling or Judo at -3 | Pain compliance; -4 to target's DX |

Choke Hold and Arm Lock are **techniques** — they start at a penalty from the base skill (Choke Hold is skill-2; Arm Lock is skill+0) and can be bought up with character points.

---

### Breaking Free

A grappled character can spend their turn attempting to **break free**: a **Quick Contest of ST or Wrestling** vs. the grappler's ST or Wrestling. Success ends the grapple; failure means they are still held. Being stronger or a trained wrestler makes this significantly easier.

---

### Multiple Grapplers

Each additional attacker who establishes a grip contributes their ST to the holding side of the Quick Contest. A mob can pin a physically superior opponent by sheer numbers.

---

### Posture Matters

Many follow-ups are easier or only possible in certain postures:
- A prone target is at -3 to attack and -3 to defend.
- Fighting from the ground yourself uses the **Ground Fighting** technique (defaults to melee skill at a variable penalty).

---

### Key Skills and Techniques Summary

| Skill/Technique | Diff | Page | Note |
|---|---|---|---|
| Wrestling | DX/A | B228 | Primary grappling skill; +1 per 2 ST pts |
| Judo | DX/H | B203 | Throws; can parry weapons at -3 |
| Brawling | DX/E | B182 | General unarmed; overlaps grappling |
| Arm Lock | skill+0, max +4 | B230 | Judo or Wrestling follow-up |
| Choke Hold | skill-2, max +0 | B230 | Suffocation; Judo or Wrestling |
| Finger Lock | skill-3, max +0 | B231 | Pain compliance; Judo or Wrestling |
| Ground Fighting | skill-var, max +0 | B231 | Any melee skill; fighting prone |
| Neck Snap | ST-var, max +0 | B232 | Lethal; ST-based |

---

### Practical GM Notes

- Grappling is powerful because the -4 DX penalty cripples the target's offensive and defensive rolls immediately. A skilled wrestler with high ST can neutralize a weapon-user in seconds.
- Judo is the specialist's choice for theatrical throws; Wrestling is the workhorse for sustained control.
- Against armored opponents, grappling often bypasses damage reduction — Choke Hold inflicts fatigue directly, and throws cause damage from the fall (also not blocked by most armor).
- Trained by a Master [30] unlocks cinematic grappling options (pressure point strikes, etc.) and halves Rapid Strike penalties, but is a major point investment.

For the full technique rules and cinematic options, see GURPS Basic Set Campaigns pp. 230–232 and GURPS Martial Arts (the dedicated supplement for complete grappling styles).
