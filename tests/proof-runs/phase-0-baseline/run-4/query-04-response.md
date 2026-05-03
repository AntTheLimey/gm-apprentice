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

Source: GURPS Basic Set — Campaigns, Chapters 11-13 (B370–B405).

---

## Overview

Grappling in GURPS 4e is a multi-step process that takes place across
several turns. It begins with a successful grab attack, continues with
contested follow-up actions, and ends when one party breaks free or is
subdued. The key skills involved are **Brawling** (DX/E), **Judo**
(DX/H), and **Wrestling** (DX/A). DX alone can be used if none of
these are known.

---

## Step 1 — The Grab (Attack Maneuver)

To initiate a grapple, take an **Attack** maneuver and roll vs. your
DX, Brawling, Judo, or Wrestling skill to hit.

- A successful hit means you have grabbed the target. You do no damage
  on a bare grab.
- The target may attempt an **active defense** (Dodge, Parry, or
  Block) as normal to avoid being grabbed. Judo is notable because it
  allows parrying armed opponents at -3.
- You must be within reach (typically 1 yard for empty-hand attacks).

**Wrestling bonus**: Wrestling adds a ST-based damage bonus for
follow-up actions. At DX+0 in Wrestling, +1 to effective ST per
2 points of skill above the base.

---

## Step 2 — Maintaining the Grapple

Once you have a hold, maintaining it costs nothing — it is a **free
action** at the start of each of your turns. You are considered to be
grappling the target as long as you choose to hold on.

**Effects on a grappled target:**
- The target is at **-4 to DX** for most actions while grappled
  (this penalizes their attacks, defenses that require movement,
  and skill rolls that depend on free movement).
- The grappled character may not retreat.
- The grappler must stay adjacent; if either party moves more than
  a step, the grapple breaks unless a follow-up action (e.g., a throw)
  produces the movement.

---

## Step 3 — Follow-Up Actions

On turns after the grab, the grappler can attempt any of the following
by spending their Attack maneuver on a **Quick Contest** of ST or
grappling skill (your choice of which stat to use):

### Takedown / Trip
Force the target to the ground (prone). Roll ST or grappling skill
vs. the target's ST or grappling skill. Success leaves the target
prone and still grappled.

### Pin
Hold the target so they cannot act. The grappler must already have
the target prone (from a takedown or from being knocked down). Win
a Quick Contest of ST or Wrestling vs. the target's ST or Wrestling.
A pinned target is helpless — they can only attempt to break free
each turn.

### Choke Hold (Technique — skill-2, max 0)
Requires Judo or Wrestling at the relevant technique level. A
successful application does **fatigue damage** and can render the
target unconscious. Each turn you maintain a choke, the target takes
FP loss and must make HT rolls to stay conscious.

### Arm Lock (Technique — skill+0, max +4)
Requires Judo or Wrestling. A successful arm lock causes the target
pain (HT roll to avoid dropping held items) and gives you control
leverage. The target is effectively at your mercy unless they break
free.

### Neck Snap (Technique — ST-based, Hard)
A lethal follow-up available to those with sufficient ST and the
relevant technique. Roll ST-based Quick Contest against the target's
ST. Success on a prone, pinned, or thoroughly helpless opponent can
be instantly lethal. This is a cinematic technique and GMs may restrict
it to appropriate settings.

### Throw (Judo)
Judo allows a grappler to throw rather than hold. Win a Quick Contest
of Judo vs. the target's DX or Judo. Success sends the target flying
(typically 1 yard per point of margin, landing prone) and they take
falling damage. This ends the grapple.

---

## Step 4 — Breaking Free

A grappled character can spend their Attack maneuver each turn
attempting to escape. This is a **Quick Contest**:

- Attacker rolls **ST or grappling skill** (Brawling, Judo, or
  Wrestling — whichever is higher).
- Defender (the grappler) rolls **ST or grappling skill**.
- Success by the grappled party means they break free and can act
  normally next turn.

A grappled character who wants to do something other than break free
(e.g., attack) does so at **-4 DX** and with no retreat available.

---

## Key Grappling Skills Summary

| Skill | Diff | Grappling Role |
|-------|------|----------------|
| Brawling | DX/E | Basic grab attack; +1/die damage at skill 2+ |
| Wrestling | DX/A | Full grapple system; ST bonus for follow-ups |
| Judo | DX/H | Parry + throw; can parry weapons at -3; throw on a successful parry |
| Sumo Wrestling | DX/A | Shoving/slamming; defaults Wrestling-4 |

---

## Key Grappling Techniques

| Technique | Base Skill | Difficulty | Notes |
|-----------|-----------|------------|-------|
| Arm Lock | skill+0 | Average | Control hold; pain on failure to resist |
| Choke Hold | skill-2 | Hard | FP damage; unconsciousness risk |
| Finger Lock | skill-3 | Hard | Fine control; drops items |
| Neck Snap | ST-based | Hard | Lethal; requires helpless target |

---

## Common Modifiers

- **Grappling a larger target** (Size Modifier difference): SM
  differences translate to effective ST adjustments — a larger SM means
  higher effective ST for grappling purposes.
- **Multiple grapplers**: Each additional person grappling the same
  target adds +2 to the effective ST used against that target for
  takedowns and pins.
- **From behind**: Grabbing from behind removes the target's ability
  to defend with a Parry (they must Dodge or Block). The Garrote skill
  (DX/E) is specifically designed for attacks from behind.
- **Ground fighting**: Fighting while prone imposes penalties to most
  actions. The Ground Fighting technique (Hard) reduces these penalties.

---

## Quick Reference Sequence

1. **Grab** — Attack maneuver; roll vs. DX/Brawling/Judo/Wrestling;
   target may defend.
2. **Hold** — Free action to maintain each turn; target is at -4 DX.
3. **Follow-up** — Attack maneuver; Quick Contest of ST or skill:
   takedown / pin / choke / arm lock / throw.
4. **Break free** — Target spends Attack maneuver; Quick Contest of
   ST or grappling skill.

---

## Cross-References

- Full maneuver rules and active defense values: `combat.md`
- Skill point costs and defaults: `skills-combat.md`
- Quick Contest mechanics: `mechanics.md`
- Martial arts styles and advanced techniques: GURPS Martial Arts
  (supplement — not reproduced here; consult your copy for cinematic
  options and style lenses)
