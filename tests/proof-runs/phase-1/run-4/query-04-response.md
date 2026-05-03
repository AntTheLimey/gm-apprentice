---
query: "How does the GURPS 4e grappling system work?"
system: gurps-4e
type: lookup
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/systems/gurps-4e/combat.md
  - skills/ttrpg-expert/systems/gurps-4e/mechanics.md
  - skills/ttrpg-expert/systems/gurps-4e/skills-combat.md
---

# GURPS 4e Grappling System

Source: GURPS Basic Set — Campaigns, Chapter 11 (B370–B372). The rules below paraphrase the mechanics; refer to your own copy for full text.

---

## Overview

Grappling in GURPS 4e is resolved over multiple turns. First you grab your opponent, then you exploit the hold each subsequent turn with follow-up actions. Every step involves an attack roll or a Quick Contest, and the grappled character is progressively penalized until they break free or are taken down/pinned.

---

## Step 1 — Initiate the Grapple (Grab Attack)

On your turn, take an **Attack** maneuver (or All-Out Attack) and declare a grab.

**Roll to hit:** 3d6 ≤ DX, Brawling, Judo, or Wrestling (your choice, use whichever is highest). Apply normal hit-location penalties if targeting a specific body part (e.g., –2 for an arm or leg, –4 for a hand).

**Target's defense:** The target may attempt any active defense (Dodge, Parry, Block) as normal.

**If the grab lands:** The target is **grappled**. They suffer **–4 to DX** as long as the hold is maintained. This penalty applies to all their actions including attacks and defenses.

---

## Step 2 — Maintain the Grapple

The grappler automatically maintains the hold as a **free action** each turn, provided they do nothing that requires both hands. If the grappler is struck and fails a DX roll, the hold may be broken at the GM's discretion.

---

## Step 3 — Follow-Up Actions (Subsequent Turns)

Once a grapple is established, on each of your turns you can attempt one of the following. Most are resolved as a **Quick Contest** of ST or grappling skill.

| Action | Resolution | Notes |
|--------|-----------|-------|
| **Takedown / Trip** | Quick Contest: your Wrestling or Judo vs. target's ST or Wrestling/Judo | Winner knocks target prone; target is still grappled unless you release |
| **Pin** | Quick Contest: your ST vs. target's ST (both on the ground) | Target is helpless until they break free; you must be on top of them |
| **Choke Hold** | Technique: Choke Hold (default Wrestling/Judo –2, max +0); roll to hit, then target rolls HT each turn or loses 1 FP | When FP = 0 target falls unconscious |
| **Arm Lock** | Technique: Arm Lock (default Wrestling/Judo +0, max +4); Quick Contest vs. target's DX or ST | On a win, target takes pain penalties and cannot use that arm |
| **Throw** | Quick Contest: your Judo vs. target's ST or Judo | Launches target; they fall prone and take damage from the throw |
| **Neck Snap** | Technique: Neck Snap (default ST-based, Hard); Quick Contest vs. target's ST | Lethal; GM may require appropriate cinematic rules |
| **Strike from Grapple** | Normal attack roll at –4 (grappler's own DX penalty also applies) | Punch, knee strike, elbow, headbutt; damage as normal |

---

## Breaking Free

A grappled character can attempt to escape on their turn:

- **Quick Contest:** Grappled character's ST or Wrestling/Judo vs. grappler's ST or Wrestling/Judo.
- **All-Out Attack (for escape):** You may use All-Out Attack to get +4 ST on the break-free attempt, but you forfeit active defenses.
- If the victim wins the contest, the grapple ends. On a tie or loss, they remain held.

---

## Relevant Skills

| Skill | Diff | Key Notes |
|-------|------|-----------|
| Brawling | DX/E | Can initiate a grapple; no follow-up technique bonuses |
| Wrestling | DX/A | Primary grappling skill; +1 per 2 points of ST above 10 as a bonus (check your edition printing) |
| Judo | DX/H | Can parry weapons at –3; strong throw options; best for takedowns and throws |
| Sumo Wrestling | DX/A | Specialises in shoves and slams; defaults to Wrestling –4 |

**Judo vs. Wrestling:** Judo is better at throws and has a weapon-parry option. Wrestling is better for pins, chokes, and raw-strength holds. Both can do most grappling actions.

---

## Relevant Techniques

These are bought separately as technique points (each +1 costs 1 point up to the listed maximum).

| Technique | Defaults From | Max | Notes |
|-----------|--------------|-----|-------|
| Arm Lock | Wrestling or Judo +0 | +4 | Lock out an arm |
| Choke Hold | Wrestling or Judo –2 | +0 | Fatigue/suffocation |
| Finger Lock | Wrestling or Judo –3 | +0 | Fine-motor control disruption |
| Neck Snap | ST-based, Hard | +0 | Lethal; use with care |
| Ground Fighting | Any melee –var | +0 | Reduces penalties when fighting prone |

---

## Key Modifiers Summary

| Situation | Effect |
|-----------|--------|
| Target is grappled | –4 to DX for all actions |
| Attacker using All-Out Attack | No active defenses allowed; can take +4 (Determined) to grab roll |
| Target using All-Out Defense | +2 to one defense against the grab |
| Multiple grapplers | Each additional grappler adds their ST to the hold; escape Quick Contest is harder |
| Grappler takes damage, fails DX roll | May lose grip (GM call) |
| Target is prone and pinned | Cannot act until they win a Quick Contest of ST vs. grappler's ST |

---

## Practical Sequence (Example)

1. Wrestler (ST 13, Wrestling-14) uses **Attack** maneuver to grab the bandit's arm (–2 to hit). Rolls 3d6 ≤ 12. Succeeds.
2. Bandit attempts Dodge. Fails. Bandit is now **grappled** (–4 DX).
3. Next turn: Wrestler attempts **Takedown** — Quick Contest of Wrestling (14) vs. bandit's ST (10). Wrestler wins. Bandit falls prone, still grappled.
4. Wrestler moves to **Pin** — Quick Contest of ST (13) vs. bandit's ST (10). Wrestler wins. Bandit is pinned and helpless.
5. Bandit's turn: attempts break-free with Quick Contest of ST (10) vs. Wrestler's ST (13). Loses. Still pinned.

---

## Notes on Encumbrance and Size

- **Encumbrance** reduces Move and Dodge normally but does not directly penalise grappling attack rolls.
- **Size Modifier (SM) differences** affect the grapple: a SM+2 creature grappling a SM0 human has a significant ST advantage; check with the GM whether the ST adjustment for scale applies.
- **Constriction Attack** (exotic advantage, 15 pts): Allows a creature to do crushing damage automatically each turn while maintaining a grapple, without a follow-up roll — relevant for monsters, not typical PCs.

---

## Page References (Basic Set — Campaigns)

- Grappling rules: B370–B372
- Quick Contest mechanics: B348
- Wrestling skill: B228
- Judo skill: B203
- Techniques (Arm Lock, Choke Hold, etc.): B230–B232
- Shock and knockdown from strikes during grapple: B419–B420
