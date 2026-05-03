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
  - skills/ttrpg-expert/systems/gurps-4e/traits-exotic.md
---

# GURPS 4e Grappling System

Source: GURPS Basic Set — Campaigns, Chapter 11 (B370–371); Martial Arts supplement for advanced grappling.

---

## Overview

Grappling in GURPS is a multi-turn process that begins with an initial grab and then escalates through follow-up actions. Each step is a separate turn. The key mechanic throughout is the **Quick Contest**, where both sides roll against their relevant attribute or skill and the higher margin of success wins.

---

## Step 1: The Grab (Initial Grapple)

On your turn, take an **Attack maneuver** and roll against one of:

- **DX** (default, untrained)
- **Brawling** (DX/E)
- **Judo** (DX/H)
- **Wrestling** (DX/A)

The target may use any active defense (Dodge, Parry, or Block) to avoid the grapple. If the attack succeeds and the defense fails, the target is **grappled**.

A grappled target suffers **-4 to DX** for as long as the grapple is maintained.

---

## Step 2: Maintaining the Grapple

Maintaining a grapple is a **free action** on each of your subsequent turns. You do not need to spend a maneuver just to hold on — your action each turn can be a follow-up attack or other maneuver while you maintain the hold.

---

## Step 3: Follow-Up Actions

On turns after a successful grab, you can attempt one of the following. Most are **Quick Contests** of ST or your grappling skill vs. the target's ST or grappling skill.

### Takedown / Throw
- Roll a **Quick Contest**: your Wrestling or Judo skill vs. the target's DX, Judo, or Wrestling.
- On a win, the target is knocked **prone** (and may take falling damage if thrown: 1d-1 crushing for a basic throw to the ground).
- Judo allows throws at range; Wrestling throws are typically to the ground in contact.

### Pin
- Roll a **Quick Contest**: your ST or Wrestling vs. the target's ST or Wrestling.
- On a win, the target is **pinned** — they cannot move or take most actions until they break free.
- A pinned target can still attempt to break free on their turn.

### Choke Hold (technique; Judo or Wrestling)
- Default: Skill-2, max Skill+0 (Hard technique).
- A successful choke hold deals **fatigue damage** (to FP, not HP) and can cause suffocation if sustained.
- The target loses 1 FP per turn while choked; when FP reaches 0, they fall unconscious.

### Arm Lock (technique; Judo or Wrestling)
- Default: Skill+0, max Skill+4 (Average technique).
- Immobilizes one arm. The target suffers pain and cannot use that arm.
- Can be used to force compliance ("submit or I break it") — damage applied on a failed HT roll.

### Neck Snap
- Roll ST-based Quick Contest (ST vs. target's ST or HT).
- Lethal follow-up for an already-pinned or helpless target.
- Hard technique; requires an already established grapple.

---

## Step 4: Breaking Free

The grappled character may attempt to **escape** on their turn. This costs their action for the turn. Roll a **Quick Contest**:

- **Grappled party**: ST or grappling skill (Judo, Wrestling, Brawling, or DX)
- **Grappling party**: ST or grappling skill

If the grappled character wins, they are free. On a tie or a loss, the grapple continues.

---

## Key Grappling Skills

| Skill | Difficulty | Page | Key Notes |
|-------|-----------|------|-----------|
| Brawling | DX/E | B182 | Simplest grab; +1/die damage above skill 2 |
| Wrestling | DX/A | B228 | Core grappling skill; +1 to grapple per 2 pts of ST above 10 |
| Judo | DX/H | B203 | Can parry melee weapons at -3; enables throws to range; best for locks |
| Sumo Wrestling | DX/A | B223 | Specializes in shoves and slams rather than holds |
| Garrote | DX/E | B197 | Grappling attack from behind; automatically targets the neck |

**Wrestling bonus:** Wrestling gives +1 to grapple rolls for every 2 points of ST above 10 (so ST 12 = +1, ST 14 = +2, etc.).

**Judo parry:** Judo allows you to parry unarmed attacks normally, and weapon attacks at -3. A successful Judo parry can immediately flow into a throw attempt (same turn, no extra roll needed to grab).

---

## Relevant Techniques

| Technique | Base Skill | Default | Max | Notes |
|-----------|-----------|---------|-----|-------|
| Arm Lock | Judo / Wrestling | Skill+0 | Skill+4 | Average; immobilize arm |
| Choke Hold | Judo / Wrestling | Skill-2 | Skill+0 | Hard; FP drain, suffocation |
| Neck Snap | ST | ST-var | ST+0 | Hard; lethal, requires pin |
| Finger Lock | Judo / Wrestling | Skill-3 | Skill+0 | Hard; immobilize hand/wrist |
| Ground Fighting | Any melee | Skill-var | Skill+0 | Hard; reduces penalty for fighting while prone |
| Sweeping Kick | Judo / Karate / Sumo | Skill-3 | Skill-1 | Hard; knock target prone |

---

## Exotic Advantage: Constriction Attack

- **Cost**: 15 points (B43)
- For creatures with coiling bodies or powerful crushing limbs.
- Instead of a standard grapple follow-up, you can deal **crushing damage equal to your grappling damage roll** automatically each turn while you maintain the grapple — no additional contest needed. The target still rolls to break free on their turn.

---

## Posture and the Grapple

A grappled character who is also knocked prone faces compounding penalties:
- Prone: -4 to attack, -3 to defend (or no active defense against melee from above)
- Grappled: -4 to DX

If you achieve a takedown and maintain the grapple while the target is prone, they are very difficult to escape: they must win a Quick Contest just to stand, and another to break the grapple.

---

## Quick Reference: Grappling Sequence

```
Turn 1 — Grab:
  Roll DX / Brawling / Judo / Wrestling vs. active defense.
  Success: target is grappled (-4 DX).

Turn 2+ — Follow-up (choose one per turn):
  Takedown:  Quick Contest grapple skill vs. target DX / Judo / Wrestling.
  Pin:       Quick Contest ST or Wrestling vs. target ST or Wrestling.
  Choke:     Technique roll (Choke Hold); target loses 1 FP/turn.
  Lock:      Technique roll (Arm Lock / Finger Lock); limb immobilized.
  Maintain:  Free — hold without acting.

Any turn (target's turn):
  Break free: Quick Contest ST or grappling skill vs. yours.
```

---

## Notes for the GM

- **Multiple grapplers**: Two characters can grapple the same target simultaneously. Each applies a separate -4 DX penalty (so two grapplers = -8 DX). For takedowns and pins, the stronger grappler usually leads the contest.
- **Armed grapples**: You can grapple while holding a weapon, but weapon attacks into a grapple are at -4 and the weapon can be turned against you on a failed roll. Knives are common for this.
- **Grapple vs. non-human ST**: Very high-ST creatures (animals, giants) make grappling them extremely risky — they may win the break-free contest trivially. Consider using Judo throws rather than trying to hold a bear.
- **Size Modifier (SM)**: Grappling a target with a different SM imposes a penalty equal to the SM difference on your grapple roll. Grappling SM+2 creature at SM 0 = -2 to your roll.

For martial arts styles that build systematically on these techniques, see GURPS Martial Arts (the supplement; not in the core book). Core-book grappling as described above covers everything needed for realistic play without that supplement.
