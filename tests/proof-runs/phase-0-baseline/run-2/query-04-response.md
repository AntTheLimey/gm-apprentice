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
  - skills/ttrpg-expert/systems/gurps-4e/mechanics.md
---

# GURPS 4e Grappling System

Source: GURPS Basic Set — Campaigns (SJG). The following is a summary in original phrasing; not verbatim rule text.

---

## Overview

Grappling in GURPS 4e is a multi-step process that unfolds across successive turns. A character must first establish a hold, then use follow-up actions to control, damage, or throw the target. It is resolved through attack rolls, active defenses, and Quick Contests.

---

## Step 1 — Initiate the Grapple (Grab)

On your turn, use the **Attack** maneuver. Roll vs. one of the following skills:

- **DX** (default, unskilled)
- **Brawling** (DX/Easy, B182) — general fighting; +1/die above skill 2
- **Judo** (DX/Hard, B203) — trained throws and locks; can parry weapons at -3
- **Wrestling** (DX/Average, B228) — specialist grappler; +1 per 2 pts of ST bonus

The target may attempt an **active defense** as normal:
- **Dodge**: Basic Speed + 3 (floor), ±retreat
- **Parry**: available if the target has a free hand or suitable weapon/skill
- **Block**: requires a shield

If the attack hits and the target fails to defend, the grapple is established. The grappler is now holding the target; the target is **grappled** (-4 to DX).

---

## Step 2 — Maintain (Free Action)

Each subsequent turn you must choose to **maintain** the grapple as a free action. If you don't take any action that would release the hold, you keep it. The target remains at -4 DX until they break free or the grapple ends.

---

## Step 3 — Follow-Up Actions

On turns after the grapple is established, you can attempt follow-up techniques using your Attack maneuver. Each is resolved as a **Quick Contest** (both sides roll 3d6 vs. their relevant attribute or skill; the higher margin of success wins):

| Action | Contest |
|--------|---------|
| **Takedown / Trip** | Your Wrestling or Judo vs. target's ST or DX |
| **Pin** | Your ST vs. target's ST (target must be prone or otherwise restrained) |
| **Choke Hold** (Technique, DX/Hard, default Skill-2) | Judo or Wrestling vs. target's HT; on success, target takes fatigue each turn and risks unconsciousness |
| **Arm Lock** (Technique, DX/Average, default Skill+0) | Judo or Wrestling; forces compliance or causes injury if target resists |
| **Finger Lock** (Technique, DX/Hard, default Skill-3) | Judo or Wrestling; disabling a hand |
| **Neck Snap** (Technique, ST-based, Hard) | ST-based Quick Contest; lethal outcome |
| **Throw** | Judo; a successful throw puts the target prone; target takes falling damage |
| **Strike while grappling** | Brawling, Boxing, or Karate at -4 (close-combat penalty) |

Techniques must be purchased separately from the base skill; the values above are their trained defaults (the floor you start from before spending points to improve).

---

## Step 4 — Breaking Free

A grappled character can spend their turn attempting to **break free**:

- **Quick Contest**: Target's ST or best grappling skill (Brawling, Judo, Wrestling) vs. grappler's ST or grappling skill
- **Win the contest** → grapple is broken; character is free
- **Tie or lose** → grapple is maintained; character's turn is spent

A character who is **pinned** is at -4 DX and cannot attempt most actions until they break the pin.

---

## Key Modifiers and Interactions

- **Grappled condition**: -4 DX to the grappled character at all times the hold is maintained.
- **Multiple grapplers**: Each additional person grappling the same target adds their ST to the contest for purposes of resisting escape.
- **Size Modifier (SM)**: Grappling a significantly larger creature imposes penalties; refer to the SM rules (Basic Set p. 19).
- **Encumbrance**: Heavy encumbrance reduces Move and Dodge but does not directly penalize grappling skill rolls.
- **All-Out Attack**: Using All-Out Attack (Determined) gives +4 to the initial grab roll but removes all active defenses. Useful when you need to be sure of landing the hold.
- **Judo throw vs. Wrestling pin**: Judo excels at throws and weapon parrying; Wrestling is stronger for pins and control due to the ST bonus.

---

## Relevant Traits and Advantages

| Trait | Cost | Effect |
|-------|------|--------|
| ST (high) | 10/level | Better grapple contests and damage |
| Wrestling skill | B228 | +1 per 2 pts ST above 10 on grappling contests |
| Judo skill | B203 | Throw attacks; can parry armed opponents at -3 |
| Brawling skill | B182 | Unarmed fighting; Parry = Skill/2+3 |
| Enhanced ST | varies | Boosts grappling contests |
| Slippery [2/level] | B85 | +1/level to break-free contests |
| No Fine Manipulators | varies | Cannot initiate or maintain most grapples |

---

## Quick Reference Flow

```
1. ATTACK maneuver → Roll vs. DX / Brawling / Judo / Wrestling
   └─ Target defends (Dodge, Parry, Block)
      ├─ Defense fails → GRAPPLED (target at -4 DX)
      └─ Defense succeeds → No grapple

2. Each of your turns while grappling:
   └─ Maintain (free) + choose follow-up:
      ├─ Takedown → Quick Contest (your skill vs. their ST or DX)
      ├─ Pin → Quick Contest (ST vs. ST)
      ├─ Choke → Quick Contest (skill vs. HT); fatigue damage
      ├─ Arm/Finger Lock → Quick Contest; injury or compliance
      ├─ Throw (Judo) → Quick Contest; target goes prone
      └─ Strike → Brawling/Karate at -4

3. Target's turn while grappled:
   └─ Break Free → Quick Contest (ST or skill vs. grappler)
      ├─ Win → grapple broken, free to act normally
      └─ Lose/Tie → still grappled; turn spent
```

---

## Worked Example

Gerd (ST 12, Wrestling-14) grabs a guard (ST 11, DX 10).

**Turn 1 — Grab**: Gerd attacks vs. Wrestling-14. Guard tries Dodge (Basic Speed ~5.5, Dodge 8). Guard rolls 10 — success, but Gerd rolls 9 — also a success; Quick Contest of margins: Gerd margin 5, Guard margin 2 — wait, the grab is a standard attack/defense exchange, not a Quick Contest. Gerd's roll of 9 is a hit; Guard's Dodge of 10 vs. roll of 10 exactly succeeds. Guard is not grappled — Gerd must try again next turn.

**Turn 2 — Grab** (All-Out Attack, Determined): Gerd gets +4 → effective skill 18. Guard fails Dodge. Grapple established. Guard is at -4 DX (effectively DX 6).

**Turn 3 — Takedown**: Gerd attempts a Takedown: Quick Contest of Wrestling-14 vs. Guard's ST 11. Gerd rolls 8 (margin 6), Guard rolls 11 (margin 0). Gerd wins — guard goes prone.

**Turn 3 onward — Pin**: Gerd attempts to pin the prone guard: Quick Contest of ST 12 vs. guard's ST 11. Most likely outcome with high-ST attacker is a successful pin within 1-2 more turns.

---

*Page references: GURPS Basic Set — Campaigns, Chapter 11 (Maneuvers), Chapter 12 (Combat Procedures). Grappling techniques: B230-232. Wrestling: B228. Judo: B203.*
