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

# GURPS 4e Grappling

Source: GURPS Basic Set — Campaigns, Chapters 11-13.

---

## Overview

Grappling in GURPS 4e is a multi-step process spread across combat turns. It uses the standard Attack maneuver and resolves through Quick Contests of ST or grappling skill. A grapple does not automatically deal damage — it sets up control from which you can attempt more dangerous follow-ups.

---

## Step 1: Initiate the Grapple (Grab)

On your turn, take the **Attack** maneuver and roll against one of:

- **DX** (untrained, default)
- **Brawling** (DX/Easy — best for generalists)
- **Wrestling** (DX/Average — specialized grappling; +1 to effective ST per 2 points in the skill)
- **Judo** (DX/Hard — can also parry weapons at -3)

**Hit location:** A grapple targets a body part. The most common target is the torso (no penalty). Targeting an arm or leg is -2; a hand or foot is -4.

If the attack succeeds, the target may attempt an **active defense** (Dodge, Parry, or Block) as normal.

If the grapple lands and is not defended against, the target is **grappled**. A grappled character suffers:

- **-4 to DX** (affects all DX-based rolls, including defenses)
- Cannot move away without first breaking free
- May not use two-handed weapons freely if an arm is grappled

---

## Step 2: Maintain the Grapple

Maintaining a grapple costs nothing — it is automatic. However, if you are stunned, knocked back, or otherwise disrupted, you lose the hold.

Both you and the target remain in **close combat** as long as the grapple persists.

---

## Step 3: Follow-up Actions

On subsequent turns you can attempt one of the following against your grappled target. Each is a **Quick Contest** of your ST (or grappling skill) against the target's ST (or grappling skill). The grappler wins ties unless otherwise specified.

| Action | Skill Used | Effect |
|--------|-----------|--------|
| Takedown | ST or Wrestling/Judo | Opponent falls prone; still grappled |
| Pin | ST or Wrestling/Judo | Opponent is helpless (cannot act); requires target to be prone |
| Choke Hold | Judo or Wrestling (technique: Choke Hold, default Skill-2) | Deals fatigue damage; target can suffocate |
| Arm Lock | Judo or Wrestling (technique: Arm Lock, default Skill+0) | Immobilizes the arm; causes pain/crippling if pressed |
| Finger Lock | Judo or Wrestling (technique: Finger Lock, default Skill-3) | Immobilizes/disarms; requires hand grappled |
| Neck Snap | ST-based (technique: Neck Snap) | Lethal follow-up; highly cinematic |
| Throw | Judo | Throws target; deals damage; ends grapple |

For any Quick Contest, if you are using Wrestling, your effective ST is boosted by +1 for every 2 skill points invested above DX (this reflects technique over raw strength).

---

## Step 4: Break Free

A grappled character can attempt to break free on their turn. This is a **Quick Contest** of:

- Their ST or grappling skill (Wrestling/Judo) vs.
- The grappler's ST or grappling skill

On a success the grapple ends and the character may act normally for the remainder of the turn. On a failure they remain grappled.

Breaking free counts as the character's action for the turn (it replaces their attack).

---

## Key Skill Summaries

**Brawling** [DX/Easy, B182]
- The generalist unarmed option; easy to buy, low prerequisites.
- Provides a grapple option but no special grappling bonuses.
- Also improves punch/kick damage at higher skill levels.

**Wrestling** [DX/Average, B228]
- Purpose-built for grappling: every 2 points above DX gives +1 effective ST in all grappling contests.
- Default -5 from DX; no weapon defaults.
- Best skill for pure control/submission play.

**Judo** [DX/Hard, B203]
- Hard to buy, but uniquely flexible: can parry weapons at -3 (unarmed vs. armed).
- Enables throws (which deal damage and break the grapple).
- Core skill for the Arm Lock and Choke Hold techniques.
- No weapon defaults.

**Sumo Wrestling** [DX/Average, B223]
- Specializes in shoves and slams rather than classical grappling.
- Defaults to Wrestling-4; useful for characters who combine stand-up and grappling.

---

## Relevant Techniques

These are bought separately from the parent skill and represent focused training:

| Technique | Parent Skill | Default | Hard Cap | Notes |
|-----------|-------------|---------|----------|-------|
| Arm Lock | Judo or Wrestling | Skill+0 | +4 | Immobilize/damage arm |
| Choke Hold | Judo or Wrestling | Skill-2 | +0 (Hard) | Fatigue/suffocation |
| Finger Lock | Judo or Wrestling | Skill-3 | +0 (Hard) | Hand target |
| Neck Snap | ST | ST-var | +0 (Hard) | Lethal; cinematic |
| Ground Fighting | Any melee | Skill-var | +0 (Hard) | Fight effectively while prone |

Techniques cost 1 point per +1 (Average) or are bought at 1 point per +1 toward a Hard cap. You must have the parent skill to buy a technique off it.

---

## Practical GM Notes

- **Multiple grapplers:** Each additional attacker who joins a grapple adds their ST to the grapple contest, making escape much harder. This makes gang-tackles very effective.
- **Weapons while grappled:** Using a long weapon in close combat is penalized or outright impossible (weapon reach 1+ is unusable at Reach C). Knives and short weapons work normally.
- **Armor and grappling:** Grappling itself does not deal damage unless a follow-up technique is applied, so DR is rarely relevant to the grab itself.
- **Judo throws:** When Judo is used to throw a grappled opponent, the target hits the ground and takes falling damage. This is a one-action resolution vs. the multi-step Wrestling approach.
- **Size Modifier:** Grappling a target with a much larger SM than you imposes penalties to hit (and may be physically impossible against very large creatures per the GM's ruling).

---

## Quick Reference: Grapple Sequence

```
Turn 1 — Grappler:
  Attack maneuver → roll DX / Brawling / Wrestling / Judo
  Target defends (Dodge/Parry/Block)
  → Success: target is grappled (-4 DX, can't move freely)

Turn 2+ — Grappler:
  Attack maneuver → Quick Contest (ST or skill) for follow-up
  (Takedown / Pin / Choke / Arm Lock / Throw / etc.)

Turn 2+ — Grappled target:
  Attack maneuver → Quick Contest (ST or skill) to Break Free
  → Success: grapple ends
```

---

*Source: GURPS Basic Set — Campaigns pp. 370-371 (close combat), 202-203 (Judo), 228 (Wrestling), 182 (Brawling); techniques at pp. 230-232. For cinematic grappling options (e.g. Neck Snap in play) see GURPS Martial Arts.*
