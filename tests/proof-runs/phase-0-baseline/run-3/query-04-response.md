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

Source: GURPS Basic Set — Campaigns, Chapters 11-13 (B370-B378).

Grappling in GURPS 4e is a multi-step sequence that unfolds over successive turns. It rewards characters who invest in dedicated grappling skills and high ST, and it integrates cleanly with the standard combat framework (Attack maneuvers, Quick Contests, active defenses).

---

## Step 1 — Initiate the Grapple (Grab)

Use the **Attack** maneuver. Roll against one of the following skills:

- **DX** (default, no training)
- **Brawling** (DX/E) — the basic unarmed-combat catch-all
- **Judo** (DX/H) — stylized throws and locks; can parry weapons at -3
- **Wrestling** (DX/A) — dedicated grappling; grants +1 per 2 pts of ST when resisting a takedown

The grab targets the opponent's torso by default (no hit-location penalty). Targeting a specific limb is possible at the normal location penalty (arm -2, leg -2, hand -4, etc.).

The defender may use any active defense against the grab:
- **Dodge** (always available)
- **Parry** (Judo parry is common here)
- **Block** (if shield is ready)

If the grab succeeds and the defender fails to defend, the attacker has established a **grapple**. The target is now Grappled (see below).

---

## Step 2 — Maintain the Grapple

Maintaining the hold is a **free action** each turn — no roll required as long as nothing breaks it. The grappler does not need to spend their action just to keep holding.

Being Grappled imposes the following on the victim:
- **-4 to DX** for all actions
- Movement is limited — the victim cannot move freely; both figures move together (contested ST roll required to drag the victim)
- Active defenses are still available, but the -4 DX applies

---

## Step 3 — Follow-Up Actions

On any subsequent turn the grappler can attempt one of several follow-up actions. Each is a **Quick Contest** (both sides roll their relevant skill or attribute; highest margin of success wins):

| Action | Contest | Effect on Win |
|--------|---------|---------------|
| **Takedown** | Grappler's Wrestling or Judo vs. defender's ST or Wrestling/Judo | Defender goes prone; grappler may follow to the ground |
| **Pin** | ST vs. ST (or Wrestling vs. Wrestling) | Defender is Pinned — cannot act until they break free |
| **Choke Hold** | Choke Hold technique (Wrestling or Judo -2, max ±0) vs. HT | Defender takes Fatigue damage each turn; can render unconscious |
| **Arm Lock / Finger Lock** | Arm Lock (skill ±0, max +4) vs. ST or skill | Defender cannot use that limb; continuing pressure can cause injury |
| **Throw** | Judo or Wrestling vs. ST or Judo/Wrestling | Defender goes flying — typically 1 yard per point of ST margin; treated as a fall |
| **Neck Snap** | ST-based roll (Hard technique) | Lethal; reserved for cinematic or very high-ST scenarios |

The **Choke Hold**, **Arm Lock**, and **Finger Lock** are formal Techniques that must be bought up from their default penalties if the character wants reliable results (see below).

---

## Step 4 — Breaking Free

The grappled character can attempt to break free as an **Attack** maneuver (spending their turn). This is a **Quick Contest**:

- Defender rolls **ST** or their grappling skill (Brawling, Judo, or Wrestling)
- Attacker rolls **ST** or their grappling skill

If the defender wins, they are free and may act normally this turn. If they tie or lose, they remain grappled.

A character can also attempt to break free via **Judo** throw — if they succeed, they escape *and* throw the grappler.

---

## Relevant Skills and Techniques

| Skill / Technique | Difficulty | Page | Notes |
|-------------------|------------|------|-------|
| Brawling | DX/E | B182 | Basic unarmed; grapples from DX default |
| Wrestling | DX/A | B228 | Primary grapple skill; +1 per 2 ST pts |
| Judo | DX/H | B203 | Throws and locks; can parry weapons at -3 |
| Sumo Wrestling | DX/A | B223 | Shoves and slams; defaults Wrestling-4 |
| Arm Lock (technique) | Skill+0, max +4 | B230 | Average; Judo or Wrestling |
| Choke Hold (technique) | Skill-2, max +0 | B230 | Hard; Judo or Wrestling |
| Finger Lock (technique) | Skill-3, max +0 | B231 | Hard; Judo or Wrestling |
| Neck Snap (technique) | ST-based, max +0 | B232 | Hard; high ST required |
| Ground Fighting (technique) | Skill-var, max +0 | B231 | Hard; any melee skill; fight while prone |

---

## Posture and Ground Fighting

If both combatants go to the ground (common after a takedown):

- Both are **prone**, suffering the standard posture penalties (-4 to attack, -3 to active defense)
- The **Ground Fighting** technique reduces these penalties
- Escape from a ground grapple is the same Quick Contest as above, but DX penalties for being grappled still apply

---

## Key Traits for Grapplers

- **High ST** — the single most important attribute; affects both the initial grab (if using ST-based Neck Snap) and all follow-up Quick Contests
- **Wrestling** or **Judo** — buy these up; defaulting to DX for grapple follow-ups is risky
- **Trained by a Master** [30 pts] — unlocks the full cinematic technique suite and halves Rapid Strike penalties, useful for grapple+strike combos
- **High Pain Threshold** [10 pts] — immune to shock penalties from -4 DX; useful defensively when grappled

---

## Quick Summary (Sequence Cheat-Sheet)

1. **Attack** — roll vs. DX / Brawling / Judo / Wrestling to grab
2. Defender **active-defends** (Dodge / Parry / Block)
3. On success: target is Grappled (-4 DX, limited movement)
4. Each subsequent turn: **maintain free**, then choose a follow-up:
   - Takedown → prone
   - Pin → helpless
   - Choke Hold → fatigue/unconscious
   - Lock → limb disabled
   - Throw → sent flying
5. Victim's turn: **Quick Contest** to break free (ST or grappling skill)

---

For the full rules text see **GURPS Basic Set: Campaigns**, pp. 370-378. Martial arts expansion rules (additional techniques, styles) are in **GURPS Martial Arts** (not covered in this reference).
