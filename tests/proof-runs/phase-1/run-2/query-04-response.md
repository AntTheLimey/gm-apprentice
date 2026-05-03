---
query: "How does the GURPS 4e grappling system work?"
system: gurps-4e
type: lookup
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/systems/gurps-4e/combat.md
  - skills/ttrpg-expert/systems/gurps-4e/skills-combat.md
---

# GURPS 4e Grappling System

Source: GURPS Basic Set — Campaigns, Chapters 11-13. All summaries are original paraphrase; no rule text is reproduced verbatim.

---

## Overview

Grappling in GURPS 4e is a multi-step process spread across turns. You first establish a hold, then exploit it on subsequent turns with follow-up actions. The relevant skills are **Brawling** (DX/Easy), **Judo** (DX/Hard), and **Wrestling** (DX/Average). DX alone can be used if none of these skills are known, but trained grapplers are significantly more effective.

---

## Step-by-Step Procedure

### 1. Establish the Grapple (Grab Attack)

Use the **Attack** maneuver. Roll vs. DX, Brawling, Judo, or Wrestling to hit. Your target may attempt an active defense (Dodge, Parry, or Block) as normal.

- If the attack succeeds and the defense fails, you have **grappled** the target.
- A grapple itself deals no damage by default; it restrains the target.
- Hit location matters: you can grapple an arm, leg, or the torso depending on what you reach for. Targeting specific locations applies the standard hit location penalties (e.g., arm -2, hand -4).

### 2. Maintain the Grapple

Holding a grapple is a **free action** each turn — you do not need to spend your maneuver to keep hold, provided you do nothing else with that limb. However, if your opponent breaks free or you take damage, the grapple may be lost.

A grappled character suffers:
- **-4 to DX** while being held (which reduces skill rolls, attack rolls, and defense rolls derived from DX).
- Movement is reduced or prevented, depending on what is grappled.

### 3. Follow-Up Actions

On each subsequent turn while the grapple is maintained, you choose a follow-up option. These are resolved as **Quick Contests** of ST or the relevant grappling skill vs. the target's ST or grappling skill:

| Follow-Up | Mechanic |
|-----------|----------|
| **Takedown** | Quick Contest of ST or Wrestling vs. target's ST or Wrestling; success puts target prone |
| **Pin** | Quick Contest of ST or Wrestling; hold target completely immobile (they can only talk and attempt escape) |
| **Choke Hold** | Technique (Choke Hold, default Judo/Wrestling-2, max +0); deals Fatigue damage; can render unconscious |
| **Arm Lock** | Technique (Arm Lock, default Judo/Wrestling+0, max +4); applies pain and prevents arm use |
| **Neck Snap** | Technique (Neck Snap, ST-based); lethal; requires extremely high ST advantage |
| **Throw** | Quick Contest of Judo or Wrestling vs. ST or DX; target is thrown prone, may take falling damage |

A pin requires winning the Quick Contest by enough to hold both of the target's arms. A pinned character cannot act meaningfully.

### 4. Breaking Free

A grappled character can attempt to escape on their turn using the **Attack** maneuver (their action for the turn). Roll a Quick Contest of ST or Wrestling (or Judo) vs. the grappler's ST or Wrestling. Success ends the grapple; failure wastes the turn.

Alternatively, the target can try to **bite, strike, or use a held weapon** despite the -4 DX penalty — escaping is not the only option.

---

## Key Skills for Grapplers

| Skill | Diff | Key Benefit |
|-------|------|-------------|
| Brawling | DX/E | Basic grapple attacks; easy to acquire |
| Wrestling | DX/A | +1 to grapple rolls per 2 points of ST advantage; best general grappler |
| Judo | DX/H | Can parry weapons at -3 (unusual for unarmed); excellent throws; Arm Lock and Choke Hold at good defaults |
| Sumo Wrestling | DX/A | Optimized for shoves, slams, and pushing opponents out of position |
| Garrote | DX/E | Grappling attack from behind only; strangulation |

---

## Relevant Traits

- **Wrestling** [4+] — The core grappling skill. High ST synergizes directly.
- **Judo** [4+] — Hard to learn, but versatile; best for joint locks and throws.
- **High Pain Threshold** [10] — Immune to shock from damage; +3 to resist knockdown. Useful if you expect to take hits while grappling.
- **Combat Reflexes** [15] — +1 to all defenses; helps defend against the initial grab attempt.
- **Extra Attack** [25/level] — Lets you grapple and strike in the same turn.
- **ST** — Directly improves Quick Contests for takedowns, pins, and breaks. Every +1 ST is worth having for a dedicated wrestler.

---

## Common Tactical Notes

- **Grapple + Choke Hold** is one of the most effective non-lethal takedown sequences. Establish the grapple (turn 1), then apply Choke Hold (turn 2+). The target loses FP each turn and passes out when FP reaches 0.
- **All-Out Attack (Determined)** on the initial grab gives +4 to hit — useful if the target is quick and likely to dodge, but leaves you with no active defense that turn.
- **Judo throws** are powerful because a thrown opponent is prone, taking falling damage and losing their next action to stand up (or fight from the ground at a significant penalty).
- A **pinned** target is nearly helpless; allies can coup de grace or cuff them without opposition.
- Wrestling's bonus for ST advantage means high-ST characters (ST 14+) have a meaningful edge over equally skilled but lighter opponents.

---

## Page References

- Grappling procedure: GURPS Basic Set Campaigns p. 370–371
- Choke Hold technique: B230
- Arm Lock technique: B230
- Neck Snap technique: B232
- Wrestling skill: B228
- Judo skill: B203
- Sumo Wrestling skill: B223
