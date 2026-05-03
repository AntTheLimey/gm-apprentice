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

Source: GURPS Basic Set — Campaigns, Chapters 11-13, B202-B232.

---

## Core Sequence

Grappling in GURPS 4e follows a four-step flow:

### 1. Grab (Attack maneuver)

On your turn, take an **Attack** maneuver and roll against one of:
- **DX** (untrained default)
- **Brawling** (DX/E)
- **Judo** (DX/H)
- **Wrestling** (DX/A)

A successful roll means you have grabbed your target. The target may attempt an **active defense** (Dodge, Parry, or Block) as normal to avoid being grabbed.

### 2. Maintain (Free action)

Each of your subsequent turns, you may maintain the grapple as a free action — no roll needed. If you take damage or are otherwise interrupted, the GM may call for a roll to hold on.

### 3. Follow-up Actions

On turns after the grab, you can attempt one of several follow-up techniques. Each is a **Quick Contest** of ST or your grappling skill vs. the target's ST or grappling skill:

| Action | Roll | Notes |
|--------|------|-------|
| Takedown | Quick Contest of grappling skill | Put target prone |
| Pin | Quick Contest of ST or Wrestling | Target immobilised; can't act |
| Choke Hold | Choke Hold technique (Skill-2, max +0) | Causes FP loss; suffocation |
| Arm Lock | Arm Lock technique (Skill+0, max +4) | Restrains arm; pain/injury |
| Finger Lock | Finger Lock technique (Skill-3, max +0) | Painful compliance hold |
| Throw | Quick Contest of Judo vs. target's ST/DX | Target falls prone; may take damage |
| Neck Snap | ST-based technique | Lethal; Hard technique |

For **Quick Contests**: both sides roll against their skill; the side with the highest margin of success wins (ties go to the initiator if they have the higher margin, otherwise to the defender).

### 4. Break Free

A grappled character can attempt to escape by taking an **Attack** maneuver on their own turn:
- Roll a **Quick Contest of ST or grappling skill** vs. the grappler's ST or grappling skill.
- Success means the grapple is broken and they are free.
- Failure means they remain grappled and have spent their turn.

---

## Key Skills for Grappling

| Skill | Diff | Notes |
|-------|------|-------|
| Brawling | DX/E | +1/die damage above skill 2; basic grapple grab |
| Wrestling | DX/A | Dedicated grappling skill; +1 per 2 points of ST above average |
| Judo | DX/H | Can parry weapons at -3; throws deal damage; very versatile |
| Sumo Wrestling | DX/A | Specializes in shoves and slams rather than holds |
| Garrote | DX/E | Grappling attack from behind; strangulation |

**Wrestling** is the workhorse grappling skill. **Judo** adds the ability to throw and to use the grapple defensively. If you default (no skill bought), you default to DX-5 for Wrestling, DX-5 for Judo, or DX-4 for Brawling.

---

## Combat Techniques (Grappling Follow-ups)

These are technique specializations bought separately from the parent skill. Cost: 1 pt per +1 (Average), 1 pt per +1 (Hard).

| Technique | Parent Skill | Default | Max | Effect |
|-----------|-------------|---------|-----|--------|
| Arm Lock | Judo or Wrestling | Skill+0 | Skill+4 | Restrains arm; continued pressure causes pain/injury |
| Choke Hold | Judo or Wrestling | Skill-2 | Skill+0 | Target loses FP; suffocation if maintained |
| Finger Lock | Judo or Wrestling | Skill-3 | Skill+0 | Compliance hold; painful |
| Neck Snap | ST-based | ST-var | ST+0 | Lethal; ST-based attack on grappled target |

---

## Being Grappled: Penalties

A grappled character suffers:
- **-4 to DX** while grappled (affects all DX-based skills and attacks).
- Cannot retreat while grappled.
- Limited to specific actions: attempt to break free, attack the grappler (at -4 DX), or take non-movement actions.

---

## Grappling and Damage

- A basic grab does **no damage by itself**.
- A Choke Hold causes **fatigue damage** (FP loss) once per turn maintained; continued suffocation eventually causes unconsciousness and death.
- A throw (Judo) can deal **crushing damage** equal to the margin of success on the Quick Contest (or per throw rules, B202).
- A Neck Snap can deal **lethal injury** (B232; use with caution — this is a killing technique).

---

## Grappling at Range / Special Cases

- **Garrote** (DX/E): Requires getting behind the target first; once attached, applies a Choke Hold that is harder to escape (target is at -4 ST/DX to break free).
- **Net / Lasso / Bolas** (ranged entangling weapons): These use ranged attack rolls but result in a grappled state similar to a melee grapple — target must make a Quick Contest to escape.
- **Multiple grapplers**: Each additional grappler after the first adds +2 to the grappling side's effective skill for maintaining and follow-up contests.

---

## Practical Summary for the GM

1. Attacker rolls grappling skill (Wrestling/Judo/Brawling/DX).
2. Defender rolls active defense to avoid the grab.
3. If grabbed: defender is at -4 DX until free.
4. Each attacker turn: choose a follow-up (takedown, pin, choke, lock, throw) — Quick Contest.
5. Defender uses their turn to attempt escape — Quick Contest.
6. First side to win the contest gets what they want.

For most cinematic or brutal grapples, the sequence is: Grab → Pin (immobilize) → Choke Hold (render unconscious). A character with high Wrestling and ST can lock down almost any foe who lacks the same.

---

*For martial arts styles and more detailed technique combinations, see `skills/ttrpg-expert/systems/gurps-4e/skills-combat.md`. For full page references, consult GURPS Basic Set — Campaigns pp. 370-379 and pp. 202-232.*
